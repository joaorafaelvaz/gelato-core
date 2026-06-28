# Ciclo 3 · Fatia 3a — Checklist Templates + Tarefas — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Modelar templates de checklist HACCP e suas tarefas (boolean/temperature/text, com faixa em decigraus), com API de gestão — a camada de definição do Ciclo 3.

**Architecture:** Puras `isValidTaskDefinition`/`formatDecidegrees` em `@gelato/compliance` → `ChecklistTemplate` + `ChecklistTask` (master **mutável**, GRANT DML) → módulo NestJS `checklists` (GET/POST/PUT templates, RBAC `checklist.*`) → seção mínima no backoffice. Temperatura **inteira em decigraus**. Execução/classificação/relatórios = 3b/3c.

**Tech Stack:** TypeScript strict, vitest, NestJS, Prisma + Postgres (**5433**), zod, React/Vite.

**Spec:** `docs/superpowers/specs/2026-06-27-ciclo-3a-checklist-templates-design.md`

**Pré-requisitos:** Postgres up (`-p gelato_c0`, 5433); branch `ciclo-3a` (off `main`).

---

## Chunk 1: `isValidTaskDefinition` + `formatDecidegrees` (puro)

**Files:**
- Create: `packages/compliance/src/checklist/task.ts`
- Create: `packages/compliance/test/checklist-task.test.ts`
- Modify: `packages/compliance/src/index.ts` (`export * from './checklist/task'`)

- [ ] **Step 1: Write the failing test**

`packages/compliance/test/checklist-task.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { isValidTaskDefinition, formatDecidegrees } from '../src/checklist/task'

describe('isValidTaskDefinition', () => {
  it('temperature requires a coherent range', () => {
    expect(isValidTaskDefinition('temperature', -2200, -1800)).toBe(true)
    expect(isValidTaskDefinition('temperature', 200, 200)).toBe(true) // min == max ok
    expect(isValidTaskDefinition('temperature', null, -1800)).toBe(false) // faixa incompleta
    expect(isValidTaskDefinition('temperature', 700, 200)).toBe(false) // min > max
  })
  it('boolean/text must not carry a range', () => {
    expect(isValidTaskDefinition('boolean', null, null)).toBe(true)
    expect(isValidTaskDefinition('text', null, null)).toBe(true)
    expect(isValidTaskDefinition('boolean', 0, 10)).toBe(false)
    expect(isValidTaskDefinition('text', null, 5)).toBe(false)
  })
})

describe('formatDecidegrees', () => {
  it('formats decidegrees as German Celsius', () => {
    expect(formatDecidegrees(-180)).toBe('-18,0 °C')
    expect(formatDecidegrees(0)).toBe('0,0 °C')
    expect(formatDecidegrees(205)).toBe('20,5 °C')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `corepack pnpm --filter @gelato/compliance exec vitest run checklist-task`
Expected: FAIL — import inexistente.

- [ ] **Step 3: Implement**

`packages/compliance/src/checklist/task.ts`:
```ts
export type ChecklistTaskType = 'boolean' | 'temperature' | 'text'

/**
 * Uma definição de tarefa é coerente quando: temperature tem faixa completa e
 * minStock ≤ maxStock; boolean/text não têm faixa. Puro.
 */
export function isValidTaskDefinition(type: ChecklistTaskType, validMin: number | null, validMax: number | null): boolean {
  if (type === 'temperature') {
    return validMin != null && validMax != null && validMin <= validMax
  }
  return validMin == null && validMax == null
}

/** Decigraus (°C×10) → exibição alemã, ex.: -180 → "-18,0 °C". */
export function formatDecidegrees(d: number): string {
  const sign = d < 0 ? '-' : ''
  const abs = Math.abs(d)
  return `${sign}${Math.floor(abs / 10)},${abs % 10} °C`
}
```

- [ ] **Step 4: Export** — `packages/compliance/src/index.ts`: `export * from './checklist/task'`

- [ ] **Step 5: Run to verify it passes**

Run: `corepack pnpm --filter @gelato/compliance exec vitest run checklist-task`
Expected: PASS (3 testes).

- [ ] **Step 6: Build dist**

Run: `corepack pnpm --filter @gelato/compliance build`

- [ ] **Step 7: Commit**

```bash
git add packages/compliance/src/checklist/task.ts packages/compliance/test/checklist-task.test.ts packages/compliance/src/index.ts
git commit -m "feat(compliance): isValidTaskDefinition + formatDecidegrees — checklist HACCP (puro)"
```

---

## Chunk 2: modelo `ChecklistTemplate` + `ChecklistTask` + seed

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/<ts>_c3a_checklist_templates/migration.sql`
- Modify: `apps/api/prisma/seed.ts` (template diário demo)

- [ ] **Step 1: Adicionar os modelos**

Modify `apps/api/prisma/schema.prisma` — ao final:
```prisma
// ---------- Checklist / HACCP (Ciclo 3a) ----------

model ChecklistTemplate {
  id         String   @id @default(cuid())
  tenantId   String
  name       String
  recurrence String   @default("daily") // daily | weekly | per_shift | on_event (informativo; scheduler = 3c)
  active     Boolean  @default(true)
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  tasks ChecklistTask[]

  @@map("checklist_templates")
}

model ChecklistTask {
  id         String  @id @default(cuid())
  templateId String
  label      String
  type       String // 'boolean' | 'temperature' | 'text'
  validMin   Int? // decigraus (°C×10), só p/ temperature
  validMax   Int?
  required   Boolean @default(true)
  sortOrder  Int     @default(0)
  active     Boolean @default(true)

  template ChecklistTemplate @relation(fields: [templateId], references: [id], onDelete: Cascade)

  @@map("checklist_tasks")
}
```

- [ ] **Step 2: Validar + gerar a migração**

```bash
corepack pnpm --filter @gelato/api exec prisma validate
cd apps/api
TS=20260627150000
mkdir -p prisma/migrations/${TS}_c3a_checklist_templates
corepack pnpm exec prisma migrate diff \
  --from-schema-datasource prisma/schema.prisma \
  --to-schema-datamodel prisma/schema.prisma \
  --script > prisma/migrations/${TS}_c3a_checklist_templates/migration.sql
cd ../..
cat apps/api/prisma/migrations/20260627150000_c3a_checklist_templates/migration.sql
```
Expected: `CREATE TABLE "checklist_templates"`, `CREATE TABLE "checklist_tasks"` + FK.

- [ ] **Step 3: Anexar GRANT DML** (master-data mutável; sem trigger)

Acrescentar ao final de `prisma/migrations/${TS}_c3a_checklist_templates/migration.sql`:
```sql

-- ===== Checklist/HACCP: master data (mutável) — DML p/ gelato_app =====
GRANT SELECT, INSERT, UPDATE, DELETE ON checklist_templates, checklist_tasks TO gelato_app;
```

- [ ] **Step 4: Aplicar + marcar + gerar**

```bash
cd apps/api
corepack pnpm exec prisma db execute --schema prisma/schema.prisma --file prisma/migrations/20260627150000_c3a_checklist_templates/migration.sql
corepack pnpm exec prisma migrate resolve --applied 20260627150000_c3a_checklist_templates
corepack pnpm exec prisma generate
cd ../..
```

- [ ] **Step 5: Seed do template diário**

Modify `apps/api/prisma/seed.ts` — após o bloco de receitas (antes do fechamento da função):
```ts
  // Checklist/HACCP (Ciclo 3a): template diário demo (higiene + temperatura).
  await prisma.checklistTemplate.upsert({
    where: { id: 'tpl-haccp-daily' },
    update: {},
    create: { id: 'tpl-haccp-daily', tenantId: TENANT_ID, name: 'Tägliche Hygiene & Temperatur', recurrence: 'daily' },
  })
  const tasks: [string, string, string, number | null, number | null, number][] = [
    ['task-hands', 'Hände gewaschen?', 'boolean', null, null, 1],
    ['task-vitrine', 'Vitrine gereinigt?', 'boolean', null, null, 2],
    ['task-tk', 'Tiefkühltruhe', 'temperature', -2200, -1800, 3],
    ['task-kv', 'Kühlvitrine', 'temperature', 200, 700, 4],
    ['task-notes', 'Bemerkungen', 'text', null, null, 5],
  ]
  for (const [id, label, type, validMin, validMax, sortOrder] of tasks) {
    await prisma.checklistTask.upsert({
      where: { id },
      update: { label, type, validMin, validMax, sortOrder },
      create: { id, templateId: 'tpl-haccp-daily', label, type, validMin, validMax, sortOrder },
    })
  }
```

- [ ] **Step 6: Rodar o seed 2×**

Run: `corepack pnpm --filter @gelato/api db:seed && corepack pnpm --filter @gelato/api db:seed`
Expected: "seed done" nas duas.

- [ ] **Step 7: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations apps/api/prisma/seed.ts
git commit -m "feat(api): modelo de checklist — ChecklistTemplate + ChecklistTask (mutável) + seed HACCP diário"
```

---

## Chunk 3: módulo `checklists` + e2e + capstone

**Files:**
- Create: `apps/api/src/checklists/checklists.service.ts`
- Create: `apps/api/src/checklists/checklists.controller.ts`
- Create: `apps/api/src/checklists/checklists.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Create: `apps/api/test/checklists.e2e.test.ts`
- Create: `apps/api/test/checklists-capstone.e2e.test.ts`

> **RBAC:** `checklist.view`/`checklist.manage` hoje só no `admin`. Os e2e autenticam como **admin**
> (`admin@demo.test`/`admin123`). (A permissão `checklist.execute` p/ operator entra na 3b.)

- [ ] **Step 1: Write the failing e2e**

`apps/api/test/checklists.e2e.test.ts`:
```ts
import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AppModule } from '../src/app.module'

describe('Checklists templates (e2e)', () => {
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

  it('creates a template with all 3 task types and GET returns it ordered', async () => {
    const name = `T-${crypto.randomUUID().slice(0, 8)}`
    const r = await post('/checklists/templates', {
      name, recurrence: 'daily',
      tasks: [
        { label: 'Hände?', type: 'boolean' },
        { label: 'TK', type: 'temperature', valid_min: -2200, valid_max: -1800 },
        { label: 'Notiz', type: 'text' },
      ],
    })
    expect(r.status).toBe(201)
    const id = ((await r.json()) as { id: string }).id
    const list = (await (await get('/checklists/templates')).json()) as { id: string; tasks: { label: string; type: string; validMin: number | null }[] }[]
    const tpl = list.find((t) => t.id === id)!
    expect(tpl.tasks.map((t) => t.type)).toEqual(['boolean', 'temperature', 'text'])
    expect(tpl.tasks[1].validMin).toBe(-2200)
  })

  it('rejects an incoherent task definition (400)', async () => {
    // temperature sem faixa
    expect((await post('/checklists/templates', { name: 'x', tasks: [{ label: 'TK', type: 'temperature' }] })).status).toBe(400)
    // min > max
    expect((await post('/checklists/templates', { name: 'x', tasks: [{ label: 'TK', type: 'temperature', valid_min: 700, valid_max: 200 }] })).status).toBe(400)
    // boolean com faixa
    expect((await post('/checklists/templates', { name: 'x', tasks: [{ label: 'B', type: 'boolean', valid_min: 0, valid_max: 1 }] })).status).toBe(400)
    // tasks vazio
    expect((await post('/checklists/templates', { name: 'x', tasks: [] })).status).toBe(400)
  })

  it('PUT replaces tasks and toggles active', async () => {
    const id = ((await (await post('/checklists/templates', { name: `P-${crypto.randomUUID().slice(0, 8)}`, tasks: [{ label: 'a', type: 'boolean' }] })).json()) as { id: string }).id
    expect((await put(`/checklists/templates/${id}`, { active: false, tasks: [{ label: 'b', type: 'text' }] })).status).toBe(200)
    const tpl = ((await (await get('/checklists/templates')).json()) as { id: string; active: boolean; tasks: { label: string }[] }[]).find((t) => t.id === id)!
    expect(tpl.active).toBe(false)
    expect(tpl.tasks.map((t) => t.label)).toEqual(['b'])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `corepack pnpm --filter @gelato/api exec vitest run checklists.e2e`
Expected: FAIL — rotas inexistentes.

- [ ] **Step 3: Implement the service**

`apps/api/src/checklists/checklists.service.ts`:
```ts
import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common'
import { isValidTaskDefinition, type ChecklistTaskType } from '@gelato/compliance'
import { PrismaService } from '../prisma/prisma.service'

interface TaskInput {
  label: string
  type: ChecklistTaskType
  valid_min?: number | null
  valid_max?: number | null
  required?: boolean
}

@Injectable()
export class ChecklistsService {
  constructor(private readonly prisma: PrismaService) {}

  private validateTasks(tasks: TaskInput[]): void {
    if (tasks.length === 0) throw new BadRequestException('at least one task')
    for (const t of tasks) {
      if (!isValidTaskDefinition(t.type, t.valid_min ?? null, t.valid_max ?? null)) {
        throw new BadRequestException(`invalid task definition: ${t.label}`)
      }
    }
  }

  private taskData(tasks: TaskInput[]) {
    return tasks.map((t, i) => ({
      label: t.label,
      type: t.type,
      validMin: t.type === 'temperature' ? (t.valid_min ?? null) : null,
      validMax: t.type === 'temperature' ? (t.valid_max ?? null) : null,
      required: t.required ?? true,
      sortOrder: i + 1,
    }))
  }

  async list(tenantId: string) {
    return this.prisma.checklistTemplate.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'asc' },
      include: { tasks: { orderBy: { sortOrder: 'asc' } } },
    })
  }

  async create(tenantId: string, dto: { name: string; recurrence?: string; tasks: TaskInput[] }) {
    this.validateTasks(dto.tasks)
    const tpl = await this.prisma.checklistTemplate.create({
      data: { tenantId, name: dto.name, recurrence: dto.recurrence ?? 'daily', tasks: { create: this.taskData(dto.tasks) } },
    })
    return { id: tpl.id }
  }

  async update(tenantId: string, id: string, dto: { name?: string; recurrence?: string; active?: boolean; tasks?: TaskInput[] }) {
    const tpl = await this.prisma.checklistTemplate.findFirst({ where: { id, tenantId } })
    if (!tpl) throw new NotFoundException('template')
    if (dto.tasks) {
      this.validateTasks(dto.tasks)
      await this.prisma.$transaction([
        this.prisma.checklistTask.deleteMany({ where: { templateId: id } }),
        this.prisma.checklistTask.createMany({ data: this.taskData(dto.tasks).map((t) => ({ ...t, templateId: id })) }),
      ])
    }
    const data: { name?: string; recurrence?: string; active?: boolean } = {}
    if (dto.name !== undefined) data.name = dto.name
    if (dto.recurrence !== undefined) data.recurrence = dto.recurrence
    if (dto.active !== undefined) data.active = dto.active
    if (Object.keys(data).length > 0) await this.prisma.checklistTemplate.update({ where: { id }, data })
    return { id }
  }
}
```

- [ ] **Step 4: Implement the controller**

`apps/api/src/checklists/checklists.controller.ts`:
```ts
import { Body, Controller, Get, HttpCode, Param, Post, Put, Req, UseGuards } from '@nestjs/common'
import { z } from 'zod'
import { ChecklistsService } from './checklists.service'
import { JwtAuthGuard, type JwtUser } from '../auth/jwt-auth.guard'
import { PermissionsGuard } from '../rbac/permissions.guard'
import { RequirePermission } from '../rbac/require-permission.decorator'
import { parseOrThrow } from '../common/zod'

const Task = z.object({
  label: z.string().min(1),
  type: z.enum(['boolean', 'temperature', 'text']),
  valid_min: z.number().int().nullish(),
  valid_max: z.number().int().nullish(),
  required: z.boolean().optional(),
})
const CreateDto = z.object({ name: z.string().min(1), recurrence: z.string().optional(), tasks: z.array(Task).min(1) })
const UpdateDto = z.object({ name: z.string().min(1).optional(), recurrence: z.string().optional(), active: z.boolean().optional(), tasks: z.array(Task).min(1).optional() })

@Controller('checklists')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ChecklistsController {
  constructor(private readonly checklists: ChecklistsService) {}

  @Get('templates')
  @RequirePermission('checklist.view')
  async list(@Req() req: { user: JwtUser }) {
    return this.checklists.list(req.user.tenant_id)
  }

  @Post('templates')
  @RequirePermission('checklist.manage')
  async create(@Req() req: { user: JwtUser }, @Body() body: unknown) {
    return this.checklists.create(req.user.tenant_id, parseOrThrow(CreateDto, body))
  }

  @Put('templates/:id')
  @HttpCode(200)
  @RequirePermission('checklist.manage')
  async update(@Req() req: { user: JwtUser }, @Param('id') id: string, @Body() body: unknown) {
    return this.checklists.update(req.user.tenant_id, id, parseOrThrow(UpdateDto, body))
  }
}
```
> `POST` → **201**; `PUT` → **200**. A coerência tipo×faixa é re-checada no serviço (`validateTasks`)
> mesmo após o zod (o zod só garante os tipos primitivos; a regra HACCP é a pura).

- [ ] **Step 5: Module + registrar**

`apps/api/src/checklists/checklists.module.ts`:
```ts
import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { PermissionsGuard } from '../rbac/permissions.guard'
import { ChecklistsService } from './checklists.service'
import { ChecklistsController } from './checklists.controller'

@Module({
  imports: [AuthModule],
  controllers: [ChecklistsController],
  providers: [ChecklistsService, PermissionsGuard],
})
export class ChecklistsModule {}
```

Modify `apps/api/src/app.module.ts` — importar `ChecklistsModule` e adicionar ao `imports`.

- [ ] **Step 6: Run to verify it passes**

Run: `corepack pnpm --filter @gelato/api exec vitest run checklists.e2e`
Expected: PASS (3 testes).

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/checklists apps/api/src/app.module.ts apps/api/test/checklists.e2e.test.ts
git commit -m "feat(api): módulo checklists — GET/POST/PUT templates (RBAC checklist.view/manage)"
```

- [ ] **Step 8: Write the capstone e2e**

`apps/api/test/checklists-capstone.e2e.test.ts`:
```ts
import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AppModule } from '../src/app.module'

// Capstone 3a: monta o template HACCP diário realista (5 tarefas, 2 temperaturas
// com faixa em decigraus) e confere a estrutura via GET.
describe('Checklists capstone (e2e)', () => {
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

  it('builds a realistic daily HACCP template', async () => {
    const name = `HACCP-${crypto.randomUUID().slice(0, 8)}`
    const id = ((await (await post('/checklists/templates', {
      name, recurrence: 'daily',
      tasks: [
        { label: 'Hände gewaschen?', type: 'boolean' },
        { label: 'Vitrine gereinigt?', type: 'boolean' },
        { label: 'Tiefkühltruhe', type: 'temperature', valid_min: -2200, valid_max: -1800 },
        { label: 'Kühlvitrine', type: 'temperature', valid_min: 200, valid_max: 700 },
        { label: 'Bemerkungen', type: 'text' },
      ],
    })).json()) as { id: string }).id

    const tpl = ((await (await get('/checklists/templates')).json()) as { id: string; recurrence: string; tasks: { label: string; type: string; validMin: number | null; validMax: number | null; sortOrder: number }[] }[]).find((t) => t.id === id)!
    expect(tpl.recurrence).toBe('daily')
    expect(tpl.tasks).toHaveLength(5)
    const tk = tpl.tasks.find((t) => t.label === 'Tiefkühltruhe')!
    expect([tk.validMin, tk.validMax]).toEqual([-2200, -1800])
    // ordenadas por sortOrder
    expect(tpl.tasks.map((t) => t.sortOrder)).toEqual([1, 2, 3, 4, 5])
    // tarefas não-temperatura sem faixa
    expect(tpl.tasks.find((t) => t.type === 'boolean')!.validMin).toBeNull()
  })
})
```

- [ ] **Step 9: Run the capstone + full API suite**

Run: `corepack pnpm --filter @gelato/api exec vitest run checklists-capstone`
Then: `corepack pnpm --filter @gelato/api exec vitest run`
Expected: ambos verdes.

- [ ] **Step 10: Commit**

```bash
git add apps/api/test/checklists-capstone.e2e.test.ts
git commit -m "test(api): checklists capstone (template HACCP diário realista)"
```

---

## Chunk 4: backoffice (mínimo) + integração

**Files:**
- Modify: `apps/backoffice/src/api.ts` (tipo `ChecklistTemplateRow`)
- Modify: `apps/backoffice/src/App.tsx` (seção `Checklists`)

- [ ] **Step 1: Tipo no backoffice api**

Modify `apps/backoffice/src/api.ts` — adicionar:
```ts
export interface ChecklistTemplateRow {
  id: string
  name: string
  recurrence: string
  active: boolean
  tasks: { id: string; label: string; type: string; validMin: number | null; validMax: number | null }[]
}
```

- [ ] **Step 2: Seção `Checklists` no App**

Modify `apps/backoffice/src/App.tsx`:
1. Import: incluir `type ChecklistTemplateRow` no import do `./api`.
2. Renderizar `<Checklists token={token} />` (perto de `<Recipes token={token} />`).
3. Componente (read-only):
```tsx
function fmtRange(min: number | null, max: number | null): string {
  if (min == null || max == null) return ''
  const c = (d: number) => `${d < 0 ? '-' : ''}${Math.floor(Math.abs(d) / 10)},${Math.abs(d) % 10}`
  return ` (${c(min)}…${c(max)} °C)`
}

function Checklists({ token }: { token: string }) {
  const [templates, setTemplates] = useState<ChecklistTemplateRow[]>([])
  useEffect(() => {
    apiGet<ChecklistTemplateRow[]>('/checklists/templates', token).then(setTemplates).catch(() => setTemplates([]))
  }, [token])

  return (
    <section style={{ marginTop: '2rem' }}>
      <h2>Checklists (HACCP)</h2>
      <ul>
        {templates.map((tpl) => (
          <li key={tpl.id}>
            <strong>{tpl.name}</strong> — {tpl.recurrence}
            {!tpl.active && ' (inativo)'}
            <ul>
              {tpl.tasks.map((t) => (
                <li key={t.id}>
                  {t.label} [{t.type}]
                  {t.type === 'temperature' && fmtRange(t.validMin, t.validMax)}
                </li>
              ))}
            </ul>
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
git commit -m "feat(backoffice): seção Checklists (templates HACCP + tarefas)"
```

- [ ] **Step 5: Suíte completa + integração**

```bash
corepack pnpm -r test
git checkout main
git merge --ff-only ciclo-3a
git push origin main
git branch -d ciclo-3a
```
> Manter `docker/docker-compose.yml` (5433) e `.claude/` fora do commit.

---

## Notas de verificação / riscos

- **GRANT explícito** p/ `checklist_templates`/`checklist_tasks` (master-data nova).
- **Sem append-only** — template/tarefa são mutáveis; a 3b (execução) é que será append-only.
- **Coerência tipo×faixa** é da função pura (`isValidTaskDefinition`); o serviço re-valida além do zod.
- **`validMin/validMax` só persistem p/ `temperature`** (o serviço zera p/ boolean/text).
- **Dist do compliance** rebuildado no Chunk 1.
```
