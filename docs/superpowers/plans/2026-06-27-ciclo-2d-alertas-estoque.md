# Ciclo 2 · Fatia 2d — Alertas de estoque — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sinalizar insumos que precisam de atenção (abaixo do mínimo = `low`; negativos = `negative`) como leitura derivada — `GET /stock/alerts` + banner no backoffice. Fecha o Ciclo 2.

**Architecture:** Pura `classifyStockAlert`/`stockAlerts` em `@gelato/compliance` → `GET /stock/alerts` reusa `StockService.levels` (2a) e devolve só os não-`ok`, ordenados por severidade → banner no backoffice. **Nada materializado** (sem tabela/eventos).

**Tech Stack:** TypeScript strict, vitest, NestJS, Prisma + Postgres (**5433**), React/Vite.

**Spec:** `docs/superpowers/specs/2026-06-27-ciclo-2d-alertas-estoque-design.md`

**Pré-requisitos:** Postgres up (`-p gelato_c0`, 5433); branch `ciclo-2d` (off `main`).

---

## Chunk 1: `classifyStockAlert` + `stockAlerts` (puro)

**Files:**
- Create: `packages/compliance/src/stock/alerts.ts`
- Create: `packages/compliance/test/stock-alerts.test.ts`
- Modify: `packages/compliance/src/index.ts` (`export * from './stock/alerts'`)

- [ ] **Step 1: Write the failing test**

`packages/compliance/test/stock-alerts.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { classifyStockAlert, stockAlerts } from '../src/stock/alerts'

describe('classifyStockAlert', () => {
  it('negative when qty < 0 (even without minStock)', () => {
    expect(classifyStockAlert(-1, 100)).toBe('negative')
    expect(classifyStockAlert(-1, null)).toBe('negative')
  })
  it('low when 0 <= qty < minStock', () => {
    expect(classifyStockAlert(0, 100)).toBe('low')
    expect(classifyStockAlert(99, 100)).toBe('low')
  })
  it('ok at or above minStock, or without minStock', () => {
    expect(classifyStockAlert(100, 100)).toBe('ok') // == min → ok
    expect(classifyStockAlert(150, 100)).toBe('ok')
    expect(classifyStockAlert(0, null)).toBe('ok') // sem minStock, não negativo
  })
})

describe('stockAlerts', () => {
  it('filters out ok and orders negative before low, then by qty asc', () => {
    const out = stockAlerts([
      { id: 'a', qty: 150, minStock: 100 }, // ok
      { id: 'b', qty: 80, minStock: 100 }, // low
      { id: 'c', qty: -5, minStock: 100 }, // negative
      { id: 'd', qty: 20, minStock: 100 }, // low (menor que b)
      { id: 'e', qty: 500, minStock: null }, // ok
    ])
    expect(out.map((x) => [x.id, x.state])).toEqual([
      ['c', 'negative'],
      ['d', 'low'],
      ['b', 'low'],
    ])
  })

  it('empty when everything is ok', () => {
    expect(stockAlerts([{ id: 'a', qty: 100, minStock: 100 }, { id: 'b', qty: 5, minStock: null }])).toEqual([])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `corepack pnpm --filter @gelato/compliance exec vitest run stock-alerts`
Expected: FAIL — import inexistente.

- [ ] **Step 3: Implement**

`packages/compliance/src/stock/alerts.ts`:
```ts
export type StockAlertState = 'low' | 'negative'

/** Classifica um nível de estoque. Negativo é mais urgente; low exige minStock. */
export function classifyStockAlert(qty: number, minStock: number | null): 'ok' | StockAlertState {
  if (qty < 0) return 'negative'
  if (minStock != null && qty < minStock) return 'low'
  return 'ok'
}

/**
 * Só os insumos em alerta (não-ok), ordenados por severidade (negative antes de
 * low) e, dentro, por qty ascendente (mais crítico primeiro). Genérica/pass-through.
 */
export function stockAlerts<T extends { qty: number; minStock: number | null }>(items: T[]): (T & { state: StockAlertState })[] {
  const rank: Record<StockAlertState, number> = { negative: 0, low: 1 }
  return items
    .map((i) => ({ ...i, state: classifyStockAlert(i.qty, i.minStock) }))
    .filter((i): i is T & { state: StockAlertState } => i.state !== 'ok')
    .sort((a, b) => rank[a.state] - rank[b.state] || a.qty - b.qty)
}
```

- [ ] **Step 4: Export** — `packages/compliance/src/index.ts`: `export * from './stock/alerts'`

- [ ] **Step 5: Run to verify it passes**

Run: `corepack pnpm --filter @gelato/compliance exec vitest run stock-alerts`
Expected: PASS (5 testes).

- [ ] **Step 6: Build dist**

Run: `corepack pnpm --filter @gelato/compliance build`

- [ ] **Step 7: Commit**

```bash
git add packages/compliance/src/stock/alerts.ts packages/compliance/test/stock-alerts.test.ts packages/compliance/src/index.ts
git commit -m "feat(compliance): classifyStockAlert + stockAlerts — alertas de estoque (puro)"
```

---

## Chunk 2: `GET /stock/alerts` + e2e + capstone

**Files:**
- Modify: `apps/api/src/stock/stock.service.ts` (método `alerts`)
- Modify: `apps/api/src/stock/stock.controller.ts` (rota `@Get('alerts')`)
- Modify: `apps/api/test/stock.e2e.test.ts` (testes de alerta)
- Create: `apps/api/test/stock-alerts-capstone.e2e.test.ts`

> **Ordem das rotas:** `@Get('alerts')` é um path estático distinto de `@Get()` — sem conflito (o
> controller não tem `GET /stock/:id`). Mantê-lo declarado junto do `@Get()`.

- [ ] **Step 1: Write the failing e2e** — adicionar a `apps/api/test/stock.e2e.test.ts` (usa o
  `post`/`get`/`newItem` já existentes no arquivo):
```ts
  it('GET /stock/alerts lists low and negative items, ordered by severity', async () => {
    // item com minStock; recebe acima do mínimo (ok) → não aparece
    const okId = ((await (await post('/stock/items', { name: `ok-${crypto.randomUUID().slice(0, 8)}`, unit: 'g', min_stock: 100 })).json()) as { id: string }).id
    await post('/stock/receive', { stock_item_id: okId, qty: 150 })
    // item baixo (qty 50 < min 100)
    const lowId = ((await (await post('/stock/items', { name: `low-${crypto.randomUUID().slice(0, 8)}`, unit: 'g', min_stock: 100 })).json()) as { id: string }).id
    await post('/stock/receive', { stock_item_id: lowId, qty: 50 })
    // item negativo (ajuste para -10)
    const negId = ((await (await post('/stock/items', { name: `neg-${crypto.randomUUID().slice(0, 8)}`, unit: 'g', min_stock: 100 })).json()) as { id: string }).id
    await post('/stock/adjust', { stock_item_id: negId, qty_delta: -10 })

    const alerts = (await (await get('/stock/alerts')).json()) as { id: string; state: string }[]
    const byId = new Map(alerts.map((a) => [a.id, a.state]))
    expect(byId.get(okId)).toBeUndefined() // ok não aparece
    expect(byId.get(lowId)).toBe('low')
    expect(byId.get(negId)).toBe('negative')
    // o negativo vem antes do baixo
    const idxNeg = alerts.findIndex((a) => a.id === negId)
    const idxLow = alerts.findIndex((a) => a.id === lowId)
    expect(idxNeg).toBeLessThan(idxLow)
  })
```

- [ ] **Step 2: Run to verify it fails**

Run: `corepack pnpm --filter @gelato/api exec vitest run stock.e2e -t alerts`
Expected: FAIL — rota inexistente.

- [ ] **Step 3: Implement the service method**

Modify `apps/api/src/stock/stock.service.ts`:
1. Import: `import { aggregateStock, stockAlerts } from '@gelato/compliance'`
2. Método (após `levels`):
```ts
  /** Insumos em alerta (baixo/negativo), derivado do nível atual. */
  async alerts(tenantId: string) {
    return stockAlerts(await this.levels(tenantId))
  }
```

- [ ] **Step 4: Implement the route**

Modify `apps/api/src/stock/stock.controller.ts` — adicionar após o `@Get()`:
```ts
  @Get('alerts')
  @RequirePermission('stock.view')
  async alerts(@Req() req: { user: JwtUser }) {
    return this.stock.alerts(req.user.tenant_id)
  }
```

- [ ] **Step 5: Run to verify it passes**

Run: `corepack pnpm --filter @gelato/api exec vitest run stock.e2e`
Expected: PASS (todos, incl. o novo).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/stock/stock.service.ts apps/api/src/stock/stock.controller.ts apps/api/test/stock.e2e.test.ts
git commit -m "feat(api): GET /stock/alerts — insumos baixos/negativos (derivado)"
```

- [ ] **Step 7: Write the capstone e2e** (liga 2c → 2d)

`apps/api/test/stock-alerts-capstone.e2e.test.ts`:
```ts
import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import type { AddressInfo } from 'node:net'
import { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { FakeTseProvider } from '@gelato/compliance'
import { AppModule } from '../src/app.module'

const tse = new FakeTseProvider({ serialNumber: 'SER-ALERT' })

// Capstone 2d: insumo minStock 100 / qty 120 (ok) → vender via receita até 80 (low)
// → vender até negativo → o alerta acompanha. Liga o decremento (2c) ao alerta (2d).
describe('Stock alerts capstone (e2e)', () => {
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
  const stateOf = async (id: string): Promise<string | undefined> =>
    ((await (await get('/stock/alerts')).json()) as { id: string; state: string }[]).find((a) => a.id === id)?.state

  async function sell(productId: string, qty: number): Promise<void> {
    const r = await tse.sign({ clientId: 'c1', processType: 'Kassenbeleg-V1', amountsByVatRate: [], paymentType: 'Bar', grossTotal: 119 * qty })
    await post('/pos/sync', {
      client_event_id: crypto.randomUUID(), type: 'sale', kasse_id: 'demo-kasse',
      payload: {
        order: { mode: 'ausser_haus', total_net: 100 * qty, total_mwst: 19 * qty, total_gross: 119 * qty },
        items: [{ product_id: productId, qty, unit_net: 100, mwst_rate: 0.19, mwst_code: 'standard_19' }],
        payment: { method: 'cash', amount: 119 * qty },
        receipt: { qr_payload: '', format: 'digital' },
        tse_transaction: { tx_number: r.txNumber, signature_counter: r.signatureCounter, signature_value: r.signatureValue, log_time: r.logTime, process_type: r.processType, serial_number: r.serialNumber, public_key: r.publicKey },
      },
    })
  }

  it('a sale drives an item from ok → low → negative in /stock/alerts', async () => {
    const stockId = ((await (await post('/stock/items', { name: `cap-${crypto.randomUUID().slice(0, 8)}`, unit: 'g', min_stock: 100 })).json()) as { id: string }).id
    await post('/stock/receive', { stock_item_id: stockId, qty: 120 })
    const product = await prisma.product.create({ data: { tenantId: 'demo-tenant', name: `AP-${crypto.randomUUID().slice(0, 8)}`, netCents: 100, mwstCodeImHaus: 'standard_19', mwstCodeAusserHaus: 'reduced_7' } })
    await post('/recipes', { product_id: product.id, ingredients: [{ stock_item_id: stockId, qty: 20 }] }) // 20g por unidade

    expect(await stateOf(stockId)).toBeUndefined() // 120 ≥ 100 → ok, fora dos alertas

    await sell(product.id, 2) // 120 - 40 = 80 (< 100) → low
    expect(await stateOf(stockId)).toBe('low')

    await sell(product.id, 5) // 80 - 100 = -20 → negative
    expect(await stateOf(stockId)).toBe('negative')
  })
})
```

- [ ] **Step 8: Run the capstone**

Run: `corepack pnpm --filter @gelato/api exec vitest run stock-alerts-capstone`
Expected: PASS.

- [ ] **Step 9: Run the whole API suite**

Run: `corepack pnpm --filter @gelato/api exec vitest run`
Expected: tudo verde.

- [ ] **Step 10: Commit**

```bash
git add apps/api/test/stock-alerts-capstone.e2e.test.ts
git commit -m "test(api): stock alerts capstone (venda -> low -> negative)"
```

---

## Chunk 3: backoffice (banner) + integração

**Files:**
- Modify: `apps/backoffice/src/api.ts` (tipo `StockAlert`)
- Modify: `apps/backoffice/src/App.tsx` (banner na seção `Stock`)

- [ ] **Step 1: Tipo no backoffice api**

Modify `apps/backoffice/src/api.ts` — adicionar:
```ts
export interface StockAlert {
  id: string
  name: string
  unit: string
  qty: number
  minStock: number | null
  state: 'low' | 'negative'
}
```

- [ ] **Step 2: Banner na seção `Stock`**

Modify `apps/backoffice/src/App.tsx`:
1. Import: incluir `type StockAlert` no import do `./api`.
2. No componente `Stock`, carregar os alertas e mostrar um banner acima da tabela:
```tsx
function Stock({ token }: { token: string }) {
  const [levels, setLevels] = useState<StockLevel[]>([])
  const [alerts, setAlerts] = useState<StockAlert[]>([])
  const [selected, setSelected] = useState('')
  const [qty, setQty] = useState('')

  const reload = (): void => {
    apiGet<StockLevel[]>('/stock', token).then(setLevels).catch(() => setLevels([]))
    apiGet<StockAlert[]>('/stock/alerts', token).then(setAlerts).catch(() => setAlerts([]))
  }
  useEffect(reload, [token])
```
(o resto do componente — `receive`/`count`/tabela/form — permanece; só adicionar o estado `alerts`,
incluir `apiGet<StockAlert[]>('/stock/alerts', …)` no `reload`, e renderizar o banner abaixo do `<h2>`):
```tsx
      <h2>Estoque</h2>
      {alerts.length > 0 && (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, padding: '0.5rem 0.75rem', marginBottom: '0.5rem' }}>
          ⚠ {alerts.length} em alerta:{' '}
          {alerts.map((a) => (
            <span key={a.id} style={{ marginRight: 8, fontWeight: a.state === 'negative' ? 700 : 400 }}>
              {a.name} ({a.qty} {a.unit}{a.state === 'negative' ? ', negativo' : ''})
            </span>
          ))}
        </div>
      )}
```
> O `reload` já é chamado após `receive`/`count`, então o banner se atualiza junto. A tabela já
> colore linhas com `qty < minStock` (2a) — o banner é o resumo acionável.

- [ ] **Step 3: Typecheck + build**

Run: `corepack pnpm --filter @gelato/backoffice exec tsc --noEmit && corepack pnpm --filter @gelato/backoffice build`
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add apps/backoffice/src/api.ts apps/backoffice/src/App.tsx
git commit -m "feat(backoffice): banner de alertas de estoque na seção Estoque"
```

- [ ] **Step 5: Suíte completa**

Run: `corepack pnpm -r test`
Expected: tudo verde.

- [ ] **Step 6: Integrar `ciclo-2d` → `main` + push (fecha o Ciclo 2)**

```bash
git checkout main
git merge --ff-only ciclo-2d
git push origin main
git branch -d ciclo-2d
```
> Manter `docker/docker-compose.yml` (5433) e `.claude/` fora do commit.

---

## Notas de verificação / riscos

- **Derivado, não materializado:** `/stock/alerts` recomputa de `levels()` a cada chamada — sem
  tabela/eventos. Consistente com o resto do sistema.
- **`qty == minStock` é ok** (não low) — bordas cobertas no teste puro.
- **Insumo sem `minStock`** só alerta se negativo.
- **Dist do compliance** rebuildado no Chunk 1 (runtime Nest importa `stockAlerts`).
- **Fecha o Ciclo 2** (2a Estoque + 2b Receitas + 2c Decremento/Disponibilidade + 2d Alertas).
```
