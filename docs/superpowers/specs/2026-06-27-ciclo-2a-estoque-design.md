# Ciclo 2 · Fatia 2a — Estoque (StockItem + StockMovement)

> Spec de design. Base: C0 + todo o Ciclo 1 (1b/1c/1d + 1a-1..1a-4) em `main` (152 testes,
> origin/main 90a8c04). Convenções: **quantidades inteiras em unidade-base** (g/ml/Stück — sem
> floats, igual à disciplina de **cents**); **append-only** (estoque derivado, nunca materializado);
> **MwSt da `tax_rates`** (não toca aqui); **TDD**; **127.0.0.1** (Postgres em **5433** por
> coexistência — API :3001 / pos-web/backoffice por coexistência); inglês / termos de domínio em
> alemão. RBAC `stock.view/receive/adjust/count` **já existe** (papel `lagerist`).

## Problema

O PDV registra vendas, mas não sabe o que tem em estoque. A 2a é a **fundação operacional** do
Ciclo 2: cadastrar insumos (`StockItem`) e registrar **movimentos append-only** (entrada/ajuste/
contagem), com o **estoque atual derivado** da soma dos movimentos. Receitas/BOM (2b), decremento
por venda (2c) e alertas (2d) dependem desta base.

> **Natureza:** estoque é **operacional**, não fiscal §146a/TSE. Mas modelamos `StockMovement`
> como **append-only** (auditabilidade/rastreabilidade do Wareneinsatz) — reusando o mecanismo
> de imutabilidade do banco (GRANT SELECT/INSERT + trigger), **separado** da lista fiscal legal.

## Decisões travadas (brainstorming 2026-06-27)

1. **Estoque = Σ deltas assinados.** Cada `StockMovement` é um delta: entrada (+), ajuste (+/−).
   A **contagem (Inventur)** vira um movimento que grava o delta `(contado − atual)` — fica
   auditada como uma correção. Estoque atual = **Σ `qtyDelta`** por item. Nunca materializado.
2. **Quantidades inteiras em unidade-base** (g/ml/Stück; kg/L → g/ml). Sem floats.

## Dados

- **`StockItem`** (master data, **mutável**): `id, tenantId, name, unit` (string livre: `'g'`,
  `'ml'`, `'Stück'`…), `minStock Int?` (limiar p/ alertas da 2d — já entra o campo), `active Boolean`.
  GRANT explícito `SELECT,INSERT,UPDATE,DELETE … TO gelato_app` (master-data nova precisa do grant).
- **`StockMovement`** (**append-only**): `id, tenantId, stockItemId, type` (`'receive'|'adjust'|
  'count'`), `qtyDelta Int` (assinado), `reason String?`, `createdBy String?`, `createdAt`. GRANT
  só `SELECT,INSERT` + trigger `fiscal_append_only()` (reuso do mecanismo, fim operacional).

## Lógica pura (`@gelato/compliance`, testável sem banco)

**`aggregateStock(movements) → { stockItemId, qty }[]`** — agrupa por `stockItemId` e soma
`qtyDelta`. Determinística, ordenada por `stockItemId`. Cobre: soma simples, deltas negativos,
item sem movimentos (não aparece / qty 0), contagem como ajuste. (Vive junto das outras agregações
puras do pacote: `aggregateTab`, `apportionSplit`, reports.)

## API (`apps/api/src/stock`) — RBAC já existe

| Rota | RBAC | Corpo | Efeito |
|---|---|---|---|
| `GET /stock` | `stock.view` | — | nível atual por item: `aggregateStock` sobre os movimentos do tenant + dados do `StockItem` (name/unit/minStock). Itens sem movimento aparecem com `qty 0`. |
| `POST /stock/items` | `stock.adjust` | `{ name, unit, min_stock? }` | cria `StockItem` (tenant da Kasse/usuário). |
| `POST /stock/receive` | `stock.receive` | `{ stock_item_id, qty, reason? }` | movimento `receive` com `qtyDelta = +qty` (qty > 0). |
| `POST /stock/adjust` | `stock.adjust` | `{ stock_item_id, qty_delta, reason? }` | movimento `adjust` com `qtyDelta = qty_delta` (≠ 0; pode ser negativo). |
| `POST /stock/count` | `stock.count` | `{ stock_item_id, counted }` | calcula `delta = counted − atual` (atual via `aggregateStock`); insere movimento `count` com `qtyDelta = delta` (mesmo que 0). |

- **DTOs** zod (igual ao resto da API): `qty`/`counted` inteiros ≥ 0; `qty_delta` inteiro ≠ 0.
- **Tenant:** resolvido do JWT/Kasse (como nas outras controllers). Item de outro tenant → **404**.
- **Seed:** 2 insumos demo — ex. `stock-milch` (`Milch`, unit `ml`) e `stock-zucker` (`Zucker`,
  unit `g`) — cada um com 1 movimento `receive` inicial (ex. 10000 ml / 5000 g).

## Backoffice (mínimo)

Seção **"Estoque"**: tabela com `name`, `unit`, **estoque atual** (de `GET /stock`) e `minStock`.
Um formulário simples de **entrada rápida** (`POST /stock/receive`) e **contagem** (`POST /stock/count`).
Ajuste/criação de item = mínimos. UI rica/edição inline = depois. Build + typecheck verdes.

## Erros / bordas

- Item de outro tenant em qualquer rota → **404**.
- `receive.qty ≤ 0` / `adjust.qty_delta == 0` → **400** (zod).
- Estoque pode ficar **negativo** (ajuste/consumo) — **permitido e visível**, não bloqueia (o
  alerta de baixo/negativo é a 2d; o decremento por venda é a 2c).
- `count` quando o item nunca teve movimento → `atual = 0`, delta = `counted`.
- `StockMovement` **append-only**: UPDATE/DELETE bloqueados (trigger + grant) — testado.

## Testes e verificação

- **Unit (puro):** `aggregateStock` — Σ por item, deltas negativos, contagem-como-ajuste, item sem
  movimento, multi-item ordenado.
- **API (e2e):** `receive` → `GET /stock` mostra a qtd; `adjust` negativo reduz; `count` gera o
  delta `(counted − atual)` e o `GET` passa a mostrar `counted`; item de outro tenant → 404;
  **imutabilidade** de `stock_movements` (UPDATE/DELETE falham).
- **Capstone (e2e):** cria item → `receive 1000` → `adjust −250` (atual 750) → `count 700` (gera
  movimento `count` de delta −50) → `GET /stock` = **700**; e o histórico tem 3 movimentos.
- **Backoffice:** build + typecheck; (verificação ao vivo opcional, como nas fatias do salão).

## Decomposição (4 chunks TDD)

1. **puro + domínio** — `aggregateStock` em `@gelato/compliance` (+ build do dist); schemas zod dos
   movimentos/DTOs em `@gelato/domain` (`StockMovementType`, `StockItem` shape) se fizer sentido.
2. **modelo + imutabilidade + seed** — `StockItem` (master, mutável, GRANT completo) + `StockMovement`
   (append-only, GRANT SELECT/INSERT + trigger) via migração **não-interativa** (migrate diff + db
   execute + migrate resolve --applied); seed dos 2 insumos demo.
3. **API** — módulo `stock` (`GET /stock`, `POST /stock/items|receive|adjust|count`) com RBAC +
   DTOs zod; e2e (incl. imutabilidade + multi-tenant) + capstone.
4. **backoffice (mínimo)** — seção Estoque (lista + entrada/contagem) + build/typecheck; integrar.

## Fora de escopo (fatias seguintes / YAGNI)

Receitas/BOM (2b); decremento por venda (2c); alertas de baixo/negativo (2d — `minStock` já entra
o campo); conversão de unidades; lotes/validade (Charge/MHD); múltiplos depósitos; custo/Wareneinsatz
valorizado (FIFO/médio); fornecedores/pedidos de compra; edição/desativação rica no backoffice.

## Validação externa (rastrear, não resolver no código)

Retenção/forma dos registros de estoque para **GoBD** (o Wareneinsatz é relevante fiscalmente,
embora não seja TSE) → **Steuerberater**. Mantemos append-only + auditável por precaução.
