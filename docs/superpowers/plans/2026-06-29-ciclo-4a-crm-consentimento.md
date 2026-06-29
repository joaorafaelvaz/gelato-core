# Ciclo 4 · Fatia 4a — CRM + Consentimento DSGVO — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cadastrar clientes (PII mínima) + registrar consentimento DSGVO versionado/append-only por finalidade, com estado derivado e direito ao esquecimento por anonimização.

**Architecture:** Puras `currentConsents`/`canContact` em `@gelato/compliance` → `Customer` + `ConsentVersion` (mutáveis) + `ConsentRecord` (append-only, trigger) → módulo NestJS `customers` (CRUD + consent + anonymize + consent-versions, RBAC `marketing.*`/`customer.manage`) → seção mínima no backoffice. **Esquecimento = anonimizar** (PII zerada; registro fiscal e trilha intactos).

**Tech Stack:** TypeScript strict, vitest, NestJS, Prisma + Postgres (**5433**), zod, React/Vite.

**Spec:** `docs/superpowers/specs/2026-06-29-ciclo-4a-crm-consentimento-design.md`

**Pré-requisitos:** Postgres up (`docker compose -f docker/docker-compose.yml -p gelato_c0 up -d`, 5433; se o Docker Desktop estiver fora: `Start-Process "C:\Program Files\Docker\Docker\Docker Desktop.exe"`, aguardar o engine); branch `ciclo-4a` (off `main`).

---

## Chunk 1: `currentConsents` + `canContact` (puro)

**Files:**
- Create: `packages/compliance/src/consent/state.ts`
- Create: `packages/compliance/test/consent-state.test.ts`
- Modify: `packages/compliance/src/index.ts` (`export * from './consent/state'`)

- [ ] **Step 1: Write the failing test**

`packages/compliance/test/consent-state.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { currentConsents, canContact } from '../src/consent/state'

describe('currentConsents', () => {
  it('takes the latest action per purpose (by at)', () => {
    const recs = [
      { purpose: 'email_marketing', action: 'granted' as const, at: 100 },
      { purpose: 'email_marketing', action: 'withdrawn' as const, at: 200 },
      { purpose: 'email_marketing', action: 'granted' as const, at: 300 },
      { purpose: 'sms_marketing', action: 'granted' as const, at: 150 },
    ]
    expect(currentConsents(recs)).toEqual({ email_marketing: 'granted', sms_marketing: 'granted' })
  })
  it('empty → {}', () => {
    expect(currentConsents([])).toEqual({})
  })
})

describe('canContact', () => {
  const recs = [
    { purpose: 'email_marketing', action: 'granted' as const, at: 100 },
    { purpose: 'sms_marketing', action: 'granted' as const, at: 100 },
    { purpose: 'sms_marketing', action: 'withdrawn' as const, at: 200 },
  ]
  it('true only when latest is granted and not anonymized', () => {
    expect(canContact(recs, 'email_marketing', false)).toBe(true)
    expect(canContact(recs, 'sms_marketing', false)).toBe(false) // withdrawn
    expect(canContact(recs, 'email_marketing', true)).toBe(false) // anonymized
    expect(canContact(recs, 'unknown', false)).toBe(false) // sem registro
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `corepack pnpm --filter @gelato/compliance exec vitest run consent-state`
Expected: FAIL — import inexistente.

- [ ] **Step 3: Implement**

`packages/compliance/src/consent/state.ts`:
```ts
export type ConsentAction = 'granted' | 'withdrawn'
export interface ConsentRecordInput {
  purpose: string
  action: ConsentAction
  at: number // epoch ms
}

/** Estado atual por propósito = a ação do registro mais recente (por at). Puro. */
export function currentConsents(records: ConsentRecordInput[]): Record<string, ConsentAction> {
  const latest = new Map<string, { at: number; action: ConsentAction }>()
  for (const r of records) {
    const cur = latest.get(r.purpose)
    if (!cur || r.at >= cur.at) latest.set(r.purpose, { at: r.at, action: r.action })
  }
  const out: Record<string, ConsentAction> = {}
  for (const [purpose, { action }] of latest) out[purpose] = action
  return out
}

/** Pode contatar p/ o propósito? Último = granted E não anonimizado. Puro. */
export function canContact(records: ConsentRecordInput[], purpose: string, anonymized: boolean): boolean {
  if (anonymized) return false
  return currentConsents(records)[purpose] === 'granted'
}
```

- [ ] **Step 4: Export** — `packages/compliance/src/index.ts`: `export * from './consent/state'`

- [ ] **Step 5: Run to verify it passes**

Run: `corepack pnpm --filter @gelato/compliance exec vitest run consent-state`
Expected: PASS (4 testes).

- [ ] **Step 6: Build dist**

Run: `corepack pnpm --filter @gelato/compliance build`

- [ ] **Step 7: Commit**

```bash
git add packages/compliance/src/consent/state.ts packages/compliance/test/consent-state.test.ts packages/compliance/src/index.ts
git commit -m "feat(compliance): currentConsents + canContact — estado de consentimento DSGVO (puro)"
```

---

## Chunk 2: modelo `Customer` + `ConsentVersion` + `ConsentRecord` + seed

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/<ts>_c4a_crm_consent/migration.sql`
- Modify: `apps/api/prisma/seed.ts` (termo demo)

> **Sem FK de tenant** em Customer/ConsentVersion/ConsentRecord (consistente com stock_items/recipes;
> evita o trap de FK no teste cross-tenant). **Sem FK** `Order → Customer` (não se toca no fiscal).

- [ ] **Step 1: Adicionar os modelos**

Modify `apps/api/prisma/schema.prisma` — ao final:
```prisma
// ---------- CRM + Consentimento DSGVO (Ciclo 4a) ----------

model Customer {
  id           String    @id @default(cuid())
  tenantId     String
  name         String?
  email        String?
  phone        String?
  anonymizedAt DateTime?
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt

  consents ConsentRecord[]

  @@map("customers")
}

model ConsentVersion {
  id        String   @id @default(cuid())
  tenantId  String
  purpose   String // 'email_marketing' | 'sms_marketing' ...
  version   Int
  text      String
  active    Boolean  @default(true)
  createdAt DateTime @default(now())

  @@unique([tenantId, purpose, version])
  @@map("consent_versions")
}

model ConsentRecord {
  id           String   @id @default(cuid())
  tenantId     String
  customerId   String
  purpose      String
  version      Int      @default(0) // snapshot da ConsentVersion (0 p/ withdrawn)
  textSnapshot String   @default("") // snapshot do texto do termo
  action       String // 'granted' | 'withdrawn'
  at           DateTime @default(now())
  source       String?

  customer Customer @relation(fields: [customerId], references: [id])

  @@index([tenantId, customerId])
  @@map("consent_records")
}
```

- [ ] **Step 2: Validar + gerar a migração**

```bash
corepack pnpm --filter @gelato/api exec prisma validate
cd apps/api
TS=20260629100000
mkdir -p prisma/migrations/${TS}_c4a_crm_consent
corepack pnpm exec prisma migrate diff \
  --from-schema-datasource prisma/schema.prisma \
  --to-schema-datamodel prisma/schema.prisma \
  --script > prisma/migrations/${TS}_c4a_crm_consent/migration.sql
cd ../..
cat apps/api/prisma/migrations/20260629100000_c4a_crm_consent/migration.sql
```
Expected: `CREATE TABLE "customers"`, `"consent_versions"`, `"consent_records"` + unique + FK.

- [ ] **Step 3: Anexar GRANT + trigger append-only só p/ consent_records**

Acrescentar ao final de `prisma/migrations/${TS}_c4a_crm_consent/migration.sql`:
```sql

-- ===== CRM: master data mutável (customers, consent_versions) =====
GRANT SELECT, INSERT, UPDATE, DELETE ON customers, consent_versions TO gelato_app;

-- ===== Consentimento: trilha append-only (DSGVO, reusa fiscal_append_only) =====
GRANT SELECT, INSERT ON consent_records TO gelato_app;
DROP TRIGGER IF EXISTS consent_records_append_only ON consent_records;
CREATE TRIGGER consent_records_append_only BEFORE UPDATE OR DELETE ON consent_records
  FOR EACH ROW EXECUTE FUNCTION fiscal_append_only();
```

- [ ] **Step 4: Aplicar + marcar + gerar**

```bash
cd apps/api
corepack pnpm exec prisma db execute --schema prisma/schema.prisma --file prisma/migrations/20260629100000_c4a_crm_consent/migration.sql
corepack pnpm exec prisma migrate resolve --applied 20260629100000_c4a_crm_consent
corepack pnpm exec prisma generate
cd ../..
```

- [ ] **Step 5: Seed do termo demo**

Modify `apps/api/prisma/seed.ts` — após o bloco de checklist (antes do fechamento da função):
```ts
  // CRM/DSGVO (Ciclo 4a): termo de consentimento demo (email_marketing v1).
  await prisma.consentVersion.upsert({
    where: { tenantId_purpose_version: { tenantId: TENANT_ID, purpose: 'email_marketing', version: 1 } },
    update: {},
    create: { tenantId: TENANT_ID, purpose: 'email_marketing', version: 1, text: 'Ich willige in den Erhalt von E-Mail-Werbung ein. Widerruf jederzeit möglich.', active: true },
  })
```

- [ ] **Step 6: Rodar o seed 2×**

Run: `corepack pnpm --filter @gelato/api db:seed && corepack pnpm --filter @gelato/api db:seed`
Expected: "seed done" nas duas.

- [ ] **Step 7: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations apps/api/prisma/seed.ts
git commit -m "feat(api): modelo CRM — Customer + ConsentVersion (mutáveis) + ConsentRecord (append-only) + seed termo"
```

---

## Chunk 3: módulo `customers` + e2e + imutabilidade + capstone

**Files:**
- Create: `apps/api/src/customers/customers.service.ts`
- Create: `apps/api/src/customers/customers.controller.ts`
- Create: `apps/api/src/customers/consent-versions.controller.ts`
- Create: `apps/api/src/customers/customers.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Create: `apps/api/test/customers.e2e.test.ts`
- Modify: `apps/api/test/immutability.test.ts`
- Create: `apps/api/test/customers-capstone.e2e.test.ts`

> **RBAC:** `marketing.view`/`marketing.manage`/`customer.manage` hoje só no `admin`. Os e2e usam admin.
> Os testes usam **purposes únicos** (`p-${uuid}`) p/ não colidir com a seed (`email_marketing`).

- [ ] **Step 1: Write the failing e2e**

`apps/api/test/customers.e2e.test.ts`:
```ts
import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import type { AddressInfo } from 'node:net'
import { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AppModule } from '../src/app.module'

const TENANT = 'demo-tenant'

describe('Customers / consent (e2e)', () => {
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
  const patch = (path: string, body: unknown) =>
    fetch(`${baseUrl}${path}`, { method: 'PATCH', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body) })
  const get = (path: string) => fetch(`${baseUrl}${path}`, { headers: { authorization: `Bearer ${token}` } })

  const newCustomer = async (email = `c-${crypto.randomUUID().slice(0, 8)}@x.de`): Promise<string> =>
    ((await (await post('/customers', { name: 'Anna', email })).json()) as { id: string }).id

  it('creates a customer (needs at least one contact)', async () => {
    expect((await post('/customers', { name: 'Anna', email: 'a@x.de' })).status).toBe(201)
    expect((await post('/customers', {})).status).toBe(400)
  })

  it('records granted/withdrawn consent and derives the current state', async () => {
    const purpose = `p-${crypto.randomUUID().slice(0, 8)}`
    await post('/consent-versions', { purpose, text: 'Term v1' })
    const id = await newCustomer()
    expect((await post(`/customers/${id}/consent`, { purpose, action: 'granted' })).status).toBe(201)
    let c = (await (await get(`/customers/${id}`)).json()) as { consents: Record<string, string> }
    expect(c.consents[purpose]).toBe('granted')
    await post(`/customers/${id}/consent`, { purpose, action: 'withdrawn' })
    c = (await (await get(`/customers/${id}`)).json()) as { consents: Record<string, string> }
    expect(c.consents[purpose]).toBe('withdrawn')
  })

  it('granting without a published term → 400', async () => {
    const id = await newCustomer()
    expect((await post(`/customers/${id}/consent`, { purpose: `none-${crypto.randomUUID().slice(0, 8)}`, action: 'granted' })).status).toBe(400)
  })

  it('anonymize wipes PII, withdraws consents, keeps the trail; idempotent', async () => {
    const purpose = `p-${crypto.randomUUID().slice(0, 8)}`
    await post('/consent-versions', { purpose, text: 'Term' })
    const id = await newCustomer()
    await post(`/customers/${id}/consent`, { purpose, action: 'granted' })
    expect((await post(`/customers/${id}/anonymize`, {})).status).toBe(201)
    const c = (await (await get(`/customers/${id}`)).json()) as { name: string | null; email: string | null; anonymizedAt: string | null; consents: Record<string, string> }
    expect(c.name).toBeNull()
    expect(c.email).toBeNull()
    expect(c.anonymizedAt).not.toBeNull()
    expect(c.consents[purpose]).toBe('withdrawn')
    // a trilha sobrevive
    const records = await prisma.consentRecord.count({ where: { customerId: id } })
    expect(records).toBeGreaterThanOrEqual(2) // granted + withdrawn(anonymize)
    // idempotente
    expect((await post(`/customers/${id}/anonymize`, {})).status).toBe(201)
  })

  it('404 for a customer from another tenant; 409 patch on anonymized', async () => {
    const other = await prisma.customer.create({ data: { tenantId: 'tenant-other', email: 'x@x.de' } })
    expect((await get(`/customers/${other.id}`)).status).toBe(404)
    const id = await newCustomer()
    await post(`/customers/${id}/anonymize`, {})
    expect((await patch(`/customers/${id}`, { name: 'X' })).status).toBe(409)
  })

  it('publishing a new version deactivates the previous', async () => {
    const purpose = `p-${crypto.randomUUID().slice(0, 8)}`
    await post('/consent-versions', { purpose, text: 'v1' })
    await post('/consent-versions', { purpose, text: 'v2' })
    const versions = (await (await get('/consent-versions')).json()) as { purpose: string; version: number; active: boolean }[]
    const mine = versions.filter((v) => v.purpose === purpose)
    expect(mine.find((v) => v.version === 2)!.active).toBe(true)
    expect(mine.find((v) => v.version === 1)!.active).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `corepack pnpm --filter @gelato/api exec vitest run customers.e2e`
Expected: FAIL — rotas inexistentes.

- [ ] **Step 3: Implement the service**

`apps/api/src/customers/customers.service.ts`:
```ts
import { Injectable, BadRequestException, NotFoundException, ConflictException } from '@nestjs/common'
import { currentConsents, type ConsentAction } from '@gelato/compliance'
import { PrismaService } from '../prisma/prisma.service'

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  private view(c: { id: string; name: string | null; email: string | null; phone: string | null; anonymizedAt: Date | null; consents: { purpose: string; action: string; at: Date }[] }) {
    return {
      id: c.id, name: c.name, email: c.email, phone: c.phone, anonymizedAt: c.anonymizedAt,
      consents: currentConsents(c.consents.map((r) => ({ purpose: r.purpose, action: r.action as ConsentAction, at: r.at.getTime() }))),
    }
  }

  async list(tenantId: string) {
    const cs = await this.prisma.customer.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' }, include: { consents: true } })
    return cs.map((c) => this.view(c))
  }

  private async ownOr404(tenantId: string, id: string) {
    const c = await this.prisma.customer.findFirst({ where: { id, tenantId }, include: { consents: true } })
    if (!c) throw new NotFoundException('customer')
    return c
  }

  async get(tenantId: string, id: string) {
    return this.view(await this.ownOr404(tenantId, id))
  }

  async create(tenantId: string, dto: { name?: string; email?: string; phone?: string }) {
    if (!dto.name && !dto.email && !dto.phone) throw new BadRequestException('at least one contact field')
    const c = await this.prisma.customer.create({ data: { tenantId, name: dto.name, email: dto.email, phone: dto.phone } })
    return { id: c.id }
  }

  async update(tenantId: string, id: string, dto: { name?: string; email?: string; phone?: string }) {
    const c = await this.ownOr404(tenantId, id)
    if (c.anonymizedAt) throw new ConflictException('customer anonymized')
    await this.prisma.customer.update({ where: { id }, data: { name: dto.name, email: dto.email, phone: dto.phone } })
    return { id }
  }

  async recordConsent(tenantId: string, id: string, dto: { purpose: string; action: ConsentAction; source?: string }) {
    await this.ownOr404(tenantId, id)
    let version = 0
    let textSnapshot = ''
    if (dto.action === 'granted') {
      const cv = await this.prisma.consentVersion.findFirst({ where: { tenantId, purpose: dto.purpose, active: true }, orderBy: { version: 'desc' } })
      if (!cv) throw new BadRequestException('no published consent version for purpose')
      version = cv.version
      textSnapshot = cv.text
    }
    await this.prisma.consentRecord.create({ data: { tenantId, customerId: id, purpose: dto.purpose, version, textSnapshot, action: dto.action, source: dto.source } })
    return { ok: true }
  }

  async anonymize(tenantId: string, id: string) {
    const c = await this.ownOr404(tenantId, id)
    if (c.anonymizedAt) return { ok: true } // idempotente
    const current = currentConsents(c.consents.map((r) => ({ purpose: r.purpose, action: r.action as ConsentAction, at: r.at.getTime() })))
    const granted = Object.entries(current).filter(([, a]) => a === 'granted').map(([p]) => p)
    await this.prisma.$transaction([
      ...granted.map((p) => this.prisma.consentRecord.create({ data: { tenantId, customerId: id, purpose: p, action: 'withdrawn', source: 'anonymize' } })),
      this.prisma.customer.update({ where: { id }, data: { name: null, email: null, phone: null, anonymizedAt: new Date() } }),
    ])
    return { ok: true }
  }

  async listVersions(tenantId: string) {
    return this.prisma.consentVersion.findMany({ where: { tenantId }, orderBy: [{ purpose: 'asc' }, { version: 'desc' }] })
  }

  async publishVersion(tenantId: string, dto: { purpose: string; text: string }) {
    const last = await this.prisma.consentVersion.findFirst({ where: { tenantId, purpose: dto.purpose }, orderBy: { version: 'desc' } })
    const version = (last?.version ?? 0) + 1
    await this.prisma.$transaction([
      this.prisma.consentVersion.updateMany({ where: { tenantId, purpose: dto.purpose }, data: { active: false } }),
      this.prisma.consentVersion.create({ data: { tenantId, purpose: dto.purpose, version, text: dto.text, active: true } }),
    ])
    return { version }
  }
}
```

- [ ] **Step 4: Implement the controllers**

`apps/api/src/customers/customers.controller.ts`:
```ts
import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common'
import { z } from 'zod'
import { CustomersService } from './customers.service'
import { JwtAuthGuard, type JwtUser } from '../auth/jwt-auth.guard'
import { PermissionsGuard } from '../rbac/permissions.guard'
import { RequirePermission } from '../rbac/require-permission.decorator'
import { parseOrThrow } from '../common/zod'

const ContactDto = z.object({ name: z.string().min(1).optional(), email: z.string().email().optional(), phone: z.string().min(1).optional() })
const ConsentDto = z.object({ purpose: z.string().min(1), action: z.enum(['granted', 'withdrawn']), source: z.string().optional() })

@Controller('customers')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  @RequirePermission('marketing.view')
  async list(@Req() req: { user: JwtUser }) {
    return this.customers.list(req.user.tenant_id)
  }

  @Get(':id')
  @RequirePermission('marketing.view')
  async get(@Req() req: { user: JwtUser }, @Param('id') id: string) {
    return this.customers.get(req.user.tenant_id, id)
  }

  @Post()
  @RequirePermission('customer.manage')
  async create(@Req() req: { user: JwtUser }, @Body() body: unknown) {
    return this.customers.create(req.user.tenant_id, parseOrThrow(ContactDto, body))
  }

  @Patch(':id')
  @RequirePermission('customer.manage')
  async update(@Req() req: { user: JwtUser }, @Param('id') id: string, @Body() body: unknown) {
    return this.customers.update(req.user.tenant_id, id, parseOrThrow(ContactDto, body))
  }

  @Post(':id/consent')
  @RequirePermission('customer.manage')
  async consent(@Req() req: { user: JwtUser }, @Param('id') id: string, @Body() body: unknown) {
    return this.customers.recordConsent(req.user.tenant_id, id, parseOrThrow(ConsentDto, body))
  }

  @Post(':id/anonymize')
  @RequirePermission('customer.manage')
  async anonymize(@Req() req: { user: JwtUser }, @Param('id') id: string) {
    return this.customers.anonymize(req.user.tenant_id, id)
  }
}
```

`apps/api/src/customers/consent-versions.controller.ts`:
```ts
import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common'
import { z } from 'zod'
import { CustomersService } from './customers.service'
import { JwtAuthGuard, type JwtUser } from '../auth/jwt-auth.guard'
import { PermissionsGuard } from '../rbac/permissions.guard'
import { RequirePermission } from '../rbac/require-permission.decorator'
import { parseOrThrow } from '../common/zod'

const VersionDto = z.object({ purpose: z.string().min(1), text: z.string().min(1) })

@Controller('consent-versions')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ConsentVersionsController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  @RequirePermission('marketing.view')
  async list(@Req() req: { user: JwtUser }) {
    return this.customers.listVersions(req.user.tenant_id)
  }

  @Post()
  @RequirePermission('marketing.manage')
  async publish(@Req() req: { user: JwtUser }, @Body() body: unknown) {
    return this.customers.publishVersion(req.user.tenant_id, parseOrThrow(VersionDto, body))
  }
}
```

- [ ] **Step 5: Module + registrar**

`apps/api/src/customers/customers.module.ts`:
```ts
import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { PermissionsGuard } from '../rbac/permissions.guard'
import { CustomersService } from './customers.service'
import { CustomersController } from './customers.controller'
import { ConsentVersionsController } from './consent-versions.controller'

@Module({
  imports: [AuthModule],
  controllers: [CustomersController, ConsentVersionsController],
  providers: [CustomersService, PermissionsGuard],
})
export class CustomersModule {}
```

Modify `apps/api/src/app.module.ts` — importar `CustomersModule` e adicionar ao `imports`.

- [ ] **Step 6: Run to verify it passes**

Run: `corepack pnpm --filter @gelato/api exec vitest run customers.e2e`
Expected: PASS (6 testes).

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/customers apps/api/src/app.module.ts apps/api/test/customers.e2e.test.ts
git commit -m "feat(api): módulo customers — CRM + consentimento DSGVO (CRUD, consent, anonymize, versions)"
```

- [ ] **Step 8: Immutability test** — adicionar a `apps/api/test/immutability.test.ts`:

Helper (junto dos outros `insert*`):
```ts
async function insertConsentRecord(pool: Pool): Promise<string> {
  const custId = `cust_${Date.now()}_${Math.random().toString(36).slice(2)}`
  await pool.query(
    `INSERT INTO customers (id, "tenantId", email, "createdAt", "updatedAt") VALUES ($1, 'demo-tenant', 'x@x.de', now(), now())`,
    [custId],
  )
  const id = `cons_${Date.now()}_${Math.random().toString(36).slice(2)}`
  await pool.query(
    `INSERT INTO consent_records (id, "tenantId", "customerId", purpose, version, "textSnapshot", action, at)
     VALUES ($1, 'demo-tenant', $2, 'email_marketing', 1, 'T', 'granted', now())`,
    [id, custId],
  )
  return id
}
```
e dentro do `describe`:
```ts
  it('consent_records is append-only (INSERT ok, UPDATE/DELETE blocked); customers stays mutable', async (ctx) => {
    if (!dbAvailable) return ctx.skip()
    const id = await insertConsentRecord(appPool)
    await expect(appPool.query(`UPDATE consent_records SET action='withdrawn' WHERE id=$1`, [id])).rejects.toThrow()
    await expect(appPool.query(`DELETE FROM consent_records WHERE id=$1`, [id])).rejects.toThrow()
  })
```

- [ ] **Step 9: Run immutability**

Run: `corepack pnpm --filter @gelato/api exec vitest run immutability`
Expected: PASS (incl. o novo).

- [ ] **Step 10: Write the capstone**

`apps/api/test/customers-capstone.e2e.test.ts`:
```ts
import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import type { AddressInfo } from 'node:net'
import { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AppModule } from '../src/app.module'

// Capstone 4a: ciclo de vida DSGVO — cliente → publica termo → consente
// email_marketing (snapshot) → withdraw → anonimiza → PII some, consentimentos
// withdrawn, mas a trilha append-only sobrevive (auditoria).
describe('Customers capstone (e2e)', () => {
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

  it('runs the full DSGVO consent lifecycle, preserving the audit trail', async () => {
    const purpose = `cap-${crypto.randomUUID().slice(0, 8)}`
    await post('/consent-versions', { purpose, text: 'Einwilligung E-Mail-Werbung v1' })
    const id = ((await (await post('/customers', { name: 'Max Mustermann', email: 'max@x.de' })).json()) as { id: string }).id

    await post(`/customers/${id}/consent`, { purpose, action: 'granted' })
    let c = (await (await get(`/customers/${id}`)).json()) as { consents: Record<string, string> }
    expect(c.consents[purpose]).toBe('granted')

    // o registro fotografou a versão do termo
    const granted = await prisma.consentRecord.findFirst({ where: { customerId: id, purpose, action: 'granted' } })
    expect(granted?.version).toBe(1)
    expect(granted?.textSnapshot).toContain('v1')

    await post(`/customers/${id}/consent`, { purpose, action: 'withdrawn' })
    await post(`/customers/${id}/anonymize`, {})

    c = (await (await get(`/customers/${id}`)).json()) as { name: string | null; email: string | null; anonymizedAt: string | null; consents: Record<string, string> }
    expect(c.name).toBeNull()
    expect(c.email).toBeNull()
    expect(c.anonymizedAt).not.toBeNull()
    expect(c.consents[purpose]).toBe('withdrawn')

    // a trilha de auditoria sobrevive ao esquecimento
    const records = await prisma.consentRecord.findMany({ where: { customerId: id }, orderBy: { at: 'asc' } })
    expect(records.length).toBeGreaterThanOrEqual(2)
    expect(records[0].action).toBe('granted')
  })
})
```

- [ ] **Step 11: Run capstone + full API suite**

Run: `corepack pnpm --filter @gelato/api exec vitest run customers-capstone`
Then: `corepack pnpm --filter @gelato/api exec vitest run`
Expected: ambos verdes.

- [ ] **Step 12: Commit**

```bash
git add apps/api/test/immutability.test.ts apps/api/test/customers-capstone.e2e.test.ts
git commit -m "test(api): consent append-only + capstone (ciclo de vida DSGVO + anonimização)"
```

---

## Chunk 4: backoffice (Clientes/CRM) + integração

**Files:**
- Modify: `apps/backoffice/src/api.ts` (tipo `CustomerRow`)
- Modify: `apps/backoffice/src/App.tsx` (componente `Customers`)

- [ ] **Step 1: Tipo no backoffice api**

Modify `apps/backoffice/src/api.ts` — adicionar:
```ts
export interface CustomerRow {
  id: string
  name: string | null
  email: string | null
  phone: string | null
  anonymizedAt: string | null
  consents: Record<string, string>
}
```

- [ ] **Step 2: Componente `Customers`**

Modify `apps/backoffice/src/App.tsx`:
1. Import: incluir `type CustomerRow`.
2. Renderizar `<Customers token={token} />` (perto de `<ChecklistReports token={token} />`).
3. Componente:
```tsx
function Customers({ token }: { token: string }) {
  const [customers, setCustomers] = useState<CustomerRow[]>([])
  const reload = (): void => {
    apiGet<CustomerRow[]>('/customers', token).then(setCustomers).catch(() => setCustomers([]))
  }
  useEffect(reload, [token])

  async function anonymize(id: string): Promise<void> {
    await apiPost(`/customers/${id}/anonymize`, token, {})
    reload()
  }

  return (
    <section style={{ marginTop: '2rem' }}>
      <h2>Clientes (CRM)</h2>
      <table>
        <thead><tr><th>Nome</th><th>Contato</th><th>Consentimentos</th><th></th></tr></thead>
        <tbody>
          {customers.map((c) => (
            <tr key={c.id} style={c.anonymizedAt ? { color: '#888' } : undefined}>
              <td>{c.anonymizedAt ? '— anonimizado —' : (c.name ?? '—')}</td>
              <td>{c.email ?? c.phone ?? '—'}</td>
              <td>{Object.entries(c.consents).map(([p, a]) => `${p}: ${a}`).join('; ') || '—'}</td>
              <td>{!c.anonymizedAt && <button onClick={() => anonymize(c.id)}>Anonimizar (DSGVO)</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
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
git commit -m "feat(backoffice): seção Clientes (CRM) — consentimentos + anonimizar"
```

- [ ] **Step 5: Suíte completa + integração**

```bash
corepack pnpm -r test
git checkout main
git merge --ff-only ciclo-4a
git push origin main
git branch -d ciclo-4a
```
> Manter `docker/docker-compose.yml` (5433) e `.claude/` fora do commit.

---

## Notas de verificação / riscos

- **GRANT:** `customers`/`consent_versions` = DML completo; `consent_records` = SELECT/INSERT + trigger.
- **Append-only só em `consent_records`** (a trilha DSGVO); Customer é mutável (precisa anonimizar).
- **Esquecimento = anonimizar** (UPDATE da PII p/ null + `anonymizedAt`); o `Order.customerId` fiscal
  fica apontando p/ um cliente sem PII — integridade fiscal preservada.
- **Sem FK de tenant** (evita o trap cross-tenant) e **sem FK `Order→Customer`** (não tocar no fiscal).
- **Snapshot do termo** no `ConsentRecord` (version+textSnapshot) → prova auditável mesmo que a
  `ConsentVersion` mude depois.
- **Testes usam purposes únicos** p/ não colidir com a seed.
- **Dist do compliance** rebuildado no Chunk 1.
```
