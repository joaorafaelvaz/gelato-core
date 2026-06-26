# Split (por valor) + transferência (Ciclo 1 · fatia 1a-2) Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir pagar uma conta de mesa em **vários Kassenbelege parciais** (split por valor, MwSt rateada, o último reconcilia) até quitar, e **transferir** a conta inteira para outra mesa — tudo append-only.

**Architecture:** Pagamentos parciais são `orders` append-only ligados à sessão (`Order.tischSessionId`, gravado no INSERT do ledger — nunca UPDATE em registro fiscal). O remanescente é **derivado** (`aggregateTab(Bestellungen) − paidByRate(orders)`). `apportionSplit` (puro, **net-centric**: o gross do order é sempre `net + MwSt`) fatia um pagamento; o último pagamento toma o remanescente exato → Σ = total. Transferência = `update` operacional do `tischId`.

**Tech Stack:** TypeScript strict, vitest (TDD), NestJS + Prisma + Postgres (`gelato_c0` em **5433**), React/Vite (pos-web). Cents; MwSt da `tax_rates`. **127.0.0.1**.

**Spec:** `docs/superpowers/specs/2026-06-26-ciclo-1a-2-split-transferencia-design.md`

> **Postgres em 5433** (coexistência). Migração **não-interativa**: `prisma migrate diff` → `migration.sql` → `db execute` → `migrate resolve --applied` → `prisma generate` (migrate dev exige TTY, indisponível headless).
> **Validação externa:** forma canônica de Teilzahlung/Teilrechnung na DSFinV-K + rateio de MwSt + assinatura TSE sobre o valor exato do parcial → DFKA/Steuerberater.

---

## File Structure

**Criar (puro):** `packages/compliance/src/tab/split.ts` (`apportionSplit`, `paidByRate`).
**Modificar (puro):** `packages/compliance/src/index.ts`; `packages/domain/src/events.ts` (`OrderSchema.tisch_session_id?`).
**Modificar (API):** `prisma/schema.prisma` (+migração c1a2); `src/pos/ledger.service.ts` (grava `tischSessionId`); `src/tables/tables.service.ts` (pay generalizado + transfer + remaining no get); `src/tables/tables.controller.ts` (PayDto.amount? + rota transfer); `test/tables.e2e.test.ts`.
**Criar (teste):** `test/tische-split-capstone.e2e.test.ts`.
**Modificar (pos-web):** `src/api.ts` (transfer + amount), `src/TischPanel.tsx` (split/transfer).

**Comandos:** puro `corepack pnpm --filter @gelato/<pkg> exec vitest run`; API e2e `corepack pnpm --filter @gelato/api exec vitest run`; typecheck `corepack pnpm exec tsc --noEmit -p <pkg>/tsconfig.json`; build `corepack pnpm --filter @gelato/<pkg> build`.

---

## Chunk 1: puro — apportionSplit + paidByRate

### Task 1.1: `apportionSplit` + `paidByRate`

**Files:**
- Create: `packages/compliance/src/tab/split.ts`
- Modify: `packages/compliance/src/index.ts`
- Test: `packages/compliance/test/split.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/compliance/test/split.test.ts
import { describe, it, expect } from 'vitest'
import { aggregateTab } from '../src/tab/aggregate'
import { apportionSplit, paidByRate, type PaidLike } from '../src/tab/split'

// conta: p1 1×100 @19% (gross119) + p2 1×200 @7% (gross214) = 333
const fullTab = aggregateTab([
  { productId: 'p1', qty: 1, unitNet: 100, mwstRate: 0.19, mwstCode: 'standard_19' },
  { productId: 'p2', qty: 1, unitNet: 200, mwstRate: 0.07, mwstCode: 'reduced_7' },
])

describe('apportionSplit', () => {
  it('a single full payment (no prior paid) settles the whole tab', () => {
    const r = apportionSplit(fullTab, [], fullTab.totalGross)
    expect(r.settles).toBe(true)
    expect(r.totalGross).toBe(333)
    expect(r.totalNet).toBe(300)
  })

  it('three partial payments reconcile exactly to the tab (Σ = full)', () => {
    const paid: { rate: number; net: number }[] = []
    let remaining = fullTab.totalGross
    const grosses: number[] = []
    for (let i = 0; i < 3; i++) {
      const r = apportionSplit(fullTab, paid as PaidLike[], Math.ceil(remaining / (3 - i)))
      grosses.push(r.totalGross)
      remaining -= r.totalGross
      // acumula o pago por alíquota (net)
      for (const l of r.lines) {
        const g = paid.find((p) => p.rate === l.mwstRate)
        if (g) g.net += l.unitNet
        else paid.push({ rate: l.mwstRate, net: l.unitNet })
        void g
      }
    }
    expect(grosses.reduce((s, g) => s + g, 0)).toBe(333) // Σ pagamentos = total
    expect(remaining).toBe(0)
    // net por alíquota reconcilia
    expect(paid.find((p) => p.rate === 0.19)!.net).toBe(100)
    expect(paid.find((p) => p.rate === 0.07)!.net).toBe(200)
  })

  it('caps a partial at the remaining and never overpays a rate', () => {
    const r = apportionSplit(fullTab, [], 50)
    expect(r.totalGross).toBeLessThanOrEqual(50 + 2) // ~50, sem estourar
    expect(r.lines.every((l) => l.unitNet >= 0)).toBe(true)
  })

  it('paidByRate aggregates order items into {rate,net,mwst,gross}', () => {
    const groups = paidByRate([
      { items: [{ unitNet: 100, qty: 1, mwstRate: 0.19 }, { unitNet: 200, qty: 1, mwstRate: 0.07 }] },
    ])
    expect(groups.find((g) => g.rate === 0.19)).toMatchObject({ net: 100, mwst: 19, gross: 119 })
    expect(groups.find((g) => g.rate === 0.07)).toMatchObject({ net: 200, mwst: 14, gross: 214 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm --filter @gelato/compliance exec vitest run test/split.test.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/compliance/src/tab/split.ts
import { applyRate, type Cents } from '@gelato/domain'
import type { TabState } from './aggregate'

export interface PaidLike {
  rate: number
  net: Cents
}
export interface PaidGroup {
  rate: number
  net: Cents
  mwst: Cents
  gross: Cents
}
export interface SplitLine {
  productId: string
  qty: number
  unitNet: Cents
  mwstRate: number
  mwstCode: string
}
export interface SplitResult {
  lines: SplitLine[]
  totalNet: Cents
  totalMwst: Cents
  totalGross: Cents
  settles: boolean
}

/** Soma os itens dos orders (já pagos) por alíquota → {rate,net,mwst,gross}. Net-centric. */
export function paidByRate(orders: { items: { unitNet: Cents; qty: number; mwstRate: number }[] }[]): PaidGroup[] {
  const byRate = new Map<number, Cents>()
  for (const o of orders) {
    for (const it of o.items) {
      byRate.set(it.mwstRate, (byRate.get(it.mwstRate) ?? 0) + it.unitNet * it.qty)
    }
  }
  return [...byRate.entries()].map(([rate, net]) => {
    const mwst = applyRate(net, rate)
    return { rate, net, mwst, gross: net + mwst }
  })
}

/**
 * Fatia um pagamento de `payGross` (bruto) sobre a conta. NET-CENTRIC: cada linha tem
 * `unitNet`, e o bruto é sempre `net + applyRate(net,rate)` (igual ao ledger). Rateia
 * proporcional ao bruto remanescente; o pagamento que cobre o resto (`settles`) toma o
 * remanescente de NET EXATO por alíquota → Σ de todos os pagamentos = a conta, exato.
 */
export function apportionSplit(fullTab: TabState, paid: PaidLike[], payGross: Cents): SplitResult {
  const paidNet = new Map(paid.map((p) => [p.rate, p.net]))
  const remaining = fullTab.byVatRate
    .map((g) => {
      const code = fullTab.lines.find((l) => l.mwstRate === g.rate)?.mwstCode ?? String(g.rate)
      const net = g.net - (paidNet.get(g.rate) ?? 0)
      return { rate: g.rate, code, net, gross: net + applyRate(net, g.rate) }
    })
    .filter((r) => r.net > 0)
  const totalRemainingGross = remaining.reduce((s, r) => s + r.gross, 0)

  let chosen: { rate: number; code: string; net: Cents }[]
  let settles = false
  if (payGross >= totalRemainingGross) {
    chosen = remaining.map((r) => ({ rate: r.rate, code: r.code, net: r.net }))
    settles = true
  } else {
    chosen = remaining
      .map((r) => {
        const targetGross = Math.round((payGross * r.gross) / totalRemainingGross)
        const net = Math.min(Math.round(targetGross / (1 + r.rate)), r.net)
        return { rate: r.rate, code: r.code, net }
      })
      .filter((c) => c.net > 0)
  }

  const lines: SplitLine[] = chosen.map((c) => ({
    productId: `split:${c.code}`,
    qty: 1,
    unitNet: c.net,
    mwstRate: c.rate,
    mwstCode: c.code,
  }))
  const totalNet = chosen.reduce((s, c) => s + c.net, 0)
  const totalMwst = chosen.reduce((s, c) => s + applyRate(c.net, c.rate), 0)
  return { lines, totalNet, totalMwst, totalGross: totalNet + totalMwst, settles }
}
```

- [ ] **Step 4: Run + export + build**

Run: `corepack pnpm --filter @gelato/compliance exec vitest run test/split.test.ts` → PASS.
Editar `packages/compliance/src/index.ts`: `export * from './tab/split'`.
Run: `corepack pnpm exec tsc --noEmit -p packages/compliance/tsconfig.json` → sem erros.
Run: `corepack pnpm --filter @gelato/compliance build` → dist atualizado.

- [ ] **Step 5: Commit**

```bash
git add packages/compliance/src/tab/split.ts packages/compliance/src/index.ts packages/compliance/test/split.test.ts
git commit -m "feat(compliance): apportionSplit (split por valor, net-centric, reconcilia) + paidByRate"
```

---

## Chunk 2: modelo — Order.tischSessionId

### Task 2.1: schema + domínio + ledger gravam tischSessionId no INSERT

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (Order + Tischsession), migração c1a2
- Modify: `packages/domain/src/events.ts` (`OrderSchema.tisch_session_id?`)
- Modify: `apps/api/src/pos/ledger.service.ts` (order.create grava tischSessionId)

- [ ] **Step 1: schema** — em `model Order` adicionar `tischSessionId String?` e relação:
```prisma
  tischSessionId String?
  tischSession   Tischsession? @relation(fields: [tischSessionId], references: [id])
```
Em `model Tischsession` adicionar a relação inversa: `orders Order[]` (mantém `orderId` como settling).

- [ ] **Step 2: migração não-interativa**

```bash
cd apps/api
corepack pnpm exec prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script > /tmp/c1a2.sql
TS=$(date +%Y%m%d%H%M%S); DIR="prisma/migrations/${TS}_c1a2_order_session"
mkdir -p "$DIR"; cp /tmp/c1a2.sql "$DIR/migration.sql"
corepack pnpm exec prisma db execute --schema prisma/schema.prisma --file "$DIR/migration.sql"
corepack pnpm exec prisma migrate resolve --applied "${TS}_c1a2_order_session"
corepack pnpm exec prisma generate
```
Expected: `ALTER TABLE "orders" ADD COLUMN "tischSessionId"` + FK + índice. (Sem trigger novo — `orders` já é append-only; a coluna é setada no INSERT.)

- [ ] **Step 3: domínio** — em `OrderSchema` (`packages/domain/src/events.ts`) adicionar:
```ts
  tisch_session_id: z.string().optional(),
```
Build: `corepack pnpm --filter @gelato/domain build`.

- [ ] **Step 4: ledger grava no INSERT** — em `apps/api/src/pos/ledger.service.ts`, no `order.create` `data`, adicionar (perto de `tableId`):
```ts
          tischSessionId: p.order.tisch_session_id,
```

- [ ] **Step 5: typecheck + commit**

Run: `corepack pnpm exec tsc --noEmit -p apps/api/tsconfig.json` → sem erros (após generate).
```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations packages/domain/src/events.ts apps/api/src/pos/ledger.service.ts
git commit -m "feat(db,domain): Order.tischSessionId gravado no INSERT do ledger (sem UPDATE fiscal)"
```

---

## Chunk 3: API — pay generalizado (parcial/rateio) + remaining

### Task 3.1: `pay` aceita `amount?`, rateia, marca paid só ao quitar

**Files:**
- Modify: `apps/api/src/tables/tables.service.ts`, `tables.controller.ts`
- Test: `apps/api/test/tables.e2e.test.ts`

- [ ] **Step 1: Write the failing test** (adicionar ao describe existente)

```ts
it('splits a tab into 3 partial payments until settled (Σ = total, paid only at the end)', async () => {
  const tisch = `tisch-${crypto.randomUUID().slice(0, 8)}`
  await prisma.tisch.create({ data: { id: tisch, betriebsstaetteId: 'demo-bs', name: 'split' } })
  const sessionId = ((await (await post(`/pos/tables/${tisch}/open`, { kasse_id: 'demo-kasse' })).json()) as { id: string }).id
  await post(`/pos/sessions/${sessionId}/bestellung`, await signedBestellung(sessionId, [
    { product_id: 'p1', qty: 1, unit_net: 100, mwst_rate: 0.19, mwst_code: 'standard_19' },
    { product_id: 'p2', qty: 1, unit_net: 200, mwst_rate: 0.07, mwst_code: 'reduced_7' },
  ]))
  const total = 333
  let paidSum = 0
  for (let i = 0; i < 3; i++) {
    const remaining = ((await (await get(`/pos/sessions/${sessionId}`)).json()) as { remaining: { totalGross: number } }).remaining.totalGross
    const amount = i < 2 ? Math.ceil(remaining / (3 - i)) : remaining
    const r = await tse.sign({ clientId: 'c1', processType: 'Kassenbeleg-V1', amountsByVatRate: [], paymentType: 'Bar', grossTotal: amount })
    const res = await post(`/pos/sessions/${sessionId}/pay`, {
      client_event_id: crypto.randomUUID(), amount, payment: { method: 'cash', amount },
      tse: { tx_number: r.txNumber, signature_counter: r.signatureCounter, signature_value: r.signatureValue, log_time: r.logTime, process_type: r.processType, serial_number: r.serialNumber, public_key: r.publicKey },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { settled: boolean; remainingGross: number }
    paidSum += amount
    if (i < 2) expect(body.settled).toBe(false)
    else expect(body.settled).toBe(true)
  }
  // Σ dos orders da sessão = total
  const orders = await prisma.order.findMany({ where: { tischSessionId: sessionId } })
  expect(orders.reduce((s, o) => s + o.totalGross, 0)).toBe(total)
  const sess = await prisma.tischsession.findUnique({ where: { id: sessionId } })
  expect(sess?.status).toBe('paid')
})

it('rejects an overpay (amount > remaining) with 400', async () => {
  const tisch = `tisch-${crypto.randomUUID().slice(0, 8)}`
  await prisma.tisch.create({ data: { id: tisch, betriebsstaetteId: 'demo-bs', name: 'over' } })
  const sessionId = ((await (await post(`/pos/tables/${tisch}/open`, { kasse_id: 'demo-kasse' })).json()) as { id: string }).id
  await post(`/pos/sessions/${sessionId}/bestellung`, await signedBestellung(sessionId, [
    { product_id: 'p1', qty: 1, unit_net: 100, mwst_rate: 0.19, mwst_code: 'standard_19' },
  ]))
  const r = await tse.sign({ clientId: 'c1', processType: 'Kassenbeleg-V1', amountsByVatRate: [], paymentType: 'Bar', grossTotal: 9999 })
  const res = await post(`/pos/sessions/${sessionId}/pay`, {
    client_event_id: crypto.randomUUID(), amount: 9999, payment: { method: 'cash', amount: 9999 },
    tse: { tx_number: r.txNumber, signature_counter: r.signatureCounter, signature_value: r.signatureValue, log_time: r.logTime, process_type: r.processType, serial_number: r.serialNumber, public_key: r.publicKey },
  })
  expect(res.status).toBe(400)
})
```

- [ ] **Step 2: Run** → FAIL (sem `remaining` no GET; `amount` ignorado; overpay não validado).

- [ ] **Step 3: Implementar — `getSession` devolve `remaining`**

Em `getSession`, calcular o pago e o remanescente:
```ts
import { aggregateTab, apportionSplit, paidByRate, type TabItemInput } from '@gelato/compliance'
// ...
async getSession(id: string) {
  const session = await this.prisma.tischsession.findUnique({
    where: { id },
    include: { bestellungen: { include: { items: true } }, orders: { include: { items: true } } },
  })
  if (!session) throw new NotFoundException('session')
  const items: TabItemInput[] = session.bestellungen.flatMap((b) => b.items.map((i) => ({ productId: i.productId, qty: i.qty, unitNet: i.unitNet, mwstRate: Number(i.mwstRate), mwstCode: i.mwstCode })))
  const tab = aggregateTab(items)
  const paid = paidByRate(session.orders.map((o) => ({ items: o.items.map((i) => ({ unitNet: i.unitNet, qty: i.qty, mwstRate: Number(i.mwstRate) })) })))
  const paidGross = paid.reduce((s, p) => s + p.gross, 0)
  const remaining = { totalGross: Math.max(0, tab.totalGross - paidGross) }
  return { id: session.id, tischId: session.tischId, status: session.status, orderId: session.orderId, tab, remaining }
}
```

- [ ] **Step 4: Implementar — `pay` generalizado** (substituir o método da 1a-1)

```ts
async pay(sessionId: string, body: { client_event_id: string; amount?: number; payment: { method: 'cash'; amount: number; ref?: string }; tse: Record<string, unknown> }, actor: Actor) {
  const session = await this.prisma.tischsession.findUnique({
    where: { id: sessionId },
    include: { bestellungen: { include: { items: true } }, orders: { include: { items: true } } },
  })
  if (!session) throw new NotFoundException('session')

  // Idempotência: pagamento já gravado → devolve-o.
  const existing = await this.prisma.order.findUnique({ where: { clientEventId: body.client_event_id } })
  if (existing) return { orderId: existing.id, settled: session.status === 'paid', remainingGross: 0, duplicate: true }

  const items: TabItemInput[] = session.bestellungen.flatMap((b) => b.items.map((i) => ({ productId: i.productId, qty: i.qty, unitNet: i.unitNet, mwstRate: Number(i.mwstRate), mwstCode: i.mwstCode })))
  const fullTab = aggregateTab(items)
  const paid = paidByRate(session.orders.map((o) => ({ items: o.items.map((i) => ({ unitNet: i.unitNet, qty: i.qty, mwstRate: Number(i.mwstRate) })) })))
  const paidGross = paid.reduce((s, p) => s + p.gross, 0)
  const remainingGross = fullTab.totalGross - paidGross
  if (remainingGross <= 0) throw new ConflictException('session already settled')

  const amount = body.amount ?? remainingGross
  if (amount <= 0 || amount > remainingGross) throw new BadRequestException('invalid amount')

  let eventItems: { product_id: string; qty: number; unit_net: number; mwst_rate: number; mwst_code: string }[]
  let totals: { net: number; mwst: number; gross: number }
  if (amount === remainingGross && session.orders.length === 0) {
    // pagamento integral sem parciais anteriores → Beleg itemizado real (1a-1)
    const lines = fullTab.lines.filter((l) => l.qty !== 0)
    eventItems = lines.map((l) => ({ product_id: l.productId, qty: l.qty, unit_net: Math.round(l.net / l.qty), mwst_rate: l.mwstRate, mwst_code: l.mwstCode }))
    totals = { net: fullTab.totalNet, mwst: fullTab.totalMwst, gross: fullTab.totalGross }
  } else {
    const split = apportionSplit(fullTab, paid.map((p) => ({ rate: p.rate, net: p.net })), amount)
    eventItems = split.lines.map((l) => ({ product_id: l.productId, qty: l.qty, unit_net: l.unitNet, mwst_rate: l.mwstRate, mwst_code: l.mwstCode }))
    totals = { net: split.totalNet, mwst: split.totalMwst, gross: split.totalGross }
  }

  const saleEvent: SaleEvent = {
    client_event_id: body.client_event_id, type: 'sale', kasse_id: session.kasseId,
    payload: {
      order: { mode: 'im_haus', table_id: session.tischId, tisch_session_id: session.id, total_net: totals.net, total_mwst: totals.mwst, total_gross: totals.gross },
      items: eventItems,
      payment: { method: 'cash', amount: totals.gross },
      receipt: { qr_payload: '', format: 'digital' },
      tse_transaction: body.tse as SaleEvent['payload']['tse_transaction'],
    },
  }
  const result = await this.ledger.ingest(saleEvent, actor)
  const newRemaining = remainingGross - totals.gross
  if (newRemaining <= 0) {
    await this.prisma.tischsession.update({ where: { id: sessionId }, data: { status: 'paid', closedAt: new Date(), orderId: result.orderId } })
  }
  return { orderId: result.orderId, settled: newRemaining <= 0, remainingGross: Math.max(0, newRemaining), duplicate: result.duplicate }
}
```

- [ ] **Step 5: controller PayDto ganha `amount?`**

Em `tables.controller.ts`, no `PayDto`:
```ts
const PayDto = z.object({
  client_event_id: z.string().uuid(),
  amount: z.number().int().positive().optional(),
  payment: z.object({ method: z.literal('cash'), amount: z.number().int(), ref: z.string().optional() }),
  tse: z.record(z.unknown()),
})
```

- [ ] **Step 6: Run + typecheck**

Run: `corepack pnpm --filter @gelato/api exec vitest run test/tables.e2e.test.ts` → PASS (todos, incl. split + overpay).
Run: `corepack pnpm exec tsc --noEmit -p apps/api/tsconfig.json` → sem erros.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/tables/tables.service.ts apps/api/src/tables/tables.controller.ts apps/api/test/tables.e2e.test.ts
git commit -m "feat(api): pay generalizado (split por valor, remaining derivado, paid so ao quitar)"
```

---

## Chunk 4: transferência (Tisch umbuchen)

### Task 4.1: `POST /pos/sessions/:id/transfer`

**Files:**
- Modify: `apps/api/src/tables/tables.service.ts`, `tables.controller.ts`
- Test: `apps/api/test/tables.e2e.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('transfers a whole tab to another free table (409 if target occupied)', async () => {
  const a = `tisch-${crypto.randomUUID().slice(0, 8)}`
  const b = `tisch-${crypto.randomUUID().slice(0, 8)}`
  await prisma.tisch.create({ data: { id: a, betriebsstaetteId: 'demo-bs', name: 'A' } })
  await prisma.tisch.create({ data: { id: b, betriebsstaetteId: 'demo-bs', name: 'B' } })
  const sessionId = ((await (await post(`/pos/tables/${a}/open`, { kasse_id: 'demo-kasse' })).json()) as { id: string }).id
  // move A -> B
  expect((await post(`/pos/sessions/${sessionId}/transfer`, { target_tisch_id: b })).status).toBe(200)
  const moved = (await (await get(`/pos/sessions/${sessionId}`)).json()) as { tischId: string }
  expect(moved.tischId).toBe(b)
  // abrir conta em B (agora ocupada) e tentar transferir outra p/ B → 409
  const c = `tisch-${crypto.randomUUID().slice(0, 8)}`
  await prisma.tisch.create({ data: { id: c, betriebsstaetteId: 'demo-bs', name: 'C' } })
  const s2 = ((await (await post(`/pos/tables/${c}/open`, { kasse_id: 'demo-kasse' })).json()) as { id: string }).id
  expect((await post(`/pos/sessions/${s2}/transfer`, { target_tisch_id: b })).status).toBe(409)
})
```

- [ ] **Step 2: Run** → FAIL (rota inexistente).

- [ ] **Step 3: Implementar — service**

```ts
async transfer(sessionId: string, targetTischId: string, userId?: string) {
  const session = await this.prisma.tischsession.findUnique({ where: { id: sessionId } })
  if (!session) throw new NotFoundException('session')
  if (session.status !== 'open') throw new ConflictException('session not open')
  const occupied = await this.prisma.tischsession.findFirst({ where: { tischId: targetTischId, status: 'open' } })
  if (occupied) throw new ConflictException('target table occupied')
  await this.prisma.tischsession.update({ where: { id: sessionId }, data: { tischId: targetTischId } })
  await this.prisma.auditLog.create({ data: { userId, action: 'pos.table.transfer', entity: 'tischsession', entityId: sessionId, payload: { from: session.tischId, to: targetTischId } } })
  return { id: sessionId, tischId: targetTischId }
}
```

- [ ] **Step 4: controller** — adicionar:
```ts
@Post('sessions/:id/transfer')
@HttpCode(200)
@RequirePermission('pos.table.open')
async transfer(@Req() req: { user: JwtUser }, @Param('id') id: string, @Body() body: { target_tisch_id?: string }) {
  if (!body?.target_tisch_id) throw new BadRequestException('target_tisch_id required')
  return this.tables.transfer(id, body.target_tisch_id, req.user.sub)
}
```

- [ ] **Step 5: Run + typecheck + commit**

Run: `corepack pnpm --filter @gelato/api exec vitest run test/tables.e2e.test.ts` → PASS.
Run: `corepack pnpm exec tsc --noEmit -p apps/api/tsconfig.json` → sem erros.
```bash
git add apps/api/src/tables apps/api/test/tables.e2e.test.ts
git commit -m "feat(api): transferencia de conta inteira (Tisch umbuchen) + guard mesa ocupada"
```

---

## Chunk 5: pos-web + capstone

### Task 5.1: split/transfer no `TischPanel`

**Files:**
- Modify: `apps/pos-web/src/api.ts`, `apps/pos-web/src/TischPanel.tsx`

- [ ] **Step 1:** Em `api.ts`: `payTable` já existe (aceita body com `amount?`); adicionar `transferTable`:
```ts
export const transferTable = (token: string, id: string, targetTischId: string) =>
  authedPost<{ tischId: string }>(`/pos/sessions/${id}/transfer`, token, { target_tisch_id: targetTischId })
```
E `SessionView` ganha `remaining?: { totalGross: number }`.

- [ ] **Step 2:** Em `TischPanel.tsx`: adicionar botões "Split ÷N" (prompt N → amount = ceil(remaining/N), assina Kassenbeleg-V1 sobre amount, `payTable` com `amount`) e "Transferir" (prompt id da mesa destino → `transferTable`). Reusa `signWithFallback`. Mostra o remanescente quando há pagamentos parciais.

- [ ] **Step 3: typecheck + build**

Run: `corepack pnpm exec tsc --noEmit -p apps/pos-web/tsconfig.json` → sem erros.
Run: `corepack pnpm --filter @gelato/pos-web build` → ok. (Verificação visual ao vivo = sessão interativa.)

- [ ] **Step 4: Commit** `git commit -am "feat(pos-web): split (por N/valor) + transferir no TischPanel"`

### Task 5.2: capstone split + verificação

**Files:**
- Create: `apps/api/test/tische-split-capstone.e2e.test.ts`

- [ ] **Step 1: Write the failing test** — mesa → 1 Bestellung (333) → split em 3 pagamentos (com `amount`) até quitar → afirma: Σ `orders` da sessão = 333, sessão `paid`, cada order append-only (UPDATE rejeitado), idempotência de um parcial. Kasse/Tisch únicos por run.

- [ ] **Step 2: Run** → ajustar → PASS.

- [ ] **Step 3: Suíte completa** `corepack pnpm -r test` → tudo verde (ABI Node p/ pos-terminal se preciso).

- [ ] **Step 4: Commit** `git add apps/api/test/tische-split-capstone.e2e.test.ts && git commit -m "test(api): capstone split (conta -> 3 parciais -> quitada, Sigma=total, append-only)"`

---

## Definition of Done (fatia 1a-2)

- [ ] `apportionSplit` rateia e reconcilia (Σ pagamentos = conta exato); `paidByRate` agrega — testado.
- [ ] `Order.tischSessionId` gravado no INSERT (sem UPDATE fiscal) — typecheck/migração.
- [ ] `pay` aceita `amount?`, deriva remanescente, marca `paid` só ao quitar; overpay → 400 — e2e.
- [ ] Transferência de conta inteira; 409 p/ mesa ocupada — e2e.
- [ ] pos-web: split ÷N + transferir (compila/builda).
- [ ] Capstone: conta → 3 parciais → quitada, Σ = total, append-only, idempotente; `corepack pnpm -r test` verde.

## Riscos / validação externa (rastrear)

- Forma canônica de **Teilzahlung/Teilrechnung** na DSFinV-K (linhas `split:*` por alíquota) + rateio de MwSt + assinatura TSE sobre o valor exato → DFKA/Steuerberater.
