import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import QRCode from 'qrcode'
import { FakeTseProvider, type TaxRate } from '@gelato/compliance'
import { SUPPORTED_LOCALES } from '@gelato/i18n'
import { IdbStore } from './idb-store'
import { finalizeSale, runOutboxOnce, HttpSyncClient, type CartLine } from './sale'
import { apiBase, getProducts, getTaxRates, loginPin, type ApiProduct } from './api'

type Mode = 'im_haus' | 'ausser_haus'

// Singletons da sessão (rodam inteiramente no navegador).
const store = new IdbStore()
const tse = new FakeTseProvider({ serialNumber: 'WEB-SANDBOX' })

const euro = (c: number): string =>
  (c / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })

export function App() {
  const { t, i18n } = useTranslation()
  const [token, setToken] = useState<string | null>(null)
  const [pin, setPin] = useState('')
  const [products, setProducts] = useState<ApiProduct[]>([])
  const [rates, setRates] = useState<TaxRate[]>([])
  const [cart, setCart] = useState<Record<string, number>>({})
  const [mode, setMode] = useState<Mode>('im_haus')
  const [qr, setQr] = useState<string | null>(null)
  const [msg, setMsg] = useState('')

  // Outbox: sincroniza com a API a cada 5s quando há sessão (offline-first).
  useEffect(() => {
    if (!token) return
    const client = new HttpSyncClient(apiBase(), token)
    const id = setInterval(() => {
      void runOutboxOnce(store, client).catch(() => {})
    }, 5000)
    return () => clearInterval(id)
  }, [token])

  async function login(): Promise<void> {
    try {
      const r = await loginPin('demo-kasse', pin)
      setToken(r.access_token)
      setProducts(await getProducts(r.access_token))
      const tr = await getTaxRates(r.access_token)
      setRates(
        tr.map((x) => ({
          code: x.code,
          rate: Number(x.rate),
          validFrom: new Date(x.validFrom),
          validTo: x.validTo ? new Date(x.validTo) : undefined,
        })),
      )
      setMsg('')
    } catch {
      setMsg('PIN inválido')
    }
  }

  function add(id: string): void {
    setCart((c) => ({ ...c, [id]: (c[id] ?? 0) + 1 }))
  }

  async function finalize(): Promise<void> {
    const items: CartLine[] = products
      .filter((p) => cart[p.id])
      .map((p) => ({
        product: {
          id: p.id,
          name: p.name,
          netCents: p.netCents,
          mwstCodeImHaus: p.mwstCodeImHaus,
          mwstCodeAusserHaus: p.mwstCodeAusserHaus,
        },
        qty: cart[p.id]!,
      }))
    if (items.length === 0) return
    try {
      const { receipt } = await finalizeSale({
        cart: items,
        mode,
        at: new Date(),
        rates,
        kasseId: 'demo-kasse',
        tseClientId: 'c1',
        tse,
        store,
        seller: { name: 'Gelateria Demo (Web)' },
      })
      setQr(await QRCode.toDataURL(receipt.qrPayload))
      setCart({})
      setMsg('')
    } catch (e) {
      setMsg(String(e))
    }
  }

  if (!token) {
    return (
      <div style={{ fontFamily: 'system-ui', display: 'grid', placeItems: 'center', height: '100vh', gap: 8 }}>
        <h1>🍦 gelato-core · Web Kasse</h1>
        <input value={pin} onChange={(e) => setPin(e.target.value)} placeholder={t('auth.login.pin')} type="password" />
        <button onClick={() => void login()}>{t('auth.login.submit')}</button>
        {msg && <span style={{ color: 'crimson' }}>{msg}</span>}
      </div>
    )
  }

  return (
    <div style={{ fontFamily: 'system-ui', padding: 16, display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16 }}>
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
          <div>
            <button onClick={() => setMode('im_haus')} disabled={mode === 'im_haus'}>
              {t('pos.mode.im_haus')}
            </button>
            <button onClick={() => setMode('ausser_haus')} disabled={mode === 'ausser_haus'}>
              {t('pos.mode.ausser_haus')}
            </button>
          </div>
          <select value={i18n.language} onChange={(e) => void i18n.changeLanguage(e.target.value)}>
            {SUPPORTED_LOCALES.map((l) => (
              <option key={l} value={l}>
                {l.toUpperCase()}
              </option>
            ))}
          </select>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
          {products.map((p) => (
            <button key={p.id} onClick={() => add(p.id)} style={{ padding: 16 }}>
              {p.name}
              <br />
              {euro(p.netCents)}
              {cart[p.id] ? ` ×${cart[p.id]}` : ''}
            </button>
          ))}
        </div>
        <button onClick={() => void finalize()} style={{ marginTop: 12, padding: 12, width: '100%' }}>
          {t('pos.finalize')}
        </button>
        {msg && <p style={{ color: 'crimson' }}>{msg}</p>}
      </div>
      <div>
        <h3>{t('pos.receipt.title')} (QR)</h3>
        {qr ? <img src={qr} alt="QR" style={{ width: '100%' }} /> : <p>—</p>}
      </div>
    </div>
  )
}
