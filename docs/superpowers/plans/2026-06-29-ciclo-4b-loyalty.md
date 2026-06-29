# Ciclo 4 · Fatia 4b — Loyalty — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fidelidade: ganho automático de pontos+carimbos por venda (ledger append-only) + resgate manual, com saldo derivado.

**Architecture:** Puras `earnFromSale`/`loyaltyBalance` em `@gelato/compliance` → `LoyaltyProgram` (config mutável) + `LoyaltyEntry` (append-only, trigger) → hook `earnLoyalty` no `ledger.ingest` (toda Order com `customer_id`) + módulo NestJS `loyalty` (saldo, resgate, programa). Saldo = Σ entries.

**Tech Stack:** TypeScript strict, vitest, NestJS, Prisma + Postgres (**5433**), zod, React/Vite.

**Spec:** `docs/superpowers/specs/2026-06-29-ciclo-4b-loyalty-design.md`

**Pré-requisitos:** Postgres up (`docker compose -f docker/docker-compose.yml -p gelato_c0 up -d`, 5433; se o Docker Desktop estiver fora: `Start-Process "C:\Program Files\Docker\Docker\Docker Desktop.exe"`, aguardar o engine); branch `ciclo-4b` (off `main`).

---

## Chunk 1: `earnFromSale` + `loyaltyBalance` (puro)

**Files:**
- Create: `packages/compliance/src/loyalty/points.ts`
- Create: `packages/compliance/test/loyalty-points.test.ts`
- Modify: `packages/compliance/src/index.ts` (`export * from './loyalty/points'`)

- [ ] **Step 1: Write the failing test**

`packages/compliance/test/loyalty-points.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { earnFromSale, loyaltyBalance } from '../src/loyalty/points'

describe('earnFromSale', () => {
  it('points per whole euro + stamps per item', () => {
    expect(earnFromSale(1190, 3, { pointsPerEuro: 1, stampsPerItem: 1 })).toEqual({ points: 11, stamps: 3 })
    expect(earnFromSale(1190, 3, { pointsPerEuro: 2, stampsPerItem: 0 })).toEqual({ points: 22, stamps: 0 })
  })
  it('zero config → zero', () => {
    expect(earnFromSale(5000, 9, { pointsPerEuro: 0, stampsPerItem: 0 })).toEqual({ points: 0, stamps: 0 })
  })
  it('negative gross/items (Storno) → negative earn', () => {
    expect(earnFromSale(-1190, -3, { pointsPerEuro: 1, stampsPerItem: 1 })).toEqual({ points: -11, stamps: -3 })
  })
})

describe('loyaltyBalance', () => {
  it('sums signed point/stamp deltas', () => {
    expect(loyaltyBalance([
      { points: 11, stamps: 3 },
      { points: -5, stamps: 0 },
      { points: 0, stamps: -1 },
    ])).toEqual({ points: 6, stamps: 2 })
  })
  it('empty → zero', () => {
    expect(loyaltyBalance([])).toEqual({ points: 0, stamps: 0 })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `corepack pnpm --filter @gelato/compliance exec vitest run loyalty-points`
Expected: FAIL — import inexistente.

- [ ] **Step 3: Implement**

`packages/compliance/src/loyalty/points.ts`:
```ts
export interface LoyaltyProgramConfig {
  pointsPerEuro: number
  stampsPerItem: number
}

/** Ganho de uma venda: pontos por € inteiro + carimbos por item. Puro. */
export function earnFromSale(grossCents: number, itemCount: number, program: LoyaltyProgramConfig): { points: number; stamps: number } {
  const euros = Math.trunc(grossCents / 100)
  return { points: euros * program.pointsPerEuro, stamps: itemCount * program.stampsPerItem }
}

/** Saldo = Σ dos deltas de points e stamps. Puro. */
export function loyaltyBalance(entries: { points: number; stamps: number }[]): { points: number; stamps: number } {
  return entries.reduce((acc, e) => ({ points: acc.points + e.points, stamps: acc.stamps + e.stamps }), { points: 0, stamps: 0 })
}
```
> `Math.trunc` (não `floor`) p/ Storno: `-1190/100 = -11.9` → `trunc = -11` (devolve o que ganhou).

- [ ] **Step 4: Export** — `packages/compliance/src/index.ts`: `export * from './loyalty/points'`

- [ ] **Step 5: Run to verify it passes**

Run: `corepack pnpm --filter @gelato/compliance exec vitest run loyalty-points`
Expected: PASS (5 testes).

- [ ] **Step 6: Build dist**

Run: `corepack pnpm --filter @gelato/compliance build`

- [ ] **Step 7: Commit**

```bash
git add packages/compliance/src/loyalty/points.ts packages/compliance/test/loyalty-points.test.ts packages/compliance/src/index.ts
git commit -m "feat(compliance): earnFromSale + loyaltyBalance — fidelidade (puro)"
```

---

## Chunk 2: modelo `LoyaltyProgram` + `LoyaltyEntry` + seed

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/<ts>_c4b_loyalty/migration.sql`
- Modify: `apps/api/prisma/seed.ts`

- [ ] **Step 1: Adicionar os modelos**

Modify `apps/api/prisma/schema.prisma` — ao final:
```prisma
// ---------- Loyalty (Ciclo 4b) ----------

model LoyaltyProgram {
  id            String   @id @default(cuid())
  tenantId      String   @unique
  pointsPerEuro Int      @default(0)
  stampsPerItem Int      @default(0)
  active        Boolean  @default(true)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@map("loyalty_programs")
}

model LoyaltyEntry {
  id         String   @id @default(cuid())
  tenantId   String
  customerId String
  kind       String // 'earn' | 'redeem' | 'adjust'
  points     Int      @default(0) // delta assinado
  stamps     Int      @default(0) // delta assinado
  refType    String?
  refId      String?
  reason     String?
  at         DateTime @default(now())

  customer Customer @relation(fields: [customerId], references: [id])

  @@index([tenantId, customerId])
  @@map("loyalty_entries")
}
```
E no model `Customer`, adicionar o lado inverso da relação (junto de `consents`):
```prisma
  loyaltyEntries ConsentRecord[] // <-- NÃO; ver abaixo
```
> **Correção:** adicionar `loyaltyEntries LoyaltyEntry[]` ao `Customer` (não `ConsentRecord`):
> ```prisma
>   consents       ConsentRecord[]
>   loyaltyEntries LoyaltyEntry[]
> ```

- [ ] **Step 2: Validar + gerar a migração**

```bash
corepack pnpm --filter @gelato/api exec prisma validate
cd apps/api
TS=20260629110000
mkdir -p prisma/migrations/${TS}_c4b_loyalty
corepack pnpm exec prisma migrate diff \
  --from-schema-datasource prisma/schema.prisma \
  --to-schema-datamodel prisma/schema.prisma \
  --script > prisma/migrations/${TS}_c4b_loyalty/migration.sql
cd ../..
cat apps/api/prisma/migrations/20260629110000_c4b_loyalty/migration.sql
```
Expected: `CREATE TABLE "loyalty_programs"` (+ unique tenantId), `"loyalty_entries"` + FK.

- [ ] **Step 3: Anexar GRANT + trigger**

Acrescentar ao final de `prisma/migrations/${TS}_c4b_loyalty/migration.sql`:
```sql

-- ===== Loyalty: programa mutável; entries append-only =====
GRANT SELECT, INSERT, UPDATE, DELETE ON loyalty_programs TO gelato_app;
GRANT SELECT, INSERT ON loyalty_entries TO gelato_app;
DROP TRIGGER IF EXISTS loyalty_entries_append_only ON loyalty_entries;
CREATE TRIGGER loyalty_entries_append_only BEFORE UPDATE OR DELETE ON loyalty_entries
  FOR EACH ROW EXECUTE FUNCTION fiscal_append_only();
```

- [ ] **Step 4: Aplicar + marcar + gerar**

```bash
cd apps/api
corepack pnpm exec prisma db execute --schema prisma/schema.prisma --file prisma/migrations/20260629110000_c4b_loyalty/migration.sql
corepack pnpm exec prisma migrate resolve --applied 20260629110000_c4b_loyalty
corepack pnpm exec prisma generate
cd ../..
```

- [ ] **Step 5: Seed do programa demo**

Modify `apps/api/prisma/seed.ts` — após o bloco do termo de consentimento (antes do fechamento da função):
```ts
  // Loyalty (Ciclo 4b): programa demo (1 ponto/€, 1 carimbo/item).
  await prisma.loyaltyProgram.upsert({
    where: { tenantId: TENANT_ID },
    update: {},
    create: { tenantId: TENANT_ID, pointsPerEuro: 1, stampsPerItem: 1, active: true },
  })
```

- [ ] **Step 6: Rodar o seed 2×**

Run: `corepack pnpm --filter @gelato/api db:seed && corepack pnpm --filter @gelato/api db:seed`
Expected: "seed done" nas duas.

- [ ] **Step 7: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations apps/api/prisma/seed.ts
git commit -m "feat(api): modelo loyalty — LoyaltyProgram (mutável) + LoyaltyEntry (append-only) + seed"
```

---

## Chunk 3: hook `earnLoyalty` + módulo `loyalty` + e2e + imutabilidade + capstone

**Files:**
- Create: `apps/api/src/loyalty/earn.ts`
- Modify: `apps/api/src/pos/ledger.service.ts` (hook)
- Create: `apps/api/src/loyalty/loyalty.service.ts`
- Create: `apps/api/src/loyalty/loyalty.controller.ts`
- Create: `apps/api/src/loyalty/loyalty.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Create: `apps/api/test/loyalty.e2e.test.ts`
- Modify: `apps/api/test/immutability.test.ts`
- Create: `apps/api/test/loyalty-capstone.e2e.test.ts`

- [ ] **Step 1: Implement `earnLoyalty`**

`apps/api/src/loyalty/earn.ts`:
```ts
import type { Prisma } from '@prisma/client'
import { earnFromSale } from '@gelato/compliance'

/** Ganho de fidelidade na venda. Roda DENTRO da transação da Order (idempotente). */
export async function earnLoyalty(
  tx: Prisma.TransactionClient,
  params: { kasseId: string; customerId: string; grossCents: number; itemCount: number; orderId: string },
): Promise<void> {
  const kasse = await tx.kasse.findUnique({ where: { id: params.kasseId }, include: { betriebsstaette: true } })
  if (!kasse) return
  const tenantId = kasse.betriebsstaette.tenantId
  const program = await tx.loyaltyProgram.findUnique({ where: { tenantId } })
  if (!program || !program.active) return
  const { points, stamps } = earnFromSale(params.grossCents, params.itemCount, { pointsPerEuro: program.pointsPerEuro, stampsPerItem: program.stampsPerItem })
  if (points === 0 && stamps === 0) return
  await tx.loyaltyEntry.create({ data: { tenantId, customerId: params.customerId, kind: 'earn', points, stamps, refType: 'order', refId: params.orderId } })
}
```

- [ ] **Step 2: Hook no `ledger.ingest`**

Modify `apps/api/src/pos/ledger.service.ts`:
1. Import: `import { earnLoyalty } from '../loyalty/earn'`.
2. Dentro do `$transaction`, **após** o bloco de `consumeForSale` e **antes** do `return { duplicate: false, orderId: order.id }`:
```ts
      // Fidelidade (4b): ganho na venda quando há cliente (vendas diretas + pagamentos com cliente).
      if (p.order.customer_id) {
        await earnLoyalty(tx, {
          kasseId: event.kasse_id,
          customerId: p.order.customer_id,
          grossCents: p.order.total_gross,
          itemCount: p.items.reduce((s, i) => s + i.qty, 0),
          orderId: order.id,
        })
      }
```

- [ ] **Step 3: Write the failing e2e**

`apps/api/test/loyalty.e2e.test.ts`:
```ts
import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { FakeTseProvider } from '@gelato/compliance'
import { AppModule } from '../src/app.module'

const tse = new FakeTseProvider({ serialNumber: 'SER-L' })

describe('Loyalty (e2e)', () => {
  let app: INestApplication
  let baseUrl: string
  let token: string

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = mod.createNestApplication()
    await app.listen(0)
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`
    token = ((await (await fetch(`${baseUrl}/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'admin@demo.test', password: 'admin123' }),
    })).json()) as { access_token: string }).access_token
  }, 30000)

  afterAll(async () => {
    await app?.close()
  })

  const post = (path: string, body: unknown) =>
    fetch(`${baseUrl}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body) })
  const put = (path: string, body: unknown) =>
    fetch(`${baseUrl}${path}`, { method: 'PUT', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body) })
  const get = (path: string) => fetch(`${baseUrl}${path}`, { headers: { authorization: `Bearer ${token}` } })

  const newCustomer = async (): Promise<string> => ((await (await post('/customers', { name: 'L', email: `l-${crypto.randomUUID().slice(0, 8)}@x.de` })).json()) as { id: string }).id

  async function sale(customerId: string, qty: number, unitNet: number): Promise<void> {
    const gross = Math.round(unitNet * qty * 1.19)
    const r = await tse.sign({ clientId: 'c1', processType: 'Kassenbeleg-V1', amountsByVatRate: [], paymentType: 'Bar', grossTotal: gross })
    await post('/pos/sync', {
      client_event_id: crypto.randomUUID(), type: 'sale', kasse_id: 'demo-kasse',
      payload: {
        order: { mode: 'ausser_haus', customer_id: customerId, total_net: unitNet * qty, total_mwst: gross - unitNet * qty, total_gross: gross },
        items: [{ product_id: 'p1', qty, unit_net: unitNet, mwst_rate: 0.19, mwst_code: 'standard_19' }],
        payment: { method: 'cash', amount: gross },
        receipt: { qr_payload: '', format: 'digital' },
        tse_transaction: { tx_number: r.txNumber, signature_counter: r.signatureCounter, signature_value: r.signatureValue, log_time: r.logTime, process_type: r.processType, serial_number: r.serialNumber, public_key: r.publicKey },
      },
    })
  }

  // Lê a config ATIVA (robusto a qualquer programa) e devolve o ganho esperado.
  async function expectedEarn(gross: number, items: number): Promise<{ points: number; stamps: number }> {
    const p = (await (await get('/loyalty/program')).json()) as { pointsPerEuro: number; stampsPerItem: number }
    return { points: Math.trunc(gross / 100) * p.pointsPerEuro, stamps: items * p.stampsPerItem }
  }

  it('a sale with a customer earns loyalty per the active program', async () => {
    const id = await newCustomer()
    // venda: 3 × 400net → gross = round(400*3*1.19) = 1428
    await sale(id, 3, 400)
    const exp = await expectedEarn(1428, 3)
    const r = (await (await get(`/customers/${id}/loyalty`)).json()) as { balance: { points: number; stamps: number } }
    expect(r.balance).toEqual(exp)
  })

  it('redeem reduces the balance; over-redeem → 400', async () => {
    const id = await newCustomer()
    await sale(id, 5, 1000) // gross = round(5000*1.19)=5950
    const before = (await (await get(`/customers/${id}/loyalty`)).json()) as { balance: { points: number; stamps: number } }
    expect((await post(`/customers/${id}/loyalty/redeem`, { points: 1, stamps: 1 })).status).toBe(201)
    const after = (await (await get(`/customers/${id}/loyalty`)).json()) as { balance: { points: number; stamps: number } }
    expect(after.balance.points).toBe(before.balance.points - 1)
    expect(after.balance.stamps).toBe(before.balance.stamps - 1)
    expect((await post(`/customers/${id}/loyalty/redeem`, { points: 999999 })).status).toBe(400)
    expect((await post(`/customers/${id}/loyalty/redeem`, {})).status).toBe(400) // nada p/ resgatar
  })

  it('an inactive program earns nothing', async () => {
    await put('/loyalty/program', { active: false })
    const id = await newCustomer()
    await sale(id, 2, 500)
    const r = (await (await get(`/customers/${id}/loyalty`)).json()) as { balance: { points: number; stamps: number } }
    expect(r.balance).toEqual({ points: 0, stamps: 0 })
    await put('/loyalty/program', { active: true, points_per_euro: 1, stamps_per_item: 1 }) // restaura
  })

  it('PUT /loyalty/program upserts the config', async () => {
    const r = (await (await put('/loyalty/program', { points_per_euro: 2, stamps_per_item: 3, active: true })).json()) as { pointsPerEuro: number; stampsPerItem: number }
    expect([r.pointsPerEuro, r.stampsPerItem]).toEqual([2, 3])
    await put('/loyalty/program', { points_per_euro: 1, stamps_per_item: 1, active: true }) // restaura
  })

  it('404 loyalty for a customer from another tenant', async () => {
    expect((await get(`/customers/nonexistent-${crypto.randomUUID().slice(0, 8)}/loyalty`)).status).toBe(404)
  })
})
```
> **Isolamento:** os testes de ganho leem a config ativa (`expectedEarn`) → robustos a qualquer
> programa. Os testes que mexem no programa restauram `(1,1,active)` ao final.

- [ ] **Step 4: Implement the service**

`apps/api/src/loyalty/loyalty.service.ts`:
```ts
import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common'
import { loyaltyBalance } from '@gelato/compliance'
import { PrismaService } from '../prisma/prisma.service'

@Injectable()
export class LoyaltyService {
  constructor(private readonly prisma: PrismaService) {}

  private async ownOr404(tenantId: string, customerId: string) {
    const c = await this.prisma.customer.findFirst({ where: { id: customerId, tenantId } })
    if (!c) throw new NotFoundException('customer')
    return c
  }

  async balance(tenantId: string, customerId: string) {
    await this.ownOr404(tenantId, customerId)
    const entries = await this.prisma.loyaltyEntry.findMany({ where: { tenantId, customerId }, orderBy: { at: 'desc' } })
    return { balance: loyaltyBalance(entries), entries }
  }

  async redeem(tenantId: string, customerId: string, dto: { points?: number; stamps?: number; reason?: string }) {
    await this.ownOr404(tenantId, customerId)
    const points = dto.points ?? 0
    const stamps = dto.stamps ?? 0
    if (points <= 0 && stamps <= 0) throw new BadRequestException('nothing to redeem')
    const entries = await this.prisma.loyaltyEntry.findMany({ where: { tenantId, customerId } })
    const bal = loyaltyBalance(entries)
    if (points > bal.points || stamps > bal.stamps) throw new BadRequestException('insufficient balance')
    await this.prisma.loyaltyEntry.create({ data: { tenantId, customerId, kind: 'redeem', points: -points, stamps: -stamps, reason: dto.reason } })
    return { ok: true }
  }

  async getProgram(tenantId: string) {
    const p = await this.prisma.loyaltyProgram.findUnique({ where: { tenantId } })
    return p ?? { tenantId, pointsPerEuro: 0, stampsPerItem: 0, active: true }
  }

  async putProgram(tenantId: string, dto: { points_per_euro?: number; stamps_per_item?: number; active?: boolean }) {
    return this.prisma.loyaltyProgram.upsert({
      where: { tenantId },
      update: { pointsPerEuro: dto.points_per_euro, stampsPerItem: dto.stamps_per_item, active: dto.active },
      create: { tenantId, pointsPerEuro: dto.points_per_euro ?? 0, stampsPerItem: dto.stamps_per_item ?? 0, active: dto.active ?? true },
    })
  }
}
```

- [ ] **Step 5: Implement the controller**

`apps/api/src/loyalty/loyalty.controller.ts`:
```ts
import { Body, Controller, Get, Param, Post, Put, Req, UseGuards } from '@nestjs/common'
import { z } from 'zod'
import { LoyaltyService } from './loyalty.service'
import { JwtAuthGuard, type JwtUser } from '../auth/jwt-auth.guard'
import { PermissionsGuard } from '../rbac/permissions.guard'
import { RequirePermission } from '../rbac/require-permission.decorator'
import { parseOrThrow } from '../common/zod'

const RedeemDto = z.object({ points: z.number().int().nonnegative().optional(), stamps: z.number().int().nonnegative().optional(), reason: z.string().optional() })
const ProgramDto = z.object({ points_per_euro: z.number().int().nonnegative().optional(), stamps_per_item: z.number().int().nonnegative().optional(), active: z.boolean().optional() })

@Controller()
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class LoyaltyController {
  constructor(private readonly loyalty: LoyaltyService) {}

  @Get('customers/:id/loyalty')
  @RequirePermission('marketing.view')
  async balance(@Req() req: { user: JwtUser }, @Param('id') id: string) {
    return this.loyalty.balance(req.user.tenant_id, id)
  }

  @Post('customers/:id/loyalty/redeem')
  @RequirePermission('customer.manage')
  async redeem(@Req() req: { user: JwtUser }, @Param('id') id: string, @Body() body: unknown) {
    return this.loyalty.redeem(req.user.tenant_id, id, parseOrThrow(RedeemDto, body))
  }

  @Get('loyalty/program')
  @RequirePermission('marketing.view')
  async getProgram(@Req() req: { user: JwtUser }) {
    return this.loyalty.getProgram(req.user.tenant_id)
  }

  @Put('loyalty/program')
  @RequirePermission('marketing.manage')
  async putProgram(@Req() req: { user: JwtUser }, @Body() body: unknown) {
    return this.loyalty.putProgram(req.user.tenant_id, parseOrThrow(ProgramDto, body))
  }
}
```

- [ ] **Step 6: Module + registrar**

`apps/api/src/loyalty/loyalty.module.ts`:
```ts
import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { PermissionsGuard } from '../rbac/permissions.guard'
import { LoyaltyService } from './loyalty.service'
import { LoyaltyController } from './loyalty.controller'

@Module({
  imports: [AuthModule],
  controllers: [LoyaltyController],
  providers: [LoyaltyService, PermissionsGuard],
})
export class LoyaltyModule {}
```

Modify `apps/api/src/app.module.ts` — importar `LoyaltyModule` e adicionar ao `imports`.

- [ ] **Step 7: Run to verify it passes**

Run: `corepack pnpm --filter @gelato/api exec vitest run loyalty.e2e`
Expected: PASS (5 testes).

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/loyalty apps/api/src/pos/ledger.service.ts apps/api/src/app.module.ts apps/api/test/loyalty.e2e.test.ts
git commit -m "feat(api): loyalty — ganho na venda (earnLoyalty no ledger) + saldo/resgate/programa"
```

- [ ] **Step 9: Immutability test** — adicionar a `apps/api/test/immutability.test.ts`:

Helper (junto dos outros `insert*`):
```ts
async function insertLoyaltyEntry(pool: Pool): Promise<string> {
  const custId = `lc_${Date.now()}_${Math.random().toString(36).slice(2)}`
  await pool.query(
    `INSERT INTO customers (id, "tenantId", email, "createdAt", "updatedAt") VALUES ($1, 'demo-tenant', 'l@x.de', now(), now())`,
    [custId],
  )
  const id = `le_${Date.now()}_${Math.random().toString(36).slice(2)}`
  await pool.query(
    `INSERT INTO loyalty_entries (id, "tenantId", "customerId", kind, points, stamps, at) VALUES ($1, 'demo-tenant', $2, 'earn', 10, 1, now())`,
    [id, custId],
  )
  return id
}
```
e dentro do `describe`:
```ts
  it('loyalty_entries is append-only (INSERT ok, UPDATE/DELETE blocked)', async (ctx) => {
    if (!dbAvailable) return ctx.skip()
    const id = await insertLoyaltyEntry(appPool)
    await expect(appPool.query(`UPDATE loyalty_entries SET points=0 WHERE id=$1`, [id])).rejects.toThrow()
    await expect(appPool.query(`DELETE FROM loyalty_entries WHERE id=$1`, [id])).rejects.toThrow()
  })
```

- [ ] **Step 10: Run immutability**

Run: `corepack pnpm --filter @gelato/api exec vitest run immutability`
Expected: PASS (incl. o novo).

- [ ] **Step 11: Write the capstone**

`apps/api/test/loyalty-capstone.e2e.test.ts`:
```ts
import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import type { AddressInfo } from 'node:net'
import { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { FakeTseProvider } from '@gelato/compliance'
import { AppModule } from '../src/app.module'

const tse = new FakeTseProvider({ serialNumber: 'SER-LC' })

// Capstone 4b: programa ativo → venda com cliente → earn (refType order) → saldo →
// resgate reduz → resgate > saldo → 400. Ganho calculado da config ATIVA (robusto).
describe('Loyalty capstone (e2e)', () => {
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

  it('earns on a sale, reflects the balance, and redeems', async () => {
    const id = ((await (await post('/customers', { name: 'Max', email: `cap-${crypto.randomUUID().slice(0, 8)}@x.de` })).json()) as { id: string }).id
    const prog = (await (await get('/loyalty/program')).json()) as { pointsPerEuro: number; stampsPerItem: number; active: boolean }

    // venda: 3 itens, gross 1190
    const r = await tse.sign({ clientId: 'c1', processType: 'Kassenbeleg-V1', amountsByVatRate: [], paymentType: 'Bar', grossTotal: 1190 })
    await post('/pos/sync', {
      client_event_id: crypto.randomUUID(), type: 'sale', kasse_id: 'demo-kasse',
      payload: {
        order: { mode: 'ausser_haus', customer_id: id, total_net: 1000, total_mwst: 190, total_gross: 1190 },
        items: [{ product_id: 'p1', qty: 3, unit_net: 333, mwst_rate: 0.19, mwst_code: 'standard_19' }],
        payment: { method: 'cash', amount: 1190 },
        receipt: { qr_payload: '', format: 'digital' },
        tse_transaction: { tx_number: r.txNumber, signature_counter: r.signatureCounter, signature_value: r.signatureValue, log_time: r.logTime, process_type: r.processType, serial_number: r.serialNumber, public_key: r.publicKey },
      },
    })

    const expPoints = prog.active ? Math.trunc(1190 / 100) * prog.pointsPerEuro : 0
    const expStamps = prog.active ? 3 * prog.stampsPerItem : 0
    const lo = (await (await get(`/customers/${id}/loyalty`)).json()) as { balance: { points: number; stamps: number }; entries: { kind: string; refType: string | null }[] }
    expect(lo.balance).toEqual({ points: expPoints, stamps: expStamps })
    expect(lo.entries[0].refType).toBe('order')

    if (expPoints > 0) {
      expect((await post(`/customers/${id}/loyalty/redeem`, { points: 1 })).status).toBe(201)
      const after = (await (await get(`/customers/${id}/loyalty`)).json()) as { balance: { points: number } }
      expect(after.balance.points).toBe(expPoints - 1)
    }
    expect((await post(`/customers/${id}/loyalty/redeem`, { points: 999999 })).status).toBe(400)
  })
})
```

- [ ] **Step 12: Run capstone + full API suite**

Run: `corepack pnpm --filter @gelato/api exec vitest run loyalty-capstone`
Then: `corepack pnpm --filter @gelato/api exec vitest run`
Expected: ambos verdes.

- [ ] **Step 13: Commit**

```bash
git add apps/api/test/immutability.test.ts apps/api/test/loyalty-capstone.e2e.test.ts
git commit -m "test(api): loyalty append-only + capstone (venda -> earn -> saldo -> resgate)"
```

---

## Chunk 4: backoffice (Fidelidade) + integração

**Files:**
- Modify: `apps/backoffice/src/api.ts` (tipos `LoyaltyProgram` + `LoyaltyBalance`)
- Modify: `apps/backoffice/src/App.tsx` (componente `Loyalty`)

- [ ] **Step 1: Tipos no backoffice api**

Modify `apps/backoffice/src/api.ts` — adicionar:
```ts
export interface LoyaltyProgram {
  pointsPerEuro: number
  stampsPerItem: number
  active: boolean
}
export interface LoyaltyView {
  balance: { points: number; stamps: number }
  entries: { kind: string; points: number; stamps: number; at: string }[]
}
```

- [ ] **Step 2: Componente `Loyalty`**

Modify `apps/backoffice/src/App.tsx`:
1. Import: incluir `type LoyaltyProgram, type LoyaltyView, type CustomerRow` (CustomerRow já existe).
2. Renderizar `<Loyalty token={token} />` (perto de `<Customers token={token} />`).
3. Componente:
```tsx
function Loyalty({ token }: { token: string }) {
  const [program, setProgram] = useState<LoyaltyProgram | null>(null)
  const [customers, setCustomers] = useState<CustomerRow[]>([])
  const [balances, setBalances] = useState<Record<string, { points: number; stamps: number }>>({})

  useEffect(() => {
    apiGet<LoyaltyProgram>('/loyalty/program', token).then(setProgram).catch(() => setProgram(null))
    apiGet<CustomerRow[]>('/customers', token).then(setCustomers).catch(() => setCustomers([]))
  }, [token])

  async function save(): Promise<void> {
    if (!program) return
    await apiPost('/loyalty/program', token, { points_per_euro: program.pointsPerEuro, stamps_per_item: program.stampsPerItem, active: program.active })
    // (apiPost faz POST; usar fetch PUT via apiPut — ver nota)
  }

  async function showBalance(id: string): Promise<void> {
    const v = await apiGet<LoyaltyView>(`/customers/${id}/loyalty`, token)
    setBalances((b) => ({ ...b, [id]: v.balance }))
  }

  return (
    <section style={{ marginTop: '2rem' }}>
      <h2>Fidelidade</h2>
      {program && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <label>Pontos/€ <input type="number" value={program.pointsPerEuro} onChange={(e) => setProgram({ ...program, pointsPerEuro: Number(e.target.value) })} /></label>
          <label>Carimbos/item <input type="number" value={program.stampsPerItem} onChange={(e) => setProgram({ ...program, stampsPerItem: Number(e.target.value) })} /></label>
          <label>Ativo <input type="checkbox" checked={program.active} onChange={(e) => setProgram({ ...program, active: e.target.checked })} /></label>
          <button onClick={save}>Salvar</button>
        </div>
      )}
      <ul>
        {customers.filter((c) => !c.anonymizedAt).map((c) => (
          <li key={c.id}>
            {c.name ?? c.email ?? c.id}{' '}
            <button onClick={() => showBalance(c.id)}>ver saldo</button>
            {balances[c.id] && ` — ${balances[c.id].points} pts / ${balances[c.id].stamps} carimbos`}
          </li>
        ))}
      </ul>
    </section>
  )
}
```
> **`apiPut`:** o `loyalty/program` é PUT. Adicionar um helper `apiPut` em `apps/backoffice/src/api.ts`
> (igual ao `apiPost` mas `method: 'PUT'`) e usar `apiPut('/loyalty/program', token, {...})` no `save`.

- [ ] **Step 3: Adicionar `apiPut` ao backoffice api**

Modify `apps/backoffice/src/api.ts` — após `apiPost`:
```ts
export async function apiPut<T>(path: string, token: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`${path} failed`)
  return res.json() as Promise<T>
}
```
e no `App.tsx` importar `apiPut` e usá-lo no `save` (`await apiPut('/loyalty/program', token, {...})`).

- [ ] **Step 4: Typecheck + build**

Run: `corepack pnpm --filter @gelato/backoffice exec tsc --noEmit && corepack pnpm --filter @gelato/backoffice build`
Expected: sem erros.

- [ ] **Step 5: Commit**

```bash
git add apps/backoffice/src/api.ts apps/backoffice/src/App.tsx
git commit -m "feat(backoffice): seção Fidelidade (config do programa + saldo por cliente)"
```

- [ ] **Step 6: Suíte completa + integração**

```bash
corepack pnpm -r test
git checkout main
git merge --ff-only ciclo-4b
git push origin main
git branch -d ciclo-4b
```
> Manter `docker/docker-compose.yml` (5433) e `.claude/` fora do commit.

---

## Notas de verificação / riscos

- **Ganho na venda:** o hook fica no `ledger.ingest` (toda Order com `customer_id`), **sem** o gate
  `tisch_session_id == null` (loyalty ganha em vendas diretas E pagamentos com cliente — diferente do
  decremento de estoque, que é por produção). Idempotente (só no caminho de criação).
- **Saldo derivado** de `loyalty_entries` (append-only); resgate = entrada negativa; Storno = earn negativo.
- **Isolamento de teste:** os testes de ganho leem a config ativa e computam o esperado (robustos a
  qualquer programa); os que mexem no programa restauram `(1,1,active)`.
- **`Math.trunc`** (não floor) p/ Storno simétrico.
- **Controller sem prefixo** (`@Controller()`) com paths completos — `customers/:id/loyalty` não
  conflita com `customers/:id` (mais segmentos = rota mais específica).
- **Dist do compliance** rebuildado no Chunk 1.
```
