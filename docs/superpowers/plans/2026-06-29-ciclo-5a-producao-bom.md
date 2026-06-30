# Ciclo 5 · Fatia 5a — Produção / BOM 2 níveis — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produzir semi-acabados em lotes a partir de insumos (movimentos append-only) e consumi-los na venda de produtos acabados — BOM de 2 níveis.

**Architecture:** Pura `explodeProduction` em `@gelato/compliance` → `ProductionRecipe` + `ProductionRecipeIngredient` (mutáveis) → módulo NestJS `production` (CRUD + produzir → `StockMovement` `produce`/`consume`) → seção mínima no backoffice. O semi-acabado é um `StockItem`; vender o acabado decrementa o semi (2c). Estoque pode ir a negativo.

**Tech Stack:** TypeScript strict, vitest, NestJS, Prisma + Postgres (**5433**), zod, React/Vite.

**Spec:** `docs/superpowers/specs/2026-06-29-ciclo-5a-producao-bom-design.md`

**Pré-requisitos:** Postgres up (`docker compose -f docker/docker-compose.yml -p gelato_c0 up -d`, 5433; se o Docker Desktop estiver fora: `Start-Process "C:\Program Files\Docker\Docker\Docker Desktop.exe"`, aguardar o engine); branch `ciclo-5a` (off `main`).

---

## Chunk 1: `explodeProduction` (puro)

**Files:**
- Create: `packages/compliance/src/production/explode.ts`
- Create: `packages/compliance/test/production-explode.test.ts`
- Modify: `packages/compliance/src/index.ts` (`export * from './production/explode'`)

- [ ] **Step 1: Write the failing test**

`packages/compliance/test/production-explode.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { explodeProduction } from '../src/production/explode'

describe('explodeProduction', () => {
  const ingredients = [{ stockItemId: 'milch', qty: 8000 }, { stockItemId: 'zucker', qty: 2000 }]

  it('scales produce and consume by batches', () => {
    expect(explodeProduction('base', 10000, ingredients, 2)).toEqual({
      produce: { stockItemId: 'base', qty: 20000 },
      consume: [{ stockItemId: 'milch', qty: 16000 }, { stockItemId: 'zucker', qty: 4000 }],
    })
  })

  it('one batch = the recipe; zero batches = zero', () => {
    expect(explodeProduction('base', 10000, ingredients, 1).produce.qty).toBe(10000)
    expect(explodeProduction('base', 10000, ingredients, 0)).toEqual({
      produce: { stockItemId: 'base', qty: 0 },
      consume: [{ stockItemId: 'milch', qty: 0 }, { stockItemId: 'zucker', qty: 0 }],
    })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `corepack pnpm --filter @gelato/compliance exec vitest run production-explode`
Expected: FAIL — import inexistente.

- [ ] **Step 3: Implement**

`packages/compliance/src/production/explode.ts`:
```ts
export interface ProductionIngredient {
  stockItemId: string
  qty: number
}

/** Explode uma produção de N lotes: produz yieldQty×N do output, consome qty×N de cada insumo. Puro. */
export function explodeProduction(
  outputStockItemId: string,
  yieldQty: number,
  ingredients: ProductionIngredient[],
  batches: number,
): { produce: { stockItemId: string; qty: number }; consume: { stockItemId: string; qty: number }[] } {
  return {
    produce: { stockItemId: outputStockItemId, qty: yieldQty * batches },
    consume: ingredients.map((i) => ({ stockItemId: i.stockItemId, qty: i.qty * batches })),
  }
}
```

- [ ] **Step 4: Export** — `packages/compliance/src/index.ts`: `export * from './production/explode'`

- [ ] **Step 5: Run to verify it passes**

Run: `corepack pnpm --filter @gelato/compliance exec vitest run production-explode`
Expected: PASS (2 testes).

- [ ] **Step 6: Build dist**

Run: `corepack pnpm --filter @gelato/compliance build`

- [ ] **Step 7: Commit**

```bash
git add packages/compliance/src/production/explode.ts packages/compliance/test/production-explode.test.ts packages/compliance/src/index.ts
git commit -m "feat(compliance): explodeProduction — BOM de produção (puro)"
```

---

## Chunk 2: modelo `ProductionRecipe` + `ProductionRecipeIngredient` + seed

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/<ts>_c5a_production/migration.sql`
- Modify: `apps/api/prisma/seed.ts`

- [ ] **Step 1: Adicionar os modelos + relações inversas no StockItem**

Modify `apps/api/prisma/schema.prisma`:

1. No model `StockItem`, adicionar as duas relações inversas (junto de `movements`/`recipeIngredients`):
```prisma
  movements             StockMovement[]
  recipeIngredients     RecipeIngredient[]
  productionRecipes     ProductionRecipe[]
  productionIngredients ProductionRecipeIngredient[]
```

2. Ao final do arquivo, os dois modelos:
```prisma
// ---------- Produção / BOM 2 níveis (Ciclo 5a) ----------

model ProductionRecipe {
  id                String   @id @default(cuid())
  tenantId          String
  outputStockItemId String
  yieldQty          Int
  active            Boolean  @default(true)
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  output      StockItem                    @relation(fields: [outputStockItemId], references: [id])
  ingredients ProductionRecipeIngredient[]

  @@unique([tenantId, outputStockItemId])
  @@map("production_recipes")
}

model ProductionRecipeIngredient {
  id                 String @id @default(cuid())
  productionRecipeId String
  stockItemId        String
  qty                Int

  productionRecipe ProductionRecipe @relation(fields: [productionRecipeId], references: [id], onDelete: Cascade)
  stockItem        StockItem        @relation(fields: [stockItemId], references: [id])

  @@unique([productionRecipeId, stockItemId])
  @@map("production_recipe_ingredients")
}
```

- [ ] **Step 2: Validar + gerar a migração**

```bash
corepack pnpm --filter @gelato/api exec prisma validate
cd apps/api
TS=20260629140000
mkdir -p prisma/migrations/${TS}_c5a_production
corepack pnpm exec prisma migrate diff \
  --from-schema-datasource prisma/schema.prisma \
  --to-schema-datamodel prisma/schema.prisma \
  --script > prisma/migrations/${TS}_c5a_production/migration.sql
cd ../..
cat apps/api/prisma/migrations/20260629140000_c5a_production/migration.sql
```
Expected: `CREATE TABLE "production_recipes"` (+ unique tenant+output), `"production_recipe_ingredients"` + FKs.
> Se o `validate` reclamar de relação ambígua, nomear as relações (`@relation("ProdOutput", ...)`
> / `@relation("ProdIngredient", ...)`) nos dois lados; mas como cada par de modelos tem uma só
> relação, deve validar sem nomes.

- [ ] **Step 3: Anexar GRANT DML** (master-data mutável; sem trigger)

Acrescentar ao final de `prisma/migrations/${TS}_c5a_production/migration.sql`:
```sql

-- ===== Produção: master data (mutável) — DML p/ gelato_app =====
GRANT SELECT, INSERT, UPDATE, DELETE ON production_recipes, production_recipe_ingredients TO gelato_app;
```

- [ ] **Step 4: Aplicar + marcar + gerar**

```bash
cd apps/api
corepack pnpm exec prisma db execute --schema prisma/schema.prisma --file prisma/migrations/20260629140000_c5a_production/migration.sql
corepack pnpm exec prisma migrate resolve --applied 20260629140000_c5a_production
corepack pnpm exec prisma generate
cd ../..
```

- [ ] **Step 5: Seed do semi-acabado + receita de produção**

Modify `apps/api/prisma/seed.ts` — após o bloco do estoque (perto de `stock-milch`/`stock-zucker`),
adicionar o semi-acabado, e depois das receitas (perto do fim) a receita de produção:

(a) junto dos `stockItem.upsert` da 2a:
```ts
  await prisma.stockItem.upsert({
    where: { id: 'stock-eisbasis' },
    update: {},
    create: { id: 'stock-eisbasis', tenantId: TENANT_ID, name: 'Eisbasis', unit: 'ml' },
  })
```
(b) antes do fechamento da função (após o bloco de campanhas):
```ts
  // Produção (Ciclo 5a): Eisbasis (semi-acabado) — 1 lote = 10000ml de 8000 Milch + 2000 Zucker.
  const prodRec = await prisma.productionRecipe.upsert({
    where: { tenantId_outputStockItemId: { tenantId: TENANT_ID, outputStockItemId: 'stock-eisbasis' } },
    update: {},
    create: { id: 'prodrec-eisbasis', tenantId: TENANT_ID, outputStockItemId: 'stock-eisbasis', yieldQty: 10000 },
  })
  for (const [id, stockItemId, qty] of [
    ['proding-eisbasis-milch', 'stock-milch', 8000],
    ['proding-eisbasis-zucker', 'stock-zucker', 2000],
  ] as const) {
    await prisma.productionRecipeIngredient.upsert({
      where: { id },
      update: { qty },
      create: { id, productionRecipeId: prodRec.id, stockItemId, qty },
    })
  }
```

- [ ] **Step 6: Rodar o seed 2×**

Run: `corepack pnpm --filter @gelato/api db:seed && corepack pnpm --filter @gelato/api db:seed`
Expected: "seed done" nas duas.

- [ ] **Step 7: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations apps/api/prisma/seed.ts
git commit -m "feat(api): modelo de produção — ProductionRecipe + ingredientes (mutável) + seed Eisbasis"
```

---

## Chunk 3: módulo `production` + e2e + capstone

**Files:**
- Create: `apps/api/src/production/production.service.ts`
- Create: `apps/api/src/production/production.controller.ts`
- Create: `apps/api/src/production/production.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Create: `apps/api/test/production.e2e.test.ts`
- Create: `apps/api/test/production-capstone.e2e.test.ts`

> **RBAC:** `stock.view`/`stock.adjust` já existem (papel `lagerist`); o **admin** tem tudo. Os e2e
> autenticam como **admin** (`admin@demo.test`/`admin123`).

- [ ] **Step 1: Write the failing e2e**

`apps/api/test/production.e2e.test.ts`:
```ts
import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { AppModule } from '../src/app.module'

describe('Production (e2e)', () => {
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

  const newItem = async (unit = 'g'): Promise<string> =>
    ((await (await post('/stock/items', { name: `i-${crypto.randomUUID().slice(0, 8)}`, unit })).json()) as { id: string }).id
  const levelOf = async (id: string): Promise<number> =>
    ((await (await get('/stock')).json()) as { id: string; qty: number }[]).find((l) => l.id === id)!.qty

  it('creates a production recipe (409 duplicate, 400 invalid)', async () => {
    const out = await newItem('ml')
    const ing = await newItem('g')
    expect((await post('/production/recipes', { output_stock_item_id: out, yield_qty: 1000, ingredients: [{ stock_item_id: ing, qty: 100 }] })).status).toBe(201)
    expect((await post('/production/recipes', { output_stock_item_id: out, yield_qty: 1000, ingredients: [{ stock_item_id: ing, qty: 100 }] })).status).toBe(409)
    const out2 = await newItem('ml')
    expect((await post('/production/recipes', { output_stock_item_id: out2, yield_qty: 0, ingredients: [{ stock_item_id: ing, qty: 100 }] })).status).toBe(400)
    expect((await post('/production/recipes', { output_stock_item_id: out2, yield_qty: 1000, ingredients: [] })).status).toBe(400)
  })

  it('produces a batch: consumes ingredients, produces output', async () => {
    const out = await newItem('ml')
    const milch = await newItem('ml')
    const zucker = await newItem('g')
    await post('/production/recipes', { output_stock_item_id: out, yield_qty: 1000, ingredients: [{ stock_item_id: milch, qty: 800 }, { stock_item_id: zucker, qty: 200 }] })
    await post('/stock/receive', { stock_item_id: milch, qty: 5000 })
    await post('/stock/receive', { stock_item_id: zucker, qty: 5000 })

    const r = await post('/production', { output_stock_item_id: out, batches: 2 })
    expect(r.status).toBe(201)
    expect(await levelOf(out)).toBe(2000) // 1000 * 2
    expect(await levelOf(milch)).toBe(5000 - 1600) // 800*2
    expect(await levelOf(zucker)).toBe(5000 - 400)
  })

  it('producing without a recipe → 404; batches <= 0 → 400', async () => {
    const out = await newItem('ml')
    expect((await post('/production', { output_stock_item_id: out, batches: 1 })).status).toBe(404)
    const out2 = await newItem('ml')
    const ing = await newItem('g')
    await post('/production/recipes', { output_stock_item_id: out2, yield_qty: 1000, ingredients: [{ stock_item_id: ing, qty: 10 }] })
    expect((await post('/production', { output_stock_item_id: out2, batches: 0 })).status).toBe(400)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `corepack pnpm --filter @gelato/api exec vitest run production.e2e`
Expected: FAIL — rotas inexistentes.

- [ ] **Step 3: Implement the service**

`apps/api/src/production/production.service.ts`:
```ts
import { Injectable, BadRequestException, ConflictException, NotFoundException } from '@nestjs/common'
import { explodeProduction } from '@gelato/compliance'
import { PrismaService } from '../prisma/prisma.service'

interface IngredientInput {
  stock_item_id: string
  qty: number
}

@Injectable()
export class ProductionService {
  constructor(private readonly prisma: PrismaService) {}

  async listRecipes(tenantId: string) {
    const recipes = await this.prisma.productionRecipe.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'asc' },
      include: { output: true, ingredients: { include: { stockItem: true }, orderBy: { stockItemId: 'asc' } } },
    })
    return recipes.map((r) => ({
      id: r.id,
      outputStockItemId: r.outputStockItemId,
      outputName: r.output.name,
      unit: r.output.unit,
      yieldQty: r.yieldQty,
      active: r.active,
      ingredients: r.ingredients.map((i) => ({ stockItemId: i.stockItemId, name: i.stockItem.name, unit: i.stockItem.unit, qty: i.qty })),
    }))
  }

  async createRecipe(tenantId: string, dto: { output_stock_item_id: string; yield_qty: number; ingredients: IngredientInput[] }) {
    if (dto.yield_qty <= 0) throw new BadRequestException('yield_qty must be positive')
    if (dto.ingredients.length === 0) throw new BadRequestException('at least one ingredient')
    const output = await this.prisma.stockItem.findFirst({ where: { id: dto.output_stock_item_id, tenantId } })
    if (!output) throw new NotFoundException('output stock item')
    for (const ing of dto.ingredients) {
      const si = await this.prisma.stockItem.findFirst({ where: { id: ing.stock_item_id, tenantId } })
      if (!si) throw new NotFoundException('ingredient stock item')
    }
    const existing = await this.prisma.productionRecipe.findFirst({ where: { tenantId, outputStockItemId: dto.output_stock_item_id } })
    if (existing) throw new ConflictException('production recipe already exists for this output')
    const rec = await this.prisma.productionRecipe.create({
      data: { tenantId, outputStockItemId: dto.output_stock_item_id, yieldQty: dto.yield_qty, ingredients: { create: dto.ingredients.map((i) => ({ stockItemId: i.stock_item_id, qty: i.qty })) } },
    })
    return { id: rec.id }
  }

  async produce(tenantId: string, dto: { output_stock_item_id: string; batches: number }, userId?: string) {
    if (dto.batches <= 0) throw new BadRequestException('batches must be positive')
    const recipe = await this.prisma.productionRecipe.findFirst({
      where: { tenantId, outputStockItemId: dto.output_stock_item_id, active: true },
      include: { ingredients: true },
    })
    if (!recipe) throw new NotFoundException('production recipe')
    const { produce, consume } = explodeProduction(
      recipe.outputStockItemId,
      recipe.yieldQty,
      recipe.ingredients.map((i) => ({ stockItemId: i.stockItemId, qty: i.qty })),
      dto.batches,
    )
    const runId = crypto.randomUUID()
    await this.prisma.$transaction([
      ...consume.map((c) => this.prisma.stockMovement.create({ data: { tenantId, stockItemId: c.stockItemId, type: 'consume', qtyDelta: -c.qty, refType: 'production', refId: runId, createdBy: userId } })),
      this.prisma.stockMovement.create({ data: { tenantId, stockItemId: produce.stockItemId, type: 'produce', qtyDelta: produce.qty, refType: 'production', refId: runId, createdBy: userId } }),
    ])
    return { runId, produce, consume }
  }
}
```

- [ ] **Step 4: Controller + module + registrar**

`apps/api/src/production/production.controller.ts`:
```ts
import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common'
import { z } from 'zod'
import { ProductionService } from './production.service'
import { JwtAuthGuard, type JwtUser } from '../auth/jwt-auth.guard'
import { PermissionsGuard } from '../rbac/permissions.guard'
import { RequirePermission } from '../rbac/require-permission.decorator'
import { parseOrThrow } from '../common/zod'

const Ingredient = z.object({ stock_item_id: z.string().min(1), qty: z.number().int().positive() })
const CreateDto = z.object({ output_stock_item_id: z.string().min(1), yield_qty: z.number().int(), ingredients: z.array(Ingredient) })
const ProduceDto = z.object({ output_stock_item_id: z.string().min(1), batches: z.number().int() })

@Controller('production')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ProductionController {
  constructor(private readonly production: ProductionService) {}

  @Get('recipes')
  @RequirePermission('stock.view')
  async listRecipes(@Req() req: { user: JwtUser }) {
    return this.production.listRecipes(req.user.tenant_id)
  }

  @Post('recipes')
  @RequirePermission('stock.adjust')
  async createRecipe(@Req() req: { user: JwtUser }, @Body() body: unknown) {
    return this.production.createRecipe(req.user.tenant_id, parseOrThrow(CreateDto, body))
  }

  @Post()
  @RequirePermission('stock.adjust')
  async produce(@Req() req: { user: JwtUser }, @Body() body: unknown) {
    return this.production.produce(req.user.tenant_id, parseOrThrow(ProduceDto, body), req.user.sub)
  }
}
```
> `yield_qty`/`batches` validados como inteiros no zod; o `≤ 0` (400) é checado no serviço (mensagem
> clara), como na 2a.

`apps/api/src/production/production.module.ts`:
```ts
import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { PermissionsGuard } from '../rbac/permissions.guard'
import { ProductionService } from './production.service'
import { ProductionController } from './production.controller'

@Module({
  imports: [AuthModule],
  controllers: [ProductionController],
  providers: [ProductionService, PermissionsGuard],
})
export class ProductionModule {}
```

Modify `apps/api/src/app.module.ts` — importar `ProductionModule` e adicionar ao `imports`.

- [ ] **Step 5: Run to verify it passes**

Run: `corepack pnpm --filter @gelato/api exec vitest run production.e2e`
Expected: PASS (3 testes).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/production apps/api/src/app.module.ts apps/api/test/production.e2e.test.ts
git commit -m "feat(api): módulo production — receitas de produção + produzir lote (movimentos append-only)"
```

- [ ] **Step 7: Write the capstone (2 níveis)**

`apps/api/test/production-capstone.e2e.test.ts`:
```ts
import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import type { AddressInfo } from 'node:net'
import { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { FakeTseProvider } from '@gelato/compliance'
import { AppModule } from '../src/app.module'

const tse = new FakeTseProvider({ serialNumber: 'SER-PROD' })

// Capstone 5a (BOM 2 níveis): receber Milch/Zucker → produzir 2 lotes de Eisbasis
// → criar produto acabado + receita de venda usando Eisbasis → vender o acabado →
// Eisbasis decrementado (2c). Raw → semi (produção) → acabado (venda).
describe('Production capstone (e2e)', () => {
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
  const newItem = async (unit: string): Promise<string> => ((await (await post('/stock/items', { name: `i-${crypto.randomUUID().slice(0, 8)}`, unit })).json()) as { id: string }).id
  const levelOf = async (id: string): Promise<number> => ((await (await get('/stock')).json()) as { id: string; qty: number }[]).find((l) => l.id === id)!.qty

  it('raw → semi (production) → finished (sale)', async () => {
    const milch = await newItem('ml')
    const zucker = await newItem('g')
    const eisbasis = await newItem('ml')
    await post('/production/recipes', { output_stock_item_id: eisbasis, yield_qty: 10000, ingredients: [{ stock_item_id: milch, qty: 8000 }, { stock_item_id: zucker, qty: 2000 }] })
    await post('/stock/receive', { stock_item_id: milch, qty: 20000 })
    await post('/stock/receive', { stock_item_id: zucker, qty: 5000 })

    // produz 2 lotes → Eisbasis +20000, Milch -16000, Zucker -4000
    await post('/production', { output_stock_item_id: eisbasis, batches: 2 })
    expect(await levelOf(eisbasis)).toBe(20000)
    expect(await levelOf(milch)).toBe(4000)
    expect(await levelOf(zucker)).toBe(1000)

    // produto acabado + receita de venda usando o semi-acabado (Eisbasis 200/unidade)
    const product = await prisma.product.create({ data: { tenantId: 'demo-tenant', name: `Becher-${crypto.randomUUID().slice(0, 8)}`, netCents: 300, mwstCodeImHaus: 'standard_19', mwstCodeAusserHaus: 'reduced_7' } })
    await post('/recipes', { product_id: product.id, ingredients: [{ stock_item_id: eisbasis, qty: 200 }] })

    // vende 3 → consumeForSale (2c) decrementa Eisbasis em 600
    const r = await tse.sign({ clientId: 'c1', processType: 'Kassenbeleg-V1', amountsByVatRate: [], paymentType: 'Bar', grossTotal: 1071 })
    await post('/pos/sync', {
      client_event_id: crypto.randomUUID(), type: 'sale', kasse_id: 'demo-kasse',
      payload: {
        order: { mode: 'ausser_haus', total_net: 900, total_mwst: 171, total_gross: 1071 },
        items: [{ product_id: product.id, qty: 3, unit_net: 300, mwst_rate: 0.19, mwst_code: 'standard_19' }],
        payment: { method: 'cash', amount: 1071 },
        receipt: { qr_payload: '', format: 'digital' },
        tse_transaction: { tx_number: r.txNumber, signature_counter: r.signatureCounter, signature_value: r.signatureValue, log_time: r.logTime, process_type: r.processType, serial_number: r.serialNumber, public_key: r.publicKey },
      },
    })
    expect(await levelOf(eisbasis)).toBe(20000 - 600) // 2 níveis: produção subiu, venda baixou
  })
})
```

- [ ] **Step 8: Run capstone + full API suite**

Run: `corepack pnpm --filter @gelato/api exec vitest run production-capstone`
Then: `corepack pnpm --filter @gelato/api exec vitest run`
Expected: ambos verdes.

- [ ] **Step 9: Commit**

```bash
git add apps/api/test/production-capstone.e2e.test.ts
git commit -m "test(api): production capstone (BOM 2 níveis: raw -> semi -> acabado)"
```

---

## Chunk 4: backoffice (Produção) + integração

**Files:**
- Modify: `apps/backoffice/src/api.ts` (tipo `ProductionRecipeRow`)
- Modify: `apps/backoffice/src/App.tsx` (componente `Production`)

- [ ] **Step 1: Tipo no backoffice api**

Modify `apps/backoffice/src/api.ts` — adicionar:
```ts
export interface ProductionRecipeRow {
  id: string
  outputStockItemId: string
  outputName: string
  unit: string
  yieldQty: number
  active: boolean
  ingredients: { stockItemId: string; name: string; unit: string; qty: number }[]
}
```

- [ ] **Step 2: Componente `Production`**

Modify `apps/backoffice/src/App.tsx`:
1. Import: incluir `type ProductionRecipeRow`.
2. Renderizar `<Production token={token} />` (perto de `<Recipes token={token} />`).
3. Componente:
```tsx
function Production({ token }: { token: string }) {
  const [recipes, setRecipes] = useState<ProductionRecipeRow[]>([])
  const [batches, setBatches] = useState<Record<string, string>>({})

  const reload = (): void => {
    apiGet<ProductionRecipeRow[]>('/production/recipes', token).then(setRecipes).catch(() => setRecipes([]))
  }
  useEffect(reload, [token])

  async function produce(outputId: string): Promise<void> {
    const n = Number(batches[outputId])
    if (!n || n <= 0) return
    await apiPost('/production', token, { output_stock_item_id: outputId, batches: n })
    setBatches((b) => ({ ...b, [outputId]: '' }))
    reload()
  }

  return (
    <section style={{ marginTop: '2rem' }}>
      <h2>Produção (semi-acabados)</h2>
      <ul>
        {recipes.map((r) => (
          <li key={r.id}>
            <strong>{r.outputName}</strong> — rende {r.yieldQty} {r.unit}/lote
            <ul>
              {r.ingredients.map((i) => (
                <li key={i.stockItemId}>{i.qty} {i.unit} — {i.name}</li>
              ))}
            </ul>
            <input type="number" placeholder="lotes" value={batches[r.outputStockItemId] ?? ''} onChange={(e) => setBatches((b) => ({ ...b, [r.outputStockItemId]: e.target.value }))} />
            <button onClick={() => produce(r.outputStockItemId)}>Produzir</button>
          </li>
        ))}
      </ul>
    </section>
  )
}
```

- [ ] **Step 3: Typecheck + build**

Run: `corepack pnpm --filter @gelato/backoffice exec tsc --noEmit && corepack pnpm --filter @gelato/backoffice build`
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add apps/backoffice/src/api.ts apps/backoffice/src/App.tsx
git commit -m "feat(backoffice): seção Produção (receitas de produção + produzir lotes)"
```

- [ ] **Step 5: Suíte completa + integração**

```bash
corepack pnpm -r test
git checkout main
git merge --ff-only ciclo-5a
git push origin main
git branch -d ciclo-5a
```
> Manter `docker/docker-compose.yml` (5433) e `.claude/` fora do commit.

---

## Notas de verificação / riscos

- **2 níveis:** o semi-acabado é um `StockItem`; produzir adiciona (`produce` +), vender o acabado
  consome (`consumeForSale` da 2c, via a receita de venda que tem o semi-acabado como ingrediente).
- **`StockMovement.type`** ganha `'produce'`/`'consume'` sem migração de schema (string); `aggregateStock`
  soma tudo. `refType:'production' refId:runId` agrupa um lote (trilha sem entidade própria).
- **Permite negativo** (produzir sem insumo): consistente com 2c; alerta na 2d.
- **GRANT DML** p/ `production_recipes`/`production_recipe_ingredients` (master-data nova).
- **Relações inversas** no `StockItem` (produção como output e como ingrediente) — conferir no `validate`.
- **Dist do compliance** rebuildado no Chunk 1.
```
