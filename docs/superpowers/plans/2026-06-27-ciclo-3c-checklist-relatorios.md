# Ciclo 3 · Fatia 3c — Relatórios HACCP + pendentes/atrasados — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Status operacional (template atrasado por recorrência) + log de desvios HACCP, como leitura derivada. Fecha o Ciclo 3.

**Architecture:** Pura `isOverdue` em `@gelato/compliance` → `GET /checklists/status` (último run + overdue por template) + `GET /checklists/deviations` (resultados !ok com ação corretiva) no módulo `checklists` → componente "Relatórios HACCP" no backoffice. **Nada materializado.**

**Tech Stack:** TypeScript strict, vitest, NestJS, Prisma + Postgres (**5433**), React/Vite.

**Spec:** `docs/superpowers/specs/2026-06-27-ciclo-3c-checklist-relatorios-design.md`

**Pré-requisitos:** Postgres up (`docker compose -f docker/docker-compose.yml -p gelato_c0 up -d`, 5433; se o Docker Desktop estiver fora, `Start-Process "C:\Program Files\Docker\Docker\Docker Desktop.exe"` e aguardar o engine); branch `ciclo-3c` (off `main`).

---

## Chunk 1: `isOverdue` (puro)

**Files:**
- Create: `packages/compliance/src/checklist/schedule.ts`
- Create: `packages/compliance/test/checklist-schedule.test.ts`
- Modify: `packages/compliance/src/index.ts` (`export * from './checklist/schedule'`)

- [ ] **Step 1: Write the failing test**

`packages/compliance/test/checklist-schedule.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { isOverdue } from '../src/checklist/schedule'

const DAY = 86_400_000
const now = 20_000 * DAY + 50_000_000 // um instante qualquer dentro de um dia UTC

describe('isOverdue', () => {
  it('daily: overdue when never run or last run is an earlier UTC day', () => {
    expect(isOverdue('daily', null, now)).toBe(true)
    expect(isOverdue('daily', now - 1000, now)).toBe(false) // mesmo dia
    expect(isOverdue('daily', now - DAY, now)).toBe(true) // ontem
  })

  it('weekly: overdue across week buckets', () => {
    expect(isOverdue('weekly', null, now)).toBe(true)
    expect(isOverdue('weekly', now - DAY, now)).toBe(false) // mesma semana (provável)
    expect(isOverdue('weekly', now - 8 * DAY, now)).toBe(true) // semana anterior
  })

  it('per_shift / on_event / unknown: never overdue', () => {
    expect(isOverdue('per_shift', null, now)).toBe(false)
    expect(isOverdue('on_event', null, now)).toBe(false)
    expect(isOverdue('whatever', null, now)).toBe(false)
  })
})
```
> Nota: `now` é alinhado para que `now` e `now - DAY` caiam em buckets de semana distintos só quando
> a diferença cruza a fronteira; por isso o teste weekly usa 8*DAY (garante bucket anterior) e 1*DAY
> (mesma semana, dado o offset de 50_000_000 ms ≈ 0,58 dia dentro do dia).

- [ ] **Step 2: Run to verify it fails**

Run: `corepack pnpm --filter @gelato/compliance exec vitest run checklist-schedule`
Expected: FAIL — import inexistente.

- [ ] **Step 3: Implement**

`packages/compliance/src/checklist/schedule.ts`:
```ts
const DAY_MS = 86_400_000

/**
 * Um template está "atrasado"? Heurística por buckets UTC. Puro (recebe nowMs).
 * - daily: nunca rodou OU o último run é de um dia (UTC) anterior ao de agora.
 * - weekly: idem por semana (bucket de 7 dias).
 * - per_shift/on_event/outro: nunca atrasado (não agendado por tempo).
 */
export function isOverdue(recurrence: string, lastRunMs: number | null, nowMs: number): boolean {
  const bucket = (ms: number, size: number): number => Math.floor(ms / size)
  if (recurrence === 'daily') {
    return lastRunMs == null || bucket(lastRunMs, DAY_MS) < bucket(nowMs, DAY_MS)
  }
  if (recurrence === 'weekly') {
    return lastRunMs == null || bucket(lastRunMs, 7 * DAY_MS) < bucket(nowMs, 7 * DAY_MS)
  }
  return false
}
```

- [ ] **Step 4: Export** — `packages/compliance/src/index.ts`: `export * from './checklist/schedule'`

- [ ] **Step 5: Run to verify it passes**

Run: `corepack pnpm --filter @gelato/compliance exec vitest run checklist-schedule`
Expected: PASS (3 testes).

- [ ] **Step 6: Build dist**

Run: `corepack pnpm --filter @gelato/compliance build`

- [ ] **Step 7: Commit**

```bash
git add packages/compliance/src/checklist/schedule.ts packages/compliance/test/checklist-schedule.test.ts packages/compliance/src/index.ts
git commit -m "feat(compliance): isOverdue — recorrência de checklist (puro)"
```

---

## Chunk 2: `GET /checklists/status` + `GET /checklists/deviations` + e2e + capstone

**Files:**
- Modify: `apps/api/src/checklists/checklists.service.ts` (status + deviations)
- Modify: `apps/api/src/checklists/checklists.controller.ts` (rotas)
- Create: `apps/api/test/checklist-reports.e2e.test.ts`
- Create: `apps/api/test/checklist-reports-capstone.e2e.test.ts`

> **Ordem das rotas:** `@Get('status')`/`@Get('deviations')` são paths estáticos — sem conflito com
> `@Get('templates')`/`@Get('runs')`.

- [ ] **Step 1: Write the failing e2e**

`apps/api/test/checklist-reports.e2e.test.ts`:
```ts
import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AppModule } from '../src/app.module'

describe('Checklist reports (e2e)', () => {
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

  async function makeTemplate(): Promise<{ templateId: string; boolTask: string; tempTask: string }> {
    const id = ((await (await post('/checklists/templates', {
      name: `Rep-${crypto.randomUUID().slice(0, 8)}`, recurrence: 'daily',
      tasks: [{ label: 'H', type: 'boolean' }, { label: 'KV', type: 'temperature', valid_min: 200, valid_max: 700 }],
    })).json()) as { id: string }).id
    const tpl = ((await (await get('/checklists/templates')).json()) as { id: string; tasks: { id: string; type: string }[] }[]).find((t) => t.id === id)!
    return { templateId: id, boolTask: tpl.tasks.find((t) => t.type === 'boolean')!.id, tempTask: tpl.tasks.find((t) => t.type === 'temperature')!.id }
  }

  it('status: a template with no run is overdue (daily)', async () => {
    const { templateId } = await makeTemplate()
    const status = (await (await get('/checklists/status')).json()) as { templateId: string; overdue: boolean; lastRunAt: string | null; lastStatus: string | null }[]
    const row = status.find((s) => s.templateId === templateId)!
    expect(row.overdue).toBe(true)
    expect(row.lastRunAt).toBeNull()
    expect(row.lastStatus).toBeNull()
  })

  it('status: after a run, not overdue and reflects last status', async () => {
    const { templateId, boolTask, tempTask } = await makeTemplate()
    await post('/checklists/runs', { client_event_id: crypto.randomUUID(), template_id: templateId, kasse_id: 'demo-kasse', results: [{ task_id: boolTask, value_bool: true }, { task_id: tempTask, value_num: 500 }] })
    const row = ((await (await get('/checklists/status')).json()) as { templateId: string; overdue: boolean; lastStatus: string | null }[]).find((s) => s.templateId === templateId)!
    expect(row.overdue).toBe(false)
    expect(row.lastStatus).toBe('ok')
  })

  it('deviations: an out-of-range result appears with its corrective action', async () => {
    const { templateId, boolTask, tempTask } = await makeTemplate()
    await post('/checklists/runs', { client_event_id: crypto.randomUUID(), template_id: templateId, kasse_id: 'demo-kasse', results: [{ task_id: boolTask, value_bool: true }, { task_id: tempTask, value_num: 950, corrective_action: 'nachgestellt' }] })
    const devs = (await (await get('/checklists/deviations')).json()) as { templateId: string; label: string; reading: string | null; correctiveAction: string | null; valueNum: number | null }[]
    const d = devs.find((x) => x.templateId === templateId)!
    expect(d.label).toBe('KV')
    expect(d.reading).toBe('too_high')
    expect(d.valueNum).toBe(950)
    expect(d.correctiveAction).toBe('nachgestellt')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `corepack pnpm --filter @gelato/api exec vitest run checklist-reports.e2e`
Expected: FAIL — rotas inexistentes.

- [ ] **Step 3: Implement the service** (adicionar a `apps/api/src/checklists/checklists.service.ts`)

Import (juntar ao import de `@gelato/compliance` existente):
```ts
import { isValidTaskDefinition, evaluateResult, isOverdue, type ChecklistTaskType } from '@gelato/compliance'
```
Métodos (dentro da classe):
```ts
  async status(tenantId: string) {
    const templates = await this.prisma.checklistTemplate.findMany({ where: { tenantId, active: true }, orderBy: { name: 'asc' } })
    const now = Date.now()
    const out = []
    for (const t of templates) {
      const last = await this.prisma.checklistRun.findFirst({ where: { tenantId, templateId: t.id }, orderBy: { completedAt: 'desc' } })
      out.push({
        templateId: t.id,
        name: t.name,
        recurrence: t.recurrence,
        lastRunAt: last?.completedAt ?? null,
        lastStatus: last?.status ?? null,
        overdue: isOverdue(t.recurrence, last ? last.completedAt.getTime() : null, now),
      })
    }
    return out
  }

  async deviations(tenantId: string, from?: string, to?: string) {
    const completedAt = from || to ? { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } : undefined
    const results = await this.prisma.checklistTaskResult.findMany({
      where: { ok: false, run: { tenantId, ...(completedAt ? { completedAt } : {}) } },
      include: { run: true },
      orderBy: { run: { completedAt: 'desc' } },
    })
    return results.map((r) => ({
      runId: r.runId,
      templateId: r.run.templateId,
      completedAt: r.run.completedAt,
      label: r.label,
      type: r.type,
      valueNum: r.valueNum,
      reading: r.reading,
      correctiveAction: r.correctiveAction,
    }))
  }
```

- [ ] **Step 4: Controller — rotas** (adicionar a `apps/api/src/checklists/checklists.controller.ts`, dentro da classe)
```ts
  @Get('status')
  @RequirePermission('checklist.view')
  async status(@Req() req: { user: JwtUser }) {
    return this.checklists.status(req.user.tenant_id)
  }

  @Get('deviations')
  @RequirePermission('checklist.view')
  async deviations(@Req() req: { user: JwtUser }, @Query('from') from?: string, @Query('to') to?: string) {
    return this.checklists.deviations(req.user.tenant_id, from, to)
  }
```
> `Query` já foi importado na 3b.

- [ ] **Step 5: Run to verify it passes**

Run: `corepack pnpm --filter @gelato/api exec vitest run checklist-reports.e2e`
Expected: PASS (3 testes).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/checklists apps/api/test/checklist-reports.e2e.test.ts
git commit -m "feat(api): GET /checklists/status + /checklists/deviations — relatórios HACCP (derivado)"
```

- [ ] **Step 7: Write the capstone**

`apps/api/test/checklist-reports-capstone.e2e.test.ts`:
```ts
import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AppModule } from '../src/app.module'

// Capstone 3c: template diário → status atrasado → run limpo (atrasado→false, ok)
// → run com desvio (Kühlvitrine fora) → o desvio + ação corretiva no log.
describe('Checklist reports capstone (e2e)', () => {
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
  const statusOf = async (id: string) => ((await (await get('/checklists/status')).json()) as { templateId: string; overdue: boolean; lastStatus: string | null }[]).find((s) => s.templateId === id)!

  it('drives a template from overdue → clean → records a deviation in the log', async () => {
    const tid = ((await (await post('/checklists/templates', {
      name: `Cap-${crypto.randomUUID().slice(0, 8)}`, recurrence: 'daily',
      tasks: [{ label: 'H', type: 'boolean' }, { label: 'KV', type: 'temperature', valid_min: 200, valid_max: 700 }],
    })).json()) as { id: string }).id
    const tpl = ((await (await get('/checklists/templates')).json()) as { id: string; tasks: { id: string; type: string }[] }[]).find((t) => t.id === tid)!
    const boolTask = tpl.tasks.find((t) => t.type === 'boolean')!.id
    const tempTask = tpl.tasks.find((t) => t.type === 'temperature')!.id

    expect((await statusOf(tid)).overdue).toBe(true) // sem run → atrasado

    await post('/checklists/runs', { client_event_id: crypto.randomUUID(), template_id: tid, kasse_id: 'demo-kasse', results: [{ task_id: boolTask, value_bool: true }, { task_id: tempTask, value_num: 500 }] })
    const afterClean = await statusOf(tid)
    expect(afterClean.overdue).toBe(false)
    expect(afterClean.lastStatus).toBe('ok')

    await post('/checklists/runs', { client_event_id: crypto.randomUUID(), template_id: tid, kasse_id: 'demo-kasse', results: [{ task_id: boolTask, value_bool: true }, { task_id: tempTask, value_num: 950, corrective_action: 'Kühlung geprüft' }] })
    expect((await statusOf(tid)).lastStatus).toBe('deviations')

    const devs = (await (await get('/checklists/deviations')).json()) as { templateId: string; label: string; reading: string | null; correctiveAction: string | null }[]
    const d = devs.filter((x) => x.templateId === tid)
    expect(d).toHaveLength(1)
    expect(d[0].reading).toBe('too_high')
    expect(d[0].correctiveAction).toBe('Kühlung geprüft')
  })
})
```

- [ ] **Step 8: Run capstone + full API suite**

Run: `corepack pnpm --filter @gelato/api exec vitest run checklist-reports-capstone`
Then: `corepack pnpm --filter @gelato/api exec vitest run`
Expected: ambos verdes.

- [ ] **Step 9: Commit**

```bash
git add apps/api/test/checklist-reports-capstone.e2e.test.ts
git commit -m "test(api): checklist reports capstone (atrasado -> limpo -> desvio no log)"
```

---

## Chunk 3: backoffice (Relatórios HACCP) + integração (fecha o Ciclo 3)

**Files:**
- Modify: `apps/backoffice/src/api.ts` (tipos `ChecklistStatusRow` + `ChecklistDeviationRow`)
- Modify: `apps/backoffice/src/App.tsx` (componente `ChecklistReports`)

- [ ] **Step 1: Tipos no backoffice api**

Modify `apps/backoffice/src/api.ts` — adicionar:
```ts
export interface ChecklistStatusRow {
  templateId: string
  name: string
  recurrence: string
  lastRunAt: string | null
  lastStatus: string | null
  overdue: boolean
}
export interface ChecklistDeviationRow {
  runId: string
  templateId: string
  completedAt: string
  label: string
  type: string
  valueNum: number | null
  reading: string | null
  correctiveAction: string | null
}
```

- [ ] **Step 2: Componente `ChecklistReports`**

Modify `apps/backoffice/src/App.tsx`:
1. Import: incluir `type ChecklistStatusRow, type ChecklistDeviationRow` no import do `./api`.
2. Renderizar `<ChecklistReports token={token} />` logo após `<Checklists token={token} />`.
3. Componente (read-only):
```tsx
function ChecklistReports({ token }: { token: string }) {
  const [status, setStatus] = useState<ChecklistStatusRow[]>([])
  const [devs, setDevs] = useState<ChecklistDeviationRow[]>([])
  useEffect(() => {
    apiGet<ChecklistStatusRow[]>('/checklists/status', token).then(setStatus).catch(() => setStatus([]))
    apiGet<ChecklistDeviationRow[]>('/checklists/deviations', token).then(setDevs).catch(() => setDevs([]))
  }, [token])

  const fmtC = (d: number | null) => (d == null ? '' : `${d < 0 ? '-' : ''}${Math.floor(Math.abs(d) / 10)},${Math.abs(d) % 10} °C`)

  return (
    <section style={{ marginTop: '2rem' }}>
      <h2>Relatórios HACCP</h2>
      <h3>Status</h3>
      <table>
        <thead><tr><th>Checklist</th><th>Recorrência</th><th>Último</th><th>Estado</th></tr></thead>
        <tbody>
          {status.map((s) => (
            <tr key={s.templateId} style={s.overdue ? { color: '#b91c1c', fontWeight: 700 } : undefined}>
              <td>{s.name}</td>
              <td>{s.recurrence}</td>
              <td>{s.lastRunAt ? new Date(s.lastRunAt).toLocaleString('de-DE') : '—'}</td>
              <td>{s.overdue ? 'ATRASADO' : (s.lastStatus ?? '—')}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3>Desvios recentes</h3>
      <ul>
        {devs.map((d, i) => (
          <li key={`${d.runId}-${i}`}>
            {new Date(d.completedAt).toLocaleString('de-DE')} — {d.label}
            {d.type === 'temperature' ? ` ${fmtC(d.valueNum)} (${d.reading})` : ''}
            {d.correctiveAction ? ` → ${d.correctiveAction}` : ''}
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
git commit -m "feat(backoffice): Relatórios HACCP (status/pendentes + log de desvios)"
```

- [ ] **Step 5: Suíte completa + integração (fecha o Ciclo 3)**

```bash
corepack pnpm -r test
git checkout main
git merge --ff-only ciclo-3c
git push origin main
git branch -d ciclo-3c
```
> Manter `docker/docker-compose.yml` (5433) e `.claude/` fora do commit.

---

## Notas de verificação / riscos

- **Derivado, não materializado:** `status`/`deviations` recomputam dos runs a cada chamada.
- **`overdue` heurístico:** buckets UTC (daily/weekly); `per_shift`/`on_event` nunca atrasados; TZ
  Europe/Berlin = validação externa.
- **`orderBy: { run: { completedAt: 'desc' } }`** (ordenar por campo de relação) é suportado pelo Prisma.
- **Templates inativos** fora do status (só `active: true`).
- **Dist do compliance** rebuildado no Chunk 1.
- **Fecha o Ciclo 3** (3a Templates + 3b Execução + 3c Relatórios).
```
