import { useEffect, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { SUPPORTED_LOCALES } from '@gelato/i18n'
import { apiGet, apiGetBlob, apiLogin, apiPost, type StockLevel, type RecipeRow, type Availability, type StockAlert, type ChecklistTemplateRow, type ChecklistRunRow, type ChecklistStatusRow, type ChecklistDeviationRow } from './api'

interface Order {
  id: string
  ts: string
  mode: string
  totalGross: number
}

interface Product {
  id: string
  name: string
  netCents: number
}

const euro = (cents: number): string =>
  (cents / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })

export function App() {
  const { t, i18n } = useTranslation()
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('token'))

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

  return (
    <div style={{ fontFamily: 'system-ui', maxWidth: 900, margin: '2rem auto', padding: '0 1rem' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>{t('common.appName')}</h1>
        <div>
          <select value={i18n.language} onChange={(e) => void i18n.changeLanguage(e.target.value)}>
            {SUPPORTED_LOCALES.map((l) => (
              <option key={l} value={l}>
                {l.toUpperCase()}
              </option>
            ))}
          </select>
          <button
            onClick={() => {
              localStorage.removeItem('token')
              setToken(null)
            }}
            style={{ marginLeft: 8 }}
          >
            {t('auth.login.submit')} ⤺
          </button>
        </div>
      </header>
      <Sales token={token} />
      <Products token={token} />
      <Stock token={token} />
      <Recipes token={token} />
      <Checklists token={token} />
      <ChecklistReports token={token} />
      <Exports token={token} />
    </div>
  )
}

function Login({ onLogin }: { onLogin: (token: string) => void }) {
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
    <form
      onSubmit={submit}
      style={{ fontFamily: 'system-ui', maxWidth: 320, margin: '4rem auto', display: 'grid', gap: 8 }}
    >
      <h1>{t('common.appName')}</h1>
      <label>
        {t('auth.login.email')}
        <input value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label>
        {t('auth.login.password')}
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </label>
      <button type="submit">{t('auth.login.submit')}</button>
      {error && <span style={{ color: 'crimson' }}>✗</span>}
    </form>
  )
}

function Sales({ token }: { token: string }) {
  const { t } = useTranslation()
  const [orders, setOrders] = useState<Order[]>([])

  useEffect(() => {
    apiGet<Order[]>('/orders', token)
      .then(setOrders)
      .catch(() => setOrders([]))
  }, [token])

  return (
    <section>
      <h2>{t('backoffice.sales.title')}</h2>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th align="left">{t('pos.mode.label')}</th>
            <th align="right">{t('pos.receipt.total')}</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o.id}>
              <td>{t(`pos.mode.${o.mode}`)}</td>
              <td align="right">{euro(o.totalGross)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

function Products({ token }: { token: string }) {
  const { t } = useTranslation()
  const [products, setProducts] = useState<Product[]>([])

  useEffect(() => {
    apiGet<Product[]>('/products', token)
      .then(setProducts)
      .catch(() => setProducts([]))
  }, [token])

  return (
    <section>
      <h2>{t('backoffice.products.title')}</h2>
      <ul>
        {products.map((p) => (
          <li key={p.id}>
            {p.name} — {euro(p.netCents)}
          </li>
        ))}
      </ul>
    </section>
  )
}

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

  async function receive(e: FormEvent): Promise<void> {
    e.preventDefault()
    if (!selected || !qty) return
    await apiPost('/stock/receive', token, { stock_item_id: selected, qty: Number(qty) })
    setQty('')
    reload()
  }

  async function count(): Promise<void> {
    if (!selected || !qty) return
    await apiPost('/stock/count', token, { stock_item_id: selected, counted: Number(qty) })
    setQty('')
    reload()
  }

  return (
    <section style={{ marginTop: '2rem' }}>
      <h2>Estoque</h2>
      {alerts.length > 0 && (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, padding: '0.5rem 0.75rem', marginBottom: '0.5rem' }}>
          ⚠ {alerts.length} em alerta:{' '}
          {alerts.map((a) => (
            <span key={a.id} style={{ marginRight: 8, fontWeight: a.state === 'negative' ? 700 : 400 }}>
              {a.name} ({a.qty} {a.unit}
              {a.state === 'negative' ? ', negativo' : ''})
            </span>
          ))}
        </div>
      )}
      <table>
        <thead>
          <tr>
            <th>Insumo</th>
            <th>Unidade</th>
            <th>Atual</th>
            <th>Mín.</th>
          </tr>
        </thead>
        <tbody>
          {levels.map((l) => (
            <tr key={l.id} style={l.minStock != null && l.qty < l.minStock ? { color: '#b91c1c' } : undefined}>
              <td>{l.name}</td>
              <td>{l.unit}</td>
              <td>{l.qty}</td>
              <td>{l.minStock ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <form onSubmit={receive} style={{ marginTop: '0.5rem', display: 'flex', gap: '0.5rem' }}>
        <select value={selected} onChange={(e) => setSelected(e.target.value)}>
          <option value="">— insumo —</option>
          {levels.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
        <input type="number" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="quantidade" />
        <button type="submit">Entrada</button>
        <button type="button" onClick={count}>
          Contagem
        </button>
      </form>
    </section>
  )
}

function Recipes({ token }: { token: string }) {
  const [recipes, setRecipes] = useState<RecipeRow[]>([])
  const [avail, setAvail] = useState<Record<string, number>>({})
  useEffect(() => {
    apiGet<RecipeRow[]>('/recipes', token)
      .then(setRecipes)
      .catch(() => setRecipes([]))
    apiGet<Availability[]>('/recipes/availability', token)
      .then((a) => setAvail(Object.fromEntries(a.map((x) => [x.recipeId, x.maxProducible]))))
      .catch(() => setAvail({}))
  }, [token])

  return (
    <section style={{ marginTop: '2rem' }}>
      <h2>Receitas</h2>
      <ul>
        {recipes.map((r) => (
          <li key={r.id}>
            <strong>
              {r.productName}
              {r.variantName ? ` (${r.variantName})` : ''}
            </strong>
            {r.id in avail && ` — dá p/ ${avail[r.id]}`}
            {!r.active && ' — inativa'}
            <ul>
              {r.ingredients.map((i) => (
                <li key={i.stockItemId}>
                  {i.qty} {i.unit} — {i.stockItemName}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </section>
  )
}

function fmtRange(min: number | null, max: number | null): string {
  if (min == null || max == null) return ''
  const c = (d: number) => `${d < 0 ? '-' : ''}${Math.floor(Math.abs(d) / 10)},${Math.abs(d) % 10}`
  return ` (${c(min)}…${c(max)} °C)`
}

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
                {t.label}
                {t.type === 'temperature' && fmtRange(t.validMin, t.validMax)}{' '}
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
              {t?.name ?? r.templateId} — {r.status}
              {dev > 0 ? ` (${dev} desvio(s))` : ''} — {new Date(r.completedAt).toLocaleString('de-DE')}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

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
        <thead>
          <tr>
            <th>Checklist</th>
            <th>Recorrência</th>
            <th>Último</th>
            <th>Estado</th>
          </tr>
        </thead>
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

interface Kasse {
  id: string
  name: string
}

function Exports({ token }: { token: string }) {
  const [kassen, setKassen] = useState<Kasse[]>([])
  const [kasseId, setKasseId] = useState('')
  const [from, setFrom] = useState('2020-01-01')
  const [to, setTo] = useState('2999-01-01')
  const [meldung, setMeldung] = useState<string>('')

  useEffect(() => {
    apiGet<Kasse[]>('/exports/kassen', token)
      .then((ks) => {
        setKassen(ks)
        if (ks[0]) setKasseId(ks[0].id)
      })
      .catch(() => setKassen([]))
  }, [token])

  async function downloadDsfinvk(): Promise<void> {
    const blob = await apiGetBlob(`/exports/dsfinvk?kasse_id=${kasseId}&from=${from}&to=${to}`, token)
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `dsfinvk_${kasseId}_${from}_${to}.zip`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function loadKassenmeldung(): Promise<void> {
    const p = await apiGet<unknown>(`/exports/kassenmeldung?kasse_id=${kasseId}`, token)
    setMeldung(JSON.stringify(p, null, 2))
  }

  return (
    <section>
      <h2>Exports (Finanzamt)</h2>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <select value={kasseId} onChange={(e) => setKasseId(e.target.value)}>
          {kassen.map((k) => (
            <option key={k.id} value={k.id}>
              {k.name}
            </option>
          ))}
        </select>
        <label>
          von <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          bis <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <button onClick={() => void downloadDsfinvk()} disabled={!kasseId}>
          DSFinV-K .zip
        </button>
        <button onClick={() => void loadKassenmeldung()} disabled={!kasseId}>
          Kassenmeldung
        </button>
      </div>
      {meldung && (
        <pre style={{ fontSize: 12, background: '#f4f4f5', padding: 8, overflow: 'auto' }}>{meldung}</pre>
      )}
    </section>
  )
}
