# Ciclo 5 · Fatia 5a — Produção / BOM 2 níveis (semi-acabados)

> Spec de design. Base: C0 + Ciclo 1 (menos 1e) + Ciclos 2/3/4 em `main` (origin/main c808ab9, 259
> testes). Convenções: **quantidades inteiras em unidade-base**; **estoque derivado (Σ deltas),
> `StockMovement` append-only**; **TDD**; **127.0.0.1** (5433; API :3001). RBAC `stock.view/adjust`
> já existe (papel `lagerist`). Depende de 2a (StockItem/StockMovement) + 2b/2c (receita de venda).

## Problema

A 5a abre o Ciclo 5 (Avançado) com **produção de semi-acabados** (BOM 2 níveis): uma base (ex.
"Eisbasis") é **produzida em lotes** a partir de insumos, vira um `StockItem` com estoque, e é
**consumida** pela receita de venda de um produto acabado (2b/2c). Raw → semi (produção) → acabado
(venda).

## Decisões travadas (brainstorming 2026-06-29)

1. **Receita de produção dedicada** (`ProductionRecipe`), separada da receita de venda (2b). O
   semi-acabado é um `StockItem` normal (tem estoque + vira insumo de outra receita).
2. **Produção em lotes inteiros** (1 lote rende `yieldQty`; N lotes = N×yield / N×ingredientes).
3. **Permitir produzir com insumo insuficiente** (estoque negativo, visível) — consistente com o
   decremento de venda (2c) e a disciplina do sistema (nunca bloquear; alerta na 2d).
4. **Movimentos append-only** reusando `StockMovement`: tipo `'produce'` (+ saída) e `'consume'`
   (− insumos), com `refType:'production'` + `refId:runId` (agrupa um lote). **Sem migração de tipo**
   (`type` é String) e **sem entidade de ordem de produção** (a trilha são os próprios movimentos).

## Lógica pura (`@gelato/compliance/src/production/`)

- **`explodeProduction(outputStockItemId, yieldQty, ingredients, batches) → { produce, consume }`** —
  `produce = { stockItemId: outputStockItemId, qty: yieldQty * batches }`; `consume = ingredients.map(
  i => ({ stockItemId: i.stockItemId, qty: i.qty * batches }))`. Puro, inteiro.

## Dados

- **`ProductionRecipe`** (master, **mutável**): `id, tenantId, outputStockItemId, yieldQty Int,
  active Boolean @default(true)`, `createdAt, updatedAt`. `@@unique([tenantId, outputStockItemId])`
  (1 receita de produção por semi-acabado). FK→`StockItem` (output). GRANT DML.
- **`ProductionRecipeIngredient`** (mutável): `id, productionRecipeId, stockItemId, qty Int`.
  FK→`ProductionRecipe` (`onDelete: Cascade`) + `StockItem`. `@@unique([productionRecipeId,
  stockItemId])`. GRANT DML.

> `StockMovement.type` ganha os valores `'produce'`/`'consume'` (já existe `'consume'` da 2c) — **sem
> alteração de schema** (`type` é String). `aggregateStock` soma todos os `qtyDelta`.

## API (`apps/api/src/production`) — RBAC já existe

| Rota | RBAC | Efeito |
|---|---|---|
| `GET /production/recipes` | `stock.view` | receitas de produção do tenant, enriquecidas (nome do output + ingredientes c/ nome/unidade). |
| `POST /production/recipes` `{ output_stock_item_id, yield_qty, ingredients: [{stock_item_id, qty}] }` | `stock.adjust` | cria; **409** se já há receita p/ o output; **404** item de outro tenant; **400** `yield_qty ≤ 0` ou `ingredients` vazio. |
| `POST /production` `{ output_stock_item_id, batches }` | `stock.adjust` | acha a receita **ativa** do output → `explodeProduction` → grava movimentos (`consume` −qty por insumo, `produce` +qty do output) num `$transaction` com `refType:'production', refId:runId` → devolve `{ runId, produce, consume }`. **404** sem receita; **400** `batches ≤ 0`. |

`tenantId` do JWT (produção é ação de gestão, não numa Kasse). `runId` = `crypto.randomUUID()`.

## Seed

Semi-acabado `stock-eisbasis` (Eisbasis, `ml`) + `ProductionRecipe` (output Eisbasis, `yieldQty
10000`, ingredientes `stock-milch 8000` + `stock-zucker 2000`).

## Backoffice (mínimo)

Seção **"Produção"**: lista das receitas de produção (output → ingredientes, rendimento) + form
"produzir N lotes". Build + typecheck.

## Erros / bordas

- Sem receita de produção p/ o output → **404**. `batches`/`yield_qty` ≤ 0 → **400**. Insumo
  insuficiente → produz mesmo assim (negativo, alerta 2d). Output/insumo de outro tenant → **404**.
  Receita de produção duplicada p/ o output → **409**. Movimentos append-only (já garantido pela 2a).

## Testes e verificação

- **Unit (puro):** `explodeProduction` (produce/consume escalados por batches; batches 0 e 1).
- **API (e2e):** criar receita (409 duplicada, 404 cross-tenant, 400 inválida); **produzir** gera os
  `consume`/`produce` certos e o `GET /stock` reflete (output ↑, insumos ↓); produzir sem receita → 404.
- **Capstone (2 níveis):** receber Milch/Zucker → **produzir** 2 lotes de Eisbasis (Milch −16000,
  Zucker −4000, Eisbasis +20000) → criar produto acabado + receita de venda (2b) usando Eisbasis →
  **vender** o acabado (`/pos/sync`) → Eisbasis decrementado (2c). Raw → semi → acabado.
- **Backoffice:** build + typecheck.

## Decomposição (4 chunks TDD)

1. **puro** — `explodeProduction` em `@gelato/compliance` + build dist.
2. **modelo + seed** — `ProductionRecipe` + `ProductionRecipeIngredient` (mutável, GRANT DML) via
   migração não-interativa; seed (Eisbasis + receita de produção).
3. **API** — módulo `production` (CRUD de receitas + produzir) + e2e + capstone (produção + decremento
   2 níveis).
4. **backoffice (Produção)** + build/typecheck; integrar `ciclo-5a → main` + push.

## Fora de escopo (Ciclo 5 / YAGNI)

Ordem de produção com status (planejada→feita); custo/valorização do semi-acabado; BOM de 3+ níveis
explodido recursivamente num clique (aqui é por nível: produz semi, depois vende); validade/lote
(Charge/MHD) do semi-acabado; perdas/rendimento real vs teórico; balança Dialog 06 (**5b**); BI
(**5c**); app mobile (**5d**).

## Validação externa

Nenhuma fiscal direta (produção é operacional/estoque). Valorização do semi-acabado p/
Wareneinsatz/GoBD seria fiscal — fora de escopo (sem custo, como na 2a/2b) → Steuerberater se vier.
