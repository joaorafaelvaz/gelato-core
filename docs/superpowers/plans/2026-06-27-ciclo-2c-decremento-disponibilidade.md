# Ciclo 2 · Fatia 2c — Decremento por venda + Disponibilidade — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A venda baixa o estoque pela receita (movimentos `consume`, na produção/venda direta) e o sistema mostra a disponibilidade ("quantas posso fazer") por receita.

**Architecture:** Pura `maxProducible` em `@gelato/compliance` → `StockMovement` ganha `type 'consume'` + `refType/refId` → helper `consumeForSale(tx, …)` que resolve receitas e cria movimentos de saída, chamado dentro das transações de `ledger.ingest` (venda direta, `tischSessionId==null`) e `addBestellung` (salão) → `GET /recipes/availability`. Consumo = `aggregateConsumption` (2b). Estoque pode ir a negativo; nunca bloqueia a venda; idempotente (só no caminho de criação).

**Tech Stack:** TypeScript strict, vitest, NestJS, Prisma + Postgres (**5433**), zod, React/Vite.

**Spec:** `docs/superpowers/specs/2026-06-27-ciclo-2c-decremento-disponibilidade-design.md`

**Pré-requisitos:** Postgres up (`-p gelato_c0`, 5433); branch `ciclo-2c` (off `main`).

---

## Chunk 1: `maxProducible` (puro)

**Files:**
- Create: `packages/compliance/src/recipe/availability.ts`
- Create: `packages/compliance/test/recipe-availability.test.ts`
- Modify: `packages/compliance/src/index.ts` (`export * from './recipe/availability'`)

- [ ] **Step 1: Write the failing test**

`packages/compliance/test/recipe-availability.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { maxProducible } from '../src/recipe/availability'

describe('maxProducible', () => {
  const stock = new Map<string, number>([['milch', 1000], ['zucker', 300]])

  it('is the limiting ingredient (min over floor(stock/qty))', () => {
    // milch: floor(1000/200)=5 ; zucker: floor(300/80)=3 → 3
    expect(maxProducible([{ stockItemId: 'milch', qty: 200 }, { stockItemId: 'zucker', qty: 80 }], stock)).toBe(3)
  })

  it('0 when an ingredient is missing or stock is negative', () => {
    expect(maxProducible([{ stockItemId: 'unknown', qty: 1 }], stock)).toBe(0)
    expect(maxProducible([{ stockItemId: 'x', qty: 10 }], new Map([['x', -5]]))).toBe(0)
  })

  it('0 for an empty recipe; ignores ingredients with qty <= 0', () => {
    expect(maxProducible([], stock)).toBe(0)
    // só milch limita (zucker qty 0 ignorado) → floor(1000/200)=5
    expect(maxProducible([{ stockItemId: 'milch', qty: 200 }, { stockItemId: 'zucker', qty: 0 }], stock)).toBe(5)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `corepack pnpm --filter @gelato/compliance exec vitest run recipe-availability`
Expected: FAIL — import inexistente.

- [ ] **Step 3: Implement**

`packages/compliance/src/recipe/availability.ts`:
```ts
import type { RecipeIngredientInput } from './explode'

/**
 * Quantas unidades vendáveis dá p/ produzir com o estoque atual: o insumo
 * limitante (min de floor(estoque / qtyReceita)). Estoque negativo/insuficiente
 * ou insumo ausente → 0. Sem ingredientes → 0. Ignora qty ≤ 0.
 */
export function maxProducible(ingredients: RecipeIngredientInput[], stockByItem: Map<string, number>): number {
  let min = Infinity
  for (const ing of ingredients) {
    if (ing.qty <= 0) continue
    const have = stockByItem.get(ing.stockItemId) ?? 0
    min = Math.min(min, Math.floor(have / ing.qty))
  }
  return min === Infinity ? 0 : Math.max(0, min)
}
```

- [ ] **Step 4: Export** — `packages/compliance/src/index.ts`: `export * from './recipe/availability'`

- [ ] **Step 5: Run to verify it passes**

Run: `corepack pnpm --filter @gelato/compliance exec vitest run recipe-availability`
Expected: PASS (3 testes).

- [ ] **Step 6: Build dist**

Run: `corepack pnpm --filter @gelato/compliance build`

- [ ] **Step 7: Commit**

```bash
git add packages/compliance/src/recipe/availability.ts packages/compliance/test/recipe-availability.test.ts packages/compliance/src/index.ts
git commit -m "feat(compliance): maxProducible — disponibilidade por receita (puro)"
```

---

## Chunk 2: decremento por venda (schema + consumeForSale + hooks)

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (`StockMovement` + `refType`/`refId`)
- Create: `apps/api/prisma/migrations/<ts>_c2c_consume/migration.sql`
- Create: `apps/api/src/stock/consume.ts`
- Modify: `apps/api/src/pos/ledger.service.ts` (hook na venda direta)
- Modify: `apps/api/src/tables/tables.service.ts` (hook na Bestellung)
- Create: `apps/api/test/stock-consume.e2e.test.ts`

- [ ] **Step 1: Schema — add `refType`/`refId` ao `StockMovement`**

Modify `apps/api/prisma/schema.prisma`, no model `StockMovement`:
```prisma
  type        String // 'receive' | 'adjust' | 'count' | 'consume'
  qtyDelta    Int // inteiro assinado, unidade-base
  reason      String?
  refType     String? // 'bestellung' | 'order' (origem do consumo)
  refId       String?
  createdBy   String?
```
(adicionar as 2 linhas `refType`/`refId` após `reason`; atualizar o comentário de `type`.)

- [ ] **Step 2: Validar + gerar a migração**

```bash
corepack pnpm --filter @gelato/api exec prisma validate
cd apps/api
TS=20260627140000
mkdir -p prisma/migrations/${TS}_c2c_consume
corepack pnpm exec prisma migrate diff \
  --from-schema-datasource prisma/schema.prisma \
  --to-schema-datamodel prisma/schema.prisma \
  --script > prisma/migrations/${TS}_c2c_consume/migration.sql
cd ../..
cat apps/api/prisma/migrations/20260627140000_c2c_consume/migration.sql
```
Expected: `ALTER TABLE "stock_movements" ADD COLUMN "refType" TEXT, ADD COLUMN "refId" TEXT;` (ou dois ALTER). **Sem GRANT extra** (colunas novas herdam o grant da tabela; `stock_movements` já tem SELECT/INSERT p/ gelato_app).

- [ ] **Step 3: Aplicar + marcar + gerar**

```bash
cd apps/api
corepack pnpm exec prisma db execute --schema prisma/schema.prisma --file prisma/migrations/20260627140000_c2c_consume/migration.sql
corepack pnpm exec prisma migrate resolve --applied 20260627140000_c2c_consume
corepack pnpm exec prisma generate
cd ../..
```

- [ ] **Step 4: Implement `consumeForSale`**

`apps/api/src/stock/consume.ts`:
```ts
import type { Prisma } from '@prisma/client'
import { aggregateConsumption, type SoldLine } from '@gelato/compliance'

export interface SaleLine {
  productId: string
  variantId?: string | null
  qty: number
}

/**
 * Decrementa o estoque conforme as receitas das linhas vendidas/produzidas.
 * Roda DENTRO da transação da venda (recebe o tx) → atômico e idempotente
 * (só é chamado no caminho de criação). Linhas sem receita ativa não baixam.
 * Storno (qty negativa) devolve estoque. Estoque pode ir a negativo.
 */
export async function consumeForSale(
  tx: Prisma.TransactionClient,
  params: { kasseId: string; lines: SaleLine[]; refType: 'bestellung' | 'order'; refId: string },
): Promise<void> {
  const kasse = await tx.kasse.findUnique({ where: { id: params.kasseId }, include: { betriebsstaette: true } })
  if (!kasse) return
  const tenantId = kasse.betriebsstaette.tenantId

  const productIds = [...new Set(params.lines.map((l) => l.productId))]
  const recipes = await tx.recipe.findMany({
    where: { tenantId, active: true, productId: { in: productIds } },
    include: { ingredients: true },
  })
  const key = (p: string, v: string | null) => `${p}|${v ?? ''}`
  const byKey = new Map(recipes.map((r) => [key(r.productId, r.variantId), r.ingredients.map((i) => ({ stockItemId: i.stockItemId, qty: i.qty }))]))

  const soldLines: SoldLine[] = []
  for (const l of params.lines) {
    const ingredients = byKey.get(key(l.productId, l.variantId ?? null))
    if (ingredients) soldLines.push({ ingredients, qtySold: l.qty })
  }
  if (soldLines.length === 0) return

  for (const c of aggregateConsumption(soldLines)) {
    if (c.qty === 0) continue
    await tx.stockMovement.create({
      data: { tenantId, stockItemId: c.stockItemId, type: 'consume', qtyDelta: -c.qty, refType: params.refType, refId: params.refId },
    })
  }
}
```

- [ ] **Step 5: Hook na venda direta (`ledger.ingest`)**

Modify `apps/api/src/pos/ledger.service.ts`:
1. Import no topo: `import { consumeForSale } from '../stock/consume'`.
2. Dentro do `this.prisma.$transaction(async (tx) => {…})`, **após** `await tx.auditLog.create({…})` e **antes** do `return { duplicate: false, orderId: order.id }`:
```ts
      // Decremento de estoque (2c): só venda DIRETA (sem sessão de mesa); o salão
      // baixa na Bestellung. Linhas sem receita não baixam. Mesma transação → atômico.
      if (p.order.tisch_session_id == null) {
        await consumeForSale(tx, {
          kasseId: event.kasse_id,
          lines: p.items.map((i) => ({ productId: i.product_id, variantId: i.variant_id ?? null, qty: i.qty })),
          refType: 'order',
          refId: order.id,
        })
      }
```

- [ ] **Step 6: Hook na Bestellung (`addBestellung`)**

Modify `apps/api/src/tables/tables.service.ts`:
1. Import: `import { consumeForSale } from '../stock/consume'`.
2. Dentro do `this.prisma.$transaction(async (tx) => {…})` do `addBestellung`, **após** `const b = await tx.bestellung.create({…})` e antes do `auditLog.create`:
```ts
      // Decremento de estoque (2c): a Bestellung é o ponto de produção do salão.
      await consumeForSale(tx, {
        kasseId: event.kasse_id,
        lines: event.items.map((i) => ({ productId: i.product_id, variantId: i.variant_id ?? null, qty: i.qty })),
        refType: 'bestellung',
        refId: b.id,
      })
```

- [ ] **Step 7: Write the e2e**

`apps/api/test/stock-consume.e2e.test.ts`:
```ts
import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import type { AddressInfo } from 'node:net'
import { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { FakeTseProvider } from '@gelato/compliance'
import { AppModule } from '../src/app.module'

const TENANT = 'demo-tenant'
const tse = new FakeTseProvider({ serialNumber: 'SER-C' })

describe('Stock consume on sale (e2e)', () => {
  let app: INestApplication
  let baseUrl: string
  let token: string
  let prisma: PrismaClient

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = mod.createNestApplication()
    await app.listen(0)
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`
    prisma = new PrismaClient()
    token = ((await (await fetch(`${baseUrl}/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'admin@demo.test', password: 'admin123' }),
    })).json()) as { access_token: string }).access_token
  }, 30000)

  afterAll(async () => {
    await prisma?.$disconnect()
    await app?.close()
  })

  const post = (path: string, body: unknown) =>
    fetch(`${baseUrl}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body) })
  const get = (path: string) => fetch(`${baseUrl}${path}`, { headers: { authorization: `Bearer ${token}` } })

  // Cria insumo + produto + receita (1 insumo, qty por unidade) com estoque inicial.
  async function setup(perUnit: number, initial: number): Promise<{ productId: string; stockId: string }> {
    const stockId = ((await (await post('/stock/items', { name: `c-${crypto.randomUUID().slice(0, 8)}`, unit: 'g' })).json()) as { id: string }).id
    const product = await prisma.product.create({ data: { tenantId: TENANT, name: `P-${crypto.randomUUID().slice(0, 8)}`, netCents: 100, mwstCodeImHaus: 'standard_19', mwstCodeAusserHaus: 'reduced_7' } })
    await post('/recipes', { product_id: product.id, ingredients: [{ stock_item_id: stockId, qty: perUnit }] })
    await post('/stock/receive', { stock_item_id: stockId, qty: initial })
    return { productId: product.id, stockId }
  }

  const levelOf = async (stockId: string): Promise<number> =>
    ((await (await get('/stock')).json()) as { id: string; qty: number }[]).find((l) => l.id === stockId)!.qty

  async function directSale(clientEventId: string, productId: string, qty: number): Promise<Response> {
    const r = await tse.sign({ clientId: 'c1', processType: 'Kassenbeleg-V1', amountsByVatRate: [], paymentType: 'Bar', grossTotal: 119 })
    return post('/pos/sync', {
      client_event_id: clientEventId, type: 'sale', kasse_id: 'demo-kasse',
      payload: {
        order: { mode: 'ausser_haus', total_net: 100 * qty, total_mwst: 19 * qty, total_gross: 119 * qty },
        items: [{ product_id: productId, qty, unit_net: 100, mwst_rate: 0.19, mwst_code: 'standard_19' }],
        payment: { method: 'cash', amount: 119 * qty },
        receipt: { qr_payload: '', format: 'digital' },
        tse_transaction: { tx_number: r.txNumber, signature_counter: r.signatureCounter, signature_value: r.signatureValue, log_time: r.logTime, process_type: r.processType, serial_number: r.serialNumber, public_key: r.publicKey },
      },
    })
  }

  it('a direct sale decrements stock by recipe × qty', async () => {
    const { productId, stockId } = await setup(50, 1000)
    expect(await levelOf(stockId)).toBe(1000)
    expect((await directSale(crypto.randomUUID(), productId, 3)).status).toBe(201)
    expect(await levelOf(stockId)).toBe(850) // 1000 - 3*50
  })

  it('the direct sale is idempotent (no double decrement on retry)', async () => {
    const { productId, stockId } = await setup(50, 1000)
    const id = crypto.randomUUID()
    await directSale(id, productId, 2)
    await directSale(id, productId, 2) // mesmo client_event_id
    expect(await levelOf(stockId)).toBe(900) // 1000 - 1*(2*50)
  })

  it('a product without an active recipe does not decrement', async () => {
    const stockId = ((await (await post('/stock/items', { name: `n-${crypto.randomUUID().slice(0, 8)}`, unit: 'g' })).json()) as { id: string }).id
    await post('/stock/receive', { stock_item_id: stockId, qty: 500 })
    const product = await prisma.product.create({ data: { tenantId: TENANT, name: `NR-${crypto.randomUUID().slice(0, 8)}`, netCents: 100, mwstCodeImHaus: 'standard_19', mwstCodeAusserHaus: 'reduced_7' } })
    await directSale(crypto.randomUUID(), product.id, 5)
    expect(await levelOf(stockId)).toBe(500) // inalterado
  })

  it('salão: Bestellung decrements; the payment does NOT decrement again', async () => {
    const { productId, stockId } = await setup(50, 1000)
    const tisch = `tisch-${crypto.randomUUID().slice(0, 8)}`
    await prisma.tisch.create({ data: { id: tisch, betriebsstaetteId: 'demo-bs', name: 'consume' } })
    const sessionId = ((await (await post(`/pos/tables/${tisch}/open`, { kasse_id: 'demo-kasse' })).json()) as { id: string }).id

    const sign = await tse.sign({ clientId: 'c1', processType: 'Bestellung-V1', amountsByVatRate: [], paymentType: 'Bar', grossTotal: 238 })
    await post(`/pos/sessions/${sessionId}/bestellung`, {
      client_event_id: crypto.randomUUID(), type: 'bestellung', session_id: sessionId, kasse_id: 'demo-kasse',
      items: [{ product_id: productId, qty: 2, unit_net: 100, mwst_rate: 0.19, mwst_code: 'standard_19' }],
      tse_transaction: { tx_number: sign.txNumber, signature_counter: sign.signatureCounter, signature_value: sign.signatureValue, log_time: sign.logTime, process_type: sign.processType, serial_number: sign.serialNumber, public_key: sign.publicKey },
    })
    expect(await levelOf(stockId)).toBe(900) // baixou na Bestellung (1000 - 2*50)

    const pay = await tse.sign({ clientId: 'c1', processType: 'Kassenbeleg-V1', amountsByVatRate: [], paymentType: 'Bar', grossTotal: 238 })
    await post(`/pos/sessions/${sessionId}/pay`, {
      client_event_id: crypto.randomUUID(),
      payment: { method: 'cash', amount: 238 },
      tse: { tx_number: pay.txNumber, signature_counter: pay.signatureCounter, signature_value: pay.signatureValue, log_time: pay.logTime, process_type: pay.processType, serial_number: pay.serialNumber, public_key: pay.publicKey },
    })
    expect(await levelOf(stockId)).toBe(900) // pagamento NÃO re-baixa
  })

  it('a Storno line returns stock', async () => {
    const { productId, stockId } = await setup(50, 1000)
    const tisch = `tisch-${crypto.randomUUID().slice(0, 8)}`
    await prisma.tisch.create({ data: { id: tisch, betriebsstaetteId: 'demo-bs', name: 'storno' } })
    const sessionId = ((await (await post(`/pos/tables/${tisch}/open`, { kasse_id: 'demo-kasse' })).json()) as { id: string }).id
    const mkBest = async (qty: number, stornoOf?: string) => {
      const s = await tse.sign({ clientId: 'c1', processType: 'Bestellung-V1', amountsByVatRate: [], paymentType: 'Bar', grossTotal: 119 })
      return post(`/pos/sessions/${sessionId}/bestellung`, {
        client_event_id: crypto.randomUUID(), type: 'bestellung', session_id: sessionId, kasse_id: 'demo-kasse',
        items: [{ product_id: productId, qty, unit_net: 100, mwst_rate: 0.19, mwst_code: 'standard_19', storno_of: stornoOf }],
        tse_transaction: { tx_number: s.txNumber, signature_counter: s.signatureCounter, signature_value: s.signatureValue, log_time: s.logTime, process_type: s.processType, serial_number: s.serialNumber, public_key: s.publicKey },
      })
    }
    await mkBest(2) // -100
    expect(await levelOf(stockId)).toBe(900)
    await mkBest(-1, 'x') // Storno devolve +50
    expect(await levelOf(stockId)).toBe(950)
  })
})
```

- [ ] **Step 8: Run the e2e**

Run: `corepack pnpm --filter @gelato/api exec vitest run stock-consume`
Expected: PASS (5 testes). (Se `consumeForSale` não rodar no salão, conferir o hook em `addBestellung`; se baixar duas vezes, conferir o gate `tisch_session_id == null` no ledger.)

- [ ] **Step 9: Run the whole API suite (no regressions)**

Run: `corepack pnpm --filter @gelato/api exec vitest run`
Expected: tudo verde (as vendas dos outros testes agora podem gerar movimentos `consume` se o produto tiver receita — os produtos `p1/p2` dos testes NÃO têm receita, então não baixam; sem regressão).

- [ ] **Step 10: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations apps/api/src/stock/consume.ts apps/api/src/pos/ledger.service.ts apps/api/src/tables/tables.service.ts apps/api/test/stock-consume.e2e.test.ts
git commit -m "feat(api): decremento de estoque por venda (consume na Bestellung + venda direta), idempotente"
```

---

## Chunk 3: `GET /recipes/availability`

**Files:**
- Modify: `apps/api/src/recipes/recipes.service.ts` (método `availability`)
- Modify: `apps/api/src/recipes/recipes.controller.ts` (rota)
- Modify: `apps/api/test/recipes.e2e.test.ts` (teste de disponibilidade)

> **Atenção à ordem das rotas:** `GET /recipes/availability` precisa ser declarado de forma que
> não conflite com um eventual `GET /recipes/:id`. Como o controller só tem `GET /recipes` (sem
> `:id`), basta adicionar `@Get('availability')`. (Mantê-lo ANTES de qualquer rota param, por garantia.)

- [ ] **Step 1: Write the failing test** — adicionar a `apps/api/test/recipes.e2e.test.ts`:
```ts
  it('GET /recipes/availability returns maxProducible from current stock', async () => {
    const milch = await newStock('ml')
    const prod = await newProduct()
    await post('/recipes', { product_id: prod, ingredients: [{ stock_item_id: milch, qty: 200 }] })
    await post('/stock/receive', { stock_item_id: milch, qty: 1000 })
    const list = (await (await get('/recipes/availability')).json()) as { productId: string; maxProducible: number }[]
    const row = list.find((r) => r.productId === prod)!
    expect(row.maxProducible).toBe(5) // floor(1000/200)
  })
```
> `newStock`/`newProduct` já existem no arquivo (Chunk 3 da 2b).

- [ ] **Step 2: Run to verify it fails**

Run: `corepack pnpm --filter @gelato/api exec vitest run recipes.e2e -t availability`
Expected: FAIL — rota inexistente (ou 404/erro).

- [ ] **Step 3: Implement the service method**

Modify `apps/api/src/recipes/recipes.service.ts` — adicionar import e método:
```ts
import { aggregateStock, maxProducible } from '@gelato/compliance'
```
```ts
  /** Disponibilidade por receita ativa: quantas unidades dá p/ fazer com o estoque atual. */
  async availability(tenantId: string) {
    const recipes = await this.prisma.recipe.findMany({
      where: { tenantId, active: true },
      include: { product: true, variant: true, ingredients: true },
    })
    const movements = await this.prisma.stockMovement.findMany({ where: { tenantId }, select: { stockItemId: true, qtyDelta: true } })
    const stock = new Map(aggregateStock(movements).map((l) => [l.stockItemId, l.qty]))
    return recipes.map((r) => ({
      recipeId: r.id,
      productId: r.productId,
      productName: r.product.name,
      variantName: r.variant?.name ?? null,
      maxProducible: maxProducible(r.ingredients.map((i) => ({ stockItemId: i.stockItemId, qty: i.qty })), stock),
    }))
  }
```
> `@gelato/compliance` já exporta `aggregateStock` (2a) e `maxProducible` (Chunk 1). O dist foi
> rebuildado no Chunk 1 — runtime ok.

- [ ] **Step 4: Implement the route**

Modify `apps/api/src/recipes/recipes.controller.ts` — adicionar (antes do `@Get()` ou logo após, mas como path estático não conflita):
```ts
  @Get('availability')
  @RequirePermission('recipe.view')
  async availability(@Req() req: { user: JwtUser }) {
    return this.recipes.availability(req.user.tenant_id)
  }
```

- [ ] **Step 5: Run to verify it passes**

Run: `corepack pnpm --filter @gelato/api exec vitest run recipes.e2e`
Expected: PASS (6 testes — os 5 anteriores + disponibilidade).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/recipes/recipes.service.ts apps/api/src/recipes/recipes.controller.ts apps/api/test/recipes.e2e.test.ts
git commit -m "feat(api): GET /recipes/availability — disponibilidade (maxProducible do estoque atual)"
```

---

## Chunk 4: capstone + backoffice + integração

**Files:**
- Create: `apps/api/test/consume-capstone.e2e.test.ts`
- Modify: `apps/backoffice/src/api.ts` (tipo `Availability` + reuso)
- Modify: `apps/backoffice/src/App.tsx` (mostrar maxProducible na seção Receitas)

- [ ] **Step 1: Write the capstone e2e**

`apps/api/test/consume-capstone.e2e.test.ts`:
```ts
import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import type { AddressInfo } from 'node:net'
import { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { FakeTseProvider } from '@gelato/compliance'
import { AppModule } from '../src/app.module'

const tse = new FakeTseProvider({ serialNumber: 'SER-CAP' })

// Capstone 2c: receita Eisbecher L (200ml Milch + 80g Zucker da seed) → receive
// estoque dedicado → vender no salão (Bestellung L) → estoque cai exatamente →
// disponibilidade recalcula.
describe('Consume capstone (e2e)', () => {
  let app: INestApplication
  let baseUrl: string
  let token: string
  let prisma: PrismaClient

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = mod.createNestApplication()
    await app.listen(0)
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`
    prisma = new PrismaClient()
    token = ((await (await fetch(`${baseUrl}/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'admin@demo.test', password: 'admin123' }),
    })).json()) as { access_token: string }).access_token
  }, 30000)

  afterAll(async () => {
    await prisma?.$disconnect()
    await app?.close()
  })

  const post = (path: string, body: unknown) =>
    fetch(`${baseUrl}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body) })
  const get = (path: string) => fetch(`${baseUrl}${path}`, { headers: { authorization: `Bearer ${token}` } })
  const levelOf = async (id: string) => ((await (await get('/stock')).json()) as { id: string; qty: number }[]).find((l) => l.id === id)?.qty ?? 0

  it('selling an Eisbecher L in the salão decrements Milch/Zucker and updates availability', async () => {
    // produto + variante + receita dedicados (não depender do estado acumulado da seed)
    const milch = ((await (await post('/stock/items', { name: `milch-${crypto.randomUUID().slice(0, 8)}`, unit: 'ml' })).json()) as { id: string }).id
    const zucker = ((await (await post('/stock/items', { name: `zucker-${crypto.randomUUID().slice(0, 8)}`, unit: 'g' })).json()) as { id: string }).id
    const product = await prisma.product.create({ data: { tenantId: 'demo-tenant', name: `Becher-${crypto.randomUUID().slice(0, 8)}`, netCents: 600, mwstCodeImHaus: 'standard_19', mwstCodeAusserHaus: 'reduced_7' } })
    const variant = await prisma.productVariant.create({ data: { productId: product.id, name: 'L', netCents: 600 } })
    const recId = ((await (await post('/recipes', { product_id: product.id, variant_id: variant.id, ingredients: [{ stock_item_id: milch, qty: 200 }, { stock_item_id: zucker, qty: 80 }] })).json()) as { id: string }).id
    await post('/stock/receive', { stock_item_id: milch, qty: 1000 })
    await post('/stock/receive', { stock_item_id: zucker, qty: 1000 })

    // disponibilidade inicial: min(floor(1000/200), floor(1000/80)) = min(5,12) = 5
    const av0 = (await (await get('/recipes/availability')).json()) as { recipeId: string; maxProducible: number }[]
    expect(av0.find((r) => r.recipeId === recId)!.maxProducible).toBe(5)

    // vende 1× L no salão
    const tisch = `tisch-${crypto.randomUUID().slice(0, 8)}`
    await prisma.tisch.create({ data: { id: tisch, betriebsstaetteId: 'demo-bs', name: 'cap' } })
    const sessionId = ((await (await post(`/pos/tables/${tisch}/open`, { kasse_id: 'demo-kasse' })).json()) as { id: string }).id
    const s = await tse.sign({ clientId: 'c1', processType: 'Bestellung-V1', amountsByVatRate: [], paymentType: 'Bar', grossTotal: 714 })
    await post(`/pos/sessions/${sessionId}/bestellung`, {
      client_event_id: crypto.randomUUID(), type: 'bestellung', session_id: sessionId, kasse_id: 'demo-kasse',
      items: [{ product_id: product.id, variant_id: variant.id, qty: 1, unit_net: 600, mwst_rate: 0.19, mwst_code: 'standard_19' }],
      tse_transaction: { tx_number: s.txNumber, signature_counter: s.signatureCounter, signature_value: s.signatureValue, log_time: s.logTime, process_type: s.processType, serial_number: s.serialNumber, public_key: s.publicKey },
    })

    expect(await levelOf(milch)).toBe(800) // 1000 - 200
    expect(await levelOf(zucker)).toBe(920) // 1000 - 80
    // movimento de consumo ligado à Bestellung
    const consume = await prisma.stockMovement.findFirst({ where: { stockItemId: milch, type: 'consume' } })
    expect(consume?.refType).toBe('bestellung')
    expect(consume?.qtyDelta).toBe(-200)

    const av1 = (await (await get('/recipes/availability')).json()) as { recipeId: string; maxProducible: number }[]
    expect(av1.find((r) => r.recipeId === recId)!.maxProducible).toBe(4) // floor(800/200)=4
  })
})
```

- [ ] **Step 2: Run the capstone**

Run: `corepack pnpm --filter @gelato/api exec vitest run consume-capstone`
Expected: PASS.

- [ ] **Step 3: Backoffice — disponibilidade na seção Receitas**

Modify `apps/backoffice/src/api.ts` — adicionar:
```ts
export interface Availability {
  recipeId: string
  maxProducible: number
}
```

Modify `apps/backoffice/src/App.tsx` — no componente `Recipes`, carregar a disponibilidade e
mostrar ao lado do nome:
```tsx
function Recipes({ token }: { token: string }) {
  const [recipes, setRecipes] = useState<RecipeRow[]>([])
  const [avail, setAvail] = useState<Record<string, number>>({})
  useEffect(() => {
    apiGet<RecipeRow[]>('/recipes', token).then(setRecipes).catch(() => setRecipes([]))
    apiGet<Availability[]>('/recipes/availability', token)
      .then((a) => setAvail(Object.fromEntries(a.map((x) => [x.recipeId, x.maxProducible]))))
      .catch(() => setAvail({}))
  }, [token])

  return (
    <section style={{ marginTop: '2rem' }}>
      <h2>Receitas</h2>
      <ul>
        {recipes.map((r) => (
          <li key={r.id}>
            <strong>
              {r.productName}
              {r.variantName ? ` (${r.variantName})` : ''}
            </strong>
            {r.id in avail && ` — dá p/ ${avail[r.id]}`}
            {!r.active && ' — inativa'}
            <ul>
              {r.ingredients.map((i) => (
                <li key={i.stockItemId}>
                  {i.qty} {i.unit} — {i.stockItemName}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </section>
  )
}
```
(adicionar `type Availability` ao import do `./api`.)

- [ ] **Step 4: Typecheck + build do backoffice**

Run: `corepack pnpm --filter @gelato/backoffice exec tsc --noEmit && corepack pnpm --filter @gelato/backoffice build`
Expected: sem erros.

- [ ] **Step 5: Commit**

```bash
git add apps/api/test/consume-capstone.e2e.test.ts apps/backoffice/src/api.ts apps/backoffice/src/App.tsx
git commit -m "feat(backoffice): disponibilidade na seção Receitas + capstone 2c (venda -> estoque -> availability)"
```

- [ ] **Step 6: Suíte completa**

Run: `corepack pnpm -r test`
Expected: tudo verde.

- [ ] **Step 7: Integrar `ciclo-2c` → `main` + push**

```bash
git checkout main
git merge --ff-only ciclo-2c
git push origin main
git branch -d ciclo-2c
```
> Manter `docker/docker-compose.yml` (5433) e `.claude/` fora do commit.

---

## Notas de verificação / riscos

- **Dupla contagem:** o gate `tisch_session_id == null` no `ledger.ingest` é o que evita o salão
  baixar duas vezes (Bestellung + pagamento). O teste "Bestellung decrements; payment does NOT"
  cobre isso.
- **Idempotência:** o decremento roda só no caminho de criação (duplicata retorna antes); o
  `clientEventId` único faz rollback de toda a transação (incl. movimentos) em corrida.
- **Sem receita → sem baixa:** produtos `p1/p2` dos testes legados não têm receita → as suítes
  existentes não regridem.
- **Estoque negativo** é permitido (2a); a venda nunca é bloqueada por falta de estoque.
- **Migração** só adiciona colunas nullable (`ALTER TABLE ADD COLUMN`) — não viola append-only.
- **Dist do compliance** rebuildado no Chunk 1 (runtime Nest importa `aggregateStock`+`maxProducible`).
```
