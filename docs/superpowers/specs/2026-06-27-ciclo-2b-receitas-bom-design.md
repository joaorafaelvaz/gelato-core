# Ciclo 2 · Fatia 2b — Receitas/BOM (Recipe + RecipeIngredient)

> Spec de design. Base: C0 + todo o Ciclo 1 + 2a (Estoque) em `main` (origin/main cc3eb69,
> 163 testes). Convenções: **quantidades inteiras em unidade-base** do insumo (g/ml/Stück — sem
> floats); **master-data mutável** (receita NÃO é fiscal, NÃO append-only); **MwSt não toca aqui**;
> **TDD**; **127.0.0.1** (Postgres **5433** por coexistência; API :3001); inglês / termos de domínio
> em alemão. RBAC `recipe.view`/`recipe.manage` **já existe** (papel `lagerist`).

## Problema

A 2a cadastrou insumos e movimentos; o catálogo (1a-3) vende produtos+variantes. Falta a **ponte**:
quanto de cada insumo entra numa unidade vendida. A 2b modela a **receita (BOM)** por linha
vendável + a **explosão pura** de consumo. Decremento por venda e disponibilidade ("quantas posso
fazer") são a **2c**, que se apoia nesta base.

## Decisões travadas (brainstorming 2026-06-27)

1. **Receita por `(produto, variante?)`** — produto sem variante → 1 receita (`variantId null`);
   com variantes → 1 por variante (S/M/L consomem diferente). Casa com a linha de venda da 1a-3.
2. **Modifier-BOM adiado** — 2b cobre só a unidade base; o modelo aceita `modifierId` no futuro
   sem refazer ("extra Sahne" ainda não decrementa creme).
3. **Yield = 1 unidade vendida** (sem `yield_qty`; lote/semi-acabado = Ciclo 5).
4. **`qty` do ingrediente em unidade-base do insumo** (ml/g/Stück, herda do `StockItem`, sem
   conversão), inteiro. Igual à disciplina da 2a.
5. **Master-data MUTÁVEL** (não fiscal, não append-only) — GRANT DML completo, como
   product_categories/variants/modifiers.

## Dados

- **`Recipe`** (mutável): `id, tenantId, productId, variantId?`, `active Boolean`, `createdAt`,
  `updatedAt`. **Unicidade: 1 receita por `(productId, variantId)`** — `@@unique([productId,
  variantId])` cobre o caso COM variante; o caso `variantId null` (produto-nível) é guardado no
  serviço no create (findFirst antes de inserir).
- **`RecipeIngredient`** (mutável): `id, recipeId, stockItemId, qty Int` (unidade-base do insumo).
  FK→`Recipe` (`onDelete: Cascade`) e →`StockItem`. `@@unique([recipeId, stockItemId])` (1 linha
  por insumo por receita).

> GRANT explícito `SELECT,INSERT,UPDATE,DELETE … TO gelato_app` para ambas (master-data nova precisa
> do grant — vide 2a/1a-3). Sem trigger de append-only.

## Lógica pura (`@gelato/compliance/src/recipe/`, testável sem banco)

- **`explodeRecipe(ingredients, qtySold) → { stockItemId, qty }[]`** — `qty = ingrediente.qty *
  qtySold` por insumo. `qtySold = 0` → tudo 0 (ou lista vazia? devolve com qty 0 por insumo).
- **`aggregateConsumption(lines) → { stockItemId, qty }[]`** — soma o consumo por insumo numa
  cesta de linhas vendidas (cada `line = { ingredients, qtySold }`), ordenado por `stockItemId`.
  **É a base que a 2c usa** para decrementar e calcular disponibilidade.

(Vive junto de `aggregateStock`/`aggregateTab`/`apportionSplit` — agregações puras do pacote.)

## API (`apps/api/src/recipes`) — RBAC já existe

| Rota | RBAC | Corpo | Efeito |
|---|---|---|---|
| `GET /recipes` | `recipe.view` | — | receitas do tenant **enriquecidas**: nome do produto/variante + ingredientes (`stockItemId`, nome+unidade do insumo, `qty`). |
| `POST /recipes` | `recipe.manage` | `{ product_id, variant_id?, ingredients: [{stock_item_id, qty}] }` | cria `Recipe` + `RecipeIngredient`s. **409** se já existe p/ `(produto, variante)`; **404** se produto/insumo de outro tenant; **400** se `ingredients` vazio / `qty ≤ 0`. |
| `PUT /recipes/:id` | `recipe.manage` | `{ ingredients?, active? }` | substitui o conjunto de ingredientes e/ou liga-desliga `active` (mutável). **404** se receita de outro tenant. |

- **DTOs** zod: `qty` inteiro positivo; `ingredients` ≥ 1; `stock_item_id`/`product_id` não vazios.
- **Tenant** do JWT; valida que produto, variante (se houver) e cada insumo pertencem ao tenant.

## Seed

Receitas demo para o **Eisbecher** (var-s/m/l, prod-eisbecher) usando os insumos da 2a
(`stock-milch` ml, `stock-zucker` g): **S** = 100ml+40g, **M** = 150ml+60g, **L** = 200ml+80g.
ids fixos `rec-becher-s/m/l` (upsert idempotente; ingredientes com ids fixos também).

## Backoffice (mínimo)

Seção **"Receitas"**: lista as receitas (produto/variante → ingredientes `qty unidade — nome`).
Leitura apenas; edição rica (form multi-ingrediente) = depois. Build + typecheck.

## Erros / bordas

- Receita duplicada p/ `(produto, variante)` → **409**.
- Produto/variante/insumo de outro tenant → **404**.
- `ingredients` vazio ou `qty ≤ 0` → **400**.
- Insumo repetido na mesma receita → **400** (ou unique no DB).
- `active=false` → some da explosão futura (2c); na 2b só afeta exibição/flag.

## Testes e verificação

- **Unit (puro):** `explodeRecipe` (multiplicação, qty 0); `aggregateConsumption` (soma multi-linha,
  multi-insumo, ordenado, cesta vazia → []).
- **API (e2e):** cria receita → `GET` enriquecido mostra ingredientes; 409 duplicado; 404
  cross-tenant; `PUT` troca o conjunto de ingredientes; `qty ≤ 0`/vazio → 400.
- **Capstone (e2e):** cria receitas S+L via API → busca via `GET` → cesta "2×L + 1×S" alimentada em
  `aggregateConsumption` → consumo de Milch/Zucker correto (ponte p/ a 2c, **sem tocar estoque**).
- **Backoffice:** build + typecheck.

## Decomposição (4 chunks TDD)

1. **puro** — `explodeRecipe` + `aggregateConsumption` em `@gelato/compliance` (+ build dist).
2. **modelo + seed** — `Recipe` + `RecipeIngredient` (mutável, GRANT DML) via migração não-interativa
   (migrate diff + db execute + migrate resolve --applied); seed Eisbecher S/M/L.
3. **API** — módulo `recipes` (`GET/POST/PUT`) com RBAC + DTOs zod; e2e + capstone.
4. **backoffice (mínimo)** — seção Receitas (lista) + build/typecheck; integrar `ciclo-2b → main`.

## Fora de escopo (fatias seguintes / YAGNI)

Decremento por venda + disponibilidade "quantas posso fazer" (**2c**); alertas de baixo/negativo
(2d); **modifier-BOM**; custo/valorização (`cost_at_creation`/avg_cost, Wareneinsatz valorizado);
produção em lote / semi-acabados / **BOM 2 níveis** (Ciclo 5); conversão de unidades; versionamento
de receita; edição rica no backoffice.

## Validação externa (rastrear)

Nenhuma fiscal — receita/BOM é operacional. (Valorização do Wareneinsatz p/ GoBD seria fiscal, mas
custo está fora de escopo.)
