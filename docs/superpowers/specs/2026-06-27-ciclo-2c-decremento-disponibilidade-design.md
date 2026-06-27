# Ciclo 2 · Fatia 2c — Decremento por venda + Disponibilidade

> Spec de design. Base: C0 + todo o Ciclo 1 + 2a (Estoque) + 2b (Receitas/BOM) em `main`
> (origin/main bffab27, 173 testes). Convenções: **quantidades inteiras em unidade-base**; **estoque
> derivado (Σ deltas)**, `StockMovement` append-only; **MwSt não toca aqui**; **TDD**; **127.0.0.1**
> (Postgres **5433**; API :3001); inglês / termos de domínio em alemão.

## Problema

A 2a tem estoque, a 2b tem receitas. Falta **conectar a venda ao estoque**: quando um item é
vendido/produzido, baixar os insumos da sua receita; e mostrar **quantas unidades dá pra fazer**
("disponibilidade") com o estoque atual. É o fechamento operacional do Ciclo 2 (só os alertas, 2d,
ficam de fora).

## Decisões travadas (brainstorming 2026-06-27)

1. **Decremento no momento da produção/venda real:** na **Bestellung** (salão, item *fired*) e no
   **Order de venda direta** (takeaway, `tischSessionId == null`). O **Order de pagamento do salão
   NÃO decrementa** (já baixou na Bestellung) → sem dupla contagem.
2. **Síncrono e atômico** — os movimentos de saída entram na **mesma transação** da Bestellung/Order.
   O decremento só roda no caminho de criação (duplicata retorna antes) → **idempotente**; o
   `clientEventId` único garante rollback em corrida.
3. **Estoque pode ficar negativo** (2a) — o decremento **nunca bloqueia** a venda. Alerta = 2d.
4. **Storno (qty negativa) devolve estoque** — cai de `qty * qtySold` (consumo negativo → `qtyDelta`
   positivo).

## Modelo

- `StockMovement.type` ganha **`'consume'`** (qtyDelta negativo). `aggregateStock` já soma tudo →
  `GET /stock` (2a) reflete consumo automaticamente.
- `StockMovement` ganha **`refType String?` + `refId String?`** (nullable) → liga o consumo à venda
  (`'bestellung'|'order'` + id). Rastreabilidade Wareneinsatz↔venda. `ALTER TABLE ADD COLUMN`
  (não viola append-only — migração do owner; o trigger só barra UPDATE/DELETE de linha). GRANT já
  existe (colunas novas herdam o grant da tabela).

## Lógica

- **`consumeForSale(tx, { kasseId, lines, refType, refId })`** — função em
  `apps/api/src/stock/consume.ts` que recebe o `tx` (Prisma transaction client). Resolve o `tenantId`
  via Kasse→Betriebsstätte; busca as **receitas ativas** das `(produto, variante?)` das linhas; monta
  `SoldLine[]`; roda `aggregateConsumption` (2b); insere 1 `StockMovement` `consume` por insumo
  (`qtyDelta = −consumo`; pula 0; `refType/refId`). Linhas **sem receita ativa** → não decrementam.
- **`maxProducible(ingredients, stockByItem) → number`** (puro, compliance): `min` sobre os insumos
  de `floor(estoque / qtyReceita)`, clamp ≥ 0 (estoque negativo/insuficiente → 0; sem ingredientes
  → 0). Ignora ingredientes com `qty ≤ 0`.

## Hooks

- `LedgerService.ingest` (PosModule): após criar o Order, **se `tisch_session_id == null`** →
  `consumeForSale(tx, { kasseId, lines: p.items, refType: 'order', refId: order.id })`.
- `TablesService.addBestellung` (TablesModule): após criar a Bestellung →
  `consumeForSale(tx, { kasseId, lines: event.items, refType: 'bestellung', refId: b.id })`. (Vale
  em Ausfall também.)

> `lines` = `{ productId, variantId ?? null, qty }[]` (qty pode ser negativa em Storno).

## API — disponibilidade

- **`GET /recipes/availability`** (`recipe.view`) → por receita **ativa**: `{ recipeId, productId,
  productName, variantName, maxProducible }`. Usa `aggregateStock` (níveis do tenant) + `maxProducible`.
  Produtos **sem receita** não aparecem (não rastreados).

## Backoffice

A seção **Receitas** mostra o **maxProducible** ao lado de cada receita (de `GET /recipes/availability`,
casado por `recipeId`). Build + typecheck.

## Erros / bordas

- Produto sem receita ativa → sem movimento (ok).
- Estoque insuficiente → negativo, não bloqueia.
- Retry de venda → idempotente (sem duplo decremento; rollback por unique em corrida).
- Storno (qty −) → devolve estoque.
- Receita inativa → não decrementa nem entra na disponibilidade.

## Testes e verificação

- **Unit (puro):** `maxProducible` (min/floor; insumo faltando → 0; estoque negativo → 0; sem
  ingredientes → 0; ignora qty ≤ 0).
- **API (e2e):** venda direta (`/pos/sync`) baixa estoque conforme a receita; **Bestellung do salão
  baixa**; **pagamento do salão NÃO re-baixa** (sem dupla contagem); Storno devolve; **idempotência**
  (retry não duplica o consumo); estoque pode ir a negativo; produto sem receita não baixa.
  Disponibilidade: `GET /recipes/availability` reflete o estoque atual.
- **Capstone (e2e):** `receive` insumos → abrir mesa → Bestellung Eisbecher **L** → `GET /stock`
  caiu exatamente (−200ml Milch / −80g Zucker) com movimentos `consume` ligados (`refType:'bestellung'`)
  → `GET /recipes/availability` recalcula o maxProducible.

## Decomposição (4 chunks TDD)

1. **puro** — `maxProducible` em `@gelato/compliance` + build dist.
2. **decremento** — schema (`type 'consume'` + `refType/refId`) via migração não-interativa;
   `consumeForSale`; hooks em `ledger.ingest` (venda direta) + `addBestellung` (salão); e2e.
3. **disponibilidade** — `GET /recipes/availability` no módulo recipes + e2e.
4. **capstone + backoffice + integrar** — capstone e2e + `maxProducible` na seção Receitas;
   build/typecheck; `pnpm -r test`; merge `ciclo-2c → main` + push.

## Fora de escopo (fatias seguintes / YAGNI)

Alertas de baixo/negativo (**2d** — `minStock` já existe); reserva/decremento ao *abrir* a conta
(decrementa só ao *fired*); modifier-BOM; custo/valorização do Wareneinsatz; produção/semi-acabados
(Ciclo 5); reversão automática de consumo ao cancelar uma sessão inteira (Storno explícito cobre);
conversão de unidades.

## Validação externa (rastrear)

Wareneinsatz é relevante p/ GoBD, mas aqui o consumo é **quantitativo** (não valorizado) e os
movimentos são append-only/rastreáveis (refType/refId) → registro sólido. Valorização (custo médio/
FIFO) fica para depois → **Steuerberater** se necessário p/ relatórios fiscais.
