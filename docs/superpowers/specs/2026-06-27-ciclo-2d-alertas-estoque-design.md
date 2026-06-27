# Ciclo 2 · Fatia 2d — Alertas de estoque (baixo/negativo)

> Spec de design. Base: C0 + Ciclo 1 + 2a + 2b + 2c em `main` (origin/main bf432c9, 183 testes).
> Convenções: **estoque derivado** (Σ deltas), nada materializado; **TDD**; **127.0.0.1** (5433;
> API :3001); inglês / termos de domínio em alemão. **Fecha o Ciclo 2.**

## Problema

A 2a tem `minStock` no `StockItem` e o `GET /stock` já devolve `qty`+`minStock`; a 2c faz o estoque
cair (e ir a negativo). Falta **sinalizar o que precisa de atenção**: insumos abaixo do mínimo
(reabastecer) ou negativos (oversold/erro de contagem). A 2d transforma os dados existentes em uma
lista de alertas acionável.

## Decisões travadas (brainstorming 2026-06-27)

1. **Alerta = leitura derivada (pull).** Sem tabela/eventos novos; `GET /stock/alerts` calcula na
   hora a partir do estoque atual. Consistente com todo o sistema (estoque/conta/disponibilidade
   são derivados, nunca materializados). YAGNI — sem infra de entrega.
2. **Escopo: insumo baixo/negativo.** Indisponibilidade de produto (`maxProducible==0`) já vem do
   `GET /recipes/availability` (2c) — a UI destaca sem novo backend.

## Estados (3) — regra pura

`classifyStockAlert(qty, minStock) →`
- **`negative`** se `qty < 0` (oversold — mais urgente; vale mesmo sem `minStock`).
- **`low`** se `minStock != null && 0 ≤ qty < minStock`.
- **`ok`** caso contrário. (Insumo sem `minStock` só alerta se negativo; `qty == minStock` → ok.)

## Lógica pura (`@gelato/compliance/src/stock/alerts.ts`)

- `classifyStockAlert(qty, minStock) → 'ok' | 'low' | 'negative'`.
- `stockAlerts(items) → (item & { state })[]` — genérica/pass-through `<T extends { qty: number;
  minStock: number | null }>`: mapeia o estado, **filtra os `ok`**, **ordena por severidade**
  (`negative` antes de `low`; dentro, `qty` ascendente = mais crítico primeiro). Testável sem banco.

## API

- **`GET /stock/alerts`** (`stock.view`) → `stockAlerts(levels(tenant))` = só os insumos em alerta,
  `{ id, name, unit, qty, minStock, state }`, ordenados. Reusa o `levels()` da 2a.

## Backoffice

A seção **Estoque** ganha um **banner de alertas** (de `GET /stock/alerts`): "⚠ N em alerta" + os
nomes; as linhas negativas ficam mais destacadas que as baixas. (Produto indisponível já aparece
como "dá p/ 0" na seção Receitas.) Build + typecheck.

## Erros / bordas

- Insumo sem `minStock` → nunca `low`; só `negative` se `< 0`.
- `qty == minStock` → `ok` (não é low). `qty == 0` com `minStock` → `low`; sem `minStock` → `ok`.
- Tudo ok → lista vazia.

## Testes e verificação

- **Unit (puro):** `classifyStockAlert` (negative/low/ok; sem minStock; bordas `qty==minStock`/`0`);
  `stockAlerts` (filtra ok; ordena negative→low e por qty).
- **API (e2e):** insumo abaixo do mínimo → `low`; oversold → `negative`; insumo ok → não aparece;
  ordenação por severidade.
- **Capstone (e2e):** insumo `minStock 100`, `receive 120` (ok, fora dos alertas) → vender via
  receita até `qty 80` → vira `low` em `/stock/alerts` → vender até negativo → vira `negative`
  (liga 2c → 2d).
- **Backoffice:** build + typecheck.

## Decomposição (3 chunks TDD)

1. **puro** — `classifyStockAlert` + `stockAlerts` em `@gelato/compliance` + build dist.
2. **API** — `GET /stock/alerts` no módulo stock + e2e + capstone (venda → low → negative).
3. **backoffice + integrar** — banner de alertas na seção Estoque; build/typecheck; `pnpm -r test`;
   merge `ciclo-2d → main` + push. **Fecha o Ciclo 2.**

## Fora de escopo (YAGNI)

Notificações push/e-mail/persistentes (tabela de alertas, ack/dismiss, histórico); regras de
reabastecimento / pedido de compra; alertas por validade/lote; thresholds por canal; produto
indisponível como alerta de 1ª classe (derivável da 2c).

## Validação externa

Nenhuma — alertas são operacionais/derivados.
