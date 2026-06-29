# Ciclo 4 · Fatia 4c — Vouchers — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cupons de desconto por código: validação (quote), desconto como linha Rabatt negativa por alíquota (computada no terminal via lógica pura compartilhada), e trilha de resgate append-only.

**Architecture:** Puras `voucherDiscountGross`/`allocateDiscountByRate` em `@gelato/compliance` → `Voucher` (mutável) + `VoucherRedemption` (append-only) → `POST /vouchers/quote` + CRUD + `voucher_code` no `OrderSchema` + resgate no `ledger.ingest` → seção mínima no backoffice. **Desconto = linha negativa** (zero mudança no modelo Order).

**Tech Stack:** TypeScript strict, vitest, NestJS, Prisma + Postgres (**5433**), zod, React/Vite.

**Spec:** `docs/superpowers/specs/2026-06-29-ciclo-4c-vouchers-design.md`

**Pré-requisitos:** Postgres up (`docker compose -f docker/docker-compose.yml -p gelato_c0 up -d`, 5433; se o Docker Desktop estiver fora: `Start-Process "C:\Program Files\Docker\Docker\Docker Desktop.exe"`, aguardar o engine); branch `ciclo-4c` (off `main`).

---

## Chunk 1: `voucherDiscountGross` + `allocateDiscountByRate` (puro)

**Files:**
- Create: `packages/compliance/src/voucher/discount.ts`
- Create: `packages/compliance/test/voucher-discount.test.ts`
- Modify: `packages/compliance/src/index.ts` (`export * from './voucher/discount'`)

- [ ] **Step 1: Write the failing test**

`packages/compliance/test/voucher-discount.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { voucherDiscountGross, allocateDiscountByRate } from '../src/voucher/discount'

describe('voucherDiscountGross', () => {
  it('percent', () => {
    expect(voucherDiscountGross('percent', 10, 1190)).toBe(119) // floor(1190*10/100)
    expect(voucherDiscountGross('percent', 33, 1000)).toBe(330)
  })
  it('fixed (capped at base)', () => {
    expect(voucherDiscountGross('fixed', 500, 1190)).toBe(500)
    expect(voucherDiscountGross('fixed', 5000, 1190)).toBe(1190) // não passa do total
  })
})

describe('allocateDiscountByRate', () => {
  it('single rate: net-centric negative line', () => {
    expect(allocateDiscountByRate([{ rate: 0.19, gross: 1190 }], 119)).toEqual([
      { rate: 0.19, net: -100, mwst: -19, gross: -119 },
    ])
  })
  it('two rates: proportional, last takes the remainder, Σ = -discount', () => {
    const out = allocateDiscountByRate([{ rate: 0.19, gross: 1190 }, { rate: 0.07, gross: 214 }], 140)
    expect(out.reduce((s, l) => s + l.gross, 0)).toBe(-140)
    expect(out[0]).toEqual({ rate: 0.19, net: -100, mwst: -19, gross: -119 })
    expect(out[1].gross).toBe(-21)
  })
  it('zero / no base → []', () => {
    expect(allocateDiscountByRate([], 100)).toEqual([])
    expect(allocateDiscountByRate([{ rate: 0.19, gross: 1190 }], 0)).toEqual([])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `corepack pnpm --filter @gelato/compliance exec vitest run voucher-discount`
Expected: FAIL — import inexistente.

- [ ] **Step 3: Implement**

`packages/compliance/src/voucher/discount.ts`:
```ts
export type VoucherType = 'percent' | 'fixed'

/** Desconto bruto de um voucher sobre a base (gross). Capado no total. Puro. */
export function voucherDiscountGross(type: VoucherType, value: number, baseGross: number): number {
  if (baseGross <= 0) return 0
  const raw = type === 'percent' ? Math.floor((baseGross * value) / 100) : value
  return Math.max(0, Math.min(raw, baseGross))
}

export interface VatGross {
  rate: number
  gross: number
}
export interface DiscountLine {
  rate: number
  net: number
  mwst: number
  gross: number
}

/**
 * Rateia um desconto bruto entre as alíquotas (proporcional ao gross), net-centric;
 * a última alíquota leva o resto (Σ gross = -discountGross exato). Linhas NEGATIVAS. Puro.
 */
export function allocateDiscountByRate(byVatRate: VatGross[], discountGross: number): DiscountLine[] {
  const total = byVatRate.reduce((s, g) => s + g.gross, 0)
  if (total <= 0 || discountGross <= 0) return []
  let allocated = 0
  return byVatRate.map((g, i) => {
    const isLast = i === byVatRate.length - 1
    const share = isLast ? discountGross - allocated : Math.round((discountGross * g.gross) / total)
    allocated += share
    const net = Math.round(share / (1 + g.rate))
    return { rate: g.rate, net: -net, mwst: -(share - net), gross: -share }
  })
}
```

- [ ] **Step 4: Export** — `packages/compliance/src/index.ts`: `export * from './voucher/discount'`

- [ ] **Step 5: Run to verify it passes**

Run: `corepack pnpm --filter @gelato/compliance exec vitest run voucher-discount`
Expected: PASS (5 testes).

- [ ] **Step 6: Build dist**

Run: `corepack pnpm --filter @gelato/compliance build`

- [ ] **Step 7: Commit**

```bash
git add packages/compliance/src/voucher/discount.ts packages/compliance/test/voucher-discount.test.ts packages/compliance/src/index.ts
git commit -m "feat(compliance): voucherDiscountGross + allocateDiscountByRate — desconto de voucher (puro)"
```

---

## Chunk 2: modelo `Voucher` + `VoucherRedemption` + seed

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/<ts>_c4c_vouchers/migration.sql`
- Modify: `apps/api/prisma/seed.ts`

- [ ] **Step 1: Adicionar os modelos**

Modify `apps/api/prisma/schema.prisma` — ao final:
```prisma
// ---------- Vouchers (Ciclo 4c) ----------

model Voucher {
  id        String    @id @default(cuid())
  tenantId  String
  code      String
  type      String // 'percent' | 'fixed'
  value     Int
  maxUses   Int?
  validFrom DateTime?
  validTo   DateTime?
  active    Boolean   @default(true)
  createdAt DateTime  @default(now())

  redemptions VoucherRedemption[]

  @@unique([tenantId, code])
  @@map("vouchers")
}

model VoucherRedemption {
  id           String   @id @default(cuid())
  tenantId     String
  voucherId    String
  orderId      String?
  customerId   String?
  discountCents Int     @default(0)
  at           DateTime @default(now())

  voucher Voucher @relation(fields: [voucherId], references: [id])

  @@index([tenantId, voucherId])
  @@map("voucher_redemptions")
}
```

- [ ] **Step 2: Validar + gerar a migração**

```bash
corepack pnpm --filter @gelato/api exec prisma validate
cd apps/api
TS=20260629120000
mkdir -p prisma/migrations/${TS}_c4c_vouchers
corepack pnpm exec prisma migrate diff \
  --from-schema-datasource prisma/schema.prisma \
  --to-schema-datamodel prisma/schema.prisma \
  --script > prisma/migrations/${TS}_c4c_vouchers/migration.sql
cd ../..
cat apps/api/prisma/migrations/20260629120000_c4c_vouchers/migration.sql
```
Expected: `CREATE TABLE "vouchers"` (+ unique tenant+code), `"voucher_redemptions"` + FK.

- [ ] **Step 3: Anexar GRANT + trigger**

Acrescentar ao final de `prisma/migrations/${TS}_c4c_vouchers/migration.sql`:
```sql

-- ===== Vouchers: master mutável; redemptions append-only =====
GRANT SELECT, INSERT, UPDATE, DELETE ON vouchers TO gelato_app;
GRANT SELECT, INSERT ON voucher_redemptions TO gelato_app;
DROP TRIGGER IF EXISTS voucher_redemptions_append_only ON voucher_redemptions;
CREATE TRIGGER voucher_redemptions_append_only BEFORE UPDATE OR DELETE ON voucher_redemptions
  FOR EACH ROW EXECUTE FUNCTION fiscal_append_only();
```

- [ ] **Step 4: Aplicar + marcar + gerar**

```bash
cd apps/api
corepack pnpm exec prisma db execute --schema prisma/schema.prisma --file prisma/migrations/20260629120000_c4c_vouchers/migration.sql
corepack pnpm exec prisma migrate resolve --applied 20260629120000_c4c_vouchers
corepack pnpm exec prisma generate
cd ../..
```

- [ ] **Step 5: Seed do voucher demo**

Modify `apps/api/prisma/seed.ts` — após o bloco do programa de loyalty (antes do fechamento da função):
```ts
  // Vouchers (Ciclo 4c): cupom demo SOMMER10 (10%).
  await prisma.voucher.upsert({
    where: { tenantId_code: { tenantId: TENANT_ID, code: 'SOMMER10' } },
    update: {},
    create: { tenantId: TENANT_ID, code: 'SOMMER10', type: 'percent', value: 10, maxUses: 100, active: true },
  })
```

- [ ] **Step 6: Rodar o seed 2×**

Run: `corepack pnpm --filter @gelato/api db:seed && corepack pnpm --filter @gelato/api db:seed`
Expected: "seed done" nas duas.

- [ ] **Step 7: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations apps/api/prisma/seed.ts
git commit -m "feat(api): modelo vouchers — Voucher (mutável) + VoucherRedemption (append-only) + seed"
```

---

## Chunk 3: domínio + API + ledger + e2e + imutabilidade + capstone

**Files:**
- Modify: `packages/domain/src/events.ts` (`voucher_code` no OrderSchema)
- Create: `apps/api/src/vouchers/redeem.ts`
- Modify: `apps/api/src/pos/ledger.service.ts` (hook)
- Create: `apps/api/src/vouchers/vouchers.service.ts`
- Create: `apps/api/src/vouchers/vouchers.controller.ts`
- Create: `apps/api/src/vouchers/vouchers.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Create: `apps/api/test/vouchers.e2e.test.ts`
- Modify: `apps/api/test/immutability.test.ts`
- Create: `apps/api/test/vouchers-capstone.e2e.test.ts`

- [ ] **Step 1: `voucher_code` no OrderSchema + build do domínio**

Modify `packages/domain/src/events.ts` — no `OrderSchema`, adicionar:
```ts
  customer_id: z.string().optional(),
  voucher_code: z.string().optional(),
```
Build: `corepack pnpm --filter @gelato/domain build`
Expected: dist regenerado (runtime do Nest importa de `dist`).

- [ ] **Step 2: `recordVoucherRedemption`**

`apps/api/src/vouchers/redeem.ts`:
```ts
import type { Prisma } from '@prisma/client'

interface SaleItem {
  unit_net: number
  qty: number
  mwst_rate: number
}

/** Grava a trilha de resgate de um voucher na venda. Roda DENTRO da transação da Order. */
export async function recordVoucherRedemption(
  tx: Prisma.TransactionClient,
  params: { kasseId: string; code: string; orderId: string; customerId?: string; items: SaleItem[] },
): Promise<void> {
  const kasse = await tx.kasse.findUnique({ where: { id: params.kasseId }, include: { betriebsstaette: true } })
  if (!kasse) return
  const tenantId = kasse.betriebsstaette.tenantId
  const voucher = await tx.voucher.findFirst({ where: { tenantId, code: params.code } })
  if (!voucher) return
  const discountCents = Math.abs(
    params.items.filter((i) => i.unit_net < 0).reduce((s, i) => s + Math.round(i.unit_net * (1 + i.mwst_rate)) * i.qty, 0),
  )
  await tx.voucherRedemption.create({ data: { tenantId, voucherId: voucher.id, orderId: params.orderId, customerId: params.customerId, discountCents } })
}
```

- [ ] **Step 3: Hook no `ledger.ingest`**

Modify `apps/api/src/pos/ledger.service.ts`:
1. Import: `import { recordVoucherRedemption } from '../vouchers/redeem'`.
2. Dentro do `$transaction`, **após** o bloco de `earnLoyalty` e **antes** do `return`:
```ts
      // Voucher (4c): trilha de resgate quando a venda traz um código.
      if (p.order.voucher_code) {
        await recordVoucherRedemption(tx, {
          kasseId: event.kasse_id,
          code: p.order.voucher_code,
          orderId: order.id,
          customerId: p.order.customer_id,
          items: p.items.map((i) => ({ unit_net: i.unit_net, qty: i.qty, mwst_rate: i.mwst_rate })),
        })
      }
```

- [ ] **Step 4: Write the failing e2e**

`apps/api/test/vouchers.e2e.test.ts`:
```ts
import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { FakeTseProvider } from '@gelato/compliance'
import { AppModule } from '../src/app.module'

const tse = new FakeTseProvider({ serialNumber: 'SER-V' })

describe('Vouchers (e2e)', () => {
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
  const get = (path: string) => fetch(`${baseUrl}${path}`, { headers: { authorization: `Bearer ${token}` } })

  const newCode = () => `T${crypto.randomUUID().slice(0, 8).toUpperCase()}`

  it('creates a voucher; duplicate code → 409', async () => {
    const code = newCode()
    expect((await post('/vouchers', { code, type: 'percent', value: 10 })).status).toBe(201)
    expect((await post('/vouchers', { code, type: 'percent', value: 10 })).status).toBe(409)
  })

  it('quote returns the discount for an active voucher', async () => {
    const code = newCode()
    await post('/vouchers', { code, type: 'percent', value: 10 })
    const q = (await (await post('/vouchers/quote', { code, gross_cents: 1190 })).json()) as { valid: boolean; discount_cents: number }
    expect(q.valid).toBe(true)
    expect(q.discount_cents).toBe(119)
  })

  it('quote on an inactive/exhausted voucher → valid:false', async () => {
    const code = newCode()
    await post('/vouchers', { code, type: 'percent', value: 10, max_uses: 1 })
    // esgota via uma venda
    await sale(code, [{ product_id: 'p1', qty: 1, unit_net: 1000, mwst_rate: 0.19, mwst_code: 'standard_19' }, { product_id: 'rabatt', qty: 1, unit_net: -100, mwst_rate: 0.19, mwst_code: 'standard_19' }])
    const q = (await (await post('/vouchers/quote', { code, gross_cents: 1190 })).json()) as { valid: boolean }
    expect(q.valid).toBe(false)
  })

  it('a sale with a voucher_code records a redemption and bumps usedCount', async () => {
    const code = newCode()
    await post('/vouchers', { code, type: 'percent', value: 10 })
    await sale(code, [{ product_id: 'p1', qty: 1, unit_net: 1000, mwst_rate: 0.19, mwst_code: 'standard_19' }, { product_id: 'rabatt', qty: 1, unit_net: -100, mwst_rate: 0.19, mwst_code: 'standard_19' }])
    const v = ((await (await get('/vouchers')).json()) as { code: string; usedCount: number }[]).find((x) => x.code === code)!
    expect(v.usedCount).toBe(1)
  })

  async function sale(voucherCode: string, items: { product_id: string; qty: number; unit_net: number; mwst_rate: number; mwst_code: string }[]): Promise<void> {
    const net = items.reduce((s, i) => s + i.unit_net * i.qty, 0)
    const gross = items.reduce((s, i) => s + Math.round(i.unit_net * (1 + i.mwst_rate)) * i.qty, 0)
    const r = await tse.sign({ clientId: 'c1', processType: 'Kassenbeleg-V1', amountsByVatRate: [], paymentType: 'Bar', grossTotal: gross })
    await post('/pos/sync', {
      client_event_id: crypto.randomUUID(), type: 'sale', kasse_id: 'demo-kasse',
      payload: {
        order: { mode: 'ausser_haus', voucher_code: voucherCode, total_net: net, total_mwst: gross - net, total_gross: gross },
        items,
        payment: { method: 'cash', amount: gross },
        receipt: { qr_payload: '', format: 'digital' },
        tse_transaction: { tx_number: r.txNumber, signature_counter: r.signatureCounter, signature_value: r.signatureValue, log_time: r.logTime, process_type: r.processType, serial_number: r.serialNumber, public_key: r.publicKey },
      },
    })
  }
})
```

- [ ] **Step 5: Run to verify it fails**

Run: `corepack pnpm --filter @gelato/api exec vitest run vouchers.e2e`
Expected: FAIL — rotas inexistentes.

- [ ] **Step 6: Implement the service**

`apps/api/src/vouchers/vouchers.service.ts`:
```ts
import { Injectable, ConflictException, NotFoundException } from '@nestjs/common'
import { voucherDiscountGross, type VoucherType } from '@gelato/compliance'
import { PrismaService } from '../prisma/prisma.service'

@Injectable()
export class VouchersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(tenantId: string) {
    const vouchers = await this.prisma.voucher.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' } })
    const counts = await this.prisma.voucherRedemption.groupBy({ by: ['voucherId'], where: { tenantId }, _count: { _all: true } })
    const byId = new Map(counts.map((c) => [c.voucherId, c._count._all]))
    return vouchers.map((v) => ({ ...v, usedCount: byId.get(v.id) ?? 0 }))
  }

  async create(tenantId: string, dto: { code: string; type: VoucherType; value: number; max_uses?: number; valid_from?: string; valid_to?: string }) {
    const exists = await this.prisma.voucher.findFirst({ where: { tenantId, code: dto.code } })
    if (exists) throw new ConflictException('voucher code already exists')
    const v = await this.prisma.voucher.create({
      data: { tenantId, code: dto.code, type: dto.type, value: dto.value, maxUses: dto.max_uses ?? null, validFrom: dto.valid_from ? new Date(dto.valid_from) : null, validTo: dto.valid_to ? new Date(dto.valid_to) : null },
    })
    return { id: v.id }
  }

  async update(tenantId: string, id: string, dto: { active?: boolean; value?: number; max_uses?: number }) {
    const v = await this.prisma.voucher.findFirst({ where: { id, tenantId } })
    if (!v) throw new NotFoundException('voucher')
    await this.prisma.voucher.update({ where: { id }, data: { active: dto.active, value: dto.value, maxUses: dto.max_uses } })
    return { id }
  }

  /** Valida e computa o desconto. valid:false (não erro) para inválido/esgotado. */
  async quote(tenantId: string, dto: { code: string; gross_cents: number }) {
    const v = await this.prisma.voucher.findFirst({ where: { tenantId, code: dto.code } })
    if (!v || !v.active) return { valid: false }
    const now = new Date()
    if (v.validFrom && now < v.validFrom) return { valid: false }
    if (v.validTo && now > v.validTo) return { valid: false }
    if (v.maxUses != null) {
      const used = await this.prisma.voucherRedemption.count({ where: { tenantId, voucherId: v.id } })
      if (used >= v.maxUses) return { valid: false }
    }
    const discount = voucherDiscountGross(v.type as VoucherType, v.value, dto.gross_cents)
    return { valid: true, type: v.type, value: v.value, discount_cents: discount }
  }
}
```

- [ ] **Step 7: Controller + module + registrar**

`apps/api/src/vouchers/vouchers.controller.ts`:
```ts
import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common'
import { z } from 'zod'
import { VouchersService } from './vouchers.service'
import { JwtAuthGuard, type JwtUser } from '../auth/jwt-auth.guard'
import { PermissionsGuard } from '../rbac/permissions.guard'
import { RequirePermission } from '../rbac/require-permission.decorator'
import { parseOrThrow } from '../common/zod'

const CreateDto = z.object({ code: z.string().min(1), type: z.enum(['percent', 'fixed']), value: z.number().int().nonnegative(), max_uses: z.number().int().positive().optional(), valid_from: z.string().optional(), valid_to: z.string().optional() })
const UpdateDto = z.object({ active: z.boolean().optional(), value: z.number().int().nonnegative().optional(), max_uses: z.number().int().positive().optional() })
const QuoteDto = z.object({ code: z.string().min(1), gross_cents: z.number().int().nonnegative() })

@Controller('vouchers')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class VouchersController {
  constructor(private readonly vouchers: VouchersService) {}

  @Get()
  @RequirePermission('marketing.view')
  async list(@Req() req: { user: JwtUser }) {
    return this.vouchers.list(req.user.tenant_id)
  }

  @Post()
  @RequirePermission('marketing.manage')
  async create(@Req() req: { user: JwtUser }, @Body() body: unknown) {
    return this.vouchers.create(req.user.tenant_id, parseOrThrow(CreateDto, body))
  }

  @Patch(':id')
  @RequirePermission('marketing.manage')
  async update(@Req() req: { user: JwtUser }, @Param('id') id: string, @Body() body: unknown) {
    return this.vouchers.update(req.user.tenant_id, id, parseOrThrow(UpdateDto, body))
  }

  @Post('quote')
  @RequirePermission('pos.sale.create')
  async quote(@Req() req: { user: JwtUser }, @Body() body: unknown) {
    return this.vouchers.quote(req.user.tenant_id, parseOrThrow(QuoteDto, body))
  }
}
```
> **Ordem das rotas:** `@Post('quote')` é estático e não conflita com `@Patch(':id')` (métodos
> diferentes; e quote é POST). Mantê-lo declarado normalmente.

`apps/api/src/vouchers/vouchers.module.ts`:
```ts
import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { PermissionsGuard } from '../rbac/permissions.guard'
import { VouchersService } from './vouchers.service'
import { VouchersController } from './vouchers.controller'

@Module({
  imports: [AuthModule],
  controllers: [VouchersController],
  providers: [VouchersService, PermissionsGuard],
})
export class VouchersModule {}
```

Modify `apps/api/src/app.module.ts` — importar `VouchersModule` e adicionar ao `imports`.

- [ ] **Step 8: Run to verify it passes**

Run: `corepack pnpm --filter @gelato/api exec vitest run vouchers.e2e`
Expected: PASS (4 testes).

- [ ] **Step 9: Commit**

```bash
git add packages/domain/src/events.ts apps/api/src/vouchers apps/api/src/pos/ledger.service.ts apps/api/src/app.module.ts apps/api/test/vouchers.e2e.test.ts
git commit -m "feat(api): vouchers — quote + CRUD + voucher_code no OrderSchema + resgate no ledger"
```

- [ ] **Step 10: Immutability test** — adicionar a `apps/api/test/immutability.test.ts`:

Helper:
```ts
async function insertVoucherRedemption(pool: Pool): Promise<string> {
  const vid = `vc_${Date.now()}_${Math.random().toString(36).slice(2)}`
  await pool.query(
    `INSERT INTO vouchers (id, "tenantId", code, type, value, active, "createdAt") VALUES ($1, 'demo-tenant', $1, 'percent', 10, true, now())`,
    [vid],
  )
  const id = `vr_${Date.now()}_${Math.random().toString(36).slice(2)}`
  await pool.query(
    `INSERT INTO voucher_redemptions (id, "tenantId", "voucherId", "discountCents", at) VALUES ($1, 'demo-tenant', $2, 119, now())`,
    [id, vid],
  )
  return id
}
```
e dentro do `describe`:
```ts
  it('voucher_redemptions is append-only (INSERT ok, UPDATE/DELETE blocked); vouchers stays mutable', async (ctx) => {
    if (!dbAvailable) return ctx.skip()
    const id = await insertVoucherRedemption(appPool)
    await expect(appPool.query(`UPDATE voucher_redemptions SET "discountCents"=0 WHERE id=$1`, [id])).rejects.toThrow()
    await expect(appPool.query(`DELETE FROM voucher_redemptions WHERE id=$1`, [id])).rejects.toThrow()
  })
```

- [ ] **Step 11: Run immutability**

Run: `corepack pnpm --filter @gelato/api exec vitest run immutability`
Expected: PASS.

- [ ] **Step 12: Write the capstone**

`apps/api/test/vouchers-capstone.e2e.test.ts`:
```ts
import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import type { AddressInfo } from 'node:net'
import { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { FakeTseProvider } from '@gelato/compliance'
import { AppModule } from '../src/app.module'

const tse = new FakeTseProvider({ serialNumber: 'SER-VC' })

// Capstone 4c: voucher 10% maxUses 1 → quote 1190 → desconto 119 → venda com linha
// Rabatt -119 → Order gross 1071 + redemption gravado + usedCount 1 → quote esgotado.
describe('Vouchers capstone (e2e)', () => {
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

  it('quotes, applies a Rabatt line, records the redemption, then exhausts', async () => {
    const code = `CAP${crypto.randomUUID().slice(0, 8).toUpperCase()}`
    await post('/vouchers', { code, type: 'percent', value: 10, max_uses: 1 })

    const q = (await (await post('/vouchers/quote', { code, gross_cents: 1190 })).json()) as { valid: boolean; discount_cents: number }
    expect(q).toEqual({ valid: true, type: 'percent', value: 10, discount_cents: 119 })

    // venda: produto 1000net@19% (gross 1190) + Rabatt -100net@19% (gross -119) → 1071
    const items = [
      { product_id: 'p1', qty: 1, unit_net: 1000, mwst_rate: 0.19, mwst_code: 'standard_19' },
      { product_id: 'rabatt', qty: 1, unit_net: -100, mwst_rate: 0.19, mwst_code: 'standard_19' },
    ]
    const gross = items.reduce((s, i) => s + Math.round(i.unit_net * (1 + i.mwst_rate)) * i.qty, 0)
    expect(gross).toBe(1071)
    const sig = await tse.sign({ clientId: 'c1', processType: 'Kassenbeleg-V1', amountsByVatRate: [], paymentType: 'Bar', grossTotal: gross })
    const cid = crypto.randomUUID()
    await post('/pos/sync', {
      client_event_id: cid, type: 'sale', kasse_id: 'demo-kasse',
      payload: {
        order: { mode: 'ausser_haus', voucher_code: code, total_net: 900, total_mwst: 171, total_gross: gross },
        items,
        payment: { method: 'cash', amount: gross },
        receipt: { qr_payload: '', format: 'digital' },
        tse_transaction: { tx_number: sig.txNumber, signature_counter: sig.signatureCounter, signature_value: sig.signatureValue, log_time: sig.logTime, process_type: sig.processType, serial_number: sig.serialNumber, public_key: sig.publicKey },
      },
    })

    const order = await prisma.order.findUnique({ where: { clientEventId: cid } })
    expect(order?.totalGross).toBe(1071)
    const red = await prisma.voucherRedemption.findFirst({ where: { orderId: order!.id } })
    expect(red?.discountCents).toBe(119)

    const q2 = (await (await post('/vouchers/quote', { code, gross_cents: 1190 })).json()) as { valid: boolean }
    expect(q2.valid).toBe(false) // esgotado (maxUses 1)
  })
})
```

- [ ] **Step 13: Run capstone + full API suite**

Run: `corepack pnpm --filter @gelato/api exec vitest run vouchers-capstone`
Then: `corepack pnpm --filter @gelato/api exec vitest run`
Expected: ambos verdes.

- [ ] **Step 14: Commit**

```bash
git add apps/api/test/immutability.test.ts apps/api/test/vouchers-capstone.e2e.test.ts
git commit -m "test(api): voucher redemptions append-only + capstone (quote -> Rabatt -> resgate -> esgota)"
```

---

## Chunk 4: backoffice (Vouchers) + integração

**Files:**
- Modify: `apps/backoffice/src/api.ts` (tipo `VoucherRow`)
- Modify: `apps/backoffice/src/App.tsx` (componente `Vouchers`)

- [ ] **Step 1: Tipo no backoffice api**

Modify `apps/backoffice/src/api.ts` — adicionar:
```ts
export interface VoucherRow {
  id: string
  code: string
  type: string
  value: number
  maxUses: number | null
  active: boolean
  usedCount: number
}
```

- [ ] **Step 2: Componente `Vouchers`**

Modify `apps/backoffice/src/App.tsx`:
1. Import: incluir `type VoucherRow`.
2. Renderizar `<Vouchers token={token} />` (perto de `<Loyalty token={token} />`).
3. Componente:
```tsx
function Vouchers({ token }: { token: string }) {
  const [vouchers, setVouchers] = useState<VoucherRow[]>([])
  const [code, setCode] = useState('')
  const [type, setType] = useState('percent')
  const [value, setValue] = useState('')

  const reload = (): void => {
    apiGet<VoucherRow[]>('/vouchers', token).then(setVouchers).catch(() => setVouchers([]))
  }
  useEffect(reload, [token])

  async function create(e: FormEvent): Promise<void> {
    e.preventDefault()
    if (!code || !value) return
    await apiPost('/vouchers', token, { code, type, value: Number(value) })
    setCode('')
    setValue('')
    reload()
  }

  return (
    <section style={{ marginTop: '2rem' }}>
      <h2>Vouchers</h2>
      <table>
        <thead><tr><th>Código</th><th>Tipo</th><th>Valor</th><th>Usos</th><th>Ativo</th></tr></thead>
        <tbody>
          {vouchers.map((v) => (
            <tr key={v.id} style={!v.active ? { color: '#888' } : undefined}>
              <td>{v.code}</td>
              <td>{v.type}</td>
              <td>{v.type === 'percent' ? `${v.value}%` : euro(v.value)}</td>
              <td>{v.usedCount}{v.maxUses != null ? `/${v.maxUses}` : ''}</td>
              <td>{v.active ? '✓' : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <form onSubmit={create} style={{ marginTop: '0.5rem', display: 'flex', gap: '0.5rem' }}>
        <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="CÓDIGO" />
        <select value={type} onChange={(e) => setType(e.target.value)}>
          <option value="percent">percent</option>
          <option value="fixed">fixed (cents)</option>
        </select>
        <input type="number" value={value} onChange={(e) => setValue(e.target.value)} placeholder={type === 'percent' ? '% (ex. 10)' : 'cents'} />
        <button type="submit">Criar</button>
      </form>
    </section>
  )
}
```
> `euro` já existe no App.tsx. `apiPost`/`apiGet`/`FormEvent` já importados.

- [ ] **Step 3: Typecheck + build**

Run: `corepack pnpm --filter @gelato/backoffice exec tsc --noEmit && corepack pnpm --filter @gelato/backoffice build`
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add apps/backoffice/src/api.ts apps/backoffice/src/App.tsx
git commit -m "feat(backoffice): seção Vouchers (lista + criação)"
```

- [ ] **Step 5: Suíte completa + integração**

```bash
corepack pnpm -r test
git checkout main
git merge --ff-only ciclo-4c
git push origin main
git branch -d ciclo-4c
```
> Manter `docker/docker-compose.yml` (5433) e `.claude/` fora do commit.

---

## Notas de verificação / riscos

- **Desconto fiscal = linha Rabatt negativa** computada no terminal (lógica pura compartilhada);
  o backend só **valida** (quote) + **registra** (VoucherRedemption append-only). Zero mudança no
  modelo Order; o `OrderSchema` só ganha `voucher_code?`.
- **`quote` não retorna 400** p/ inválido — `valid:false` é resposta normal (o PDV decide).
- **`used_count` derivado** (Σ redemptions); `maxUses` enforçado no quote (best-effort no registro).
- **Build do domínio** (`@gelato/domain`) no Chunk 3 (OrderSchema mudou; runtime do Nest usa dist).
- **Build do compliance** no Chunk 1.
- **Representação exata do Rabatt no DSFinV-K** = validação externa (Steuerberater / spec) — aqui é
  linha negativa por alíquota (MwSt recomputada).
```
