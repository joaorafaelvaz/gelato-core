# Tischplan visual (Ciclo 1 · fatia 1a-4) Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transformar o salão do pos-web de uma lista de botões numa **planta visual editável**: mesas posicionadas por `posX/posY`, coloridas por estado, **clicar abre** a conta e **arrastar reposiciona e salva**.

**Architecture:** `Tisch.posX/posY` já existem (operacionais/mutáveis). A API enriquece `GET /pos/tables` (posX/posY + total da conta aberta) e ganha `PATCH /pos/tables/:id/position` (update simples — sem ledger). No pos-web, um componente `Tischplan` (divs posicionadas + pointer events) substitui a lista; o painel da conta (variante/modifier/split/pagar/transferir) já pronto fica abaixo, inalterado.

**Tech Stack:** TypeScript strict, vitest (TDD), NestJS + Prisma + Postgres (`gelato_c0` em **5433**), React/Vite (pos-web). Cents. **127.0.0.1**.

**Spec:** `docs/superpowers/specs/2026-06-27-ciclo-1a-4-tischplan-visual-design.md`

> **Rodar ao vivo (coexistência):** API em **3001** (`cd apps/api && PORT=3001 corepack pnpm exec nest start`), pos-web em **5173** (`VITE_API_URL=http://127.0.0.1:3001`), Postgres em **5433**. O projeto paralelo ocupa 3000/4000/5432. **Sem migração** (posX/posY já existem). **Sem Electron** (deferido).

---

## File Structure

**Modificar (API):** `apps/api/src/tables/tables.service.ts` (listTables + updatePosition), `tables.controller.ts` (PATCH), `apps/api/prisma/seed.ts` (posições + tisch-3/4), `apps/api/test/tables.e2e.test.ts`.
**Criar (pos-web):** `apps/pos-web/src/tischplan-util.ts` (`tableState`, `clampPosition`), `apps/pos-web/test/tischplan-util.test.ts`.
**Modificar (pos-web):** `apps/pos-web/src/api.ts` (TableRow + updateTablePosition), `apps/pos-web/src/TischPanel.tsx` (componente `Tischplan`).

**Comandos:** API e2e `corepack pnpm --filter @gelato/api exec vitest run`; pos-web `corepack pnpm --filter @gelato/pos-web exec vitest run`; typecheck `corepack pnpm exec tsc --noEmit -p <pkg>/tsconfig.json`; build `corepack pnpm --filter @gelato/pos-web build`.

---

## Chunk 1: API — GET enriquecido + PATCH posição + seed

### Task 1.1: `listTables` devolve posX/posY/openTotalGross + `updatePosition` + PATCH

**Files:**
- Modify: `apps/api/src/tables/tables.service.ts`, `apps/api/src/tables/tables.controller.ts`
- Test: `apps/api/test/tables.e2e.test.ts`

- [ ] **Step 1: Write the failing test** (adicionar ao describe de tables)

```ts
it('lists tables with posX/posY and the open tab total; PATCH persists a position', async () => {
  // GET /pos/tables traz as mesas demo com posições (seed) — afirma que tisch-1 tem posX/posY
  const before = (await (await get(`/pos/tables?kasse_id=demo-kasse`)).json()) as { id: string; posX: number | null; posY: number | null; openTotalGross: number | null }[]
  const t1 = before.find((t) => t.id === 'tisch-1')!
  expect(typeof t1.posX).toBe('number')
  // PATCH move uma mesa de teste
  const tisch = `tisch-${crypto.randomUUID().slice(0, 8)}`
  await prisma.tisch.create({ data: { id: tisch, betriebsstaetteId: 'demo-bs', name: 'pos', posX: 10, posY: 10 } })
  const res = await fetch(`${baseUrl}/pos/tables/${tisch}/position`, { method: 'PATCH', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ pos_x: 123, pos_y: 234 }) })
  expect(res.status).toBe(200)
  const moved = await prisma.tisch.findUnique({ where: { id: tisch } })
  expect(moved?.posX).toBe(123)
  expect(moved?.posY).toBe(234)
})
```
> O `token` no arquivo é o do operador (PIN 1234), que tem `pos.table.open`. `get` e `post` helpers já existem; aqui usamos `fetch` direto p/ o método PATCH.

- [ ] **Step 2: Run** → FAIL (GET sem posX; rota PATCH inexistente).

- [ ] **Step 3: Implementar `listTables`** (incluir posições + total da conta aberta)

```ts
async listTables(kasseId: string) {
  const kasse = await this.prisma.kasse.findUnique({ where: { id: kasseId } })
  if (!kasse) throw new NotFoundException('kasse')
  const tische = await this.prisma.tisch.findMany({
    where: { betriebsstaetteId: kasse.betriebsstaetteId, active: true },
    orderBy: { name: 'asc' },
  })
  const open = await this.prisma.tischsession.findMany({
    where: { status: 'open', tischId: { in: tische.map((t) => t.id) } },
    include: { bestellungen: { include: { items: true } } },
  })
  const byTisch = new Map(
    open.map((s) => {
      const items: TabItemInput[] = s.bestellungen.flatMap((b) =>
        b.items.map((i) => ({ productId: i.productId, qty: i.qty, unitNet: i.unitNet, mwstRate: Number(i.mwstRate), mwstCode: i.mwstCode })),
      )
      return [s.tischId, { sessionId: s.id, total: aggregateTab(items).totalGross }] as const
    }),
  )
  return tische.map((t) => {
    const o = byTisch.get(t.id)
    return { id: t.id, name: t.name, posX: t.posX, posY: t.posY, openSessionId: o?.sessionId ?? null, openTotalGross: o?.total ?? null }
  })
}
```

- [ ] **Step 4: Implementar `updatePosition`** (operacional — sem ledger)

```ts
async updatePosition(id: string, posX: number, posY: number, tenantId: string) {
  const tisch = await this.prisma.tisch.findFirst({ where: { id, betriebsstaette: { tenantId } } })
  if (!tisch) throw new NotFoundException('tisch')
  return this.prisma.tisch.update({ where: { id }, data: { posX, posY } })
}
```

- [ ] **Step 5: Controller — PATCH**

Em `tables.controller.ts`: importar `Patch` de `@nestjs/common` e `z` (já importado). Adicionar:
```ts
  @Patch('tables/:id/position')
  @HttpCode(200)
  @RequirePermission('pos.table.open')
  async position(@Req() req: { user: JwtUser }, @Param('id') id: string, @Body() body: unknown) {
    const dto = parseOrThrow(PositionDto, body)
    return this.tables.updatePosition(id, dto.pos_x, dto.pos_y, req.user.tenant_id)
  }
```
E o DTO (perto do `PayDto`):
```ts
const PositionDto = z.object({ pos_x: z.number().int(), pos_y: z.number().int() })
```

- [ ] **Step 6: Run + typecheck**

Run: `corepack pnpm --filter @gelato/api exec vitest run test/tables.e2e.test.ts` → PASS.
Run: `corepack pnpm exec tsc --noEmit -p apps/api/tsconfig.json` → sem erros.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/tables apps/api/test/tables.e2e.test.ts
git commit -m "feat(api): GET /pos/tables com posX/posY+total; PATCH .../position (operacional)"
```

### Task 1.2: seed de posições + mesas demo

**Files:**
- Modify: `apps/api/prisma/seed.ts`

- [ ] **Step 1:** Trocar o bloco de mesas demo (1a-1) por 4 mesas com posições:

```ts
  for (const [id, name, posX, posY] of [
    ['tisch-1', 'Tisch 1', 40, 40],
    ['tisch-2', 'Tisch 2', 220, 40],
    ['tisch-3', 'Tisch 3', 40, 180],
    ['tisch-4', 'Tisch 4', 220, 180],
  ] as const) {
    await prisma.tisch.upsert({
      where: { id },
      update: { posX, posY },
      create: { id, betriebsstaetteId: BS_ID, name, posX, posY },
    })
  }
```
(O `update: { posX, posY }` dá posição às tisch-1/tisch-2 que já existiam sem posição.)

- [ ] **Step 2: Reaplicar** → `corepack pnpm --filter @gelato/api db:seed`.

- [ ] **Step 3: Commit** `git commit -am "feat(seed): posicoes iniciais das mesas (Tischplan)"`

---

## Chunk 2: pos-web — helpers + componente Tischplan

### Task 2.1: helpers puros `tischplan-util.ts`

**Files:**
- Create: `apps/pos-web/src/tischplan-util.ts`
- Test: `apps/pos-web/test/tischplan-util.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/pos-web/test/tischplan-util.test.ts
import { describe, it, expect } from 'vitest'
import { tableState, clampPosition } from '../src/tischplan-util'

describe('tischplan-util', () => {
  it('tableState reflects an open session', () => {
    expect(tableState({ openSessionId: null })).toBe('free')
    expect(tableState({ openSessionId: 's1' })).toBe('occupied')
  })
  it('clampPosition keeps the table inside the canvas', () => {
    const b = { w: 480, h: 360, tw: 110, th: 60 }
    expect(clampPosition(-20, -20, b)).toEqual({ x: 0, y: 0 })
    expect(clampPosition(1000, 1000, b)).toEqual({ x: 370, y: 300 }) // 480-110, 360-60
    expect(clampPosition(100, 100, b)).toEqual({ x: 100, y: 100 })
  })
})
```

- [ ] **Step 2: Run** → FAIL (módulo inexistente).

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/pos-web/src/tischplan-util.ts
export type TableState = 'free' | 'occupied'

export function tableState(t: { openSessionId: string | null }): TableState {
  return t.openSessionId ? 'occupied' : 'free'
}

export interface CanvasBounds {
  w: number
  h: number
  tw: number
  th: number
}
/** Mantém (x,y) dentro do canvas (a mesa tem largura tw/altura th). */
export function clampPosition(x: number, y: number, b: CanvasBounds): { x: number; y: number } {
  return {
    x: Math.max(0, Math.min(x, b.w - b.tw)),
    y: Math.max(0, Math.min(y, b.h - b.th)),
  }
}
```

- [ ] **Step 4: Run** → PASS. **Commit** `git add apps/pos-web/src/tischplan-util.ts apps/pos-web/test/tischplan-util.test.ts && git commit -m "feat(pos-web): tischplan-util (tableState, clampPosition)"`

### Task 2.2: `TableRow` + `updateTablePosition` no api.ts

**Files:**
- Modify: `apps/pos-web/src/api.ts`

- [ ] **Step 1:** Estender `TableRow` e adicionar o PATCH helper:

```ts
export interface TableRow {
  id: string
  name: string
  posX?: number | null
  posY?: number | null
  openSessionId: string | null
  openTotalGross?: number | null
}

export const updateTablePosition = async (token: string, id: string, x: number, y: number): Promise<void> => {
  const res = await fetch(`${BASE}/pos/tables/${id}/position`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ pos_x: x, pos_y: y }),
  })
  if (!res.ok) throw new Error(`position -> ${res.status}`)
}
```

- [ ] **Step 2: typecheck** `corepack pnpm exec tsc --noEmit -p apps/pos-web/tsconfig.json` → sem erros. (Sem commit isolado; junta com 2.3.)

### Task 2.3: componente `Tischplan` no TischPanel

**Files:**
- Modify: `apps/pos-web/src/TischPanel.tsx`

- [ ] **Step 1:** Imports: adicionar `useRef` ao import do react; `import { tableState, clampPosition } from './tischplan-util'`; `import { updateTablePosition } from './api'` (somar aos imports existentes).

- [ ] **Step 2:** Adicionar `moveTable` no `TischPanel` (perto de `open`):
```ts
  async function moveTable(id: string, x: number, y: number): Promise<void> {
    await updateTablePosition(token, id, x, y)
    refresh()
  }
```

- [ ] **Step 3:** Substituir a lista de botões de mesa pelo `<Tischplan .../>`. Trocar:
```tsx
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {tables.map((t) => (
          <button key={t.id} onClick={() => void open(t)}>
            {t.name}
            {t.openSessionId ? ' • aberta' : ''}
          </button>
        ))}
      </div>
```
por:
```tsx
      <Tischplan tables={tables} onOpen={(t) => void open(t)} onMove={(id, x, y) => void moveTable(id, x, y)} />
```

- [ ] **Step 4:** Adicionar o componente `Tischplan` ao final do arquivo (reusa o `euro` do módulo):
```tsx
function Tischplan({
  tables,
  onOpen,
  onMove,
}: {
  tables: TableRow[]
  onOpen: (t: TableRow) => void
  onMove: (id: string, x: number, y: number) => void
}) {
  const W = 480, H = 360, TW = 110, TH = 60
  const ref = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<{ id: string; dx: number; dy: number; x: number; y: number; moved: boolean } | null>(null)

  function down(e: React.PointerEvent, t: TableRow): void {
    e.currentTarget.setPointerCapture(e.pointerId)
    const rect = ref.current!.getBoundingClientRect()
    setDrag({ id: t.id, dx: e.clientX - rect.left - (t.posX ?? 0), dy: e.clientY - rect.top - (t.posY ?? 0), x: t.posX ?? 0, y: t.posY ?? 0, moved: false })
  }
  function move(e: React.PointerEvent): void {
    if (!drag) return
    const rect = ref.current!.getBoundingClientRect()
    const p = clampPosition(e.clientX - rect.left - drag.dx, e.clientY - rect.top - drag.dy, { w: W, h: H, tw: TW, th: TH })
    setDrag({ ...drag, x: p.x, y: p.y, moved: drag.moved || Math.abs(p.x - drag.x) > 5 || Math.abs(p.y - drag.y) > 5 })
  }
  function up(t: TableRow): void {
    if (!drag) return
    if (drag.moved) onMove(drag.id, drag.x, drag.y)
    else onOpen(t)
    setDrag(null)
  }

  return (
    <div ref={ref} style={{ position: 'relative', width: W, height: H, background: '#fafafa', border: '1px solid #ddd', borderRadius: 8, overflow: 'hidden' }}>
      {tables.map((t) => {
        const pos = drag?.id === t.id ? { x: drag.x, y: drag.y } : { x: t.posX ?? 0, y: t.posY ?? 0 }
        const occ = tableState(t) === 'occupied'
        return (
          <div
            key={t.id}
            onPointerDown={(e) => down(e, t)}
            onPointerMove={move}
            onPointerUp={() => up(t)}
            style={{ position: 'absolute', left: pos.x, top: pos.y, width: TW, height: TH, background: occ ? '#fde68a' : '#dcfce7', border: '1px solid #999', borderRadius: 8, display: 'grid', placeItems: 'center', cursor: 'grab', userSelect: 'none', touchAction: 'none' }}
          >
            <div style={{ textAlign: 'center', fontSize: 13 }}>
              {t.name}
              {occ && t.openTotalGross != null ? (
                <>
                  <br />
                  {euro(t.openTotalGross)}
                </>
              ) : null}
            </div>
          </div>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 5: typecheck + build**

Run: `corepack pnpm exec tsc --noEmit -p apps/pos-web/tsconfig.json` → sem erros.
Run: `corepack pnpm --filter @gelato/pos-web build` → ok.
Run: `corepack pnpm --filter @gelato/pos-web exec vitest run` → testes do pos-web verdes (incl. tischplan-util).

- [ ] **Step 6: Commit**

```bash
git add apps/pos-web/src/api.ts apps/pos-web/src/TischPanel.tsx
git commit -m "feat(pos-web): Tischplan visual (mesas posicionadas, cor por estado, arrastar+salvar, clicar p/ abrir)"
```

---

## Chunk 3: verificação ao vivo + final

### Task 3.1: rodar + dirigir via Claude_Preview

- [ ] **Step 1:** Subir os servidores (coexistência):
  - API: `cd apps/api && PORT=3001 corepack pnpm exec nest start` (background); aguardar `GET http://127.0.0.1:3001/health` = `{"status":"ok"}`.
  - pos-web: `.claude/launch.json` já existe (config `pos-web`); `apps/pos-web/.env.local` já aponta p/ 3001. `preview_start("pos-web")` → serverId (matar processo em 5173 se preciso).

- [ ] **Step 2:** Logar (PIN 1234, demo-kasse) + abrir turno (se necessário) e rolar até "Salão (Tische)". Via `preview_eval`/`preview_screenshot`:
  - Afirmar que a **planta renderiza** as 4 mesas posicionadas (verdes = livres).
  - **Arrastar** uma mesa (simular pointerdown/move/up via eval, ou `preview` drag) → confirmar o `PATCH` (rede) e, ao **recarregar**, a mesa aparece na nova posição (persistiu).
  - **Clicar** numa mesa → abre a conta + o painel embaixo (variante/modifier/split/pagar).

- [ ] **Step 3:** Parar os servidores (TaskStop da API; matar processo do pos-web 5173).

### Task 3.2: verificação final

- [ ] **Step 1:** `corepack pnpm -r test` → tudo verde (lembrar do ABI Node p/ pos-terminal se preciso).
- [ ] **Step 2: Commit** (se houver ajustes da verificação) e fim.

---

## Definition of Done (fatia 1a-4)

- [ ] `tableState`/`clampPosition` testados; `GET /pos/tables` traz posX/posY+total; `PATCH .../position` persiste — e2e.
- [ ] Planta renderiza mesas posicionadas, coloridas por estado; **arrastar salva**, **clicar abre** — verificado ao vivo.
- [ ] pos-web compila/builda; `corepack pnpm -r test` verde.
- [ ] Sem novo registro fiscal (posição é operacional); Electron deferido.

## Riscos / notas

- Distinguir clique de arraste pelo **limiar de 5px** (evita abrir a conta ao reposicionar).
- `touchAction: 'none'` nos nós p/ o pointer-drag funcionar em touch.
- Falha de `PATCH` → o `refresh()` recarrega as posições do servidor (descarta o local).
