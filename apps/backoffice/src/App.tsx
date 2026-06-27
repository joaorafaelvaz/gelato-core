import { useEffect, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { SUPPORTED_LOCALES } from '@gelato/i18n'
import { apiGet, apiGetBlob, apiLogin, apiPost, type StockLevel, type RecipeRow } from './api'

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
  const [selected, setSelected] = useState('')
  const [qty, setQty] = useState('')

  const reload = (): void => {
    apiGet<StockLevel[]>('/stock', token).then(setLevels).catch(() => setLevels([]))
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
  useEffect(() => {
    apiGet<RecipeRow[]>('/recipes', token)
      .then(setRecipes)
      .catch(() => setRecipes([]))
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
