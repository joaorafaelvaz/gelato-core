# Ciclo 1 · Fatia 1b — Turnos + X/Z-Bericht — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking. Use @superpowers:test-driven-development por tarefa.

**Goal:** Turnos com gerenciamento de caixa (float/sangria/suprimento/Differenz) + X-Bericht (snapshot read-only) e Z-Bericht (Tagesabschluss por Kasse, numeração contínua) computados pelo central sobre o ledger imutável.

**Architecture:** Estende a base do Ciclo 0. Motor de relatórios puro em `packages/compliance` (reusado por X e Z). API NestJS adiciona módulos `shifts` e `reports`; o Z atribui `seqNr` contínuo por Kasse via **advisory lock** + unique constraint, e cobre os pedidos por janela de tempo (`coveredFrom`/`coveredTo`) — sem mutar orders (que são imutáveis). Tabelas fiscais novas entram na imutabilidade (REVOKE + trigger). UI de turno/X/Z nos terminais Electron e web.

**Tech Stack:** NestJS + Prisma + Postgres (`gelato_c0`) · `@gelato/compliance` (puro, vitest) · Electron/React + React (web) · Vitest + supertest.

**Convenções:** dinheiro em **cents** (Int); **127.0.0.1** (não localhost); imutabilidade no banco; TDD; commit por tarefa. Pré-requisito: `docker compose -f docker/docker-compose.yml up -d` + `prisma migrate deploy` + `db:seed` (a base do Ciclo 0 precisa estar de pé em `gelato_c0`).

---

## File Structure

```
packages/compliance/src/reports/
  types.ts        # DayTotals, VatGroup, PaymentGroup, ShiftCashInput/Result
  day-totals.ts   # computeDayTotals() — puro
  shift-cash.ts   # computeShiftCash() — puro
packages/compliance/test/{day-totals,shift-cash}.test.ts

apps/api/prisma/schema.prisma           # Shift enrich, CashMovement, z_reports (seqNr/coveredFrom/To)
apps/api/prisma/migrations/**           # + migração de imutabilidade p/ cash_movements
apps/api/src/shifts/
  shifts.service.ts  shifts.controller.ts  shifts.module.ts
apps/api/src/reports/
  reports.service.ts  reports.controller.ts  reports.module.ts
apps/api/test/{shifts,reports}.e2e.test.ts  # incl. continuidade Z-Nr + capstone

apps/pos-web/src/ + apps/pos-terminal/src/renderer/   # telas de turno/caixa/X/Z
```

---

## Chunk 1: Motor de relatórios (puro, `@gelato/compliance`)

### Task 1.1: `computeShiftCash` (Differenz)

**Files:** Create: `packages/compliance/src/reports/types.ts`, `packages/compliance/src/reports/shift-cash.ts`, `packages/compliance/test/shift-cash.test.ts`

- [ ] **Step 1: Teste falhando**

```ts
import { describe, it, expect } from 'vitest'
import { computeShiftCash } from '../src/reports/shift-cash'

describe('computeShiftCash', () => {
  it('expected = float + cashSales + suprimentos - sangrias; differenz = counted - expected', () => {
    const r = computeShiftCash({ openingFloat: 10000, cashSales: 5000, suprimentos: 2000, sangrias: 3000, counted: 13500 })
    expect(r.expected).toBe(14000) // 10000+5000+2000-3000
    expect(r.differenz).toBe(-500) // 13500-14000 (faltou)
  })
})
```

- [ ] **Step 2: Ver falhar** — `corepack pnpm --filter @gelato/compliance exec vitest run test/shift-cash.test.ts` → FAIL.
- [ ] **Step 3: Implementar** `types.ts` (`ShiftCashInput`, `ShiftCashResult`) + `shift-cash.ts`:

```ts
import type { Cents } from '@gelato/domain'
export interface ShiftCashInput { openingFloat: Cents; cashSales: Cents; suprimentos: Cents; sangrias: Cents; counted: Cents }
export interface ShiftCashResult { expected: Cents; counted: Cents; differenz: Cents }
export function computeShiftCash(i: ShiftCashInput): ShiftCashResult {
  const expected = i.openingFloat + i.cashSales + i.suprimentos - i.sangrias
  return { expected, counted: i.counted, differenz: i.counted - expected }
}
```

- [ ] **Step 4: Ver passar.** **Step 5: Commit** — `feat(compliance): shift cash Differenz`.

### Task 1.2: `computeDayTotals` (X/Z)

**Files:** Create: `packages/compliance/src/reports/day-totals.ts`, `packages/compliance/test/day-totals.test.ts`; Modify: `packages/compliance/src/index.ts` (re-export reports)

- [ ] **Step 1: Teste falhando** — agrupa por alíquota e por meio de pagamento; conta recibos/stornos; grand total acumulado.

```ts
import { computeDayTotals } from '../src/reports/day-totals'
const r = computeDayTotals({
  lines: [ { mwstRate: 0.19, net: 400, gross: 476 }, { mwstRate: 0.07, net: 100, gross: 107 } ],
  payments: [ { method: 'cash', amount: 476 }, { method: 'card', amount: 107 } ],
  receiptCount: 2, stornoCount: 0, priorGrandTotal: 1000,
})
expect(r.byVatRate).toEqual([
  { rate: 0.07, net: 100, mwst: 7, gross: 107 },
  { rate: 0.19, net: 400, mwst: 76, gross: 476 },
])
expect(r.byPayment).toEqual([{ method: 'card', amount: 107 }, { method: 'cash', amount: 476 }])
expect(r).toMatchObject({ totalNet: 500, totalMwst: 83, totalGross: 583, receiptCount: 2, stornoCount: 0, grandTotal: 1583 })
```

- [ ] **Step 2: Ver falhar.**
- [ ] **Step 3: Implementar** `day-totals.ts` — agrupa `lines` por `mwstRate` (mwst = gross−net por grupo), `payments` por `method`, ambos ordenados; soma totais; `grandTotal = priorGrandTotal + totalGross`. Tipos em `types.ts`.
- [ ] **Step 4: Ver passar** (incl. caso vazio → grupos `[]`, grandTotal = prior). **Step 5: Commit** — `feat(compliance): day totals engine (X/Z)`.

---

## Chunk 2: Modelo de dados + imutabilidade

### Task 2.1: Schema — Shift enrich, CashMovement, z_reports

**Files:** Modify: `apps/api/prisma/schema.prisma`

- [ ] **Step 1: Editar** models:
  - `Shift`: add `status String @default("open")`, `expectedCash Int?`, `differenz Int?`, `betriebsstaetteId String?`; (já tem `openingFloat Int @default(0)`, `closingCount Int?`).
  - **Novo** `CashMovement { id, shiftId, type String, amount Int, reason String?, userId String?, ts DateTime @default(now()) @@map("cash_movements") }` (+ relation Shift.cashMovements).
  - `ZReport`: add `coveredFrom DateTime`, `coveredTo DateTime` (mantém `seqNr`, `@@unique([kasseId, seqNr])`, `totals Json`).
- [ ] **Step 2: Migrar** — `cd apps/api && corepack pnpm exec prisma migrate dev --name c1b_shifts_zreports --skip-seed`. **Step 3:** validar `\d cash_movements`. **Step 4: Commit** — `feat(api): 1b data model (shift/cash_movement/z_report)`.

### Task 2.2: Imutabilidade de `cash_movements`

**Files:** Modify: a migração gerada (append SQL), ou nova migração `--create-only`; Test: `apps/api/test/immutability.test.ts` (estender)

- [ ] **Step 1: Teste** — UPDATE/DELETE em `cash_movements` (como `gelato_app`) falham; INSERT ok. (mesma forma do teste existente p/ `audit_log`.)
- [ ] **Step 2: Ver falhar** (sem trigger). **Step 3:** adicionar `cash_movements` ao array de tabelas append-only (REVOKE + trigger) numa migração SQL (`z_reports` já está). **Step 4: Ver passar.** **Step 5: Commit.**

---

## Chunk 3: API de turnos

### Task 3.1: `ShiftsService` + endpoints

**Files:** Create: `apps/api/src/shifts/{shifts.service,shifts.controller,shifts.module}.ts`; Modify: `apps/api/src/app.module.ts`; Test: `apps/api/test/shifts.e2e.test.ts`

- [ ] **Step 1: Teste e2e** (seed do C0 já cria kasse/operador):
  - `POST /pos/shifts/open` (openingFloat) com token de operador → 200, turno `open`.
  - `POST /pos/shifts/:id/cash-movement` (type `sangria`, amount) → 200 + linha em `cash_movements` + `audit_log`.
  - `POST /pos/drawer/open` → 200 + `audit_log(pos.drawer.open)`.
  - `POST /pos/shifts/:id/close` (counted) → 200, `differenz` calculado (via `computeShiftCash`, somando vendas em dinheiro do turno + movimentos), turno `closed`.
  - sem `pos.shift.open` → 403.
- [ ] **Step 2: Ver falhar.**
- [ ] **Step 3: Implementar** — `ShiftsService` usa `PrismaService` (gelato_app) + `computeShiftCash`; controller com `@RequirePermission('pos.shift.open'|'close'|'pos.drawer.open')`, `parseOrThrow` (zod). Audit via `AuditService` (já existe padrão). `cash-movement`/`drawer` gravam append-only/audit. Vendas em dinheiro do turno = soma de `payments(method=cash)` de orders com aquele `shiftId`.
- [ ] **Step 4: Ver passar.** **Step 5: Commit** — `feat(api): shifts (open/close/cash-movement/drawer) + audit`.

---

## Chunk 4: API de relatórios (X/Z) — numeração contínua

### Task 4.1: `ReportsService` — período + totais

**Files:** Create: `apps/api/src/reports/reports.service.ts`

- [ ] **Step 1:** método `periodTotals(kasseId, from, to)` — busca `order_items` (join orders por kasse + `ts ∈ [from,to)`) → mapeia p/ `lines {mwstRate, net, gross}`; `payments`; `receiptCount` (orders); `stornoCount`; `priorGrandTotal` (soma `totalGross` de orders da kasse com `ts < from`). Chama `computeDayTotals`. Função fina sobre o ledger.
- [ ] **Step 2: Commit** (coberto pelos testes de 4.2/4.3).

### Task 4.2: `POST /pos/reports/x` (snapshot read-only)

**Files:** Create/Modify: `apps/api/src/reports/{reports.controller,reports.module}.ts`; Modify: `app.module.ts`; Test: `apps/api/test/reports.e2e.test.ts`

- [ ] **Step 1: Teste e2e** — após algumas vendas: `POST /pos/reports/x` (kasseId) → 200, totais batem; **não cria** linha em `z_reports` (count inalterado); RBAC `pos.report.x`.
- [ ] **Step 2..4:** X usa `periodTotals(kasse, lastZ.coveredTo ?? epoch, now)`; retorna sem persistir. **Step 5: Commit.**

### Task 4.3: `POST /pos/reports/z` — numeração + persistência

**Files:** Modify: `apps/api/src/reports/reports.service.ts`, `reports.controller.ts`; Test: `apps/api/test/reports.e2e.test.ts`

- [ ] **Step 1: Teste e2e (o crítico):**
  - Primeiro `Z` da kasse → `seqNr=1`, `coveredFrom=epoch`, `coveredTo≈now`, totais = vendas até agora.
  - Vender mais → segundo `Z` → `seqNr=2`, cobre **só** os pedidos desde o 1º Z.
  - **Concorrência:** dois `POST /pos/reports/z` em paralelo (`Promise.all`) → seqs `{1,2}` distintos, **sem duplicata** (zero erros de unique não tratados).
  - RBAC `pos.report.z`; `z_reports` imutável (já testado).
- [ ] **Step 2: Ver falhar.**
- [ ] **Step 3: Implementar** numa transação Prisma:

```ts
await this.prisma.$transaction(async (tx) => {
  // serializa geração de Z por Kasse (evita gaps/dupes sob concorrência)
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${kasseId}, 0))`
  const last = await tx.zReport.findFirst({ where: { kasseId }, orderBy: { seqNr: 'desc' } })
  const seqNr = (last?.seqNr ?? 0) + 1
  const from = last?.coveredTo ?? new Date(0)
  const to = new Date()
  const totals = await this.periodTotals(kasseId, from, to, tx)
  return tx.zReport.create({ data: { kasseId, seqNr, coveredFrom: from, coveredTo: to, totals, businessDay: to } })
})
```

  (`@@unique([kasseId, seqNr])` é o backstop; o advisory lock é a garantia primária.)
- [ ] **Step 4: Ver passar.** **Step 5: Commit** — `feat(api): X/Z reports with continuous Z numbering`.

---

## Chunk 5: UI de turno / caixa / X/Z (terminais)

### Task 5.1: pos-web

**Files:** Modify: `apps/pos-web/src/App.tsx` (+ `src/api.ts`)

- [ ] **Step 1:** após login, antes de vender, exigir **turno aberto**: tela "Abrir turno" (openingFloat). Botões: **Sangria/Suprimento**, **Gaveta**, **X-Bericht** (exibe snapshot), **Z-Bericht** (exibe Z numerado), **Fechar turno** (counted → mostra Differenz). Chama os endpoints via `fetch` com token.
- [ ] **Step 2:** smoke test de render onde fizer sentido; `vite build` verde.
- [ ] **Step 3: Commit** — `feat(pos-web): shift + cash + X/Z UI`.

### Task 5.2: pos-terminal (Electron)

**Files:** Modify: `apps/pos-terminal/src/renderer/App.tsx`, `electron/main.ts` (IPC) ou chamar a API direto do renderer

- [ ] Espelhar a UI do web (turno/caixa/X/Z). `electron-vite build` verde. **Commit.**

---

## Chunk 6: Capstone E2E + verificação

### Task 6.1: Capstone

**Files:** Test: `apps/api/test/shift-zbericht-capstone.e2e.test.ts`

- [ ] **Step 1: Teste** — fluxo completo: abrir turno (float) → 2 vendas (`/pos/sync`, im_haus e ausser_haus) → sangria → **X** (totais batem, não persiste) → **fechar turno** (Differenz correto) → **Z** (`seqNr=1`, `byVatRate` com 19% e 7%, `byPayment` com cash, `grandTotal` correto, cobre as 2 vendas). Segundo dia: nova venda → **Z** `seqNr=2` cobre só a nova.
- [ ] **Step 2..4:** TDD. **Step 5: Commit.**

### Task 6.2: Verificação final
- [ ] `corepack pnpm -r test` verde (pacotes + api, com `gelato_c0` de pé).
- [ ] DoD: turno completo com Differenz; X read-only; **Z-Nr contínuo e sem gaps**; totais por alíquota/pagamento/grand-total batem com o ledger; imutabilidade de `cash_movements`/`z_reports` provada; UI nos dois terminais buildando.

---

## Riscos / validações externas (rastrear)
- Campos exatos do Z-Bericht + se o Tagesabschluss exige assinatura TSE → **Steuerberater** + spec **DSFinV-K** (fatia 1c).
- Regra de corte do dia fiscal (Geschäftstag) e retenção.
- **Z offline** (terminal sem rede no fechamento) → fatia **1d** (TSE-Ausfall); no 1b o Z exige conectividade.

## Notas de execução
- Nova branch sugerida: `ciclo-1b` (a partir de `ciclo-0` ou `main` após o merge do PR #1).
- Pré-requisito de testes: Postgres `gelato_c0` de pé + migrações + seed. Lembrar do ABI do `better-sqlite3` (Node p/ testes; ver CLAUDE.md) ao mexer no terminal Electron.
