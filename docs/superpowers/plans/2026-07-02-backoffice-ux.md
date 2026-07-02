# Backoffice UX Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transformar o `apps/backoffice` (harness de 749 linhas sem CSS) num backoffice usável: tema sóbrio, abas de grupo, dashboard "Hoje", estados de loading/erro/vazio/toast, i18n completo e paginação.

**Architecture:** Frontend React+Vite sem dependências novas — `theme.css` (tokens), 9 componentes `ui/`, shell com abas, roteador hash puro (TDD), `useFetch` com 401→logout; as 12 seções de `App.tsx` viram arquivos em `pages/`. Na API, só leitura: `GET /orders` parametrizado + `GET /orders/summary` (agregado p/ o dashboard).

**Tech Stack:** React 18, Vite 6, vitest 3, react-i18next + `@gelato/i18n`, NestJS + Prisma (Postgres 5433), supertest (e2e).

**Spec:** `docs/superpowers/specs/2026-07-02-backoffice-ux-design.md` (aprovada; commit 9622284). Branch: `backoffice-ux` (off `main` 85a02c7).

## Ambiente (pré-requisito de todos os chunks)

```bash
cd /d/Dev/pessoal/gelatoDE
docker compose -f docker/docker-compose.yml -p gelato_c0 up -d     # Postgres em 127.0.0.1:5433
corepack pnpm --filter @gelato/api exec prisma migrate deploy
corepack pnpm --filter @gelato/api db:seed                          # admin@demo.test / admin123
```

- API ao vivo (quando pedido): `PORT=3001 corepack pnpm --filter @gelato/api exec nest start` (CWD-independente).
- Backoffice preview: config `backoffice` em `.claude/launch.json` (porta 5174); `apps/backoffice/.env.local` já aponta `VITE_API_URL=http://127.0.0.1:3001`. (Defaults do repo: API :3000, Vite :5173 — os overrides são locais, não-commitados.)
- Testes e2e da API usam o banco 5433 (global-setup existente). Rodar sempre de `/d/Dev/pessoal/gelatoDE` com caminhos `--filter`.

---

## Chunk 1: Fundação (router, tema, ui/, shell, pages/)

### Task 1: vitest no backoffice + router hash puro (TDD)

**Files:**
- Modify: `apps/backoffice/package.json`
- Create: `apps/backoffice/src/router.test.ts`
- Create: `apps/backoffice/src/router.ts`

- [ ] **Step 1: Habilitar vitest no pacote**

Em `apps/backoffice/package.json`, adicionar em `"scripts"`: `"test": "vitest run"` e em `"devDependencies"`: `"vitest": "^3.0.5"` (mesma versão do pos-web). Depois:

```bash
corepack pnpm install
```

- [ ] **Step 2: Escrever o teste que falha** — `apps/backoffice/src/router.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { ROUTES, DEFAULT_ROUTE, parseRoute, buildHash } from './router'

describe('parseRoute', () => {
  it('parses a full two-segment hash', () => {
    expect(parseRoute('#/operations/stock')).toEqual({ group: 'operations', page: 'stock' })
    expect(parseRoute('#/fiscal/haccp')).toEqual({ group: 'fiscal', page: 'haccp' })
  })

  it('normalizes a group-only hash to the first page of the group', () => {
    expect(parseRoute('#/today')).toEqual({ group: 'today', page: 'dashboard' })
    expect(parseRoute('#/customers')).toEqual({ group: 'customers', page: 'crm' })
  })

  it('returns null for empty or invalid hashes', () => {
    expect(parseRoute('')).toBeNull()
    expect(parseRoute('#/')).toBeNull()
    expect(parseRoute('#/nope')).toBeNull()
    expect(parseRoute('#/operations/nope')).toBeNull()
    expect(parseRoute('#/a/b/c')).toBeNull()
  })

  it('round-trips every route through buildHash', () => {
    for (const [group, pages] of Object.entries(ROUTES)) {
      for (const page of pages) {
        expect(parseRoute(buildHash({ group, page }))).toEqual({ group, page })
      }
    }
  })

  it('exposes the 5 groups / 13 pages and the default route', () => {
    expect(Object.keys(ROUTES)).toEqual(['today', 'operations', 'catalog', 'customers', 'fiscal'])
    expect(Object.values(ROUTES).flat()).toHaveLength(13)
    expect(DEFAULT_ROUTE).toEqual({ group: 'today', page: 'dashboard' })
  })
})
```

- [ ] **Step 3: Rodar e ver falhar**

```bash
corepack pnpm --filter @gelato/backoffice test
```
Esperado: FAIL (`Cannot find module './router'`).

- [ ] **Step 4: Implementação mínima** — `apps/backoffice/src/router.ts`:

```ts
/** Roteamento por hash, sem dependência. Grupos/páginas da navegação (slugs em inglês). */
export interface Route {
  group: string
  page: string
}

export const ROUTES: Record<string, string[]> = {
  today: ['dashboard'],
  operations: ['stock', 'production', 'checklists'],
  catalog: ['products', 'recipes'],
  customers: ['crm', 'loyalty', 'vouchers', 'campaigns'],
  fiscal: ['sales', 'haccp', 'exports'],
}

export const DEFAULT_ROUTE: Route = { group: 'today', page: 'dashboard' }

export function parseRoute(hash: string): Route | null {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean)
  if (parts.length === 0 || parts.length > 2) return null
  const group = parts[0] ?? ''
  const page = parts[1]
  const pages = ROUTES[group]
  if (!pages) return null
  const first = pages[0]
  if (first === undefined) return null
  if (page === undefined) return { group, page: first }
  if (!pages.includes(page)) return null
  return { group, page }
}

export function buildHash(route: Route): string {
  return `#/${route.group}/${route.page}`
}
```

- [ ] **Step 5: Rodar e ver passar**

```bash
corepack pnpm --filter @gelato/backoffice test
```
Esperado: PASS (5 testes).

- [ ] **Step 6: Commit**

```bash
git add apps/backoffice/package.json apps/backoffice/src/router.ts apps/backoffice/src/router.test.ts pnpm-lock.yaml
git commit -m "feat(backoffice): router hash puro (parseRoute/buildHash) + vitest no pacote"
```

### Task 2: `format.ts` (euro) com teste

**Files:**
- Create: `apps/backoffice/src/format.test.ts`
- Create: `apps/backoffice/src/format.ts`

- [ ] **Step 1: Teste que falha** — `apps/backoffice/src/format.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { euro } from './format'

const norm = (s: string): string => s.replace(/ /g, ' ')

describe('euro', () => {
  it('formats cents as de-DE EUR', () => {
    expect(norm(euro(450))).toBe('4,50 €')
    expect(norm(euro(0))).toBe('0,00 €')
    expect(norm(euro(123456))).toBe('1.234,56 €')
  })
})
```

- [ ] **Step 2: Rodar e ver falhar** — `corepack pnpm --filter @gelato/backoffice test` → FAIL.

- [ ] **Step 3: Implementar** — `apps/backoffice/src/format.ts`:

```ts
/** Dinheiro em cents (Int) → string de-DE. Nunca float no domínio. */
export const euro = (cents: number): string =>
  (cents / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })
```

- [ ] **Step 4: Rodar e ver passar** — `corepack pnpm --filter @gelato/backoffice test` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/backoffice/src/format.ts apps/backoffice/src/format.test.ts
git commit -m "feat(backoffice): format.ts (euro) com teste"
```

### Task 3: `theme.css` (tokens do tema sóbrio + base)

**Files:**
- Create: `apps/backoffice/src/theme.css`
- Modify: `apps/backoffice/src/main.tsx` (adicionar `import './theme.css'` no topo)

- [ ] **Step 1: Criar `apps/backoffice/src/theme.css`** (completo):

```css
:root {
  --bg: #F4F5F7;
  --surface: #FFFFFF;
  --header: #1E2732;
  --header-muted: #9DA9B8;
  --header-border: #3A4656;
  --border: #E2E5EA;
  --text: #232A33;
  --text-muted: #71798A;
  --accent: #185FA5;
  --accent-bright: #378ADD;
  --amber-bg: #FAEEDA; --amber-text: #854F0B; --amber-strong: #633806;
  --red-bg: #FCEBEB; --red-text: #A32D2D; --red-strong: #791F1F;
  --green-bg: #EAF3DE; --green-text: #3B6D11;
  --radius: 8px;
}
* { box-sizing: border-box; }
html, body { margin: 0; background: var(--bg); color: var(--text); font: 14px/1.5 system-ui, 'Segoe UI', sans-serif; }
h1 { font-size: 20px; font-weight: 600; margin: 0 0 16px; }
h2 { font-size: 16px; font-weight: 600; margin: 0 0 8px; }
h3 { font-size: 14px; font-weight: 600; margin: 16px 0 8px; }
ul { padding-left: 20px; }

.topbar { display: flex; align-items: center; gap: 16px; background: var(--header); color: #fff; padding: 10px 20px; }
.brand { font-weight: 600; }
.groups { display: flex; gap: 4px; }
.group-tab { background: none; border: none; color: var(--header-muted); padding: 6px 12px; border-radius: 6px; cursor: pointer; font: inherit; }
.group-tab.active { background: var(--accent-bright); color: #fff; }
.group-tab:hover:not(.active) { color: #fff; }
.topbar-right { margin-left: auto; display: flex; gap: 8px; align-items: center; }
.topbar-right select, .topbar-right button { background: transparent; color: #fff; border: 1px solid var(--header-border); border-radius: 6px; padding: 4px 8px; font: inherit; cursor: pointer; }
.topbar-right select option { color: var(--text); }

.subtabs { display: flex; gap: 16px; background: var(--surface); border-bottom: 1px solid var(--border); padding: 0 20px; }
.subtab { background: none; border: none; border-bottom: 2px solid transparent; padding: 10px 2px; color: var(--text-muted); cursor: pointer; font: inherit; }
.subtab.active { color: var(--text); border-bottom-color: var(--accent); }

.content { max-width: 960px; margin: 0 auto; padding: 24px 20px 64px; }
section { margin: 0 0 24px; }

.card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 16px; margin-bottom: 16px; }
.card-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }

.metrics { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 16px; }
.metric { display: flex; flex-direction: column; gap: 4px; align-items: flex-start; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 14px 16px; cursor: pointer; font: inherit; text-align: left; }
.metric-label { font-size: 12px; color: var(--text-muted); }
.metric-value { font-size: 22px; font-weight: 600; }
.metric-accent .metric-value { color: var(--accent); }
.metric-warning { background: var(--amber-bg); border-color: transparent; }
.metric-warning .metric-label { color: var(--amber-text); }
.metric-warning .metric-value { color: var(--amber-strong); }
.metric-danger { background: var(--red-bg); border-color: transparent; }
.metric-danger .metric-label { color: var(--red-text); }
.metric-danger .metric-value { color: var(--red-strong); }
.metric-success { background: var(--green-bg); border-color: transparent; }
.metric-success .metric-label, .metric-success .metric-value { color: var(--green-text); }

.badge { display: inline-block; border-radius: 999px; padding: 1px 10px; font-size: 12px; }
.badge-warning { background: var(--amber-bg); color: var(--amber-strong); }
.badge-danger { background: var(--red-bg); color: var(--red-strong); }
.badge-success { background: var(--green-bg); color: var(--green-text); }
.badge-neutral { background: var(--bg); color: var(--text-muted); }

table { width: 100%; border-collapse: collapse; background: var(--surface); border: 1px solid var(--border); }
th { text-align: left; font-size: 12px; text-transform: uppercase; letter-spacing: 0.03em; color: var(--text-muted); padding: 8px 12px; border-bottom: 1px solid var(--border); }
td { padding: 8px 12px; border-bottom: 1px solid var(--border); }
tr:last-child td { border-bottom: none; }

input, select { padding: 6px 10px; border: 1px solid var(--border); border-radius: 6px; background: var(--surface); font: inherit; color: inherit; }
input:focus-visible, select:focus-visible, button:focus-visible { outline: 2px solid var(--accent-bright); outline-offset: 1px; }
button { padding: 6px 14px; border: 1px solid var(--border); border-radius: 6px; background: var(--surface); font: inherit; color: inherit; cursor: pointer; }
button:hover { border-color: var(--accent-bright); }
button:disabled { opacity: 0.5; cursor: default; }
.btn-primary { background: var(--accent); border-color: var(--accent); color: #fff; }
.btn-danger { background: var(--red-text); border-color: var(--red-text); color: #fff; }

.spinner { width: 20px; height: 20px; border: 2px solid var(--border); border-top-color: var(--accent); border-radius: 50%; animation: spin 0.8s linear infinite; margin: 12px 0; }
@keyframes spin { to { transform: rotate(360deg); } }

.empty { color: var(--text-muted); padding: 12px 0; }
.error-state { display: flex; gap: 12px; align-items: center; background: var(--red-bg); color: var(--red-strong); border-radius: var(--radius); padding: 10px 14px; margin: 8px 0; }

.toasts { position: fixed; bottom: 16px; right: 16px; display: grid; gap: 8px; z-index: 10; }
.toast { border-radius: var(--radius); padding: 10px 16px; color: #fff; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2); }
.toast-success { background: #3B6D11; }
.toast-error { background: #A32D2D; }

.pagination { display: flex; gap: 8px; align-items: center; margin-top: 8px; }

.login { max-width: 320px; margin: 12vh auto; display: grid; gap: 10px; }
.login label { display: grid; gap: 4px; }
.login-error { color: var(--red-text); }
```

- [ ] **Step 2: Importar no `main.tsx`** — primeira linha de import: `import './theme.css'`.

- [ ] **Step 3: Verificar build** — `corepack pnpm --filter @gelato/backoffice build` → sucesso.

- [ ] **Step 4: Commit**

```bash
git add apps/backoffice/src/theme.css apps/backoffice/src/main.tsx
git commit -m "feat(backoffice): theme.css — tokens do tema sóbrio + estilos base"
```

### Task 4: componentes `ui/` (9 arquivos)

**Files (Create, todos em `apps/backoffice/src/ui/`):** `Card.tsx`, `MetricCard.tsx`, `Badge.tsx`, `Button.tsx`, `Spinner.tsx`, `EmptyState.tsx`, `ErrorState.tsx`, `Toast.tsx`, `Pagination.tsx`

- [ ] **Step 1: Criar os 9 arquivos** (código completo):

`ui/Card.tsx`:
```tsx
import type { ReactNode } from 'react'

export function Card({ title, actions, children }: { title?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="card">
      {(title || actions) && (
        <div className="card-head">
          {title && <h2>{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </div>
  )
}
```

`ui/MetricCard.tsx`:
```tsx
export type Tone = 'neutral' | 'accent' | 'warning' | 'danger' | 'success'

export function MetricCard({ label, value, tone = 'neutral', onClick }: {
  label: string
  value: string
  tone?: Tone
  onClick?: () => void
}) {
  return (
    <button type="button" className={`metric metric-${tone}`} onClick={onClick}>
      <span className="metric-label">{label}</span>
      <span className="metric-value">{value}</span>
    </button>
  )
}
```

`ui/Badge.tsx`:
```tsx
import type { ReactNode } from 'react'
import type { Tone } from './MetricCard'

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>
}
```

`ui/Button.tsx`:
```tsx
import type { ButtonHTMLAttributes } from 'react'

export function Button({ variant = 'default', className, ...rest }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default' | 'primary' | 'danger' }) {
  const cls = variant === 'default' ? '' : `btn-${variant}`
  return <button {...rest} className={[cls, className].filter(Boolean).join(' ') || undefined} />
}
```

`ui/Spinner.tsx`:
```tsx
export function Spinner() {
  return <div className="spinner" role="status" aria-label="loading" />
}
```

`ui/EmptyState.tsx`:
```tsx
export function EmptyState({ message }: { message: string }) {
  return <p className="empty">{message}</p>
}
```

`ui/ErrorState.tsx`:
```tsx
import { useTranslation } from 'react-i18next'

export function ErrorState({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation()
  return (
    <div className="error-state">
      <span>{t('backoffice.common.loadError')}</span>
      <button onClick={onRetry}>{t('backoffice.common.retry')}</button>
    </div>
  )
}
```

`ui/Toast.tsx`:
```tsx
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'

interface ToastMsg { id: number; kind: 'success' | 'error'; text: string }

const ToastCtx = createContext<(kind: ToastMsg['kind'], text: string) => void>(() => {})

export function useToast(): (kind: 'success' | 'error', text: string) => void {
  return useContext(ToastCtx)
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastMsg[]>([])
  const nextId = useRef(1)
  const push = useCallback((kind: ToastMsg['kind'], text: string) => {
    const id = nextId.current++
    setToasts((ts) => [...ts, { id, kind, text }])
    setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), 3500)
  }, [])
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts">
        {toasts.map((x) => (
          <div key={x.id} className={`toast toast-${x.kind}`}>{x.text}</div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}
```

`ui/Pagination.tsx`:
```tsx
export function Pagination({ page, pageCount, onPage }: {
  page: number
  pageCount: number
  onPage: (p: number) => void
}) {
  if (pageCount <= 1) return null
  return (
    <div className="pagination">
      <button disabled={page <= 0} onClick={() => onPage(page - 1)}>‹</button>
      <span>{page + 1} / {pageCount}</span>
      <button disabled={page >= pageCount - 1} onClick={() => onPage(page + 1)}>›</button>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck** — `corepack pnpm --filter @gelato/backoffice typecheck` → 0 erros. (ErrorState referencia chaves i18n que entram na Task 6 — typecheck não valida chaves; ok.)

- [ ] **Step 3: Commit**

```bash
git add apps/backoffice/src/ui
git commit -m "feat(backoffice): componentes ui (Card, MetricCard, Badge, Button, estados, Toast, Pagination)"
```

### Task 5: `useFetch` + 401→logout no seam de `api.ts`

**Files:**
- Create: `apps/backoffice/src/useFetch.ts`
- Modify: `apps/backoffice/src/api.ts`

- [ ] **Step 1: Criar `apps/backoffice/src/useFetch.ts`**:

```tsx
import { useCallback, useEffect, useState } from 'react'

export interface Fetched<T> {
  data: T | null
  loading: boolean
  error: boolean
  reload: () => void
}

/** Contrato padrão de leitura: loading → Spinner, error → ErrorState, data. */
export function useFetch<T>(fn: () => Promise<T>, deps: unknown[]): Fetched<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(false)
    fn()
      .then((d) => { if (alive) { setData(d); setLoading(false) } })
      .catch(() => { if (alive) { setError(true); setLoading(false) } })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick])

  const reload = useCallback(() => setTick((n) => n + 1), [])
  return { data, loading, error, reload }
}
```

- [ ] **Step 2: Modificar `apps/backoffice/src/api.ts`** — no topo (após a linha do `BASE`), adicionar:

```ts
let onUnauthorized: (() => void) | null = null

/** Registrado pelo App: 401 em qualquer chamada → limpa token e volta ao login. */
export function setOnUnauthorized(fn: (() => void) | null): void {
  onUnauthorized = fn
}

function check(res: Response, path: string): void {
  if (res.status === 401) onUnauthorized?.()
  if (!res.ok) throw new Error(`${path} failed`)
}
```

Em `apiGet`, `apiGetBlob`, `apiPut` e `apiPost`, substituir a linha `if (!res.ok) throw new Error(...)` por `check(res, path)`. (`apiLogin` fica como está — 401 no login é senha errada, não sessão expirada.)

Ainda em `api.ts`, adicionar os tipos movidos de `App.tsx` (serão usados na Task 6):

```ts
export interface OrderRow {
  id: string
  ts: string
  mode: string
  totalGross: number
}

export interface ProductRow {
  id: string
  name: string
  netCents: number
}
```

- [ ] **Step 3: Typecheck** — `corepack pnpm --filter @gelato/backoffice typecheck` → 0 erros.

- [ ] **Step 4: Commit**

```bash
git add apps/backoffice/src/useFetch.ts apps/backoffice/src/api.ts
git commit -m "feat(backoffice): useFetch + 401 no seam da api (logout automático)"
```

### Task 6: shell com abas + `App.tsx` quebrado em `pages/`

**Files:**
- Create: `apps/backoffice/src/shell/useRoute.ts`, `apps/backoffice/src/shell/AppShell.tsx`, `apps/backoffice/src/pages/types.ts`, `apps/backoffice/src/pages/Login.tsx`, `apps/backoffice/src/pages/Dashboard.tsx` (stub), e 12 páginas movidas: `Sales.tsx`, `Products.tsx`, `Stock.tsx`, `Recipes.tsx`, `Production.tsx`, `Checklists.tsx`, `ChecklistReports.tsx`, `Customers.tsx`, `Loyalty.tsx`, `Vouchers.tsx`, `Campaigns.tsx`, `Exports.tsx`
- Modify: `apps/backoffice/src/App.tsx` (reescrito), `packages/i18n/src/locales/{de,en,pt}.json`

- [ ] **Step 1: Chaves i18n do shell** — dentro do objeto `"backoffice"` existente de cada locale, adicionar `nav`, `page` e `common` (manter `sales/products/users` por enquanto; serão removidos no Chunk 4):

`de.json`:
```json
"nav": { "today": "Heute", "operations": "Betrieb", "catalog": "Stammdaten", "customers": "Kunden", "fiscal": "Fiskal" },
"page": { "dashboard": "Übersicht", "stock": "Lager", "production": "Produktion", "checklists": "Checklisten (HACCP)", "products": "Produkte", "recipes": "Rezepte", "crm": "Kunden (CRM)", "loyalty": "Treueprogramm", "vouchers": "Gutscheine", "campaigns": "Kampagnen", "sales": "Verkäufe", "haccp": "HACCP-Berichte", "exports": "Exporte (Finanzamt)" },
"common": { "loading": "Lädt…", "retry": "Erneut versuchen", "loadError": "Fehler beim Laden", "empty": "Noch keine Einträge", "saved": "Gespeichert", "actionFailed": "Aktion fehlgeschlagen", "logout": "Abmelden", "loginFailed": "Anmeldung fehlgeschlagen" }
```

`en.json`:
```json
"nav": { "today": "Today", "operations": "Operations", "catalog": "Catalog", "customers": "Customers", "fiscal": "Fiscal" },
"page": { "dashboard": "Overview", "stock": "Stock", "production": "Production", "checklists": "Checklists (HACCP)", "products": "Products", "recipes": "Recipes", "crm": "Customers (CRM)", "loyalty": "Loyalty", "vouchers": "Vouchers", "campaigns": "Campaigns", "sales": "Sales", "haccp": "HACCP reports", "exports": "Exports (Finanzamt)" },
"common": { "loading": "Loading…", "retry": "Try again", "loadError": "Failed to load", "empty": "Nothing here yet", "saved": "Saved", "actionFailed": "Action failed", "logout": "Log out", "loginFailed": "Login failed" }
```

`pt.json`:
```json
"nav": { "today": "Hoje", "operations": "Operação", "catalog": "Cadastros", "customers": "Clientes", "fiscal": "Fiscal" },
"page": { "dashboard": "Visão geral", "stock": "Estoque", "production": "Produção", "checklists": "Checklists (HACCP)", "products": "Produtos", "recipes": "Receitas", "crm": "Clientes (CRM)", "loyalty": "Fidelidade", "vouchers": "Vouchers", "campaigns": "Campanhas", "sales": "Vendas", "haccp": "Relatórios HACCP", "exports": "Exports (Finanzamt)" },
"common": { "loading": "Carregando…", "retry": "Tentar de novo", "loadError": "Falha ao carregar", "empty": "Nada por aqui ainda", "saved": "Salvo", "actionFailed": "Ação falhou", "logout": "Sair", "loginFailed": "Login falhou" }
```

Rodar o teste de paridade: `corepack pnpm --filter @gelato/i18n test` → PASS.

- [ ] **Step 2: Criar `apps/backoffice/src/pages/types.ts`**:

```ts
import type { Route } from '../router'

export interface PageProps {
  token: string
  navigate: (r: Route) => void
}
```

- [ ] **Step 3: Criar `apps/backoffice/src/shell/useRoute.ts`**:

```tsx
import { useEffect, useState } from 'react'
import { DEFAULT_ROUTE, buildHash, parseRoute, type Route } from '../router'

export function useRoute(): { route: Route; navigate: (r: Route) => void } {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash) ?? DEFAULT_ROUTE)

  useEffect(() => {
    const onChange = (): void => setRoute(parseRoute(window.location.hash) ?? DEFAULT_ROUTE)
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])

  return { route, navigate: (r) => { window.location.hash = buildHash(r) } }
}
```

- [ ] **Step 4: Criar `apps/backoffice/src/shell/AppShell.tsx`**:

```tsx
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { SUPPORTED_LOCALES } from '@gelato/i18n'
import { ROUTES, type Route } from '../router'

export function AppShell({ route, navigate, onLogout, children }: {
  route: Route
  navigate: (r: Route) => void
  onLogout: () => void
  children: ReactNode
}) {
  const { t, i18n } = useTranslation()
  const pages = ROUTES[route.group] ?? []
  return (
    <div>
      <header className="topbar">
        <span className="brand">{t('common.appName')}</span>
        <nav className="groups">
          {Object.entries(ROUTES).map(([g, gPages]) => (
            <button
              key={g}
              className={g === route.group ? 'group-tab active' : 'group-tab'}
              onClick={() => navigate({ group: g, page: gPages[0] ?? 'dashboard' })}
            >
              {t(`backoffice.nav.${g}`)}
            </button>
          ))}
        </nav>
        <div className="topbar-right">
          <select value={i18n.language} onChange={(e) => void i18n.changeLanguage(e.target.value)}>
            {SUPPORTED_LOCALES.map((l) => (
              <option key={l} value={l}>{l.toUpperCase()}</option>
            ))}
          </select>
          <button onClick={onLogout}>{t('backoffice.common.logout')}</button>
        </div>
      </header>
      {pages.length > 1 && (
        <nav className="subtabs">
          {pages.map((p) => (
            <button
              key={p}
              className={p === route.page ? 'subtab active' : 'subtab'}
              onClick={() => navigate({ group: route.group, page: p })}
            >
              {t(`backoffice.page.${p}`)}
            </button>
          ))}
        </nav>
      )}
      <main className="content">
        <h1>{t(`backoffice.page.${route.page}`)}</h1>
        {children}
      </main>
    </div>
  )
}
```

- [ ] **Step 5: Criar `apps/backoffice/src/pages/Login.tsx`** (movido de App.tsx linhas 76–111, com classes do tema e chave de erro):

```tsx
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { apiLogin } from '../api'

export function Login({ onLogin }: { onLogin: (token: string) => void }) {
  const { t } = useTranslation()
  const [email, setEmail] = useState('admin@demo.test')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(false)

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault()
    setError(false)
    try {
      const result = await apiLogin(email, password)
      onLogin(result.access_token)
    } catch {
      setError(true)
    }
  }

  return (
    <form onSubmit={submit} className="card login">
      <h1>{t('common.appName')}</h1>
      <label>
        {t('auth.login.email')}
        <input value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label>
        {t('auth.login.password')}
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </label>
      <button type="submit" className="btn-primary">{t('auth.login.submit')}</button>
      {error && <span className="login-error">{t('backoffice.common.loginFailed')}</span>}
    </form>
  )
}
```

- [ ] **Step 6: Criar `apps/backoffice/src/pages/Dashboard.tsx`** (stub — preenchido no Chunk 3):

```tsx
import type { PageProps } from './types'

export function Dashboard(_props: PageProps) {
  return null
}
```

- [ ] **Step 7: Mover as 12 seções de `App.tsx` para `pages/`** — recortar cada função de `App.tsx` (linhas na numeração ATUAL do arquivo, antes de qualquer edição) para o arquivo indicado, adicionar `export` na função e o cabeçalho de imports exato:

| Página | Linhas em App.tsx | Cabeçalho de imports do novo arquivo |
|---|---|---|
| `Sales.tsx` (113–144) | `import { useEffect, useState } from 'react'` · `import { useTranslation } from 'react-i18next'` · `import { apiGet, type OrderRow } from '../api'` · `import { euro } from '../format'` — trocar o tipo local `Order` por `OrderRow` |
| `Products.tsx` (146–168) | `import { useEffect, useState } from 'react'` · `import { useTranslation } from 'react-i18next'` · `import { apiGet, type ProductRow } from '../api'` · `import { euro } from '../format'` — trocar `Product` por `ProductRow` |
| `Stock.tsx` (170–248) | `import { useEffect, useState, type FormEvent } from 'react'` · `import { apiGet, apiPost, type StockLevel, type StockAlert } from '../api'` |
| `Recipes.tsx` (250–286) | `import { useEffect, useState } from 'react'` · `import { apiGet, type RecipeRow, type Availability } from '../api'` |
| `Checklists.tsx` (288–374, inclui `fmtRange`) | `import { useEffect, useState } from 'react'` · `import { apiGet, apiPost, type ChecklistTemplateRow, type ChecklistRunRow } from '../api'` — `fmtRange` vai junto (não exportado) |
| `ChecklistReports.tsx` (376–422) | `import { useEffect, useState } from 'react'` · `import { apiGet, type ChecklistStatusRow, type ChecklistDeviationRow } from '../api'` |
| `Customers.tsx` (424–461) | `import { useEffect, useState } from 'react'` · `import { apiGet, apiPost, type CustomerRow } from '../api'` |
| `Loyalty.tsx` (463–513) | `import { useEffect, useState } from 'react'` · `import { apiGet, apiPut, type CustomerRow, type LoyaltyProgram, type LoyaltyView } from '../api'` |
| `Vouchers.tsx` (515–574) | `import { useEffect, useState, type FormEvent } from 'react'` · `import { apiGet, apiPost, type VoucherRow } from '../api'` · `import { euro } from '../format'` |
| `Campaigns.tsx` (576–637) | `import { useEffect, useState, type FormEvent } from 'react'` · `import { apiGet, apiPost, type CampaignRow } from '../api'` |
| `Production.tsx` (639–682) | `import { useEffect, useState } from 'react'` · `import { apiGet, apiPost, type ProductionRecipeRow } from '../api'` |
| `Exports.tsx` (684–749, inclui a interface `Kasse` local) | `import { useEffect, useState } from 'react'` · `import { apiGet, apiGetBlob } from '../api'` |

O corpo de cada componente fica **idêntico** (estados/erros/i18n mudam só no Chunk 4). As interfaces `Order`/`Product` (linhas 6–17) e o `euro` (19–20) saem de `App.tsx` (já existem em `api.ts`/`format.ts`).

- [ ] **Step 8: Reescrever `apps/backoffice/src/App.tsx`** (conteúdo completo):

```tsx
import { useEffect, useState, type ComponentType } from 'react'
import { setOnUnauthorized } from './api'
import { useRoute } from './shell/useRoute'
import { AppShell } from './shell/AppShell'
import { ToastProvider } from './ui/Toast'
import type { PageProps } from './pages/types'
import { Login } from './pages/Login'
import { Dashboard } from './pages/Dashboard'
import { Sales } from './pages/Sales'
import { Products } from './pages/Products'
import { Stock } from './pages/Stock'
import { Recipes } from './pages/Recipes'
import { Production } from './pages/Production'
import { Checklists } from './pages/Checklists'
import { ChecklistReports } from './pages/ChecklistReports'
import { Customers } from './pages/Customers'
import { Loyalty } from './pages/Loyalty'
import { Vouchers } from './pages/Vouchers'
import { Campaigns } from './pages/Campaigns'
import { Exports } from './pages/Exports'

const PAGES: Record<string, ComponentType<PageProps>> = {
  dashboard: Dashboard,
  stock: Stock,
  production: Production,
  checklists: Checklists,
  products: Products,
  recipes: Recipes,
  crm: Customers,
  loyalty: Loyalty,
  vouchers: Vouchers,
  campaigns: Campaigns,
  sales: Sales,
  haccp: ChecklistReports,
  exports: Exports,
}

export function App() {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('token'))
  const { route, navigate } = useRoute()

  useEffect(() => {
    setOnUnauthorized(() => {
      localStorage.removeItem('token')
      setToken(null)
    })
    return () => setOnUnauthorized(null)
  }, [])

  if (!token) {
    return (
      <Login
        onLogin={(tk) => {
          localStorage.setItem('token', tk)
          setToken(tk)
        }}
      />
    )
  }

  const Page = PAGES[route.page] ?? Dashboard
  return (
    <ToastProvider>
      <AppShell
        route={route}
        navigate={navigate}
        onLogout={() => {
          localStorage.removeItem('token')
          setToken(null)
        }}
      >
        <Page token={token} navigate={navigate} />
      </AppShell>
    </ToastProvider>
  )
}
```

Nota de tipos: componentes que declaram só `{ token }: { token: string }` são atribuíveis a `ComponentType<PageProps>` (aceitam um superset de props) — não é preciso mudar as assinaturas das páginas movidas.

- [ ] **Step 9: Build + typecheck + testes**

```bash
corepack pnpm --filter @gelato/backoffice typecheck
corepack pnpm --filter @gelato/backoffice build
corepack pnpm --filter @gelato/backoffice test
corepack pnpm --filter @gelato/i18n test
```
Esperado: tudo verde.

- [ ] **Step 10: Commit**

```bash
git add apps/backoffice/src packages/i18n/src/locales
git commit -m "feat(backoffice): shell com abas de grupo + App.tsx dividido em pages/"
```

---

## Chunk 2: API (`GET /orders` params + `/orders/summary`) + página Vendas

### Task 7: e2e dos query params + summary (TDD)

**Files:**
- Create: `apps/api/test/orders-query.e2e.test.ts`
- Modify: `apps/api/src/orders/orders.controller.ts`

- [ ] **Step 1: Escrever o e2e que falha** — `apps/api/test/orders-query.e2e.test.ts` (completo).

A suíte roda arquivos em paralelo contra o mesmo banco (5433), e vários testes inserem vendas do demo-tenant "agora". Por isso a fixture usa uma **janela histórica única por execução** (~200 anos atrás + os ms do relógio da execução): determinística dentro do run, sem colisão entre runs nem com testes concorrentes. Os INSERTs diretos via Prisma são permitidos (ledger é append-only; só UPDATE/DELETE são proibidos).

```ts
import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AppModule } from '../src/app.module'
import { PrismaService } from '../src/prisma/prisma.service'

const WINDOW_START = new Date(Date.now() - 200 * 365 * 24 * 3600 * 1000)
const WINDOW_END = new Date(WINDOW_START.getTime() + 24 * 3600 * 1000)
const at = (hours: number): Date => new Date(WINDOW_START.getTime() + hours * 3600 * 1000)
const iso = (d: Date): string => d.toISOString()

describe('GET /orders query params + GET /orders/summary (e2e)', () => {
  let app: INestApplication
  let server: ReturnType<INestApplication['getHttpServer']>
  let token: string
  let foreignId: string

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = moduleRef.createNestApplication()
    await app.init()
    server = app.getHttpServer()
    const login = await request(server)
      .post('/auth/login')
      .send({ email: 'admin@demo.test', password: 'admin123' })
    token = login.body.access_token

    // Fixture: 3 orders do demo-tenant na janela + 1 order de OUTRO tenant na mesma janela.
    const prisma = app.get(PrismaService)
    const mk = (hours: number, gross: number) => ({
      clientEventId: crypto.randomUUID(),
      kasseId: 'demo-kasse',
      mode: 'ausser_haus',
      totalNet: gross,
      totalMwst: 0,
      totalGross: gross,
      ts: at(hours),
    })
    await prisma.order.create({ data: mk(1, 111) })
    await prisma.order.create({ data: mk(2, 222) })
    await prisma.order.create({ data: mk(3, 333) })

    const suffix = crypto.randomUUID().slice(0, 8)
    const t2 = await prisma.tenant.create({ data: { name: `t2-${suffix}` } })
    const bs2 = await prisma.betriebsstaette.create({ data: { tenantId: t2.id, name: 'bs2' } })
    const k2 = await prisma.kasse.create({ data: { betriebsstaetteId: bs2.id, name: 'k2' } })
    const foreign = await prisma.order.create({
      data: {
        clientEventId: crypto.randomUUID(),
        kasseId: k2.id,
        mode: 'ausser_haus',
        totalNet: 777001,
        totalMwst: 0,
        totalGross: 777001,
        ts: at(4),
      },
    })
    foreignId = foreign.id
  }, 30000)

  afterAll(async () => {
    await app?.close()
  })

  const get = (path: string) => request(server).get(path).set('Authorization', `Bearer ${token}`)
  const windowQ = `from=${iso(WINDOW_START)}&to=${iso(WINDOW_END)}`

  it('from/to filter the window and exclude the foreign tenant', async () => {
    const res = await get(`/orders?${windowQ}&limit=500`)
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(3)
    expect(res.body.map((o: { totalGross: number }) => o.totalGross)).toEqual([333, 222, 111])
    expect(res.body.some((o: { id: string }) => o.id === foreignId)).toBe(false)
  })

  it('limit caps the page and keeps ts desc', async () => {
    const res = await get(`/orders?${windowQ}&limit=2`)
    expect(res.body.map((o: { totalGross: number }) => o.totalGross)).toEqual([333, 222])
  })

  it('offset pages the window deterministically', async () => {
    const res = await get(`/orders?${windowQ}&limit=2&offset=2`)
    expect(res.body).toHaveLength(1)
    expect(res.body[0].totalGross).toBe(111)
  })

  it('rejects invalid params with 400', async () => {
    for (const q of ['limit=0', 'limit=501', 'limit=abc', 'offset=-1', 'from=banana', 'to=banana']) {
      const res = await get(`/orders?${q}`)
      expect(res.status, q).toBe(400)
    }
  })

  it('without params keeps the previous behavior (array, up to 100)', async () => {
    const res = await get('/orders')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
    expect(res.body.length).toBeLessThanOrEqual(100)
  })

  it('summary aggregates exactly the tenant orders in the window (foreign excluded)', async () => {
    const res = await get(`/orders/summary?${windowQ}`)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ count: 3, totalGross: 666 })
  })

  it('summary of an empty window is zero', async () => {
    const from = iso(new Date(WINDOW_START.getTime() - 2000))
    const to = iso(new Date(WINDOW_START.getTime() - 1000))
    const res = await get(`/orders/summary?from=${from}&to=${to}`)
    expect(res.body).toEqual({ count: 0, totalGross: 0 })
  })

  it('summary rejects invalid dates with 400', async () => {
    const res = await get('/orders/summary?from=banana')
    expect(res.status).toBe(400)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
corepack pnpm --filter @gelato/api exec vitest run test/orders-query.e2e.test.ts
```
Esperado: FAIL — `from`/`to`/`limit` são ignorados (a janela devolve as ~100 orders recentes, não 3), `/orders/summary` → 404, params inválidos → 200.

- [ ] **Step 3: Implementar** — reescrever `apps/api/src/orders/orders.controller.ts` (completo):

```ts
import { BadRequestException, Controller, Get, Query, Req, UseGuards } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { JwtAuthGuard, type JwtUser } from '../auth/jwt-auth.guard'
import { PermissionsGuard } from '../rbac/permissions.guard'
import { RequirePermission } from '../rbac/require-permission.decorator'

function intParam(value: string | undefined, name: string, min: number, max: number, dflt: number): number {
  if (value === undefined) return dflt
  const n = Number(value)
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new BadRequestException(`${name} must be an integer between ${min} and ${max}`)
  }
  return n
}

function dateParam(value: string | undefined, name: string): Date | undefined {
  if (value === undefined) return undefined
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) throw new BadRequestException(`${name} must be an ISO date-time`)
  return d
}

function tsWindow(from?: Date, to?: Date): { ts?: { gte?: Date; lt?: Date } } {
  if (!from && !to) return {}
  return { ts: { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) } }
}

/** Leitura do ledger imutável (lista de vendas + agregado) para o backoffice. Read-only. */
@Controller('orders')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class OrdersController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('summary')
  @RequirePermission('pos.report.x')
  async summary(
    @Req() req: { user: JwtUser },
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const agg = await this.prisma.order.aggregate({
      where: {
        kasse: { betriebsstaette: { tenantId: req.user.tenant_id } },
        ...tsWindow(dateParam(from, 'from'), dateParam(to, 'to')),
      },
      _count: { _all: true },
      _sum: { totalGross: true },
    })
    return { count: agg._count._all, totalGross: agg._sum.totalGross ?? 0 }
  }

  @Get()
  @RequirePermission('pos.report.x')
  list(
    @Req() req: { user: JwtUser },
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.prisma.order.findMany({
      where: {
        kasse: { betriebsstaette: { tenantId: req.user.tenant_id } },
        ...tsWindow(dateParam(from, 'from'), dateParam(to, 'to')),
      },
      orderBy: { ts: 'desc' },
      take: intParam(limit, 'limit', 1, 500, 100),
      skip: intParam(offset, 'offset', 0, 1_000_000, 0),
      select: {
        id: true,
        ts: true,
        mode: true,
        totalNet: true,
        totalMwst: true,
        totalGross: true,
        kasseId: true,
      },
    })
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

```bash
corepack pnpm --filter @gelato/api exec vitest run test/orders-query.e2e.test.ts
corepack pnpm --filter @gelato/api exec vitest run test/orders.e2e.test.ts
```
Esperado: PASS nos dois (o e2e antigo prova a compatibilidade sem params).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/orders/orders.controller.ts apps/api/test/orders-query.e2e.test.ts
git commit -m "feat(api): GET /orders com limit/offset/from/to + GET /orders/summary (leitura do ledger)"
```

### Task 8: página Vendas com "carregar mais"

**Files:**
- Modify: `apps/backoffice/src/pages/Sales.tsx` (reescrita), `packages/i18n/src/locales/{de,en,pt}.json`

- [ ] **Step 1: Chaves i18n** — em `"backoffice"."sales"` de cada locale, adicionar `loadMore` e `date` (manter `title` até o Chunk 4): DE `"loadMore": "Mehr laden", "date": "Datum"`; EN `"loadMore": "Load more", "date": "Date"`; PT `"loadMore": "Carregar mais", "date": "Data"`. Rodar `corepack pnpm --filter @gelato/i18n test` → PASS.

- [ ] **Step 2: Reescrever `apps/backoffice/src/pages/Sales.tsx`** (completo — este é o modelo do contrato de estados que o Chunk 4 replica):

```tsx
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { apiGet, type OrderRow } from '../api'
import { useFetch } from '../useFetch'
import { euro } from '../format'
import { Spinner } from '../ui/Spinner'
import { ErrorState } from '../ui/ErrorState'
import { EmptyState } from '../ui/EmptyState'

const PAGE = 25

export function Sales({ token }: { token: string }) {
  const { t } = useTranslation()
  const [extra, setExtra] = useState<OrderRow[]>([])
  const [end, setEnd] = useState(false)
  const first = useFetch(() => apiGet<OrderRow[]>(`/orders?limit=${PAGE}`, token), [token])

  async function loadMore(): Promise<void> {
    const offset = PAGE + extra.length
    const next = await apiGet<OrderRow[]>(`/orders?limit=${PAGE}&offset=${offset}`, token)
    setExtra((xs) => [...xs, ...next])
    if (next.length < PAGE) setEnd(true)
  }

  if (first.loading) return <Spinner />
  if (first.error) return <ErrorState onRetry={first.reload} />
  const orders = [...(first.data ?? []), ...extra]
  if (orders.length === 0) return <EmptyState message={t('backoffice.common.empty')} />

  return (
    <section>
      <table>
        <thead>
          <tr>
            <th>{t('backoffice.sales.date')}</th>
            <th>{t('pos.mode.label')}</th>
            <th align="right">{t('pos.receipt.total')}</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o.id}>
              <td>{new Date(o.ts).toLocaleString('de-DE')}</td>
              <td>{t(`pos.mode.${o.mode}`)}</td>
              <td align="right">{euro(o.totalGross)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!end && (first.data?.length ?? 0) === PAGE && (
        <button onClick={() => void loadMore()} style={{ marginTop: 8 }}>
          {t('backoffice.sales.loadMore')}
        </button>
      )}
    </section>
  )
}
```

- [ ] **Step 3: Typecheck + build** — `corepack pnpm --filter @gelato/backoffice typecheck && corepack pnpm --filter @gelato/backoffice build` → verde.

- [ ] **Step 4: Commit**

```bash
git add apps/backoffice/src/pages/Sales.tsx packages/i18n/src/locales
git commit -m "feat(backoffice): página Vendas com carregar mais (paginação server-side)"
```

---

## Chunk 3: Dashboard "Hoje"

### Task 9: `todayRange` (TDD)

**Files:**
- Create: `apps/backoffice/src/date-util.test.ts`
- Create: `apps/backoffice/src/date-util.ts`

- [ ] **Step 1: Teste que falha** — `apps/backoffice/src/date-util.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { todayRange } from './date-util'

describe('todayRange', () => {
  it('returns local midnight of the given instant', () => {
    const { from } = todayRange(new Date(2026, 6, 2, 15, 42, 7))
    expect([from.getFullYear(), from.getMonth(), from.getDate()]).toEqual([2026, 6, 2])
    expect([from.getHours(), from.getMinutes(), from.getSeconds(), from.getMilliseconds()]).toEqual([0, 0, 0, 0])
  })

  it('is idempotent at midnight', () => {
    const d = new Date(2026, 0, 1, 0, 0, 0, 0)
    expect(todayRange(d).from.getTime()).toBe(d.getTime())
  })
})
```

- [ ] **Step 2: Rodar e ver falhar** — `corepack pnpm --filter @gelato/backoffice test` → FAIL.

- [ ] **Step 3: Implementar** — `apps/backoffice/src/date-util.ts`:

```ts
/** Início do dia LOCAL do instante dado (p/ "Vendas hoje" do dashboard). */
export function todayRange(now: Date): { from: Date } {
  return { from: new Date(now.getFullYear(), now.getMonth(), now.getDate()) }
}
```

- [ ] **Step 4: Rodar e ver passar** — `corepack pnpm --filter @gelato/backoffice test` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/backoffice/src/date-util.ts apps/backoffice/src/date-util.test.ts
git commit -m "feat(backoffice): todayRange (início do dia local) com teste"
```

### Task 10: página Dashboard

**Files:**
- Modify: `apps/backoffice/src/api.ts` (tipo `OrdersSummary`), `apps/backoffice/src/pages/Dashboard.tsx` (substitui o stub), `packages/i18n/src/locales/{de,en,pt}.json`

- [ ] **Step 1: Tipo em `api.ts`**:

```ts
export interface OrdersSummary {
  count: number
  totalGross: number
}
```

- [ ] **Step 2: Chaves i18n** — em `"backoffice"` de cada locale, adicionar `"dashboard"`: DE `{ "salesToday": "Verkäufe heute", "stockAlerts": "Lagerwarnungen", "haccpOverdue": "HACCP überfällig", "lastSales": "Letzte Verkäufe" }`; EN `{ "salesToday": "Sales today", "stockAlerts": "Stock alerts", "haccpOverdue": "HACCP overdue", "lastSales": "Last sales" }`; PT `{ "salesToday": "Vendas hoje", "stockAlerts": "Alertas de estoque", "haccpOverdue": "HACCP atrasado", "lastSales": "Últimas vendas" }`. `corepack pnpm --filter @gelato/i18n test` → PASS.

- [ ] **Step 3: Reescrever `apps/backoffice/src/pages/Dashboard.tsx`** (completo):

```tsx
import { useTranslation } from 'react-i18next'
import { apiGet, type ChecklistStatusRow, type OrderRow, type OrdersSummary, type StockAlert } from '../api'
import { useFetch } from '../useFetch'
import { euro } from '../format'
import { todayRange } from '../date-util'
import { MetricCard } from '../ui/MetricCard'
import { Spinner } from '../ui/Spinner'
import { ErrorState } from '../ui/ErrorState'
import { EmptyState } from '../ui/EmptyState'
import type { PageProps } from './types'

export function Dashboard({ token, navigate }: PageProps) {
  const { t } = useTranslation()
  const fromIso = todayRange(new Date()).from.toISOString()
  const summary = useFetch(
    () => apiGet<OrdersSummary>(`/orders/summary?from=${encodeURIComponent(fromIso)}`, token),
    [token],
  )
  const alerts = useFetch(() => apiGet<StockAlert[]>('/stock/alerts', token), [token])
  const status = useFetch(() => apiGet<ChecklistStatusRow[]>('/checklists/status', token), [token])
  const last = useFetch(() => apiGet<OrderRow[]>('/orders?limit=10', token), [token])

  const alertCount = (alerts.data ?? []).length
  const overdue = (status.data ?? []).filter((s) => s.overdue).length

  return (
    <section>
      <div className="metrics">
        <MetricCard
          label={t('backoffice.dashboard.salesToday')}
          tone="accent"
          value={summary.loading ? '…' : summary.error ? '—' : euro(summary.data?.totalGross ?? 0)}
          onClick={() => navigate({ group: 'fiscal', page: 'sales' })}
        />
        <MetricCard
          label={t('backoffice.dashboard.stockAlerts')}
          tone={alertCount > 0 ? 'warning' : 'neutral'}
          value={alerts.loading ? '…' : alerts.error ? '—' : String(alertCount)}
          onClick={() => navigate({ group: 'operations', page: 'stock' })}
        />
        <MetricCard
          label={t('backoffice.dashboard.haccpOverdue')}
          tone={overdue > 0 ? 'danger' : 'success'}
          value={status.loading ? '…' : status.error ? '—' : String(overdue)}
          onClick={() => navigate({ group: 'fiscal', page: 'haccp' })}
        />
      </div>
      <h3>{t('backoffice.dashboard.lastSales')}</h3>
      {last.loading && <Spinner />}
      {last.error && <ErrorState onRetry={last.reload} />}
      {last.data && last.data.length === 0 && <EmptyState message={t('backoffice.common.empty')} />}
      {last.data && last.data.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>{t('backoffice.sales.date')}</th>
              <th>{t('pos.mode.label')}</th>
              <th align="right">{t('pos.receipt.total')}</th>
            </tr>
          </thead>
          <tbody>
            {last.data.map((o) => (
              <tr key={o.id}>
                <td>{new Date(o.ts).toLocaleString('de-DE')}</td>
                <td>{t(`pos.mode.${o.mode}`)}</td>
                <td align="right">{euro(o.totalGross)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
```

- [ ] **Step 4: Typecheck + build + testes** — `corepack pnpm --filter @gelato/backoffice typecheck && corepack pnpm --filter @gelato/backoffice build && corepack pnpm --filter @gelato/backoffice test` → verde.

- [ ] **Step 5: Commit**

```bash
git add apps/backoffice/src packages/i18n/src/locales
git commit -m "feat(backoffice): dashboard Hoje (vendas do dia, alertas, HACCP, últimas vendas)"
```

---

## Chunk 4: Acabamento (i18n completo, estados em todas as páginas, verificação live, integrar)

### Task 11: chaves i18n `backoffice.*` completas

**Files:**
- Modify: `packages/i18n/src/locales/{de,en,pt}.json`

- [ ] **Step 1: Adicionar os blocos por página** dentro de `"backoffice"` (os três locales de uma vez; interpolação i18next `{{var}}`). O bloco `sales` abaixo **substitui** o antigo `"sales": { "title": … }` (a página Vendas já não usa `title` desde o Chunk 2). **Manter** `"products": { "title" }` e `"users": { "title" }` por enquanto — `Products.tsx` ainda usa o primeiro até a Task 12; a remoção é o Step 5 da Task 12 (mantém cada commit consistente):

`de.json`:
```json
"sales": { "loadMore": "Mehr laden", "date": "Datum" },
"stock": { "item": "Zutat", "unit": "Einheit", "current": "Bestand", "min": "Min.", "receive": "Wareneingang", "count": "Inventur", "qty": "Menge", "selectItem": "— Zutat wählen —", "alerts": "{{count}} Warnung(en):", "negative": "negativ" },
"recipes": { "yields": "ergibt {{count}}", "inactive": "inaktiv" },
"production": { "yieldPerBatch": "ergibt {{qty}} {{unit}}/Charge", "batches": "Chargen", "produce": "Produzieren", "produced": "Produziert" },
"checklists": { "run": "— Vorlage ausführen —", "submit": "Absenden", "history": "Verlauf", "corrective": "Korrekturmaßnahme (bei Abweichung)", "submitFailed": "Fehler — Werte und Korrekturmaßnahmen prüfen", "deviations": "{{count}} Abweichung(en)" },
"haccp": { "status": "Status", "checklist": "Checkliste", "recurrence": "Rhythmus", "last": "Zuletzt", "state": "Zustand", "overdue": "ÜBERFÄLLIG", "recentDeviations": "Letzte Abweichungen" },
"crm": { "name": "Name", "contact": "Kontakt", "consents": "Einwilligungen", "anonymize": "Anonymisieren (DSGVO)", "anonymized": "— anonymisiert —" },
"loyalty": { "pointsPerEuro": "Punkte/€", "stampsPerItem": "Stempel/Artikel", "active": "Aktiv", "save": "Speichern", "showBalance": "Saldo anzeigen", "balance": "{{points}} Pkt. / {{stamps}} Stempel" },
"vouchers": { "code": "Code", "type": "Typ", "value": "Wert", "uses": "Einlösungen", "active": "Aktiv", "create": "Anlegen" },
"campaigns": { "name": "Name", "channel": "Kanal", "status": "Status", "recipients": "Empfänger", "send": "Senden", "create": "Anlegen", "message": "Nachricht" },
"exports": { "from": "von", "to": "bis" },
"dashboard": { "salesToday": "Verkäufe heute", "stockAlerts": "Lagerwarnungen", "haccpOverdue": "HACCP überfällig", "lastSales": "Letzte Verkäufe" }
```

`en.json`:
```json
"sales": { "loadMore": "Load more", "date": "Date" },
"stock": { "item": "Item", "unit": "Unit", "current": "Current", "min": "Min.", "receive": "Receive", "count": "Count", "qty": "Quantity", "selectItem": "— select item —", "alerts": "{{count}} alert(s):", "negative": "negative" },
"recipes": { "yields": "makes {{count}}", "inactive": "inactive" },
"production": { "yieldPerBatch": "yields {{qty}} {{unit}}/batch", "batches": "batches", "produce": "Produce", "produced": "Produced" },
"checklists": { "run": "— run template —", "submit": "Submit", "history": "History", "corrective": "corrective action (if deviation)", "submitFailed": "Failed — check values and corrective actions", "deviations": "{{count}} deviation(s)" },
"haccp": { "status": "Status", "checklist": "Checklist", "recurrence": "Recurrence", "last": "Last", "state": "State", "overdue": "OVERDUE", "recentDeviations": "Recent deviations" },
"crm": { "name": "Name", "contact": "Contact", "consents": "Consents", "anonymize": "Anonymize (GDPR)", "anonymized": "— anonymized —" },
"loyalty": { "pointsPerEuro": "Points/€", "stampsPerItem": "Stamps/item", "active": "Active", "save": "Save", "showBalance": "Show balance", "balance": "{{points}} pts / {{stamps}} stamps" },
"vouchers": { "code": "Code", "type": "Type", "value": "Value", "uses": "Uses", "active": "Active", "create": "Create" },
"campaigns": { "name": "Name", "channel": "Channel", "status": "Status", "recipients": "Recipients", "send": "Send", "create": "Create", "message": "Message" },
"exports": { "from": "from", "to": "to" },
"dashboard": { "salesToday": "Sales today", "stockAlerts": "Stock alerts", "haccpOverdue": "HACCP overdue", "lastSales": "Last sales" }
```

`pt.json`:
```json
"sales": { "loadMore": "Carregar mais", "date": "Data" },
"stock": { "item": "Insumo", "unit": "Unidade", "current": "Atual", "min": "Mín.", "receive": "Entrada", "count": "Contagem", "qty": "Quantidade", "selectItem": "— insumo —", "alerts": "{{count}} em alerta:", "negative": "negativo" },
"recipes": { "yields": "dá p/ {{count}}", "inactive": "inativa" },
"production": { "yieldPerBatch": "rende {{qty}} {{unit}}/lote", "batches": "lotes", "produce": "Produzir", "produced": "Produzido" },
"checklists": { "run": "— executar template —", "submit": "Submeter", "history": "Histórico", "corrective": "ação corretiva (se desvio)", "submitFailed": "Falha — confira valores e ações corretivas", "deviations": "{{count}} desvio(s)" },
"haccp": { "status": "Status", "checklist": "Checklist", "recurrence": "Recorrência", "last": "Último", "state": "Estado", "overdue": "ATRASADO", "recentDeviations": "Desvios recentes" },
"crm": { "name": "Nome", "contact": "Contato", "consents": "Consentimentos", "anonymize": "Anonimizar (DSGVO)", "anonymized": "— anonimizado —" },
"loyalty": { "pointsPerEuro": "Pontos/€", "stampsPerItem": "Carimbos/item", "active": "Ativo", "save": "Salvar", "showBalance": "Ver saldo", "balance": "{{points}} pts / {{stamps}} carimbos" },
"vouchers": { "code": "Código", "type": "Tipo", "value": "Valor", "uses": "Usos", "active": "Ativo", "create": "Criar" },
"campaigns": { "name": "Nome", "channel": "Canal", "status": "Status", "recipients": "Destinatários", "send": "Enviar", "create": "Criar", "message": "Mensagem" },
"exports": { "from": "de", "to": "até" },
"dashboard": { "salesToday": "Vendas hoje", "stockAlerts": "Alertas de estoque", "haccpOverdue": "HACCP atrasado", "lastSales": "Últimas vendas" }
```

Nota: o Chunk 3 já criou `"dashboard"` e o Chunk 2 `"sales"` — aqui só conferir que ficaram idênticos aos blocos acima (sem duplicar).

- [ ] **Step 2: Paridade** — `corepack pnpm --filter @gelato/i18n test` → PASS. Se o teste apontar chave órfã, é porque algum locale divergiu — igualar os três.

- [ ] **Step 3: Commit**

```bash
git add packages/i18n/src/locales
git commit -m "feat(i18n): chaves backoffice.* completas (DE/EN/PT) para o novo shell"
```

### Task 12: estados + i18n + paginação em todas as páginas

**Files:**
- Modify: todos os `apps/backoffice/src/pages/*.tsx` exceto `Login`, `Sales`, `Dashboard`, `types`

O contrato (já demonstrado em `Sales.tsx`/`Dashboard.tsx`): leituras via `useFetch`; `loading → <Spinner/>`, `error → <ErrorState onRetry={x.reload}/>`, lista vazia → `<EmptyState message={t('backoffice.common.empty')}/>`; mutações em `try/catch` com `toast('success', t('backoffice.common.saved'))` + `reload()` no sucesso e `toast('error', t('backoffice.common.actionFailed'))` na falha; strings hardcoded → chaves da Task 11; `<h2>` de seção some (título vem do shell). Páginas com vários fetches rendem estado **por bloco**.

- [ ] **Step 1: Reescrever `pages/Products.tsx`** (exemplo trabalhado completo — página só-leitura):

```tsx
import { useTranslation } from 'react-i18next'
import { apiGet, type ProductRow } from '../api'
import { useFetch } from '../useFetch'
import { euro } from '../format'
import { Spinner } from '../ui/Spinner'
import { ErrorState } from '../ui/ErrorState'
import { EmptyState } from '../ui/EmptyState'

export function Products({ token }: { token: string }) {
  const { t } = useTranslation()
  const products = useFetch(() => apiGet<ProductRow[]>('/products', token), [token])

  if (products.loading) return <Spinner />
  if (products.error) return <ErrorState onRetry={products.reload} />
  if (!products.data || products.data.length === 0) {
    return <EmptyState message={t('backoffice.common.empty')} />
  }

  return (
    <section>
      <ul>
        {products.data.map((p) => (
          <li key={p.id}>
            {p.name} — {euro(p.netCents)}
          </li>
        ))}
      </ul>
    </section>
  )
}
```

- [ ] **Step 2: Reescrever `pages/Stock.tsx`** (exemplo trabalhado completo — página com mutações + 2 fetches + Badge):

```tsx
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { apiGet, apiPost, type StockAlert, type StockLevel } from '../api'
import { useFetch } from '../useFetch'
import { useToast } from '../ui/Toast'
import { Spinner } from '../ui/Spinner'
import { ErrorState } from '../ui/ErrorState'
import { EmptyState } from '../ui/EmptyState'
import { Badge } from '../ui/Badge'

export function Stock({ token }: { token: string }) {
  const { t } = useTranslation()
  const toast = useToast()
  const [selected, setSelected] = useState('')
  const [qty, setQty] = useState('')
  const levels = useFetch(() => apiGet<StockLevel[]>('/stock', token), [token])
  const alerts = useFetch(() => apiGet<StockAlert[]>('/stock/alerts', token), [token])

  async function mutate(path: string, body: Record<string, unknown>): Promise<void> {
    try {
      await apiPost(path, token, body)
      toast('success', t('backoffice.common.saved'))
      setQty('')
      levels.reload()
      alerts.reload()
    } catch {
      toast('error', t('backoffice.common.actionFailed'))
    }
  }

  async function receive(e: FormEvent): Promise<void> {
    e.preventDefault()
    if (!selected || !qty) return
    await mutate('/stock/receive', { stock_item_id: selected, qty: Number(qty) })
  }

  async function count(): Promise<void> {
    if (!selected || !qty) return
    await mutate('/stock/count', { stock_item_id: selected, counted: Number(qty) })
  }

  return (
    <section>
      {alerts.data && alerts.data.length > 0 && (
        <p>
          <Badge tone="warning">{t('backoffice.stock.alerts', { count: alerts.data.length })}</Badge>{' '}
          {alerts.data.map((a) => (
            <span key={a.id} style={{ marginRight: 8, fontWeight: a.state === 'negative' ? 700 : 400 }}>
              {a.name} ({a.qty} {a.unit}
              {a.state === 'negative' ? `, ${t('backoffice.stock.negative')}` : ''})
            </span>
          ))}
        </p>
      )}
      {alerts.error && <ErrorState onRetry={alerts.reload} />}
      {levels.loading && <Spinner />}
      {levels.error && <ErrorState onRetry={levels.reload} />}
      {levels.data && levels.data.length === 0 && <EmptyState message={t('backoffice.common.empty')} />}
      {levels.data && levels.data.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>{t('backoffice.stock.item')}</th>
              <th>{t('backoffice.stock.unit')}</th>
              <th>{t('backoffice.stock.current')}</th>
              <th>{t('backoffice.stock.min')}</th>
            </tr>
          </thead>
          <tbody>
            {levels.data.map((l) => (
              <tr key={l.id} style={l.minStock != null && l.qty < l.minStock ? { color: 'var(--red-text)' } : undefined}>
                <td>{l.name}</td>
                <td>{l.unit}</td>
                <td>{l.qty}</td>
                <td>{l.minStock ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <form onSubmit={receive} style={{ marginTop: '0.5rem', display: 'flex', gap: '0.5rem' }}>
        <select value={selected} onChange={(e) => setSelected(e.target.value)}>
          <option value="">{t('backoffice.stock.selectItem')}</option>
          {(levels.data ?? []).map((l) => (
            <option key={l.id} value={l.id}>{l.name}</option>
          ))}
        </select>
        <input type="number" value={qty} onChange={(e) => setQty(e.target.value)} placeholder={t('backoffice.stock.qty')} />
        <button type="submit">{t('backoffice.stock.receive')}</button>
        <button type="button" onClick={() => void count()}>{t('backoffice.stock.count')}</button>
      </form>
    </section>
  )
}
```

- [ ] **Step 3: Aplicar o MESMO contrato às 8 páginas restantes**, usando a tabela (cada linha diz exatamente o que muda; a estrutura JSX interna do domínio fica a mesma):

| Página | Fetches → `useFetch` | Mutações → toast+reload | Chaves (Task 11) | Paginação client-side (25/pág, `Pagination`) |
|---|---|---|---|---|
| `Recipes.tsx` | `/recipes` e `/recipes/availability` (2 blocos; disponibilidade indisponível não bloqueia a lista) | — | `recipes.yields` (`{ count: avail[r.id] }`), `recipes.inactive` | não (lista pequena) |
| `Production.tsx` | `/production/recipes` | `POST /production` → `toast(t('backoffice.production.produced'))` | `production.yieldPerBatch` (`{ qty: r.yieldQty, unit: r.unit }`), `production.batches` (placeholder), `production.produce` | não |
| `Checklists.tsx` | `/checklists/templates` e `/checklists/runs` | `POST /checklists/runs` → toast sucesso/`checklists.submitFailed` (substitui o `setError` local) | `checklists.run`, `checklists.submit`, `checklists.history`, `checklists.corrective`, `checklists.deviations` (`{ count: dev }`) — **antes de introduzir `useTranslation`, renomear os lambdas `t` → `task`** (`templates.find((t) => …)`, `.filter((t) => …)`, `tpl.tasks.map((t) => …)`) para não colidir com o `t` da tradução | runs: sim (histórico cresce) |
| `ChecklistReports.tsx` | `/checklists/status` e `/checklists/deviations` (2 blocos) | — | `haccp.*` (colunas, `overdue`, `recentDeviations`) | não |
| `Customers.tsx` | `/customers` | `POST /customers/:id/anonymize` → toast | `crm.*` | sim |
| `Loyalty.tsx` | `/loyalty/program` e `/customers` (2 blocos) | `PUT /loyalty/program` → toast | `loyalty.*` (`balance` com `{ points, stamps }`) — o form do programa é **editável**: copiar o fetch p/ estado local com `const [form, setForm] = useState<LoyaltyProgram | null>(null)` + `useEffect(() => { if (program.data) setForm(program.data) }, [program.data])`; os inputs editam `form`, o PUT envia `form` | não |
| `Vouchers.tsx` | `/vouchers` | `POST /vouchers` → toast | `vouchers.*` | sim |
| `Campaigns.tsx` | `/campaigns` | `POST /campaigns` e `POST /campaigns/:id/send` → toast | `campaigns.*` | sim |
| `Exports.tsx` | `/exports/kassen` | downloads ficam como estão (`try/catch` + toast de erro) | `exports.from`, `exports.to` (labels von/bis) — sem callback de sucesso no `useFetch`: a Kasse default é **derivada**, `const effectiveKasseId = kasseId || (kassen.data?.[0]?.id ?? '')` (o select controla `kasseId`; usar `effectiveKasseId` nos downloads/disabled) | não |

Padrão de paginação client-side (onde a tabela diz "sim"):

```tsx
const [page, setPage] = useState(0)
const rows = x.data ?? []
const pageCount = Math.ceil(rows.length / 25)
const visible = rows.slice(page * 25, (page + 1) * 25)
// ...render visible; depois da tabela:
<Pagination page={page} pageCount={pageCount} onPage={setPage} />
```

- [ ] **Step 4: Varredura de strings hardcoded** — deve voltar vazio:

```bash
grep -rn "Estoque\|Receitas\|Produção\|Histórico\|Desvios\|Clientes\|Fidelidade\|Campanhas\|Insumo\|quantidade\|lotes\|Anonimizar\|Salvar\|Criar\|Enviar\|ATRASADO\|Recorrência\|Entrada\|Contagem\|Submeter\|ver saldo" apps/backoffice/src/pages
```

- [ ] **Step 5: Remover as chaves antigas** — apagar `"products": { "title" }` e `"users": { "title" }` do bloco `backoffice` dos três locales (nada mais os usa — conferir com `grep -rn "backoffice.products.title\|backoffice.users" apps/ packages/`), e rodar `corepack pnpm --filter @gelato/i18n test` → PASS.

- [ ] **Step 5: Typecheck + build + testes**

```bash
corepack pnpm --filter @gelato/backoffice typecheck
corepack pnpm --filter @gelato/backoffice build
corepack pnpm --filter @gelato/backoffice test
corepack pnpm --filter @gelato/i18n test
```

- [ ] **Step 6: Commit**

```bash
git add apps/backoffice/src packages/i18n/src/locales
git commit -m "feat(backoffice): estados (loading/erro/vazio/toast), paginação e i18n em todas as páginas"
```

### Task 13: verificação ao vivo (Claude_Preview)

- [ ] **Step 1: Subir o stack** — Postgres já up (pré-requisito); API: `PORT=3001 corepack pnpm --filter @gelato/api exec nest start` (background); backoffice: `preview_start` com a config `backoffice` (porta 5174).

- [ ] **Step 2: Roteiro de verificação** (via preview_snapshot/screenshot/eval — cada item deve ser confirmado):
  1. Login `admin@demo.test`/`admin123` → cai em `#/today/dashboard`.
  2. Dashboard: card "Verkäufe heute" com valor em €; alertas e HACCP com tom certo (âmbar/vermelho quando >0); "Letzte Verkäufe" com até 10 linhas ou empty-state.
  3. Navegar pelos 5 grupos e pelas 13 páginas (subabas trocam, h1 muda, deep-link `#/operations/stock` recarregável).
  4. Estoque: fazer uma Entrada → toast de sucesso + tabela atualiza.
  5. Troca de idioma DE↔PT muda títulos de abas e colunas (nenhuma string fixa).
  6. Estado de erro: derrubar a API (parar o processo) → recarregar página do Estoque → ErrorState com botão "tentar de novo"; subir a API e o retry recupera.
  7. Vendas: com >25 vendas no banco, "Mehr laden" traz a próxima página (se o seed tiver poucas vendas, gerar algumas via `POST /pos/sync` como no e2e ou aceitar o botão ausente com ≤25 — comportamento correto).
  8. Screenshot final do dashboard como prova.

- [ ] **Step 3: Corrigir o que a verificação apontar** (editar código-fonte, re-verificar) e parar os servidores ao final.

### Task 14: suíte completa + integrar em main

- [ ] **Step 1: Testes de todo o monorepo**

```bash
corepack pnpm -r test
```
Esperado: todos os pacotes verdes (inclui os e2e da API contra 5433).

- [ ] **Step 2: Typecheck geral dos pacotes tocados**

```bash
corepack pnpm --filter @gelato/backoffice typecheck && corepack pnpm --filter @gelato/api exec tsc --noEmit -p tsconfig.json
```

- [ ] **Step 3: Commit final do plano marcado + merge ff + push**

```bash
git add docs/superpowers/plans/2026-07-02-backoffice-ux.md
git commit -m "docs(plan): backoffice-ux — plano executado"
git checkout main
git merge --ff-only backoffice-ux
git push origin main
```
(Se o ff falhar por main ter avançado: `git rebase main backoffice-ux` e repetir.)
