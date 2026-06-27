# Ciclo 2 · Fatia 2a — Estoque — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cadastrar insumos (`StockItem`) e registrar movimentos append-only (entrada/ajuste/contagem), com o estoque atual **derivado** da soma dos movimentos (Σ `qtyDelta`).

**Architecture:** Função pura `aggregateStock` em `@gelato/compliance` (Σ por item) → modelo Prisma `StockItem` (master, mutável) + `StockMovement` (append-only, trigger) → módulo NestJS `stock` (GET nível + POST items/receive/adjust/count, RBAC `stock.*`) → seção mínima no backoffice. Quantidades **inteiras em unidade-base** (g/ml/Stück), sem floats. Estoque pode ficar negativo (permitido/visível).

**Tech Stack:** TypeScript strict, vitest, NestJS, Prisma + Postgres (porta **5433**, role `gelato_app` runtime / `gelato_owner` migração), zod, React/Vite (backoffice).

**Spec:** `docs/superpowers/specs/2026-06-27-ciclo-2a-estoque-design.md`

**Pré-requisitos do ambiente:**
- Postgres no ar: `docker compose -f docker/docker-compose.yml -p gelato_c0 up -d` (5433).
- Branch já criada: `ciclo-2a` (off `main`).
- Testes do pacote: `corepack pnpm --filter @gelato/compliance exec vitest run`.
- Testes da API (e2e, precisa do Postgres): `corepack pnpm --filter @gelato/api exec vitest run`.

---

## Chunk 1: `aggregateStock` (puro) + build do dist

**Files:**
- Create: `packages/compliance/src/stock/aggregate.ts`
- Create: `packages/compliance/test/aggregate-stock.test.ts`
- Modify: `packages/compliance/src/index.ts` (adicionar `export * from './stock/aggregate'`)

> Domínio (`@gelato/domain`): **não é necessário**. O `type` do movimento (`receive`/`adjust`/`count`) é decidido pelo endpoint, não vem do cliente; a validação dos DTOs vive no controller (zod), como `PayDto`/`PositionDto`. YAGNI — não tocar em `@gelato/domain`.

- [ ] **Step 1: Write the failing test**

`packages/compliance/test/aggregate-stock.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { aggregateStock } from '../src/stock/aggregate'

describe('aggregateStock', () => {
  it('sums signed deltas per item, ordered by stockItemId', () => {
    const out = aggregateStock([
      { stockItemId: 'b', qtyDelta: 100 },
      { stockItemId: 'a', qtyDelta: 1000 },
      { stockItemId: 'a', qtyDelta: -250 },
      { stockItemId: 'b', qtyDelta: -40 },
    ])
    expect(out).toEqual([
      { stockItemId: 'a', qty: 750 },
      { stockItemId: 'b', qty: 60 },
    ])
  })

  it('treats a count movement as just another signed delta', () => {
    // receive 1000, adjust -250 (atual 750), count que repõe a 700 = delta -50
    const out = aggregateStock([
      { stockItemId: 'x', qtyDelta: 1000 },
      { stockItemId: 'x', qtyDelta: -250 },
      { stockItemId: 'x', qtyDelta: -50 },
    ])
    expect(out).toEqual([{ stockItemId: 'x', qty: 700 }])
  })

  it('allows negative stock and returns [] for no movements', () => {
    expect(aggregateStock([])).toEqual([])
    expect(aggregateStock([{ stockItemId: 'x', qtyDelta: -30 }])).toEqual([{ stockItemId: 'x', qty: -30 }])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm --filter @gelato/compliance exec vitest run aggregate-stock`
Expected: FAIL — `Failed to resolve import "../src/stock/aggregate"`.

- [ ] **Step 3: Write minimal implementation**

`packages/compliance/src/stock/aggregate.ts`:
```ts
export interface StockMovementInput {
  stockItemId: string
  qtyDelta: number // inteiro assinado, em unidade-base (g/ml/Stück)
}
export interface StockLevel {
  stockItemId: string
  qty: number
}

/**
 * Estoque atual = soma de TODOS os deltas por item (entrada +, ajuste/contagem +/−).
 * Append-only-friendly: nunca materializa; só agrega. Ordena por stockItemId
 * (determinístico). Itens sem movimento simplesmente não aparecem (qty 0 é
 * responsabilidade de quem junta com o cadastro de itens). Pode ser negativo.
 */
export function aggregateStock(movements: StockMovementInput[]): StockLevel[] {
  const byItem = new Map<string, number>()
  for (const m of movements) {
    byItem.set(m.stockItemId, (byItem.get(m.stockItemId) ?? 0) + m.qtyDelta)
  }
  return [...byItem.entries()]
    .map(([stockItemId, qty]) => ({ stockItemId, qty }))
    .sort((a, b) => (a.stockItemId < b.stockItemId ? -1 : a.stockItemId > b.stockItemId ? 1 : 0))
}
```

- [ ] **Step 4: Add the export**

Modify `packages/compliance/src/index.ts` — adicionar ao final:
```ts
export * from './stock/aggregate'
```

- [ ] **Step 5: Run test to verify it passes**

Run: `corepack pnpm --filter @gelato/compliance exec vitest run aggregate-stock`
Expected: PASS (3 testes).

- [ ] **Step 6: Build the dist (runtime do Nest importa de `dist`)**

Run: `corepack pnpm --filter @gelato/compliance build`
Expected: gera `packages/compliance/dist/index.{js,cjs,d.ts}` sem erro.

- [ ] **Step 7: Commit**

```bash
git add packages/compliance/src/stock/aggregate.ts packages/compliance/test/aggregate-stock.test.ts packages/compliance/src/index.ts packages/compliance/dist
git commit -m "feat(compliance): aggregateStock — estoque = Σ deltas por item (puro)"
```

---

## Chunk 2: modelo Prisma + imutabilidade + seed

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (adicionar `StockItem` + `StockMovement`)
- Create: `apps/api/prisma/migrations/<ts>_c2a_stock/migration.sql`
- Modify: `apps/api/prisma/seed.ts` (2 insumos demo + receive inicial)

> **Migração não-interativa** (o `migrate dev` exige TTY): usamos `migrate diff` → editar SQL → `db execute` → `migrate resolve --applied` → `generate`. A datasource do schema usa `DATABASE_URL_OWNER`, então os comandos do prisma já rodam como owner.

- [ ] **Step 1: Adicionar os modelos ao schema**

Modify `apps/api/prisma/schema.prisma` — adicionar ao final (antes/depois de qualquer model, tanto faz):
```prisma
// ---------- Estoque (Ciclo 2a) ----------

model StockItem {
  id        String   @id @default(cuid())
  tenantId  String
  name      String
  unit      String // unidade-base: 'g' | 'ml' | 'Stück' ...
  minStock  Int? // limiar p/ alertas (2d); quantidades inteiras na unidade-base
  active    Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  movements StockMovement[]

  @@map("stock_items")
}

model StockMovement {
  id          String   @id @default(cuid())
  tenantId    String
  stockItemId String
  type        String // 'receive' | 'adjust' | 'count'
  qtyDelta    Int // inteiro assinado, unidade-base
  reason      String?
  createdBy   String?
  createdAt   DateTime @default(now())

  stockItem StockItem @relation(fields: [stockItemId], references: [id])

  @@index([tenantId, stockItemId])
  @@map("stock_movements")
}
```

- [ ] **Step 2: Validar o schema**

Run: `corepack pnpm --filter @gelato/api exec prisma validate`
Expected: "The schema at prisma/schema.prisma is valid".

- [ ] **Step 3: Gerar o SQL da migração (diff DB→schema)**

Criar o diretório e gerar o SQL (use um timestamp maior que o último, `20260626192001`; ex. `20260627120000`):
```bash
cd apps/api
TS=20260627120000
mkdir -p prisma/migrations/${TS}_c2a_stock
corepack pnpm exec prisma migrate diff \
  --from-schema-datasource prisma/schema.prisma \
  --to-schema-datamodel prisma/schema.prisma \
  --script > prisma/migrations/${TS}_c2a_stock/migration.sql
cd ../..
```
Expected: `migration.sql` contém `CREATE TABLE "stock_items"`, `CREATE TABLE "stock_movements"` e a FK.

- [ ] **Step 4: Anexar GRANT + trigger de append-only ao SQL**

Acrescentar ao **final** de `prisma/migrations/${TS}_c2a_stock/migration.sql` (a função `fiscal_append_only()` já existe desde a c0):
```sql

-- ===== Estoque: master data (mutável) + movimentos (append-only) =====
GRANT SELECT, INSERT, UPDATE, DELETE ON stock_items TO gelato_app;
GRANT SELECT, INSERT ON stock_movements TO gelato_app;
DROP TRIGGER IF EXISTS stock_movements_append_only ON stock_movements;
CREATE TRIGGER stock_movements_append_only BEFORE UPDATE OR DELETE ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION fiscal_append_only();
```

- [ ] **Step 5: Aplicar a migração e marcá-la como aplicada**

```bash
cd apps/api
corepack pnpm exec prisma db execute --schema prisma/schema.prisma --file prisma/migrations/20260627120000_c2a_stock/migration.sql
corepack pnpm exec prisma migrate resolve --applied 20260627120000_c2a_stock
corepack pnpm exec prisma generate
cd ../..
```
Expected: `db execute` sem erro; `migrate resolve` confirma; `generate` recria o client com `stockItem`/`stockMovement`.

- [ ] **Step 6: Adicionar o seed dos 2 insumos demo**

Modify `apps/api/prisma/seed.ts` — depois do bloco de produtos/catálogo (perto da seção `mod-sahne`), antes do `userRole.upsert` final, inserir:
```ts
  // Estoque (Ciclo 2a): 2 insumos demo + entrada inicial. Movimentos são
  // append-only → inserir só uma vez (id fixo, create se ausente; nunca update).
  await prisma.stockItem.upsert({
    where: { id: 'stock-milch' },
    update: {},
    create: { id: 'stock-milch', tenantId: TENANT_ID, name: 'Milch', unit: 'ml', minStock: 2000 },
  })
  await prisma.stockItem.upsert({
    where: { id: 'stock-zucker' },
    update: {},
    create: { id: 'stock-zucker', tenantId: TENANT_ID, name: 'Zucker', unit: 'g', minStock: 1000 },
  })
  for (const [id, stockItemId, qtyDelta] of [
    ['mov-milch-init', 'stock-milch', 10000],
    ['mov-zucker-init', 'stock-zucker', 5000],
  ] as const) {
    const seen = await prisma.stockMovement.findUnique({ where: { id } })
    if (!seen) {
      await prisma.stockMovement.create({ data: { id, tenantId: TENANT_ID, stockItemId, type: 'receive', qtyDelta } })
    }
  }
```
> Confirme que `TENANT_ID` é a const já usada no topo do seed (mesma dos produtos). Se o nome for outro, use o existente.

- [ ] **Step 7: Rodar o seed**

Run: `corepack pnpm --filter @gelato/api db:seed`
Expected: termina sem erro; rodar de novo é idempotente (upsert + create-once).

- [ ] **Step 8: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations apps/api/prisma/seed.ts
git commit -m "feat(api): modelo de estoque — StockItem (mutável) + StockMovement (append-only) + seed"
```

---

## Chunk 3: módulo NestJS `stock` + e2e + capstone

**Files:**
- Create: `apps/api/src/stock/stock.service.ts`
- Create: `apps/api/src/stock/stock.controller.ts`
- Create: `apps/api/src/stock/stock.module.ts`
- Modify: `apps/api/src/app.module.ts` (registrar `StockModule`)
- Create: `apps/api/test/stock.e2e.test.ts`
- Create: `apps/api/test/stock-capstone.e2e.test.ts`
- Modify: `apps/api/test/immutability.test.ts` (bloco append-only de `stock_movements`)

> **RBAC:** `stock.view/receive/adjust/count` já existem (`permissions.ts`) e estão no papel `lagerist` (e em `admin`). O **operator** (login por PIN) **não** tem `stock.*` → os e2e autenticam como **admin** via `POST /auth/login` (`admin@demo.test` / `admin123`).

- [ ] **Step 1: Write the failing e2e test**

`apps/api/test/stock.e2e.test.ts`:
```ts
import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import type { AddressInfo } from 'node:net'
import { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AppModule } from '../src/app.module'

describe('Stock (e2e)', () => {
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

  async function newItem(name = 'e2e'): Promise<string> {
    const r = await post('/stock/items', { name: `${name}-${crypto.randomUUID().slice(0, 8)}`, unit: 'g' })
    expect(r.status).toBe(201)
    return ((await r.json()) as { id: string }).id
  }

  it('receive raises the derived level (GET /stock)', async () => {
    const id = await newItem('milch')
    expect((await post('/stock/receive', { stock_item_id: id, qty: 1000 })).status).toBe(201)
    const lvl = ((await (await get('/stock')).json()) as { id: string; qty: number }[]).find((l) => l.id === id)!
    expect(lvl.qty).toBe(1000)
  })

  it('adjust applies a negative delta', async () => {
    const id = await newItem('adj')
    await post('/stock/receive', { stock_item_id: id, qty: 500 })
    await post('/stock/adjust', { stock_item_id: id, qty_delta: -120, reason: 'Bruch' })
    const lvl = ((await (await get('/stock')).json()) as { id: string; qty: number }[]).find((l) => l.id === id)!
    expect(lvl.qty).toBe(380)
  })

  it('count records a movement of (counted − current) and the level becomes counted', async () => {
    const id = await newItem('count')
    await post('/stock/receive', { stock_item_id: id, qty: 1000 })
    expect((await post('/stock/count', { stock_item_id: id, counted: 700 })).status).toBe(201)
    const lvl = ((await (await get('/stock')).json()) as { id: string; qty: number }[]).find((l) => l.id === id)!
    expect(lvl.qty).toBe(700)
    const movs = await prisma.stockMovement.findMany({ where: { stockItemId: id }, orderBy: { createdAt: 'asc' } })
    expect(movs.map((m) => m.qtyDelta)).toEqual([1000, -300]) // receive +1000, count -300
    expect(movs[1].type).toBe('count')
  })

  it('a new item with no movements shows qty 0', async () => {
    const id = await newItem('zero')
    const lvl = ((await (await get('/stock')).json()) as { id: string; qty: number }[]).find((l) => l.id === id)!
    expect(lvl.qty).toBe(0)
  })

  it('an item from another tenant → 404 on receive', async () => {
    const id = `stock-other-${crypto.randomUUID().slice(0, 8)}`
    await prisma.stockItem.create({ data: { id, tenantId: 'tenant-other', name: 'X', unit: 'g' } })
    expect((await post('/stock/receive', { stock_item_id: id, qty: 10 })).status).toBe(404)
  })

  it('rejects invalid bodies (400): qty ≤ 0, qty_delta == 0', async () => {
    const id = await newItem('bad')
    expect((await post('/stock/receive', { stock_item_id: id, qty: 0 })).status).toBe(400)
    expect((await post('/stock/adjust', { stock_item_id: id, qty_delta: 0 })).status).toBe(400)
  })
})
```

- [ ] **Step 2: Run the e2e to verify it fails**

Run: `corepack pnpm --filter @gelato/api exec vitest run stock.e2e`
Expected: FAIL — rotas `/stock/*` inexistentes (404 onde se espera 201, etc.).

- [ ] **Step 3: Implement the service**

`apps/api/src/stock/stock.service.ts`:
```ts
import { Injectable, NotFoundException } from '@nestjs/common'
import { aggregateStock } from '@gelato/compliance'
import { PrismaService } from '../prisma/prisma.service'

@Injectable()
export class StockService {
  constructor(private readonly prisma: PrismaService) {}

  /** Nível atual por item (todos os itens ativos; sem movimento → qty 0). */
  async levels(tenantId: string) {
    const items = await this.prisma.stockItem.findMany({ where: { tenantId, active: true }, orderBy: { name: 'asc' } })
    const movements = await this.prisma.stockMovement.findMany({ where: { tenantId }, select: { stockItemId: true, qtyDelta: true } })
    const qtyById = new Map(aggregateStock(movements).map((l) => [l.stockItemId, l.qty]))
    return items.map((i) => ({ id: i.id, name: i.name, unit: i.unit, minStock: i.minStock, qty: qtyById.get(i.id) ?? 0 }))
  }

  async createItem(tenantId: string, dto: { name: string; unit: string; min_stock?: number }) {
    return this.prisma.stockItem.create({ data: { tenantId, name: dto.name, unit: dto.unit, minStock: dto.min_stock ?? null } })
  }

  private async ownItemOr404(tenantId: string, stockItemId: string) {
    const item = await this.prisma.stockItem.findFirst({ where: { id: stockItemId, tenantId } })
    if (!item) throw new NotFoundException('stock item')
    return item
  }

  private async currentQty(tenantId: string, stockItemId: string): Promise<number> {
    const movs = await this.prisma.stockMovement.findMany({ where: { tenantId, stockItemId }, select: { stockItemId: true, qtyDelta: true } })
    return aggregateStock(movs)[0]?.qty ?? 0
  }

  async receive(tenantId: string, dto: { stock_item_id: string; qty: number; reason?: string }, userId?: string) {
    await this.ownItemOr404(tenantId, dto.stock_item_id)
    return this.prisma.stockMovement.create({
      data: { tenantId, stockItemId: dto.stock_item_id, type: 'receive', qtyDelta: dto.qty, reason: dto.reason, createdBy: userId },
    })
  }

  async adjust(tenantId: string, dto: { stock_item_id: string; qty_delta: number; reason?: string }, userId?: string) {
    await this.ownItemOr404(tenantId, dto.stock_item_id)
    return this.prisma.stockMovement.create({
      data: { tenantId, stockItemId: dto.stock_item_id, type: 'adjust', qtyDelta: dto.qty_delta, reason: dto.reason, createdBy: userId },
    })
  }

  async count(tenantId: string, dto: { stock_item_id: string; counted: number }, userId?: string) {
    await this.ownItemOr404(tenantId, dto.stock_item_id)
    const delta = dto.counted - (await this.currentQty(tenantId, dto.stock_item_id))
    return this.prisma.stockMovement.create({
      data: { tenantId, stockItemId: dto.stock_item_id, type: 'count', qtyDelta: delta, createdBy: userId },
    })
  }
}
```

- [ ] **Step 4: Implement the controller**

`apps/api/src/stock/stock.controller.ts`:
```ts
import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common'
import { z } from 'zod'
import { StockService } from './stock.service'
import { JwtAuthGuard, type JwtUser } from '../auth/jwt-auth.guard'
import { PermissionsGuard } from '../rbac/permissions.guard'
import { RequirePermission } from '../rbac/require-permission.decorator'
import { parseOrThrow } from '../common/zod'

const CreateItemDto = z.object({ name: z.string().min(1), unit: z.string().min(1), min_stock: z.number().int().nonnegative().optional() })
const ReceiveDto = z.object({ stock_item_id: z.string().min(1), qty: z.number().int().positive(), reason: z.string().optional() })
const AdjustDto = z.object({ stock_item_id: z.string().min(1), qty_delta: z.number().int().refine((n) => n !== 0, 'qty_delta must be non-zero'), reason: z.string().optional() })
const CountDto = z.object({ stock_item_id: z.string().min(1), counted: z.number().int().nonnegative() })

@Controller('stock')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class StockController {
  constructor(private readonly stock: StockService) {}

  @Get()
  @RequirePermission('stock.view')
  async levels(@Req() req: { user: JwtUser }) {
    return this.stock.levels(req.user.tenant_id)
  }

  @Post('items')
  @RequirePermission('stock.adjust')
  async createItem(@Req() req: { user: JwtUser }, @Body() body: unknown) {
    return this.stock.createItem(req.user.tenant_id, parseOrThrow(CreateItemDto, body))
  }

  @Post('receive')
  @RequirePermission('stock.receive')
  async receive(@Req() req: { user: JwtUser }, @Body() body: unknown) {
    return this.stock.receive(req.user.tenant_id, parseOrThrow(ReceiveDto, body), req.user.sub)
  }

  @Post('adjust')
  @RequirePermission('stock.adjust')
  async adjust(@Req() req: { user: JwtUser }, @Body() body: unknown) {
    return this.stock.adjust(req.user.tenant_id, parseOrThrow(AdjustDto, body), req.user.sub)
  }

  @Post('count')
  @RequirePermission('stock.count')
  async count(@Req() req: { user: JwtUser }, @Body() body: unknown) {
    return this.stock.count(req.user.tenant_id, parseOrThrow(CountDto, body), req.user.sub)
  }
}
```
> Os `POST` aqui **não** levam `@HttpCode(200)` → Nest devolve **201** (o e2e espera 201). `parseOrThrow` lança 400 em corpo inválido (mesmo helper usado nas outras controllers).

- [ ] **Step 5: Implement the module + register it**

`apps/api/src/stock/stock.module.ts`:
```ts
import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { PermissionsGuard } from '../rbac/permissions.guard'
import { StockService } from './stock.service'
import { StockController } from './stock.controller'

@Module({
  imports: [AuthModule],
  controllers: [StockController],
  providers: [StockService, PermissionsGuard],
})
export class StockModule {}
```

Modify `apps/api/src/app.module.ts` — importar e adicionar `StockModule` ao array `imports` (seguir o padrão dos outros módulos, ex. `TablesModule`).

- [ ] **Step 6: Run the e2e to verify it passes**

Run: `corepack pnpm --filter @gelato/api exec vitest run stock.e2e`
Expected: PASS (6 testes).

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/stock apps/api/src/app.module.ts apps/api/test/stock.e2e.test.ts
git commit -m "feat(api): módulo stock — GET /stock + POST items/receive/adjust/count (RBAC)"
```

- [ ] **Step 8: Write the append-only immutability test for stock_movements**

Modify `apps/api/test/immutability.test.ts` — adicionar um helper e um `it` (no estilo dos existentes):
```ts
async function insertStockMovement(pool: Pool): Promise<string> {
  const itemId = `si_${Date.now()}_${Math.random().toString(36).slice(2)}`
  await pool.query(
    `INSERT INTO stock_items (id, "tenantId", name, unit, active, "createdAt", "updatedAt")
     VALUES ($1, 'demo-tenant', 'T', 'g', true, now(), now())`,
    [itemId],
  )
  const id = `sm_${Date.now()}_${Math.random().toString(36).slice(2)}`
  await pool.query(
    `INSERT INTO stock_movements (id, "tenantId", "stockItemId", type, "qtyDelta", "createdAt")
     VALUES ($1, 'demo-tenant', $2, 'receive', 100, now())`,
    [id, itemId],
  )
  return id
}
```
e dentro do `describe('fiscal immutability (DB-enforced)', ...)`:
```ts
  it('stock_movements is append-only (INSERT ok, UPDATE/DELETE blocked)', async (ctx) => {
    if (!dbAvailable) return ctx.skip()
    const id = await insertStockMovement(appPool)
    expect(id).toBeTruthy()
    await expect(appPool.query(`UPDATE stock_movements SET "qtyDelta"=0 WHERE id=$1`, [id])).rejects.toThrow()
    await expect(appPool.query(`DELETE FROM stock_movements WHERE id=$1`, [id])).rejects.toThrow()
  })
```
> O `tenantId` `'demo-tenant'` aqui é arbitrário (a FK é só `stockItemId`→`stock_items`). Se o seu seed usa outro id de tenant, qualquer string serve — não há FK de tenant.

- [ ] **Step 9: Run the immutability test**

Run: `corepack pnpm --filter @gelato/api exec vitest run immutability`
Expected: PASS — INSERT em `stock_items`/`stock_movements` ok (app tem grant); UPDATE/DELETE em `stock_movements` lançam (trigger).

- [ ] **Step 10: Write the capstone e2e**

`apps/api/test/stock-capstone.e2e.test.ts`:
```ts
import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import type { AddressInfo } from 'node:net'
import { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AppModule } from '../src/app.module'

// Capstone 2a: item novo → receive 1000 → adjust −250 (750) → count 700
// (gera movimento count de −50) → GET /stock = 700, histórico com 3 movimentos.
describe('Stock capstone (e2e)', () => {
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

  it('derives the right level through receive → adjust → count', async () => {
    const id = ((await (await post('/stock/items', { name: `cap-${crypto.randomUUID().slice(0, 8)}`, unit: 'ml' })).json()) as { id: string }).id
    await post('/stock/receive', { stock_item_id: id, qty: 1000 })
    await post('/stock/adjust', { stock_item_id: id, qty_delta: -250 })
    const mid = ((await (await get('/stock')).json()) as { id: string; qty: number }[]).find((l) => l.id === id)!
    expect(mid.qty).toBe(750)

    await post('/stock/count', { stock_item_id: id, counted: 700 })
    const lvl = ((await (await get('/stock')).json()) as { id: string; qty: number }[]).find((l) => l.id === id)!
    expect(lvl.qty).toBe(700)

    const movs = await prisma.stockMovement.findMany({ where: { stockItemId: id }, orderBy: { createdAt: 'asc' } })
    expect(movs.map((m) => [m.type, m.qtyDelta])).toEqual([['receive', 1000], ['adjust', -250], ['count', -50]])
  })
})
```

- [ ] **Step 11: Run the capstone**

Run: `corepack pnpm --filter @gelato/api exec vitest run stock-capstone`
Expected: PASS.

- [ ] **Step 12: Run the whole API suite (no regressions)**

Run: `corepack pnpm --filter @gelato/api exec vitest run`
Expected: tudo verde (suíte anterior + os novos).

- [ ] **Step 13: Commit**

```bash
git add apps/api/test/immutability.test.ts apps/api/test/stock-capstone.e2e.test.ts
git commit -m "test(api): stock append-only + capstone (receive→adjust→count = nível derivado)"
```

---

## Chunk 4: backoffice (mínimo) + integração

**Files:**
- Modify: `apps/backoffice/src/api.ts` (adicionar `apiPost` + tipos de estoque)
- Modify: `apps/backoffice/src/App.tsx` (seção `Stock`)

- [ ] **Step 1: Adicionar `apiPost` + tipos ao backoffice api**

Modify `apps/backoffice/src/api.ts` — adicionar:
```ts
export interface StockLevel {
  id: string
  name: string
  unit: string
  minStock: number | null
  qty: number
}

export async function apiPost<T>(path: string, token: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`${path} failed`)
  return res.json() as Promise<T>
}
```

- [ ] **Step 2: Adicionar a seção `Stock` ao App**

Modify `apps/backoffice/src/App.tsx`:
1. No import do `./api`, incluir `apiPost` e o tipo: `import { apiGet, apiGetBlob, apiLogin, apiPost, type StockLevel } from './api'`.
2. Renderizar `<Stock token={token} />` junto às outras seções (perto de `<Exports token={token} />`).
3. Adicionar o componente (no estilo das funções `Sales`/`Products` existentes — minimalista):
```tsx
function Stock({ token }: { token: string }) {
  const [levels, setLevels] = useState<StockLevel[]>([])
  const [selected, setSelected] = useState('')
  const [qty, setQty] = useState('')

  const reload = (): void => {
    apiGet<StockLevel[]>('/stock', token).then(setLevels).catch(() => setLevels([]))
  }
  useEffect(reload, [token])

  async function receive(e: FormEvent): Promise<void> {
    e.preventDefault()
    if (!selected || !qty) return
    await apiPost('/stock/receive', token, { stock_item_id: selected, qty: Number(qty) })
    setQty('')
    reload()
  }

  async function count(): Promise<void> {
    if (!selected || !qty) return
    await apiPost('/stock/count', token, { stock_item_id: selected, counted: Number(qty) })
    setQty('')
    reload()
  }

  return (
    <section style={{ marginTop: '2rem' }}>
      <h2>Estoque</h2>
      <table>
        <thead>
          <tr><th>Insumo</th><th>Unidade</th><th>Atual</th><th>Mín.</th></tr>
        </thead>
        <tbody>
          {levels.map((l) => (
            <tr key={l.id} style={l.minStock != null && l.qty < l.minStock ? { color: '#b91c1c' } : undefined}>
              <td>{l.name}</td><td>{l.unit}</td><td>{l.qty}</td><td>{l.minStock ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <form onSubmit={receive} style={{ marginTop: '0.5rem', display: 'flex', gap: '0.5rem' }}>
        <select value={selected} onChange={(e) => setSelected(e.target.value)}>
          <option value="">— insumo —</option>
          {levels.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        <input type="number" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="quantidade" />
        <button type="submit">Entrada</button>
        <button type="button" onClick={count}>Contagem</button>
      </form>
    </section>
  )
}
```
> A contagem usa o mesmo campo `qty` como o **valor contado** (define o nível para esse número). Entrada quente = `POST /stock/receive`. UI rica/edição inline = depois (YAGNI).

- [ ] **Step 3: Typecheck + build do backoffice**

Run: `corepack pnpm --filter @gelato/backoffice exec tsc --noEmit && corepack pnpm --filter @gelato/backoffice build`
Expected: sem erros de tipo; build gera `dist/`.

- [ ] **Step 4: Commit**

```bash
git add apps/backoffice/src/api.ts apps/backoffice/src/App.tsx
git commit -m "feat(backoffice): seção Estoque (níveis + entrada rápida + contagem)"
```

- [ ] **Step 5: Suíte completa do monorepo**

Run: `corepack pnpm -r test`
Expected: tudo verde (pacotes + API; o terminal usa ABI Node — se já estiver em ABI Electron, rode antes `corepack pnpm rebuild better-sqlite3`).

- [ ] **Step 6: Integrar `ciclo-2a` → `main` + push**

Usar superpowers:finishing-a-development-branch (merge local fast-forward em `main` + push):
```bash
git checkout main
git merge --ff-only ciclo-2a
git push origin main
```
> Manter `docker/docker-compose.yml` (porta 5433) e `.claude/` **fora** do commit (locais/coexistência), como nas fatias anteriores.

---

## Notas de verificação / riscos

- **GRANT explícito é obrigatório** para master-data nova: `GRANT ON ALL TABLES` da c0 só cobre tabelas pré-existentes (descoberto na 1a-3 com `product_variants`). Por isso o Step 4 do Chunk 2.
- **`StockMovement` append-only** reusa o trigger `fiscal_append_only()` por **auditabilidade operacional** (Wareneinsatz), **não** é tabela fiscal §146a/TSE. Distinção de classificação, mesmo mecanismo.
- **Estoque negativo** é permitido e visível — o bloqueio/alerta é a 2d; o decremento por venda é a 2c.
- **Dist do compliance**: `nest start` (runtime) importa de `dist`; os testes (vitest) usam alias→`src`. Por isso o build no Chunk 1.
- **Validação externa (rastrear):** retenção/forma dos registros de estoque para GoBD → Steuerberater.
```
