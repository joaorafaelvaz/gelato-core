# Ciclo 4 · Fatia 4d — Campanhas — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Campanhas por canal (email/SMS) que só atingem clientes com consentimento válido (gate GDPR via `canContact`), com envio atrás de uma porta (`CampaignSender` + Fake + skeleton) e trilha append-only.

**Architecture:** Puras `consentPurposeForChannel`/`eligibleRecipients` + porta `CampaignSender`/`FakeCampaignSender` em `@gelato/compliance` → `Campaign` (mutável) + `CampaignDispatch` (append-only) → módulo NestJS `campaigns` (CRUD + send + recipients, sender injetado) → seção mínima no backoffice. **Gate de consentimento obrigatório.**

**Tech Stack:** TypeScript strict, vitest, NestJS, Prisma + Postgres (**5433**), zod, React/Vite.

**Spec:** `docs/superpowers/specs/2026-06-29-ciclo-4d-campanhas-design.md`

**Pré-requisitos:** Postgres up (`docker compose -f docker/docker-compose.yml -p gelato_c0 up -d`, 5433; se o Docker Desktop estiver fora: `Start-Process "C:\Program Files\Docker\Docker\Docker Desktop.exe"`, aguardar o engine); branch `ciclo-4d` (off `main`).

---

## Chunk 1: `eligibleRecipients` + `CampaignSender` (puro + porta)

**Files:**
- Create: `packages/compliance/src/campaign/recipients.ts`
- Create: `packages/compliance/src/campaign/sender.ts`
- Create: `packages/compliance/test/campaign-recipients.test.ts`
- Modify: `packages/compliance/src/index.ts` (`export * from './campaign/recipients'` + `'./campaign/sender'`)

- [ ] **Step 1: Write the failing test**

`packages/compliance/test/campaign-recipients.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { consentPurposeForChannel, eligibleRecipients } from '../src/campaign/recipients'
import { FakeCampaignSender } from '../src/campaign/sender'

describe('consentPurposeForChannel', () => {
  it('maps channels to purposes', () => {
    expect(consentPurposeForChannel('email')).toBe('email_marketing')
    expect(consentPurposeForChannel('sms')).toBe('sms_marketing')
    expect(consentPurposeForChannel('carrier-pigeon')).toBe('')
  })
})

describe('eligibleRecipients', () => {
  const granted = [{ purpose: 'email_marketing', action: 'granted' as const, at: 100 }]
  const withdrawn = [...granted, { purpose: 'email_marketing', action: 'withdrawn' as const, at: 200 }]

  it('includes consented + contactable; excludes withdrawn/anonymized/no-contact', () => {
    const out = eligibleRecipients(
      [
        { id: 'a', anonymized: false, contact: 'a@x.de', records: granted },
        { id: 'b', anonymized: false, contact: 'b@x.de', records: withdrawn },
        { id: 'c', anonymized: true, contact: 'c@x.de', records: granted },
        { id: 'd', anonymized: false, contact: null, records: granted },
      ],
      'email_marketing',
    )
    expect(out).toEqual(['a'])
  })
  it('empty purpose → []', () => {
    expect(eligibleRecipients([{ id: 'a', anonymized: false, contact: 'a@x.de', records: granted }], '')).toEqual([])
  })
})

describe('FakeCampaignSender', () => {
  it('counts recipients (does not actually send)', async () => {
    const out = await new FakeCampaignSender().send({ channel: 'email', recipients: [{ id: 'a', contact: 'a@x.de' }, { id: 'b', contact: 'b@x.de' }], body: 'Hi' })
    expect(out).toEqual({ sent: 2 })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `corepack pnpm --filter @gelato/compliance exec vitest run campaign-recipients`
Expected: FAIL — imports inexistentes.

- [ ] **Step 3: Implement**

`packages/compliance/src/campaign/recipients.ts`:
```ts
import { canContact, type ConsentRecordInput } from '../consent/state'

/** Canal → propósito de consentimento. Vazio = canal sem mapeamento (público vazio). Puro. */
export function consentPurposeForChannel(channel: string): string {
  if (channel === 'email') return 'email_marketing'
  if (channel === 'sms') return 'sms_marketing'
  return ''
}

export interface RecipientCandidate {
  id: string
  anonymized: boolean
  contact: string | null
  records: ConsentRecordInput[]
}

/** Ids elegíveis: consentimento válido p/ o propósito E contato do canal presente. Puro. */
export function eligibleRecipients(customers: RecipientCandidate[], purpose: string): string[] {
  if (!purpose) return []
  return customers.filter((c) => c.contact != null && canContact(c.records, purpose, c.anonymized)).map((c) => c.id)
}
```

`packages/compliance/src/campaign/sender.ts`:
```ts
export interface CampaignRecipient {
  id: string
  contact: string
}
export interface CampaignSendParams {
  channel: string
  recipients: CampaignRecipient[]
  subject?: string
  body: string
}

/** Porta de envio — o transporte real (email/SMS) fica atrás desta interface. */
export interface CampaignSender {
  send(params: CampaignSendParams): Promise<{ sent: number }>
}

/** Default de dev/teste: não envia de verdade, só conta. */
export class FakeCampaignSender implements CampaignSender {
  async send(params: CampaignSendParams): Promise<{ sent: number }> {
    return { sent: params.recipients.length }
  }
}

/** Esqueleto NÃO VERIFICADO de um provider real (email/SMS). Precisa de provider + creds + integração. */
export class SkeletonCampaignSender implements CampaignSender {
  async send(): Promise<{ sent: number }> {
    throw new Error('campaign sender not configured (NOT VERIFIED)')
  }
}
```

- [ ] **Step 4: Export** — `packages/compliance/src/index.ts`:
```ts
export * from './campaign/recipients'
export * from './campaign/sender'
```

- [ ] **Step 5: Run to verify it passes**

Run: `corepack pnpm --filter @gelato/compliance exec vitest run campaign-recipients`
Expected: PASS (4 testes).

- [ ] **Step 6: Build dist**

Run: `corepack pnpm --filter @gelato/compliance build`

- [ ] **Step 7: Commit**

```bash
git add packages/compliance/src/campaign packages/compliance/test/campaign-recipients.test.ts packages/compliance/src/index.ts
git commit -m "feat(compliance): eligibleRecipients + CampaignSender — gate de consentimento + porta de envio"
```

---

## Chunk 2: modelo `Campaign` + `CampaignDispatch` + seed

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/<ts>_c4d_campaigns/migration.sql`
- Modify: `apps/api/prisma/seed.ts`

- [ ] **Step 1: Adicionar os modelos**

Modify `apps/api/prisma/schema.prisma` — ao final:
```prisma
// ---------- Campanhas (Ciclo 4d) ----------

model Campaign {
  id             String    @id @default(cuid())
  tenantId       String
  name           String
  channel        String // 'email' | 'sms'
  subject        String?
  body           String
  status         String    @default("draft") // 'draft' | 'sent'
  recipientCount Int?
  createdAt      DateTime  @default(now())
  sentAt         DateTime?

  dispatches CampaignDispatch[]

  @@map("campaigns")
}

model CampaignDispatch {
  id         String   @id @default(cuid())
  tenantId   String
  campaignId String
  customerId String
  channel    String
  at         DateTime @default(now())

  campaign Campaign @relation(fields: [campaignId], references: [id])

  @@index([tenantId, campaignId])
  @@map("campaign_dispatches")
}
```

- [ ] **Step 2: Validar + gerar a migração**

```bash
corepack pnpm --filter @gelato/api exec prisma validate
cd apps/api
TS=20260629130000
mkdir -p prisma/migrations/${TS}_c4d_campaigns
corepack pnpm exec prisma migrate diff \
  --from-schema-datasource prisma/schema.prisma \
  --to-schema-datamodel prisma/schema.prisma \
  --script > prisma/migrations/${TS}_c4d_campaigns/migration.sql
cd ../..
cat apps/api/prisma/migrations/20260629130000_c4d_campaigns/migration.sql
```
Expected: `CREATE TABLE "campaigns"`, `"campaign_dispatches"` + FK.

- [ ] **Step 3: Anexar GRANT + trigger**

Acrescentar ao final de `prisma/migrations/${TS}_c4d_campaigns/migration.sql`:
```sql

-- ===== Campanhas: master mutável; dispatches append-only =====
GRANT SELECT, INSERT, UPDATE, DELETE ON campaigns TO gelato_app;
GRANT SELECT, INSERT ON campaign_dispatches TO gelato_app;
DROP TRIGGER IF EXISTS campaign_dispatches_append_only ON campaign_dispatches;
CREATE TRIGGER campaign_dispatches_append_only BEFORE UPDATE OR DELETE ON campaign_dispatches
  FOR EACH ROW EXECUTE FUNCTION fiscal_append_only();
```

- [ ] **Step 4: Aplicar + marcar + gerar**

```bash
cd apps/api
corepack pnpm exec prisma db execute --schema prisma/schema.prisma --file prisma/migrations/20260629130000_c4d_campaigns/migration.sql
corepack pnpm exec prisma migrate resolve --applied 20260629130000_c4d_campaigns
corepack pnpm exec prisma generate
cd ../..
```

- [ ] **Step 5: Seed da campanha demo**

Modify `apps/api/prisma/seed.ts` — após o bloco do voucher (antes do fechamento da função):
```ts
  // Campanhas (Ciclo 4d): campanha demo em rascunho.
  const campExists = await prisma.campaign.findFirst({ where: { tenantId: TENANT_ID, name: 'Sommer-Newsletter' } })
  if (!campExists) {
    await prisma.campaign.create({
      data: { tenantId: TENANT_ID, name: 'Sommer-Newsletter', channel: 'email', subject: 'Neue Sommersorten!', body: 'Probieren Sie unsere neuen Sorten.', status: 'draft' },
    })
  }
```

- [ ] **Step 6: Rodar o seed 2×**

Run: `corepack pnpm --filter @gelato/api db:seed && corepack pnpm --filter @gelato/api db:seed`
Expected: "seed done" nas duas.

- [ ] **Step 7: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations apps/api/prisma/seed.ts
git commit -m "feat(api): modelo campanhas — Campaign (mutável) + CampaignDispatch (append-only) + seed"
```

---

## Chunk 3: módulo `campaigns` + e2e + imutabilidade + capstone

**Files:**
- Create: `apps/api/src/campaigns/campaigns.service.ts`
- Create: `apps/api/src/campaigns/campaigns.controller.ts`
- Create: `apps/api/src/campaigns/campaigns.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Create: `apps/api/test/campaigns.e2e.test.ts`
- Modify: `apps/api/test/immutability.test.ts`
- Create: `apps/api/test/campaigns-capstone.e2e.test.ts`

> **Isolamento de teste:** o `send` atinge **todos** os clientes do tenant consentidos ao propósito.
> Como o tenant demo acumula clientes entre testes, os e2e asseguram **pertinência na trilha** (o
> cliente A do teste está; B/C não), **não** um `recipientCount` exato. (Os testes anteriores
> consentem só a purposes únicos, não a `email_marketing` — mas o capstone de campanhas também usa
> `email_marketing`, então conta exata não é determinística entre arquivos paralelos.)

- [ ] **Step 1: Write the failing e2e**

`apps/api/test/campaigns.e2e.test.ts`:
```ts
import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AppModule } from '../src/app.module'

describe('Campaigns (e2e)', () => {
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

  // cria um cliente com e-mail e consentimento email_marketing concedido
  async function consentedCustomer(): Promise<string> {
    const id = ((await (await post('/customers', { name: 'C', email: `c-${crypto.randomUUID().slice(0, 8)}@x.de` })).json()) as { id: string }).id
    await post(`/customers/${id}/consent`, { purpose: 'email_marketing', action: 'granted' })
    return id
  }

  it('creates a campaign', async () => {
    expect((await post('/campaigns', { name: 'N', channel: 'email', body: 'Hi' })).status).toBe(201)
  })

  it('send dispatches only to consented customers; trail records them; re-send → 409', async () => {
    const a = await consentedCustomer()
    // b: consentido e depois retirado
    const b = await consentedCustomer()
    await post(`/customers/${b}/consent`, { purpose: 'email_marketing', action: 'withdrawn' })
    // c: consentido sem e-mail (cria com phone só)
    const c = ((await (await post('/customers', { phone: '+49123' })).json()) as { id: string }).id
    await post(`/customers/${c}/consent`, { purpose: 'email_marketing', action: 'granted' })

    const camp = ((await (await post('/campaigns', { name: `K-${crypto.randomUUID().slice(0, 8)}`, channel: 'email', body: 'Hi' })).json()) as { id: string }).id
    const sendRes = await post(`/campaigns/${camp}/send`, {})
    expect(sendRes.status).toBe(201)

    const recipients = (await (await get(`/campaigns/${camp}/recipients`)).json()) as { customerId: string }[]
    const ids = new Set(recipients.map((r) => r.customerId))
    expect(ids.has(a)).toBe(true)
    expect(ids.has(b)).toBe(false) // retirado
    expect(ids.has(c)).toBe(false) // sem e-mail

    expect((await post(`/campaigns/${camp}/send`, {})).status).toBe(409) // já enviada
  })

  it('404 sending a campaign from another tenant', async () => {
    expect((await post(`/campaigns/nonexistent-${crypto.randomUUID().slice(0, 8)}/send`, {})).status).toBe(404)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `corepack pnpm --filter @gelato/api exec vitest run campaigns.e2e`
Expected: FAIL — rotas inexistentes.

- [ ] **Step 3: Implement the service**

`apps/api/src/campaigns/campaigns.service.ts`:
```ts
import { Inject, Injectable, ConflictException, NotFoundException } from '@nestjs/common'
import { consentPurposeForChannel, eligibleRecipients, type CampaignSender, type ConsentAction } from '@gelato/compliance'
import { PrismaService } from '../prisma/prisma.service'

export const CAMPAIGN_SENDER = 'CAMPAIGN_SENDER'

@Injectable()
export class CampaignsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CAMPAIGN_SENDER) private readonly sender: CampaignSender,
  ) {}

  async list(tenantId: string) {
    return this.prisma.campaign.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' } })
  }

  async create(tenantId: string, dto: { name: string; channel: string; subject?: string; body: string }) {
    const c = await this.prisma.campaign.create({ data: { tenantId, name: dto.name, channel: dto.channel, subject: dto.subject, body: dto.body } })
    return { id: c.id }
  }

  async recipients(tenantId: string, id: string) {
    const c = await this.prisma.campaign.findFirst({ where: { id, tenantId } })
    if (!c) throw new NotFoundException('campaign')
    return this.prisma.campaignDispatch.findMany({ where: { tenantId, campaignId: id }, orderBy: { at: 'asc' } })
  }

  async send(tenantId: string, id: string) {
    const c = await this.prisma.campaign.findFirst({ where: { id, tenantId } })
    if (!c) throw new NotFoundException('campaign')
    if (c.status === 'sent') throw new ConflictException('campaign already sent')

    const purpose = consentPurposeForChannel(c.channel)
    const customers = await this.prisma.customer.findMany({ where: { tenantId }, include: { consents: true } })
    const candidates = customers.map((cust) => ({
      id: cust.id,
      anonymized: cust.anonymizedAt != null,
      contact: c.channel === 'email' ? cust.email : cust.phone,
      records: cust.consents.map((r) => ({ purpose: r.purpose, action: r.action as ConsentAction, at: r.at.getTime() })),
    }))
    const eligible = new Set(eligibleRecipients(candidates, purpose))
    const recipients = candidates.filter((x) => eligible.has(x.id)).map((x) => ({ id: x.id, contact: x.contact as string }))

    await this.sender.send({ channel: c.channel, recipients, subject: c.subject ?? undefined, body: c.body })

    await this.prisma.$transaction([
      ...recipients.map((r) => this.prisma.campaignDispatch.create({ data: { tenantId, campaignId: id, customerId: r.id, channel: c.channel } })),
      this.prisma.campaign.update({ where: { id }, data: { status: 'sent', sentAt: new Date(), recipientCount: recipients.length } }),
    ])
    return { recipientCount: recipients.length }
  }
}
```

- [ ] **Step 4: Controller + module + registrar**

`apps/api/src/campaigns/campaigns.controller.ts`:
```ts
import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common'
import { z } from 'zod'
import { CampaignsService } from './campaigns.service'
import { JwtAuthGuard, type JwtUser } from '../auth/jwt-auth.guard'
import { PermissionsGuard } from '../rbac/permissions.guard'
import { RequirePermission } from '../rbac/require-permission.decorator'
import { parseOrThrow } from '../common/zod'

const CreateDto = z.object({ name: z.string().min(1), channel: z.enum(['email', 'sms']), subject: z.string().optional(), body: z.string().min(1) })

@Controller('campaigns')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class CampaignsController {
  constructor(private readonly campaigns: CampaignsService) {}

  @Get()
  @RequirePermission('marketing.view')
  async list(@Req() req: { user: JwtUser }) {
    return this.campaigns.list(req.user.tenant_id)
  }

  @Post()
  @RequirePermission('marketing.manage')
  async create(@Req() req: { user: JwtUser }, @Body() body: unknown) {
    return this.campaigns.create(req.user.tenant_id, parseOrThrow(CreateDto, body))
  }

  @Get(':id/recipients')
  @RequirePermission('marketing.view')
  async recipients(@Req() req: { user: JwtUser }, @Param('id') id: string) {
    return this.campaigns.recipients(req.user.tenant_id, id)
  }

  @Post(':id/send')
  @RequirePermission('marketing.manage')
  async send(@Req() req: { user: JwtUser }, @Param('id') id: string) {
    return this.campaigns.send(req.user.tenant_id, id)
  }
}
```

`apps/api/src/campaigns/campaigns.module.ts`:
```ts
import { Module } from '@nestjs/common'
import { FakeCampaignSender } from '@gelato/compliance'
import { AuthModule } from '../auth/auth.module'
import { PermissionsGuard } from '../rbac/permissions.guard'
import { CampaignsService, CAMPAIGN_SENDER } from './campaigns.service'
import { CampaignsController } from './campaigns.controller'

@Module({
  imports: [AuthModule],
  controllers: [CampaignsController],
  providers: [CampaignsService, PermissionsGuard, { provide: CAMPAIGN_SENDER, useClass: FakeCampaignSender }],
})
export class CampaignsModule {}
```

Modify `apps/api/src/app.module.ts` — importar `CampaignsModule` e adicionar ao `imports`.

- [ ] **Step 5: Run to verify it passes**

Run: `corepack pnpm --filter @gelato/api exec vitest run campaigns.e2e`
Expected: PASS (3 testes).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/campaigns apps/api/src/app.module.ts apps/api/test/campaigns.e2e.test.ts
git commit -m "feat(api): módulo campaigns — CRUD + send (gate de consentimento) + recipients"
```

- [ ] **Step 7: Immutability test** — adicionar a `apps/api/test/immutability.test.ts`:

Helper:
```ts
async function insertCampaignDispatch(pool: Pool): Promise<string> {
  const cid = `cmp_${Date.now()}_${Math.random().toString(36).slice(2)}`
  await pool.query(
    `INSERT INTO campaigns (id, "tenantId", name, channel, body, status, "createdAt") VALUES ($1, 'demo-tenant', 'T', 'email', 'b', 'sent', now())`,
    [cid],
  )
  const id = `cd_${Date.now()}_${Math.random().toString(36).slice(2)}`
  await pool.query(
    `INSERT INTO campaign_dispatches (id, "tenantId", "campaignId", "customerId", channel, at) VALUES ($1, 'demo-tenant', $2, 'cust', 'email', now())`,
    [id, cid],
  )
  return id
}
```
e dentro do `describe`:
```ts
  it('campaign_dispatches is append-only (INSERT ok, UPDATE/DELETE blocked); campaigns stays mutable', async (ctx) => {
    if (!dbAvailable) return ctx.skip()
    const id = await insertCampaignDispatch(appPool)
    await expect(appPool.query(`UPDATE campaign_dispatches SET channel='sms' WHERE id=$1`, [id])).rejects.toThrow()
    await expect(appPool.query(`DELETE FROM campaign_dispatches WHERE id=$1`, [id])).rejects.toThrow()
  })
```

- [ ] **Step 8: Run immutability**

Run: `corepack pnpm --filter @gelato/api exec vitest run immutability`
Expected: PASS.

- [ ] **Step 9: Write the capstone**

`apps/api/test/campaigns-capstone.e2e.test.ts`:
```ts
import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AppModule } from '../src/app.module'

// Capstone 4d: A consente email_marketing, B retira, C anonimiza → campanha email
// → só A na trilha → status sent → re-enviar 409. (GDPR: nunca contata sem consentimento.)
describe('Campaigns capstone (e2e)', () => {
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

  const mk = async (): Promise<string> => ((await (await post('/customers', { name: 'X', email: `cap-${crypto.randomUUID().slice(0, 8)}@x.de` })).json()) as { id: string }).id

  it('only consented customers are contacted', async () => {
    const a = await mk()
    await post(`/customers/${a}/consent`, { purpose: 'email_marketing', action: 'granted' })
    const b = await mk()
    await post(`/customers/${b}/consent`, { purpose: 'email_marketing', action: 'granted' })
    await post(`/customers/${b}/consent`, { purpose: 'email_marketing', action: 'withdrawn' })
    const c = await mk()
    await post(`/customers/${c}/consent`, { purpose: 'email_marketing', action: 'granted' })
    await post(`/customers/${c}/anonymize`, {})

    const camp = ((await (await post('/campaigns', { name: `Cap-${crypto.randomUUID().slice(0, 8)}`, channel: 'email', subject: 'S', body: 'B' })).json()) as { id: string }).id
    const res = (await (await post(`/campaigns/${camp}/send`, {})).json()) as { recipientCount: number }
    expect(res.recipientCount).toBeGreaterThanOrEqual(1)

    const ids = new Set(((await (await get(`/campaigns/${camp}/recipients`)).json()) as { customerId: string }[]).map((r) => r.customerId))
    expect(ids.has(a)).toBe(true)
    expect(ids.has(b)).toBe(false)
    expect(ids.has(c)).toBe(false)

    const camps = (await (await get('/campaigns')).json()) as { id: string; status: string }[]
    expect(camps.find((x) => x.id === camp)!.status).toBe('sent')
    expect((await post(`/campaigns/${camp}/send`, {})).status).toBe(409)
  })
})
```

- [ ] **Step 10: Run capstone + full API suite**

Run: `corepack pnpm --filter @gelato/api exec vitest run campaigns-capstone`
Then: `corepack pnpm --filter @gelato/api exec vitest run`
Expected: ambos verdes.

- [ ] **Step 11: Commit**

```bash
git add apps/api/test/immutability.test.ts apps/api/test/campaigns-capstone.e2e.test.ts
git commit -m "test(api): campaign dispatches append-only + capstone (gate de consentimento)"
```

---

## Chunk 4: backoffice (Campanhas) + integração (fecha o Ciclo 4)

**Files:**
- Modify: `apps/backoffice/src/api.ts` (tipo `CampaignRow`)
- Modify: `apps/backoffice/src/App.tsx` (componente `Campaigns`)

- [ ] **Step 1: Tipo no backoffice api**

Modify `apps/backoffice/src/api.ts` — adicionar:
```ts
export interface CampaignRow {
  id: string
  name: string
  channel: string
  status: string
  recipientCount: number | null
}
```

- [ ] **Step 2: Componente `Campaigns`**

Modify `apps/backoffice/src/App.tsx`:
1. Import: incluir `type CampaignRow`.
2. Renderizar `<Campaigns token={token} />` (perto de `<Vouchers token={token} />`).
3. Componente:
```tsx
function Campaigns({ token }: { token: string }) {
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([])
  const [name, setName] = useState('')
  const [channel, setChannel] = useState('email')
  const [body, setBody] = useState('')

  const reload = (): void => {
    apiGet<CampaignRow[]>('/campaigns', token).then(setCampaigns).catch(() => setCampaigns([]))
  }
  useEffect(reload, [token])

  async function create(e: FormEvent): Promise<void> {
    e.preventDefault()
    if (!name || !body) return
    await apiPost('/campaigns', token, { name, channel, body })
    setName('')
    setBody('')
    reload()
  }

  async function send(id: string): Promise<void> {
    await apiPost(`/campaigns/${id}/send`, token, {})
    reload()
  }

  return (
    <section style={{ marginTop: '2rem' }}>
      <h2>Campanhas</h2>
      <table>
        <thead>
          <tr>
            <th>Nome</th>
            <th>Canal</th>
            <th>Status</th>
            <th>Destinatários</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {campaigns.map((c) => (
            <tr key={c.id}>
              <td>{c.name}</td>
              <td>{c.channel}</td>
              <td>{c.status}</td>
              <td>{c.recipientCount ?? '—'}</td>
              <td>{c.status === 'draft' && <button onClick={() => send(c.id)}>Enviar</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <form onSubmit={create} style={{ marginTop: '0.5rem', display: 'flex', gap: '0.5rem' }}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome" />
        <select value={channel} onChange={(e) => setChannel(e.target.value)}>
          <option value="email">email</option>
          <option value="sms">sms</option>
        </select>
        <input value={body} onChange={(e) => setBody(e.target.value)} placeholder="Mensagem" />
        <button type="submit">Criar</button>
      </form>
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
git commit -m "feat(backoffice): seção Campanhas (lista + criação + enviar)"
```

- [ ] **Step 5: Suíte completa + integração (fecha o Ciclo 4)**

```bash
corepack pnpm -r test
git checkout main
git merge --ff-only ciclo-4d
git push origin main
git branch -d ciclo-4d
```
> Manter `docker/docker-compose.yml` (5433) e `.claude/` fora do commit.

---

## Notas de verificação / riscos

- **Gate de consentimento (GDPR):** o `send` só atinge clientes com `canContact` válido + contato do
  canal. O capstone prova A incluído / B (retirado) / C (anonimizado) excluídos.
- **Sender atrás de porta:** `FakeCampaignSender` (default) registra; o transporte real = esqueleto
  NÃO VERIFICADO (precisa de provider/creds) — nunca acoplar.
- **Trilha append-only** (`campaign_dispatches`): accountability de a quem foi enviado.
- **Isolamento de teste:** os e2e asseguram **pertinência na trilha** (não `recipientCount` exato),
  pois o tenant demo acumula clientes.
- **Dist do compliance** rebuildado no Chunk 1.
- **Fecha o Ciclo 4** (4a CRM + 4b Loyalty + 4c Vouchers + 4d Campanhas).
```
