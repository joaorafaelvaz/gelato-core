# Ciclo 3 · Fatia 3b — Execução de checklist + classificação HACCP — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Executar um checklist HACCP (submissão única, append-only), classificando cada leitura (temperatura vs faixa, higiene feita/não) e exigindo ação corretiva no desvio.

**Architecture:** Puras `classifyReading`/`evaluateResult` em `@gelato/compliance` → `ChecklistRun` + `ChecklistTaskResult` (append-only, trigger+grant) que **fotografam** a def da tarefa → `POST/GET /checklists/runs` no módulo `checklists` (RBAC `checklist.execute/view`) → form de execução + histórico no backoffice. Idempotente via `client_event_id`. Temperatura **inteira em decigraus**.

**Tech Stack:** TypeScript strict, vitest, NestJS, Prisma + Postgres (**5433**), zod, React/Vite.

**Spec:** `docs/superpowers/specs/2026-06-27-ciclo-3b-checklist-execucao-design.md`

**Pré-requisitos:** Postgres up (`docker compose -f docker/docker-compose.yml -p gelato_c0 up -d`, 5433); branch `ciclo-3b` (off `main`). Se o Docker Desktop estiver fora: `Start-Process "C:\Program Files\Docker\Docker\Docker Desktop.exe"`, aguardar o engine, depois subir o Postgres.

---

## Chunk 1: `classifyReading` + `evaluateResult` (puro)

**Files:**
- Create: `packages/compliance/src/checklist/result.ts`
- Create: `packages/compliance/test/checklist-result.test.ts`
- Modify: `packages/compliance/src/index.ts` (`export * from './checklist/result'`)

- [ ] **Step 1: Write the failing test**

`packages/compliance/test/checklist-result.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { classifyReading, evaluateResult } from '../src/checklist/result'

describe('classifyReading', () => {
  it('classifies value against the range (boundaries inclusive)', () => {
    expect(classifyReading(-2000, -2200, -1800)).toBe('in_range')
    expect(classifyReading(-2200, -2200, -1800)).toBe('in_range') // == min
    expect(classifyReading(-1800, -2200, -1800)).toBe('in_range') // == max
    expect(classifyReading(-2300, -2200, -1800)).toBe('too_low')
    expect(classifyReading(900, 200, 700)).toBe('too_high')
  })
})

describe('evaluateResult', () => {
  it('boolean: ok only when true', () => {
    expect(evaluateResult({ type: 'boolean', valueBool: true })).toEqual({ ok: true, reading: null })
    expect(evaluateResult({ type: 'boolean', valueBool: false })).toEqual({ ok: false, reading: null })
  })
  it('temperature: ok only in range, exposes reading', () => {
    expect(evaluateResult({ type: 'temperature', valueNum: 500, validMin: 200, validMax: 700 })).toEqual({ ok: true, reading: 'in_range' })
    expect(evaluateResult({ type: 'temperature', valueNum: 900, validMin: 200, validMax: 700 })).toEqual({ ok: false, reading: 'too_high' })
    expect(evaluateResult({ type: 'temperature', valueNum: null, validMin: 200, validMax: 700 })).toEqual({ ok: false, reading: null })
  })
  it('text: always ok', () => {
    expect(evaluateResult({ type: 'text', valueText: 'x' })).toEqual({ ok: true, reading: null })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `corepack pnpm --filter @gelato/compliance exec vitest run checklist-result`
Expected: FAIL — import inexistente.

- [ ] **Step 3: Implement**

`packages/compliance/src/checklist/result.ts`:
```ts
import type { ChecklistTaskType } from './task'

export type ReadingState = 'in_range' | 'too_low' | 'too_high'

/** Classifica um valor (decigraus) contra a faixa [min,max] (inclusiva). Puro. */
export function classifyReading(value: number, validMin: number, validMax: number): ReadingState {
  if (value < validMin) return 'too_low'
  if (value > validMax) return 'too_high'
  return 'in_range'
}

export interface ResultEval {
  type: ChecklistTaskType
  valueBool?: boolean | null
  valueNum?: number | null
  valueText?: string | null
  validMin?: number | null
  validMax?: number | null
}

/** Avalia um resultado: ok (passou?) + reading (só temperature). Puro. */
export function evaluateResult(r: ResultEval): { ok: boolean; reading: ReadingState | null } {
  if (r.type === 'temperature') {
    if (r.valueNum == null || r.validMin == null || r.validMax == null) return { ok: false, reading: null }
    const reading = classifyReading(r.valueNum, r.validMin, r.validMax)
    return { ok: reading === 'in_range', reading }
  }
  if (r.type === 'boolean') return { ok: r.valueBool === true, reading: null }
  return { ok: true, reading: null }
}
```

- [ ] **Step 4: Export** — `packages/compliance/src/index.ts`: `export * from './checklist/result'`

- [ ] **Step 5: Run to verify it passes**

Run: `corepack pnpm --filter @gelato/compliance exec vitest run checklist-result`
Expected: PASS (4 testes).

- [ ] **Step 6: Build dist**

Run: `corepack pnpm --filter @gelato/compliance build`

- [ ] **Step 7: Commit**

```bash
git add packages/compliance/src/checklist/result.ts packages/compliance/test/checklist-result.test.ts packages/compliance/src/index.ts
git commit -m "feat(compliance): classifyReading + evaluateResult — execução HACCP (puro)"
```

---

## Chunk 2: modelo `ChecklistRun`/`ChecklistTaskResult` (append-only) + RBAC

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/<ts>_c3b_checklist_runs/migration.sql`
- Modify: `apps/api/src/rbac/permissions.ts` (operator ganha `checklist.view`/`checklist.execute`)

- [ ] **Step 1: Adicionar os modelos**

Modify `apps/api/prisma/schema.prisma` — ao final:
```prisma
model ChecklistRun {
  id            String    @id @default(cuid())
  tenantId      String
  templateId    String
  kasseId       String
  executedBy    String?
  clientEventId String    @unique
  status        String // 'ok' | 'deviations'
  startedAt     DateTime?
  completedAt   DateTime  @default(now())
  createdAt     DateTime  @default(now())

  results ChecklistTaskResult[]

  @@map("checklist_runs")
}

model ChecklistTaskResult {
  id               String   @id @default(cuid())
  runId            String
  taskId           String
  label            String // snapshot
  type             String // snapshot
  validMin         Int? // snapshot (decigraus)
  validMax         Int? // snapshot
  valueBool        Boolean?
  valueNum         Int? // decigraus
  valueText        String?
  ok               Boolean
  reading          String? // in_range | too_low | too_high
  correctiveAction String?

  run ChecklistRun @relation(fields: [runId], references: [id])

  @@map("checklist_task_results")
}
```

- [ ] **Step 2: Validar + gerar a migração**

```bash
corepack pnpm --filter @gelato/api exec prisma validate
cd apps/api
TS=20260627160000
mkdir -p prisma/migrations/${TS}_c3b_checklist_runs
corepack pnpm exec prisma migrate diff \
  --from-schema-datasource prisma/schema.prisma \
  --to-schema-datamodel prisma/schema.prisma \
  --script > prisma/migrations/${TS}_c3b_checklist_runs/migration.sql
cd ../..
cat apps/api/prisma/migrations/20260627160000_c3b_checklist_runs/migration.sql
```
Expected: `CREATE TABLE "checklist_runs"`, `CREATE TABLE "checklist_task_results"`, o unique de `clientEventId` + FK.

- [ ] **Step 3: Anexar GRANT + triggers append-only**

Acrescentar ao final de `prisma/migrations/${TS}_c3b_checklist_runs/migration.sql`:
```sql

-- ===== Checklist execução: append-only (food-safety, reusa fiscal_append_only) =====
GRANT SELECT, INSERT ON checklist_runs, checklist_task_results TO gelato_app;
DROP TRIGGER IF EXISTS checklist_runs_append_only ON checklist_runs;
CREATE TRIGGER checklist_runs_append_only BEFORE UPDATE OR DELETE ON checklist_runs
  FOR EACH ROW EXECUTE FUNCTION fiscal_append_only();
DROP TRIGGER IF EXISTS checklist_task_results_append_only ON checklist_task_results;
CREATE TRIGGER checklist_task_results_append_only BEFORE UPDATE OR DELETE ON checklist_task_results
  FOR EACH ROW EXECUTE FUNCTION fiscal_append_only();
```

- [ ] **Step 4: Aplicar + marcar + gerar**

```bash
cd apps/api
corepack pnpm exec prisma db execute --schema prisma/schema.prisma --file prisma/migrations/20260627160000_c3b_checklist_runs/migration.sql
corepack pnpm exec prisma migrate resolve --applied 20260627160000_c3b_checklist_runs
corepack pnpm exec prisma generate
cd ../..
```

- [ ] **Step 5: RBAC — operator ganha view+execute**

Modify `apps/api/src/rbac/permissions.ts` — no `ROLE_PERMISSIONS.operator`, adicionar:
```ts
    'checklist.view',
    'checklist.execute',
```
(deixar `checklist.manage` só no `admin`.)

- [ ] **Step 6: Re-seed (aplica o role_permissions atualizado)**

Run: `corepack pnpm --filter @gelato/api db:seed`
Expected: "seed done". (O seed reconstrói `role_permissions` a partir de `ROLE_PERMISSIONS`.)

- [ ] **Step 7: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations apps/api/src/rbac/permissions.ts
git commit -m "feat(api): modelo de execução de checklist (append-only) + checklist.view/execute p/ operator"
```

---

## Chunk 3: `POST/GET /checklists/runs` + e2e + imutabilidade + capstone

**Files:**
- Modify: `apps/api/src/checklists/checklists.service.ts` (submitRun + listRuns)
- Modify: `apps/api/src/checklists/checklists.controller.ts` (rotas runs)
- Modify: `apps/api/test/immutability.test.ts` (append-only de checklist runs/results)
- Create: `apps/api/test/checklist-runs.e2e.test.ts`
- Create: `apps/api/test/checklist-runs-capstone.e2e.test.ts`

- [ ] **Step 1: Write the failing e2e**

`apps/api/test/checklist-runs.e2e.test.ts`:
```ts
import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AppModule } from '../src/app.module'

describe('Checklist runs (e2e)', () => {
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

  const post = (path: string, body: unknown, tk = token) =>
    fetch(`${baseUrl}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${tk}` }, body: JSON.stringify(body) })
  const get = (path: string) => fetch(`${baseUrl}${path}`, { headers: { authorization: `Bearer ${token}` } })

  // Cria um template com 1 boolean + 1 temperature e devolve os ids das tarefas.
  async function makeTemplate(): Promise<{ templateId: string; boolTask: string; tempTask: string }> {
    const name = `R-${crypto.randomUUID().slice(0, 8)}`
    const templateId = ((await (await post('/checklists/templates', {
      name, tasks: [
        { label: 'Hände?', type: 'boolean' },
        { label: 'KV', type: 'temperature', valid_min: 200, valid_max: 700 },
      ],
    })).json()) as { id: string }).id
    const tpl = ((await (await get('/checklists/templates')).json()) as { id: string; tasks: { id: string; type: string }[] }[]).find((t) => t.id === templateId)!
    return {
      templateId,
      boolTask: tpl.tasks.find((t) => t.type === 'boolean')!.id,
      tempTask: tpl.tasks.find((t) => t.type === 'temperature')!.id,
    }
  }

  it('a clean run is status ok', async () => {
    const { templateId, boolTask, tempTask } = await makeTemplate()
    const r = await post('/checklists/runs', {
      client_event_id: crypto.randomUUID(), template_id: templateId, kasse_id: 'demo-kasse',
      results: [
        { task_id: boolTask, value_bool: true },
        { task_id: tempTask, value_num: 500 },
      ],
    })
    expect(r.status).toBe(201)
    expect(((await r.json()) as { status: string }).status).toBe('ok')
  })

  it('out-of-range temperature with a corrective action → deviations', async () => {
    const { templateId, boolTask, tempTask } = await makeTemplate()
    const r = await post('/checklists/runs', {
      client_event_id: crypto.randomUUID(), template_id: templateId, kasse_id: 'demo-kasse',
      results: [
        { task_id: boolTask, value_bool: true },
        { task_id: tempTask, value_num: 900, corrective_action: 'Kühlung nachgestellt' },
      ],
    })
    expect(r.status).toBe(201)
    expect(((await r.json()) as { status: string }).status).toBe('deviations')
    const runs = (await (await get(`/checklists/runs?template_id=${templateId}`)).json()) as { results: { type: string; ok: boolean; reading: string | null; correctiveAction: string | null }[] }[]
    const temp = runs[0].results.find((x) => x.type === 'temperature')!
    expect(temp.ok).toBe(false)
    expect(temp.reading).toBe('too_high')
    expect(temp.correctiveAction).toBe('Kühlung nachgestellt')
  })

  it('a deviation without a corrective action → 400', async () => {
    const { templateId, boolTask, tempTask } = await makeTemplate()
    const r = await post('/checklists/runs', {
      client_event_id: crypto.randomUUID(), template_id: templateId, kasse_id: 'demo-kasse',
      results: [{ task_id: boolTask, value_bool: true }, { task_id: tempTask, value_num: 900 }],
    })
    expect(r.status).toBe(400)
  })

  it('a required task without a value → 400', async () => {
    const { templateId, boolTask } = await makeTemplate()
    const r = await post('/checklists/runs', {
      client_event_id: crypto.randomUUID(), template_id: templateId, kasse_id: 'demo-kasse',
      results: [{ task_id: boolTask, value_bool: true }], // falta a temperatura
    })
    expect(r.status).toBe(400)
  })

  it('is idempotent on the same client_event_id', async () => {
    const { templateId, boolTask, tempTask } = await makeTemplate()
    const cid = crypto.randomUUID()
    const body = { client_event_id: cid, template_id: templateId, kasse_id: 'demo-kasse', results: [{ task_id: boolTask, value_bool: true }, { task_id: tempTask, value_num: 500 }] }
    const id1 = ((await (await post('/checklists/runs', body)).json()) as { id: string }).id
    const r2 = (await (await post('/checklists/runs', body)).json()) as { id: string; duplicate: boolean }
    expect(r2.id).toBe(id1)
    expect(r2.duplicate).toBe(true)
    const runs = (await (await get(`/checklists/runs?template_id=${templateId}`)).json()) as unknown[]
    expect(runs.length).toBe(1)
  })

  it('an operator (PIN) can execute a run', async () => {
    const { templateId, boolTask, tempTask } = await makeTemplate()
    const opTok = ((await (await fetch(`${baseUrl}/auth/pin`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kasse_id: 'demo-kasse', pin: '1234' }) })).json()) as { access_token: string }).access_token
    const r = await post('/checklists/runs', {
      client_event_id: crypto.randomUUID(), template_id: templateId, kasse_id: 'demo-kasse',
      results: [{ task_id: boolTask, value_bool: true }, { task_id: tempTask, value_num: 500 }],
    }, opTok)
    expect(r.status).toBe(201)
  })
})
```
> O teste do operator depende do **re-seed do Chunk 2** (operator com `checklist.execute`). Se 403,
> rodar `corepack pnpm --filter @gelato/api db:seed` de novo.

- [ ] **Step 2: Run to verify it fails**

Run: `corepack pnpm --filter @gelato/api exec vitest run checklist-runs.e2e`
Expected: FAIL — rotas inexistentes.

- [ ] **Step 3: Implement the service** (adicionar a `apps/api/src/checklists/checklists.service.ts`)

Import no topo:
```ts
import { evaluateResult } from '@gelato/compliance'
```
Interface + métodos (dentro da classe):
```ts
interface ResultInput {
  task_id: string
  value_bool?: boolean | null
  value_num?: number | null
  value_text?: string | null
  corrective_action?: string | null
}
```
```ts
  async listRuns(tenantId: string, templateId?: string) {
    return this.prisma.checklistRun.findMany({
      where: { tenantId, ...(templateId ? { templateId } : {}) },
      orderBy: { completedAt: 'desc' },
      include: { results: true },
    })
  }

  async submitRun(
    tenantId: string,
    dto: { client_event_id: string; template_id: string; kasse_id: string; results: ResultInput[] },
    userId?: string,
  ): Promise<{ id: string; status: string; duplicate: boolean }> {
    const seen = await this.prisma.checklistRun.findUnique({ where: { clientEventId: dto.client_event_id } })
    if (seen) return { id: seen.id, status: seen.status, duplicate: true }

    const tpl = await this.prisma.checklistTemplate.findFirst({
      where: { id: dto.template_id, tenantId },
      include: { tasks: { where: { active: true }, orderBy: { sortOrder: 'asc' } } },
    })
    if (!tpl) throw new NotFoundException('template')

    const byTaskId = new Map(dto.results.map((r) => [r.task_id, r]))
    const resultsData: {
      taskId: string; label: string; type: string; validMin: number | null; validMax: number | null
      valueBool: boolean | null; valueNum: number | null; valueText: string | null; ok: boolean; reading: string | null; correctiveAction: string | null
    }[] = []
    let hasDeviation = false

    for (const task of tpl.tasks) {
      const r = byTaskId.get(task.id)
      if (task.required) {
        if (!r) throw new BadRequestException(`missing result for required task: ${task.label}`)
        if (task.type === 'temperature' && (r.value_num == null)) throw new BadRequestException(`missing value for: ${task.label}`)
        if (task.type === 'boolean' && (r.value_bool == null)) throw new BadRequestException(`missing value for: ${task.label}`)
      }
      if (!r) continue
      const { ok, reading } = evaluateResult({
        type: task.type as 'boolean' | 'temperature' | 'text',
        valueBool: r.value_bool ?? null,
        valueNum: r.value_num ?? null,
        valueText: r.value_text ?? null,
        validMin: task.validMin,
        validMax: task.validMax,
      })
      if (task.required && !ok && !r.corrective_action) {
        throw new BadRequestException(`corrective action required for: ${task.label}`)
      }
      if (task.required && !ok) hasDeviation = true
      resultsData.push({
        taskId: task.id, label: task.label, type: task.type, validMin: task.validMin, validMax: task.validMax,
        valueBool: r.value_bool ?? null, valueNum: r.value_num ?? null, valueText: r.value_text ?? null,
        ok, reading, correctiveAction: r.corrective_action ?? null,
      })
    }

    const run = await this.prisma.checklistRun.create({
      data: {
        tenantId, templateId: tpl.id, kasseId: dto.kasse_id, executedBy: userId,
        clientEventId: dto.client_event_id, status: hasDeviation ? 'deviations' : 'ok',
        completedAt: new Date(), results: { create: resultsData },
      },
    })
    return { id: run.id, status: run.status, duplicate: false }
  }
```
> `BadRequestException`/`NotFoundException` já estão importados no service (3a). `new Date()` é
> runtime do Nest (ok). O `status` é calculado antes do insert e nunca muda (append-only).

- [ ] **Step 4: Controller — rotas runs** (adicionar a `apps/api/src/checklists/checklists.controller.ts`)

DTOs (junto aos da 3a):
```ts
const RunResult = z.object({
  task_id: z.string().min(1),
  value_bool: z.boolean().nullish(),
  value_num: z.number().int().nullish(),
  value_text: z.string().nullish(),
  corrective_action: z.string().nullish(),
})
const RunDto = z.object({
  client_event_id: z.string().uuid(),
  template_id: z.string().min(1),
  kasse_id: z.string().min(1),
  results: z.array(RunResult).min(1),
})
```
Rotas (dentro da classe):
```ts
  @Post('runs')
  @RequirePermission('checklist.execute')
  async submitRun(@Req() req: { user: JwtUser }, @Body() body: unknown) {
    return this.checklists.submitRun(req.user.tenant_id, parseOrThrow(RunDto, body), req.user.sub)
  }

  @Get('runs')
  @RequirePermission('checklist.view')
  async listRuns(@Req() req: { user: JwtUser }, @Query('template_id') templateId?: string) {
    return this.checklists.listRuns(req.user.tenant_id, templateId)
  }
```
> Adicionar `Query` ao import de `@nestjs/common`. `POST` → 201; idempotência via service.

- [ ] **Step 5: Run to verify it passes**

Run: `corepack pnpm --filter @gelato/api exec vitest run checklist-runs.e2e`
Expected: PASS (6 testes).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/checklists apps/api/test/checklist-runs.e2e.test.ts
git commit -m "feat(api): POST/GET /checklists/runs — execução HACCP (snapshot, classificação, ação corretiva, idempotente)"
```

- [ ] **Step 7: Immutability test** — adicionar a `apps/api/test/immutability.test.ts`:

Helper (junto dos outros `insert*`):
```ts
async function insertChecklistRun(pool: Pool): Promise<{ runId: string; resultId: string }> {
  const runId = `cr_${Date.now()}_${Math.random().toString(36).slice(2)}`
  await pool.query(
    `INSERT INTO checklist_runs (id, "tenantId", "templateId", "kasseId", "clientEventId", status, "completedAt", "createdAt")
     VALUES ($1, 'demo-tenant', 'tpl-haccp-daily', 'demo-kasse', $1, 'ok', now(), now())`,
    [runId],
  )
  const resultId = `ctr_${Date.now()}_${Math.random().toString(36).slice(2)}`
  await pool.query(
    `INSERT INTO checklist_task_results (id, "runId", "taskId", label, type, ok) VALUES ($1, $2, 'task-x', 'L', 'boolean', true)`,
    [resultId, runId],
  )
  return { runId, resultId }
}
```
e dentro do `describe`:
```ts
  it('checklist_runs + results are append-only (INSERT ok, UPDATE/DELETE blocked)', async (ctx) => {
    if (!dbAvailable) return ctx.skip()
    const { runId, resultId } = await insertChecklistRun(appPool)
    await expect(appPool.query(`UPDATE checklist_runs SET status='x' WHERE id=$1`, [runId])).rejects.toThrow()
    await expect(appPool.query(`DELETE FROM checklist_runs WHERE id=$1`, [runId])).rejects.toThrow()
    await expect(appPool.query(`UPDATE checklist_task_results SET ok=false WHERE id=$1`, [resultId])).rejects.toThrow()
    await expect(appPool.query(`DELETE FROM checklist_task_results WHERE id=$1`, [resultId])).rejects.toThrow()
  })
```

- [ ] **Step 8: Run immutability**

Run: `corepack pnpm --filter @gelato/api exec vitest run immutability`
Expected: PASS (incl. o novo).

- [ ] **Step 9: Write the capstone**

`apps/api/test/checklist-runs-capstone.e2e.test.ts`:
```ts
import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AppModule } from '../src/app.module'

// Capstone 3b: executa o template HACCP diário com a Kühlvitrine a 9,0°C (=900,
// fora de 200..700) + ação corretiva → run 'deviations', reading too_high,
// snapshot da faixa preservado; um run todo em faixa → 'ok'.
describe('Checklist runs capstone (e2e)', () => {
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

  async function dailyTemplate(): Promise<{ templateId: string; tasks: Record<string, string> }> {
    const id = ((await (await post('/checklists/templates', {
      name: `Daily-${crypto.randomUUID().slice(0, 8)}`, recurrence: 'daily',
      tasks: [
        { label: 'Hände gewaschen?', type: 'boolean' },
        { label: 'Vitrine gereinigt?', type: 'boolean' },
        { label: 'Tiefkühltruhe', type: 'temperature', valid_min: -2200, valid_max: -1800 },
        { label: 'Kühlvitrine', type: 'temperature', valid_min: 200, valid_max: 700 },
        { label: 'Bemerkungen', type: 'text' },
      ],
    })).json()) as { id: string }).id
    const tpl = ((await (await get('/checklists/templates')).json()) as { id: string; tasks: { id: string; label: string }[] }[]).find((t) => t.id === id)!
    return { templateId: id, tasks: Object.fromEntries(tpl.tasks.map((t) => [t.label, t.id])) }
  }

  it('records a deviation run and a clean run', async () => {
    const { templateId, tasks } = await dailyTemplate()
    // run com desvio: Kühlvitrine a 9,0°C (900 > 700)
    const dev = await post('/checklists/runs', {
      client_event_id: crypto.randomUUID(), template_id: templateId, kasse_id: 'demo-kasse',
      results: [
        { task_id: tasks['Hände gewaschen?'], value_bool: true },
        { task_id: tasks['Vitrine gereinigt?'], value_bool: true },
        { task_id: tasks['Tiefkühltruhe'], value_num: -2000 },
        { task_id: tasks['Kühlvitrine'], value_num: 900, corrective_action: 'Kühlung nachgestellt, Ware geprüft' },
        { task_id: tasks['Bemerkungen'], value_text: 'Lieferung 8:00' },
      ],
    })
    expect(((await dev.json()) as { status: string }).status).toBe('deviations')

    // run limpo
    const clean = await post('/checklists/runs', {
      client_event_id: crypto.randomUUID(), template_id: templateId, kasse_id: 'demo-kasse',
      results: [
        { task_id: tasks['Hände gewaschen?'], value_bool: true },
        { task_id: tasks['Vitrine gereinigt?'], value_bool: true },
        { task_id: tasks['Tiefkühltruhe'], value_num: -2000 },
        { task_id: tasks['Kühlvitrine'], value_num: 500 },
      ],
    })
    expect(((await clean.json()) as { status: string }).status).toBe('ok')

    const runs = (await (await get(`/checklists/runs?template_id=${templateId}`)).json()) as { status: string; results: { label: string; type: string; validMin: number | null; reading: string | null }[] }[]
    expect(runs).toHaveLength(2)
    const devRun = runs.find((r) => r.status === 'deviations')!
    const kv = devRun.results.find((r) => r.label === 'Kühlvitrine')!
    expect(kv.reading).toBe('too_high')
    expect(kv.validMin).toBe(200) // snapshot da faixa preservado
  })
})
```

- [ ] **Step 10: Run capstone + full API suite**

Run: `corepack pnpm --filter @gelato/api exec vitest run checklist-runs-capstone`
Then: `corepack pnpm --filter @gelato/api exec vitest run`
Expected: ambos verdes.

- [ ] **Step 11: Commit**

```bash
git add apps/api/test/immutability.test.ts apps/api/test/checklist-runs-capstone.e2e.test.ts
git commit -m "test(api): checklist runs append-only + capstone (desvio + run limpo)"
```

---

## Chunk 4: backoffice (executar + histórico) + integração

**Files:**
- Modify: `apps/backoffice/src/api.ts` (tipo `ChecklistRunRow` + reuso de `apiPost`)
- Modify: `apps/backoffice/src/App.tsx` (executar + histórico no componente `Checklists`)

- [ ] **Step 1: Tipo no backoffice api**

Modify `apps/backoffice/src/api.ts` — adicionar:
```ts
export interface ChecklistRunRow {
  id: string
  templateId: string
  status: string
  completedAt: string
  results: { label: string; type: string; ok: boolean; reading: string | null }[]
}
```

- [ ] **Step 2: Executar + histórico no componente `Checklists`**

Modify `apps/backoffice/src/App.tsx` — substituir o corpo do componente `Checklists` por uma versão
com (a) seleção de template + inputs por tarefa + submit, e (b) histórico:
```tsx
function Checklists({ token }: { token: string }) {
  const [templates, setTemplates] = useState<ChecklistTemplateRow[]>([])
  const [runs, setRuns] = useState<ChecklistRunRow[]>([])
  const [selected, setSelected] = useState('')
  const [values, setValues] = useState<Record<string, { bool?: boolean; celsius?: string; text?: string; corrective?: string }>>({})
  const [error, setError] = useState('')

  const reload = (): void => {
    apiGet<ChecklistTemplateRow[]>('/checklists/templates', token).then(setTemplates).catch(() => setTemplates([]))
    apiGet<ChecklistRunRow[]>('/checklists/runs', token).then(setRuns).catch(() => setRuns([]))
  }
  useEffect(reload, [token])

  const tpl = templates.find((t) => t.id === selected)
  const set = (taskId: string, patch: Partial<{ bool: boolean; celsius: string; text: string; corrective: string }>) =>
    setValues((v) => ({ ...v, [taskId]: { ...v[taskId], ...patch } }))

  async function submit(): Promise<void> {
    if (!tpl) return
    setError('')
    const results = tpl.tasks.map((t) => {
      const v = values[t.id] ?? {}
      const r: Record<string, unknown> = { task_id: t.id }
      if (t.type === 'boolean') r.value_bool = v.bool ?? false
      if (t.type === 'temperature') r.value_num = v.celsius != null && v.celsius !== '' ? Math.round(Number(v.celsius) * 10) : null
      if (t.type === 'text') r.value_text = v.text ?? ''
      if (v.corrective) r.corrective_action = v.corrective
      return r
    })
    try {
      await apiPost('/checklists/runs', token, { client_event_id: crypto.randomUUID(), template_id: tpl.id, kasse_id: 'demo-kasse', results })
      setValues({})
      reload()
    } catch {
      setError('Falha — confira valores e ações corretivas dos desvios.')
    }
  }

  return (
    <section style={{ marginTop: '2rem' }}>
      <h2>Checklists (HACCP)</h2>
      <select value={selected} onChange={(e) => { setSelected(e.target.value); setValues({}) }}>
        <option value="">— executar template —</option>
        {templates.filter((t) => t.active).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>
      {tpl && (
        <div style={{ margin: '0.5rem 0', display: 'grid', gap: 6 }}>
          {tpl.tasks.map((t) => (
            <div key={t.id}>
              <label>
                {t.label}{' '}
                {t.type === 'boolean' && <input type="checkbox" checked={values[t.id]?.bool ?? false} onChange={(e) => set(t.id, { bool: e.target.checked })} />}
                {t.type === 'temperature' && <input type="number" step="0.1" placeholder="°C" value={values[t.id]?.celsius ?? ''} onChange={(e) => set(t.id, { celsius: e.target.value })} />}
                {t.type === 'text' && <input value={values[t.id]?.text ?? ''} onChange={(e) => set(t.id, { text: e.target.value })} />}
              </label>
              {t.type !== 'text' && (
                <input style={{ marginLeft: 8 }} placeholder="ação corretiva (se desvio)" value={values[t.id]?.corrective ?? ''} onChange={(e) => set(t.id, { corrective: e.target.value })} />
              )}
            </div>
          ))}
          <button onClick={submit}>Submeter</button>
          {error && <span style={{ color: 'crimson' }}>{error}</span>}
        </div>
      )}
      <h3>Histórico</h3>
      <ul>
        {runs.map((r) => {
          const t = templates.find((x) => x.id === r.templateId)
          const dev = r.results.filter((x) => !x.ok).length
          return (
            <li key={r.id} style={{ color: r.status === 'deviations' ? '#b91c1c' : undefined }}>
              {t?.name ?? r.templateId} — {r.status}{dev > 0 ? ` (${dev} desvio(s))` : ''} — {new Date(r.completedAt).toLocaleString('de-DE')}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
```
(adicionar `type ChecklistRunRow` ao import do `./api`; `apiPost` já é importado.)

- [ ] **Step 3: Typecheck + build**

Run: `corepack pnpm --filter @gelato/backoffice exec tsc --noEmit && corepack pnpm --filter @gelato/backoffice build`
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add apps/backoffice/src/api.ts apps/backoffice/src/App.tsx
git commit -m "feat(backoffice): executar checklist + histórico (°C->decigraus, ação corretiva)"
```

- [ ] **Step 5: Suíte completa + integração**

```bash
corepack pnpm -r test
git checkout main
git merge --ff-only ciclo-3b
git push origin main
git branch -d ciclo-3b
```
> Manter `docker/docker-compose.yml` (5433) e `.claude/` fora do commit.

---

## Notas de verificação / riscos

- **Append-only** em `checklist_runs`/`checklist_task_results` (food-safety): GRANT SELECT/INSERT +
  trigger; correção = novo run, nunca UPDATE/DELETE.
- **Idempotência:** `clientEventId @unique`; submit repetido devolve o run existente (sem duplicar).
- **Snapshot** da def da tarefa no resultado → editar o template depois não muda o histórico.
- **Ação corretiva obrigatória** só p/ tarefa **required** que não passa.
- **RBAC:** operator precisa de `checklist.execute` (re-seed no Chunk 2) — senão o teste do operator 403.
- **°C↔decigraus:** a UI coleta °C (decimal) e faz `Math.round(°C × 10)`; a API/DB são decigraus.
- **Dist do compliance** rebuildado no Chunk 1.
```
