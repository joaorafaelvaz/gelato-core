# Tische + conta aberta (Ciclo 1 · fatia 1a-1) Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar ao PDV o ciclo de vida de conta aberta no salão — abrir mesa, lançar Bestellungen assinadas (`Bestellung-V1`, append-only) que derivam a conta, e fechar com um Kassenbeleg imutável — sem violar append-only nem acoplar a TSE ao fornecedor.

**Architecture:** A sessão da mesa é metadado **operacional mutável**; a imutabilidade fiscal mora nas **Bestellungen** (append-only, cada uma com TSE `Bestellung-V1`) + no **Kassenbeleg** final. A conta é **derivada** (`aggregateTab` puro = Σ Bestellungen − Stornos). Central-autoritativa via API; o terminal assina a TSE localmente. O pagamento reusa o ledger + a resiliência TSE-Ausfall (1d).

**Tech Stack:** TypeScript strict, vitest (TDD), NestJS + Prisma + Postgres (`gelato_c0`), React/Vite (pos-web). Dinheiro em **cents**, MwSt da `tax_rates`. **127.0.0.1**, nunca `localhost`.

**Spec:** `docs/superpowers/specs/2026-06-26-ciclo-1a-1-tische-conta-aberta-design.md`

> **Validação externa (rastrear):** semântica exata de `process_type` **Bestellung-V1** e se uma gelateria precisa assiná-las → DFKA Gastronomie / Steuerberater. Inclusão das Bestellung-TSE no `tse.csv` da DSFinV-K → extensão da 1c.

---

## File Structure

**Criar (puro, `packages/compliance/src/tab/`):** `aggregate.ts` (`aggregateTab`).
**Modificar (puro):** `packages/compliance/src/tse/types.ts` (TseProcessType), `packages/compliance/src/index.ts` (export tab), `packages/domain/src/events.ts` (BestellungEvent).
**Criar (API, `apps/api/src/tables/`):** `tables.service.ts`, `tables.controller.ts`, `tables.module.ts`.
**Modificar (API):** `prisma/schema.prisma` (+ migração), `prisma/sql/immutability.sql`, `src/rbac/permissions.ts`, `prisma/seed.ts`, `src/app.module.ts`, `test/immutability.test.ts`.
**Criar (testes API):** `test/tables.e2e.test.ts`, `test/tische-capstone.e2e.test.ts`.
**Modificar (pos-web):** `src/api.ts`, `src/App.tsx`.

**Comandos:** pacote puro `corepack pnpm --filter @gelato/<pkg> exec vitest run`; API e2e `corepack pnpm --filter @gelato/api exec vitest run`; typecheck `corepack pnpm exec tsc --noEmit -p <pkg>/tsconfig.json`; build compliance `corepack pnpm --filter @gelato/compliance build`. Postgres: `docker compose -f docker/docker-compose.yml up -d`.

---

## Chunk 1: domínio/compliance — Bestellung-V1, aggregateTab, evento

### Task 1.1: `TseProcessType` ganha `Bestellung-V1`

**Files:**
- Modify: `packages/compliance/src/tse/types.ts:2`
- Test: `packages/compliance/test/bestellung-sign.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/compliance/test/bestellung-sign.test.ts
import { describe, it, expect } from 'vitest'
import { FakeTseProvider } from '../src/tse/fake'

describe('FakeTseProvider — Bestellung-V1', () => {
  it('signs a Bestellung-V1 process type', async () => {
    const tse = new FakeTseProvider({ serialNumber: 'X' })
    const r = await tse.sign({
      clientId: 'c1',
      processType: 'Bestellung-V1',
      amountsByVatRate: [{ rate: 0.19, gross: 119 }],
      paymentType: 'Bar',
      grossTotal: 119,
    })
    expect(r.processType).toBe('Bestellung-V1')
    expect(r.signatureValue).toContain('FAKE-SIG')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm --filter @gelato/compliance exec vitest run test/bestellung-sign.test.ts`
Expected: FAIL — `Type '"Bestellung-V1"' is not assignable to type 'TseProcessType'` (tsc via vitest) ou erro de tipo.

- [ ] **Step 3: Write minimal implementation**

Editar `packages/compliance/src/tse/types.ts` linha 2:
```ts
/** Tipos de processo TSE (KassenSichV): recibo de venda e pedido (Gastronomie). */
export type TseProcessType = 'Kassenbeleg-V1' | 'Bestellung-V1'
```
(O `FakeTseProvider` já devolve `processType: req.processType` e monta `processData` genericamente — nenhuma outra mudança.)

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm --filter @gelato/compliance exec vitest run test/bestellung-sign.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/compliance/src/tse/types.ts packages/compliance/test/bestellung-sign.test.ts
git commit -m "feat(compliance): TseProcessType ganha Bestellung-V1"
```

### Task 1.2: `aggregateTab` (conta derivada, pura)

**Files:**
- Create: `packages/compliance/src/tab/aggregate.ts`
- Modify: `packages/compliance/src/index.ts`
- Test: `packages/compliance/test/aggregate-tab.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/compliance/test/aggregate-tab.test.ts
import { describe, it, expect } from 'vitest'
import { aggregateTab, type TabItemInput } from '../src/tab/aggregate'

const items: TabItemInput[] = [
  { productId: 'p1', qty: 2, unitNet: 100, mwstRate: 0.19, mwstCode: 'standard_19' },
  { productId: 'p2', qty: 1, unitNet: 200, mwstRate: 0.07, mwstCode: 'reduced_7' },
  { productId: 'p1', qty: -1, unitNet: 100, mwstRate: 0.19, mwstCode: 'standard_19' }, // Storno
]

describe('aggregateTab', () => {
  it('aggregates quantities per product, cancelling Stornos', () => {
    const t = aggregateTab(items)
    const p1 = t.lines.find((l) => l.productId === 'p1')!
    expect(p1.qty).toBe(1) // 2 - 1
    expect(p1.net).toBe(100)
  })

  it('groups totals by vat rate (mwst on summed net)', () => {
    const t = aggregateTab(items)
    const g19 = t.byVatRate.find((g) => g.rate === 0.19)!
    expect(g19.net).toBe(100)
    expect(g19.mwst).toBe(19)
    expect(g19.gross).toBe(119)
    const g7 = t.byVatRate.find((g) => g.rate === 0.07)!
    expect(g7).toMatchObject({ net: 200, mwst: 14, gross: 214 })
  })

  it('computes grand totals', () => {
    const t = aggregateTab(items)
    expect(t.totalNet).toBe(300)
    expect(t.totalMwst).toBe(33)
    expect(t.totalGross).toBe(333)
  })

  it('returns empty state for no items', () => {
    expect(aggregateTab([])).toMatchObject({ lines: [], byVatRate: [], totalGross: 0 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm --filter @gelato/compliance exec vitest run test/aggregate-tab.test.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/compliance/src/tab/aggregate.ts
import { applyRate, type Cents } from '@gelato/domain'

export interface TabItemInput {
  productId: string
  qty: number // pode ser negativo (Storno)
  unitNet: Cents
  mwstRate: number
  mwstCode: string
}
export interface TabLine {
  productId: string
  mwstCode: string
  mwstRate: number
  qty: number
  net: Cents
}
export interface TabVatGroup {
  rate: number
  net: Cents
  mwst: Cents
  gross: Cents
}
export interface TabState {
  lines: TabLine[]
  byVatRate: TabVatGroup[]
  totalNet: Cents
  totalMwst: Cents
  totalGross: Cents
}

/**
 * Estado corrente da conta = soma de TODAS as Bestellungen (Stornos têm qty
 * negativa e cancelam). Agrupa linhas por (produto, código de MwSt) e os totais
 * por alíquota (MwSt aplicada sobre o net somado — sem dupla arredondamento). Puro.
 */
export function aggregateTab(items: TabItemInput[]): TabState {
  const lineMap = new Map<string, TabLine>()
  for (const it of items) {
    const key = `${it.productId}|${it.mwstCode}`
    const l = lineMap.get(key) ?? {
      productId: it.productId,
      mwstCode: it.mwstCode,
      mwstRate: it.mwstRate,
      qty: 0,
      net: 0,
    }
    l.qty += it.qty
    l.net += it.unitNet * it.qty
    lineMap.set(key, l)
  }
  const lines = [...lineMap.values()]

  const vatMap = new Map<number, { rate: number; net: Cents }>()
  for (const l of lines) {
    const g = vatMap.get(l.mwstRate) ?? { rate: l.mwstRate, net: 0 }
    g.net += l.net
    vatMap.set(l.mwstRate, g)
  }
  const byVatRate: TabVatGroup[] = [...vatMap.values()].map((g) => {
    const mwst = applyRate(g.net, g.rate)
    return { rate: g.rate, net: g.net, mwst, gross: g.net + mwst }
  })

  return {
    lines,
    byVatRate,
    totalNet: byVatRate.reduce((s, g) => s + g.net, 0),
    totalMwst: byVatRate.reduce((s, g) => s + g.mwst, 0),
    totalGross: byVatRate.reduce((s, g) => s + g.gross, 0),
  }
}
```

- [ ] **Step 4: Run test to verify it passes + export**

Run: `corepack pnpm --filter @gelato/compliance exec vitest run test/aggregate-tab.test.ts` → PASS (4 testes).
Editar `packages/compliance/src/index.ts`: adicionar `export * from './tab/aggregate'`.

- [ ] **Step 5: Build do pacote (consumido pela API em runtime)**

Run: `corepack pnpm exec tsc --noEmit -p packages/compliance/tsconfig.json` → sem erros.
Run: `corepack pnpm --filter @gelato/compliance build` → dist atualizado.

- [ ] **Step 6: Commit**

```bash
git add packages/compliance/src/tab/aggregate.ts packages/compliance/src/index.ts packages/compliance/test/aggregate-tab.test.ts
git commit -m "feat(compliance): aggregateTab (conta derivada de Bestellungen, Stornos)"
```

### Task 1.3: `BestellungEvent` no domínio

**Files:**
- Modify: `packages/domain/src/events.ts`
- Test: `packages/domain/test/bestellung-event.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/domain/test/bestellung-event.test.ts
import { describe, it, expect } from 'vitest'
import { BestellungEventSchema } from '../src/events'

describe('BestellungEventSchema', () => {
  it('accepts a bestellung with items (negative qty allowed for Storno) + tse', () => {
    const ev = {
      client_event_id: '11111111-1111-1111-1111-111111111111',
      type: 'bestellung',
      session_id: 's1',
      kasse_id: 'demo-kasse',
      items: [
        { product_id: 'p1', qty: 2, unit_net: 100, mwst_rate: 0.19, mwst_code: 'standard_19' },
        { product_id: 'p1', qty: -1, unit_net: 100, mwst_rate: 0.19, mwst_code: 'standard_19', storno_of: 'b0' },
      ],
      tse_transaction: { tx_number: 1, signature_value: 'S', signature_counter: 1, log_time: 'now', process_type: 'Bestellung-V1' },
    }
    expect(BestellungEventSchema.parse(ev).items).toHaveLength(2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm --filter @gelato/domain exec vitest run test/bestellung-event.test.ts`
Expected: FAIL — `BestellungEventSchema` não exportado.

- [ ] **Step 3: Write minimal implementation**

Editar `packages/domain/src/events.ts`, após `SaleEventSchema`/`AusfallEventSchema`:
```ts
/** Item de Bestellung: qty pode ser negativa (Storno referenciando a original). */
export const BestellungItemSchema = z.object({
  product_id: z.string(),
  qty: z.number().int(),
  unit_net: Cents,
  mwst_rate: z.number(),
  mwst_code: z.string(),
  storno_of: z.string().optional(),
})

/** Evento de Bestellung (envio de itens à conta). Assinado TSE (Bestellung-V1). */
export const BestellungEventSchema = z.object({
  client_event_id: z.string().uuid(),
  type: z.literal('bestellung'),
  session_id: z.string(),
  kasse_id: z.string(),
  items: z.array(BestellungItemSchema).min(1),
  tse_transaction: TseTransactionSchema,
})

export type BestellungItem = z.infer<typeof BestellungItemSchema>
export type BestellungEvent = z.infer<typeof BestellungEventSchema>
```

- [ ] **Step 4: Run test + build**

Run: `corepack pnpm --filter @gelato/domain exec vitest run test/bestellung-event.test.ts` → PASS.
Run: `corepack pnpm exec tsc --noEmit -p packages/domain/tsconfig.json` → sem erros.
Run: `corepack pnpm --filter @gelato/domain build` → dist atualizado.

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/events.ts packages/domain/test/bestellung-event.test.ts
git commit -m "feat(domain): BestellungEvent schema (itens com Storno + tse)"
```

---

## Chunk 2: modelo de dados + imutabilidade

> Postgres `gelato_c0` no ar. Datasource usa `gelato_owner` (127.0.0.1).

### Task 2.1: schema Prisma — Tisch, Tischsession, Bestellung(+items), tse polimórfica

**Files:**
- Modify: `apps/api/prisma/schema.prisma`

- [ ] **Step 1: Adicionar modelos** (após `TseTransaction`)

```prisma
model Tisch {
  id                String   @id @default(cuid())
  betriebsstaetteId String
  name              String
  seats             Int?
  posX              Int?
  posY              Int?
  active            Boolean  @default(true)
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  betriebsstaette Betriebsstaette @relation(fields: [betriebsstaetteId], references: [id])
  sessions        Tischsession[]

  @@map("tische")
}

model Tischsession {
  id       String    @id @default(cuid())
  tischId  String
  kasseId  String
  status   String    @default("open") // open | paid | cancelled
  openedBy String?
  openedAt DateTime  @default(now())
  closedAt DateTime?
  orderId  String?   @unique

  tisch        Tisch        @relation(fields: [tischId], references: [id])
  bestellungen Bestellung[]

  @@map("tischsessions")
}

model Bestellung {
  id            String   @id @default(cuid())
  clientEventId String   @unique
  sessionId     String
  kasseId       String
  seqNr         Int
  createdBy     String?
  totalNet      Int
  totalMwst     Int
  totalGross    Int
  createdAt     DateTime @default(now())

  session        Tischsession     @relation(fields: [sessionId], references: [id])
  items          BestellungItem[]
  tseTransaction TseTransaction?

  @@map("bestellungen")
}

model BestellungItem {
  id           String  @id @default(cuid())
  bestellungId String
  productId    String
  qty          Int
  unitNet      Int
  mwstRate     Decimal @db.Decimal(5, 4)
  mwstCode     String
  stornoOf     String?

  bestellung Bestellung @relation(fields: [bestellungId], references: [id])

  @@map("bestellung_items")
}
```

- [ ] **Step 2: Tornar `tse_transactions` polimórfica + relação na Betriebsstätte**

Editar `model TseTransaction`:
```prisma
  orderId          String?   @unique
  bestellungId     String?   @unique
  ...
  order      Order?      @relation(fields: [orderId], references: [id])
  bestellung Bestellung? @relation(fields: [bestellungId], references: [id])
```
Editar `model Betriebsstaette`: adicionar `tische Tisch[]` ao bloco de relações.

- [ ] **Step 3: Gerar migração**

Run (em `apps/api`): `corepack pnpm exec prisma migrate dev --name c1a1_tische`
Expected: cria `CREATE TABLE tische/tischsessions/bestellungen/bestellung_items`, `ALTER TABLE tse_transactions` (orderId DROP NOT NULL, ADD bestellungId + índice único + FK). Regenera o client.

- [ ] **Step 4: Append do bloco de imutabilidade + índice parcial**

Adicionar ao FINAL do `migration.sql` recém-criado:
```sql
-- ===== Imutabilidade fiscal: bestellungen + bestellung_items (append-only) =====
GRANT SELECT, INSERT ON bestellungen, bestellung_items TO gelato_app;
DROP TRIGGER IF EXISTS bestellungen_append_only ON bestellungen;
CREATE TRIGGER bestellungen_append_only BEFORE UPDATE OR DELETE ON bestellungen
  FOR EACH ROW EXECUTE FUNCTION fiscal_append_only();
DROP TRIGGER IF EXISTS bestellung_items_append_only ON bestellung_items;
CREATE TRIGGER bestellung_items_append_only BEFORE UPDATE OR DELETE ON bestellung_items
  FOR EACH ROW EXECUTE FUNCTION fiscal_append_only();

-- ===== 1 sessão aberta por mesa (operacional) =====
CREATE UNIQUE INDEX one_open_session_per_tisch ON tischsessions ("tischId") WHERE status = 'open';
```
> `tische`/`tischsessions` NÃO recebem trigger/REVOKE — são operacionais (mutáveis). O `gelato_app` precisa de UPDATE neles (sessão open→paid): o grant geral de runtime do C0 (`GRANT ... ON ALL TABLES`) só cobre tabelas existentes naquele momento, então **garanta DML para as novas operacionais**: `GRANT SELECT, INSERT, UPDATE, DELETE ON tische, tischsessions TO gelato_app;` (adicionar também ao bloco acima).

- [ ] **Step 5: Reaplicar só os blocos novos** (migrate dev já rodou o arquivo antes da edição)

Criar arquivo temporário com o bloco de imutabilidade + os GRANTs operacionais + o índice parcial e:
Run: `corepack pnpm exec prisma db execute --schema prisma/schema.prisma --file /tmp/c1a1_extra.sql`
Expected: sucesso.

- [ ] **Step 6: Atualizar doc canônica + commit**

Editar `apps/api/prisma/sql/immutability.sql`: incluir `bestellungen, bestellung_items` no comentário, no `REVOKE` e no `ARRAY[...]` do trigger.

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations apps/api/prisma/sql/immutability.sql
git commit -m "feat(db): Tisch/Tischsession (operacional) + Bestellung(+items) append-only + tse polimorfica"
```

### Task 2.2: teste de imutabilidade de `bestellungen`/`bestellung_items`

**Files:**
- Modify: `apps/api/test/immutability.test.ts`

- [ ] **Step 1: Write the failing test** (helper + `it`)

Helper (precisa de uma sessão+bestellung; a sessão é operacional):
```ts
async function insertBestellung(pool: Pool): Promise<{ bId: string; itemId: string }> {
  const tischId = `t_${Date.now()}_${Math.random().toString(36).slice(2)}`
  await pool.query(`INSERT INTO tische (id, "betriebsstaetteId", name, active, "createdAt", "updatedAt") VALUES ($1,'demo-bs','T',true,now(),now())`, [tischId])
  const sId = `s_${Date.now()}_${Math.random().toString(36).slice(2)}`
  await pool.query(`INSERT INTO tischsessions (id, "tischId", "kasseId", status, "openedAt") VALUES ($1,$2,'demo-kasse','open',now())`, [sId, tischId])
  const bId = `b_${Date.now()}_${Math.random().toString(36).slice(2)}`
  await pool.query(`INSERT INTO bestellungen (id, "clientEventId", "sessionId", "kasseId", "seqNr", "totalNet","totalMwst","totalGross","createdAt") VALUES ($1,$1,$2,'demo-kasse',1,100,19,119,now())`, [bId, sId])
  const itemId = `bi_${Date.now()}_${Math.random().toString(36).slice(2)}`
  await pool.query(`INSERT INTO bestellung_items (id, "bestellungId", "productId", qty, "unitNet","mwstRate","mwstCode") VALUES ($1,$2,'p1',1,100,0.19,'standard_19')`, [itemId, bId])
  return { bId, itemId }
}
```
`it`:
```ts
  it('bestellungen + bestellung_items are append-only', async (ctx) => {
    if (!dbAvailable) return ctx.skip()
    const { bId, itemId } = await insertBestellung(appPool)
    await expect(appPool.query(`UPDATE bestellungen SET "totalGross"=0 WHERE id=$1`, [bId])).rejects.toThrow()
    await expect(appPool.query(`DELETE FROM bestellungen WHERE id=$1`, [bId])).rejects.toThrow()
    await expect(appPool.query(`UPDATE bestellung_items SET qty=0 WHERE id=$1`, [itemId])).rejects.toThrow()
    await expect(appPool.query(`DELETE FROM bestellung_items WHERE id=$1`, [itemId])).rejects.toThrow()
  })
```

- [ ] **Step 2: Run** → `corepack pnpm --filter @gelato/api exec vitest run test/immutability.test.ts` → PASS. (Se UPDATE/DELETE não lançarem, reaplicar o bloco do Step 4/5.)

- [ ] **Step 3: Commit**

```bash
git add apps/api/test/immutability.test.ts
git commit -m "test(db): bestellungen/bestellung_items append-only"
```

---

## Chunk 3: API mesas — abrir/lançar/ver/listar

### Task 3.1: RBAC + seed de mesas

**Files:**
- Modify: `apps/api/src/rbac/permissions.ts`
- Modify: `apps/api/prisma/seed.ts`

- [ ] **Step 1:** Em `permissions.ts`, adicionar à `PERMISSIONS` (perto de `pos.*`): `'pos.table.open'`, `'pos.table.view'`. Adicioná-las ao papel `operator` em `ROLE_PERMISSIONS` (garçom abre/vê mesas). (admin já recebe `[...PERMISSIONS]`.)
- [ ] **Step 2:** Em `seed.ts`, após o `tseClient.upsert`, criar 2 mesas demo (idempotente):
```ts
for (const [id, name] of [['tisch-1', 'Tisch 1'], ['tisch-2', 'Tisch 2']] as const) {
  await prisma.tisch.upsert({ where: { id }, update: {}, create: { id, betriebsstaetteId: BS_ID, name } })
}
```
- [ ] **Step 3:** Reaplicar o seed: `corepack pnpm --filter @gelato/api db:seed` (idempotente).
- [ ] **Step 4: Commit** `git commit -am "feat(rbac,seed): permissoes pos.table.* + mesas demo"`

### Task 3.2: `tables.service` + `tables.controller` + `tables.module` + e2e (open/bestellung/get/list)

**Files:**
- Create: `apps/api/src/tables/tables.service.ts`, `tables.controller.ts`, `tables.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Test: `apps/api/test/tables.e2e.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/test/tables.e2e.test.ts  (resumo — seguir padrão dos e2e existentes)
// beforeAll: boot Nest (listen 0), login operator via /auth/pin (demo-kasse,1234);
//   criar Tisch única do run: TISCH = `t-${uuid8}` via prisma.tisch.create (betriebsstaetteId 'demo-bs').
// Helpers de assinatura: usar FakeTseProvider local p/ assinar Bestellung-V1.
it('opens a table once (409 on second open)')
it('appends bestellungen and derives the tab via GET session')
// abrir → POST /pos/sessions/:id/bestellung (2x, com FakeTse Bestellung-V1) → GET /pos/sessions/:id
//   afirma byVatRate/totalGross corretos; segundo open na mesma mesa → 409.
```
(Escrever o teste completo seguindo `shifts.e2e.test.ts`/`exports.e2e.test.ts`: `fetch` + `PrismaClient`, asserts em status e corpo.)

- [ ] **Step 2: Run** → FAIL (rotas inexistentes).

- [ ] **Step 3: Implementar `tables.service.ts`**

```ts
import { Injectable, ConflictException, NotFoundException, BadRequestException } from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import { aggregateTab, type TabItemInput } from '@gelato/compliance'
import type { BestellungEvent } from '@gelato/domain'
import { PrismaService } from '../prisma/prisma.service'

@Injectable()
export class TablesService {
  constructor(private readonly prisma: PrismaService) {}

  async listTables(kasseId: string) {
    const kasse = await this.prisma.kasse.findUnique({ where: { id: kasseId } })
    if (!kasse) throw new NotFoundException('kasse')
    const tische = await this.prisma.tisch.findMany({ where: { betriebsstaetteId: kasse.betriebsstaetteId, active: true }, orderBy: { name: 'asc' } })
    const open = await this.prisma.tischsession.findMany({ where: { status: 'open', tischId: { in: tische.map((t) => t.id) } } })
    const openByTisch = new Map(open.map((s) => [s.tischId, s.id]))
    return tische.map((t) => ({ id: t.id, name: t.name, openSessionId: openByTisch.get(t.id) ?? null }))
  }

  async openSession(tischId: string, kasseId: string, userId: string) {
    const existing = await this.prisma.tischsession.findFirst({ where: { tischId, status: 'open' } })
    if (existing) throw new ConflictException({ message: 'table already open', sessionId: existing.id })
    return this.prisma.tischsession.create({ data: { tischId, kasseId, status: 'open', openedBy: userId } })
  }

  async getSession(id: string) {
    const session = await this.prisma.tischsession.findUnique({ where: { id }, include: { bestellungen: { include: { items: true } } } })
    if (!session) throw new NotFoundException('session')
    const items: TabItemInput[] = session.bestellungen.flatMap((b) =>
      b.items.map((i) => ({ productId: i.productId, qty: i.qty, unitNet: i.unitNet, mwstRate: Number(i.mwstRate), mwstCode: i.mwstCode })),
    )
    return { id: session.id, tischId: session.tischId, status: session.status, orderId: session.orderId, tab: aggregateTab(items) }
  }

  async addBestellung(sessionId: string, event: BestellungEvent, userId: string): Promise<{ duplicate: boolean; bestellungId: string }> {
    const seen = await this.prisma.bestellung.findUnique({ where: { clientEventId: event.client_event_id } })
    if (seen) return { duplicate: true, bestellungId: seen.id }
    const session = await this.prisma.tischsession.findUnique({ where: { id: sessionId } })
    if (!session || session.status !== 'open') throw new ConflictException('session not open')

    const te = event.tse_transaction
    const isAusfall = te.is_ausfall === true
    if (!isAusfall && (!te.signature_value || te.signature_counter == null || !te.log_time)) {
      throw new BadRequestException('incomplete TSE transaction data')
    }
    const tab = aggregateTab(event.items.map((i) => ({ productId: i.product_id, qty: i.qty, unitNet: i.unit_net, mwstRate: i.mwst_rate, mwstCode: i.mwst_code })))

    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${sessionId}, 0))`
      const last = await tx.bestellung.findFirst({ where: { sessionId }, orderBy: { seqNr: 'desc' } })
      const seqNr = (last?.seqNr ?? 0) + 1
      const b = await tx.bestellung.create({
        data: {
          clientEventId: event.client_event_id, sessionId, kasseId: event.kasse_id, seqNr, createdBy: userId,
          totalNet: tab.totalNet, totalMwst: tab.totalMwst, totalGross: tab.totalGross,
          items: { create: event.items.map((i) => ({ productId: i.product_id, qty: i.qty, unitNet: i.unit_net, mwstRate: i.mwst_rate, mwstCode: i.mwst_code, stornoOf: i.storno_of })) },
          tseTransaction: {
            create: {
              txNumber: te.tx_number ?? null, signatureCounter: te.signature_counter ?? null, signatureValue: te.signature_value ?? null,
              logTime: te.log_time ? new Date(te.log_time) : null, processType: te.process_type ?? 'Bestellung-V1',
              serialNumber: te.serial_number, publicKey: te.public_key, isAusfall,
            },
          },
        },
      })
      await tx.auditLog.create({ data: { userId, action: 'pos.bestellung.create', entity: 'bestellung', entityId: b.id, payload: { sessionId, seqNr } } })
      return { duplicate: false, bestellungId: b.id }
    })
  }
}
```
> `BestellungItem.mwstRate` é `Decimal`; o Prisma aceita `number` no create (coage). O `aggregateTab` no `addBestellung` é só para os totais desta Bestellung.

- [ ] **Step 4: Implementar controller + module**

`tables.controller.ts` (classe com `@UseGuards(JwtAuthGuard, PermissionsGuard)`):
- `POST tables/:tischId/open` `@RequirePermission('pos.table.open')` → body `{ kasse_id }` → `openSession(tischId, kasse_id, req.user.sub)`; mapear `ConflictException` → 409.
- `POST sessions/:id/bestellung` `@RequirePermission('pos.sale.create')` `@HttpCode(200)` → `parseOrThrow(BestellungEventSchema, body)` (valida `session_id`==`:id`) → `addBestellung`.
- `GET sessions/:id` `@RequirePermission('pos.table.view')` → `getSession`.
- `GET tables` `@RequirePermission('pos.table.view')` → `@Query('kasse_id')` → `listTables`.
Prefixo `@Controller('pos')`. `tables.module.ts` espelha `reports.module.ts` (imports AuthModule; providers TablesService + PermissionsGuard). Registrar `TablesModule` em `app.module.ts`.

- [ ] **Step 5: Run + typecheck**

Run: `corepack pnpm --filter @gelato/api exec vitest run test/tables.e2e.test.ts` → PASS.
Run: `corepack pnpm exec tsc --noEmit -p apps/api/tsconfig.json` → sem erros.

- [ ] **Step 6: Commit** `git add apps/api/src/tables apps/api/src/app.module.ts apps/api/test/tables.e2e.test.ts && git commit -m "feat(api): mesas — abrir sessao, lancar Bestellung (append+TSE), conta derivada, listar"`

---

## Chunk 4: pagamento / Abschluss

### Task 4.1: `POST /pos/sessions/:id/pay` → Kassenbeleg ligado à sessão

**Files:**
- Modify: `apps/api/src/tables/tables.service.ts`, `tables.controller.ts`
- Modify: `apps/api/src/pos/ledger.service.ts` (reuso) — ver nota
- Test: `apps/api/test/tables.e2e.test.ts` (adicionar)

> Reuso do ledger: o pagamento monta um `SaleEvent` a partir da conta agregada (server-authoritative) + a TSE `Kassenbeleg-V1` recebida, e chama `ledger.ingest` (que já trata `is_ausfall`/Ausfall e grava `order`+items+payment+receipt+tse+audit). Depois liga `session.orderId` + marca `paid` (operacional). Para reusar, `TablesModule` importa o `LedgerService` (exportá-lo do `PosModule` ou prover no `TablesModule`).

- [ ] **Step 1: Write the failing test** (adicionar)

```ts
it('pays a session: writes a Kassenbeleg order linked to the session and marks it paid', async () => {
  // abrir mesa, lançar 1 Bestellung (FakeTse Bestellung-V1), GET total,
  // assinar Kassenbeleg-V1 (FakeTse) sobre o total, POST /pos/sessions/:id/pay { payment, tse, client_event_id }
  // → 200; GET session → status 'paid' + orderId; prisma.order(where clientEventId).tableId == tischId.
  // pagar de novo → 409.
})
```

- [ ] **Step 2: Run** → FAIL (rota inexistente).

- [ ] **Step 3: Implementar `pay` no service**

```ts
async pay(sessionId: string, body: { client_event_id: string; payment: { method: 'cash'; amount: number }; tse: Record<string, unknown> }, actor: { userId?: string; ip?: string; device?: string }) {
  const session = await this.prisma.tischsession.findUnique({ where: { id: sessionId }, include: { bestellungen: { include: { items: true } } } })
  if (!session) throw new NotFoundException('session')
  if (session.status !== 'open') throw new ConflictException('session not open')
  const items: TabItemInput[] = session.bestellungen.flatMap((b) => b.items.map((i) => ({ productId: i.productId, qty: i.qty, unitNet: i.unitNet, mwstRate: Number(i.mwstRate), mwstCode: i.mwstCode })))
  const tab = aggregateTab(items)
  if (tab.totalGross === 0 && tab.lines.length === 0) throw new BadRequestException('empty tab')

  // Monta um SaleEvent e reusa o ledger (trata Ausfall, idempotência, audit).
  const saleEvent = {
    client_event_id: body.client_event_id, type: 'sale' as const, kasse_id: session.kasseId,
    payload: {
      order: { mode: 'im_haus' as const, table_id: session.tischId, total_net: tab.totalNet, total_mwst: tab.totalMwst, total_gross: tab.totalGross },
      items: tab.lines.map((l) => ({ product_id: l.productId, qty: l.qty, unit_net: l.net / l.qty, mwst_rate: l.mwstRate, mwst_code: l.mwstCode })),
      payment: body.payment,
      receipt: { qr_payload: '', format: 'digital' as const },
      tse_transaction: body.tse as never,
    },
  }
  const result = await this.ledger.ingest(saleEvent as never, actor)
  await this.prisma.tischsession.update({ where: { id: sessionId }, data: { status: 'paid', closedAt: new Date(), orderId: result.orderId } })
  return { orderId: result.orderId, duplicate: result.duplicate }
}
```
> `unit_net: l.net / l.qty` pressupõe qty≠0; linhas totalmente stornoadas (qty 0) devem ser filtradas antes (`tab.lines.filter((l) => l.qty !== 0)`). Ajustar o `items` map para filtrar qty 0. O `receipt.qr_payload` vazio é aceitável (a 1d já permite); a montagem do QR real fica para o terminal (recibo). Em Ausfall, `body.tse` carrega `is_ausfall:true`.

Injetar `LedgerService` no construtor do `TablesService` (e exportá-lo do `PosModule`/prover no `TablesModule`).

- [ ] **Step 4: Controller** — `POST sessions/:id/pay` `@RequirePermission('pos.sale.create')` `@HttpCode(200)` → valida body (zod: client_event_id uuid, payment, tse) → `pay(...)` com `actor` de `req.user`/headers; `ConflictException`→409.

- [ ] **Step 5: Run + typecheck** → PASS; `tsc` limpo.

- [ ] **Step 6: Commit** `git commit -am "feat(api): pagamento de sessao -> Kassenbeleg ligado a mesa (reusa ledger+Ausfall)"`

---

## Chunk 5: terminal pos-web — fluxo mínimo de mesas

### Task 5.1: helpers de API + painel Tische

**Files:**
- Modify: `apps/pos-web/src/api.ts`, `apps/pos-web/src/App.tsx`

- [ ] **Step 1:** Em `api.ts`, adicionar helpers (reusando o `authedPost`/fetch existentes): `listTables(token, kasse)`, `openTable(token, tischId, kasse)`, `getSession(token, id)`, `addBestellung(token, id, event)`, `payTable(token, id, body)`.

- [ ] **Step 2:** Em `App.tsx`, adicionar um **modo "Salão"** (toggle ou seção) que: lista mesas (`listTables`), permite abrir/continuar uma mesa; na conta aberta, lançar item assina **Bestellung-V1** com o `FakeTseProvider` já instanciado (`tse`) e `make... ` → `addBestellung`; mostra o total via `getSession`; "Pagar" assina **Kassenbeleg-V1** e chama `payTable`. Reusa `computeMwst`/`signWithFallback` de `@gelato/compliance` para montar os itens (cents) e a assinatura. Estado mínimo: `tables`, `sessionId`, `tab`.

> Manter mínimo e funcional (a UI rica de Tischplan é a 1a-4). O objetivo é exercitar o fluxo ponta a ponta pelo navegador.

- [ ] **Step 3: Typecheck + build**

Run: `corepack pnpm exec tsc --noEmit -p apps/pos-web/tsconfig.json` → sem erros.
Run: `corepack pnpm --filter @gelato/pos-web build` → ok.
(Verificação visual ao vivo fica para sessão interativa; corretude lógica no capstone.)

- [ ] **Step 4: Commit** `git commit -am "feat(pos-web): fluxo minimo de mesas (abrir/lancar Bestellung/ver/pagar)"`

---

## Chunk 6: capstone e2e + verificação

### Task 6.1: capstone mesa → Bestellungen → pagamento

**Files:**
- Create: `apps/api/test/tische-capstone.e2e.test.ts`

> Kasse + Tisch **únicas por run** (ledger append-only acumula). Reusa o padrão dos capstones anteriores: boot Nest, login, FakeTseProvider local para assinar Bestellung-V1 e Kassenbeleg-V1.

- [ ] **Step 1: Write the failing test**

Fluxo: criar Tisch única → `POST open` → 2 `POST bestellung` (a 2ª inclui um item de **Storno** com qty negativa) → `GET session` afirma `tab.totalGross` = Σ − Storno → assinar Kassenbeleg-V1 sobre o total → `POST pay` → afirmar: `order` (where clientEventId) com `tableId` == tisch, `tab` zerado de pendências, `session.status='paid'`, e que as **Bestellungen são append-only** (UPDATE rejeitado). Reenviar a mesma Bestellung (mesmo `client_event_id`) → `duplicate:true`, sem duplicar.

- [ ] **Step 2: Run** → ajustar nomes de campo conforme schema/seed → PASS.

- [ ] **Step 3: Suíte completa**

Run: `corepack pnpm -r test`
Expected: tudo verde. (ABI Node p/ `@gelato/pos-terminal`: `corepack pnpm install --force` se a GUI Electron foi compilada antes.)

- [ ] **Step 4: Commit** `git add apps/api/test/tische-capstone.e2e.test.ts && git commit -m "test(api): capstone mesa -> Bestellungen(+Storno) -> Kassenbeleg, idempotente"`

---

## Definition of Done (fatia 1a-1)

- [ ] `Bestellung-V1` assinável; `aggregateTab` deriva a conta (Stornos cancelam) — testado.
- [ ] `Tisch`/`Tischsession` operacionais; `Bestellung`/`BestellungItem` **append-only** no banco (UPDATE/DELETE rejeitados) — testado.
- [ ] Abrir mesa (1-open-por-mesa, 409), lançar Bestellung (append+TSE idempotente), conta derivada via GET — e2e.
- [ ] Pagar → Kassenbeleg imutável ligado à mesa (reusa ledger + Ausfall), sessão `paid` — e2e.
- [ ] pos-web percorre o fluxo (compila/builda).
- [ ] Capstone: mesa → 2 Bestellungen (incl. Storno) → pagar, total = Σ − Storno, idempotente; `corepack pnpm -r test` verde.

## Riscos / validações externas (rastrear)

- `process_type` **Bestellung-V1** e obrigatoriedade p/ gelateria → DFKA/Steuerberater.
- Bestellung-TSE no `tse.csv` da DSFinV-K → extensão 1c.
- MwSt `im_haus` p/ gelato → Steuerberater (já em `tax_rates`).
