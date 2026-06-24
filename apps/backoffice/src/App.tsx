import { useEffect, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { SUPPORTED_LOCALES } from '@gelato/i18n'
import { apiGet, apiLogin } from './api'

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
