import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import QRCode from 'qrcode'
import { FakeTseProvider, type TaxRate } from '@gelato/compliance'
import { SUPPORTED_LOCALES } from '@gelato/i18n'
import { IdbStore } from './idb-store'
import { finalizeSale, runOutboxOnce, HttpSyncClient, type CartLine } from './sale'
import {
  apiBase,
  getProducts,
  getTaxRates,
  loginPin,
  openShift,
  closeShift,
  cashMovement,
  drawerOpen,
  reportX,
  reportZ,
  type ApiProduct,
  type DayTotals,
} from './api'

type Mode = 'im_haus' | 'ausser_haus'
const KASSE = 'demo-kasse'
const store = new IdbStore()
const tse = new FakeTseProvider({ serialNumber: 'WEB-SANDBOX' })
const euro = (c: number): string =>
  (c / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })
const askCents = (label: string): number => Math.round(Number(window.prompt(label) ?? '0') * 100)

export function App() {
  const { t, i18n } = useTranslation()
  const [token, setToken] = useState<string | null>(null)
  const [pin, setPin] = useState('')
  const [shiftId, setShiftId] = useState<string | null>(null)
  const [float, setFloat] = useState('100')
  const [products, setProducts] = useState<ApiProduct[]>([])
  const [rates, setRates] = useState<TaxRate[]>([])
  const [cart, setCart] = useState<Record<string, number>>({})
  const [mode, setMode] = useState<Mode>('im_haus')
  const [qr, setQr] = useState<string | null>(null)
  const [report, setReport] = useState<string>('')
  const [msg, setMsg] = useState('')

  useEffect(() => {
    if (!token) return
    const client = new HttpSyncClient(apiBase(), token)
    const id = setInterval(() => void runOutboxOnce(store, client).catch(() => {}), 5000)
    return () => clearInterval(id)
  }, [token])

  async function login(): Promise<void> {
    try {
      const r = await loginPin(KASSE, pin)
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

  async function open(): Promise<void> {
    const s = await openShift(token!, KASSE, Math.round(Number(float) * 100))
    setShiftId(s.id)
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
    const { receipt } = await finalizeSale({
      cart: items,
      mode,
      at: new Date(),
      rates,
      kasseId: KASSE,
      shiftId: shiftId ?? undefined,
      tseClientId: 'c1',
      tse,
      store,
      seller: { name: 'Gelateria Demo (Web)' },
    })
    setQr(await QRCode.toDataURL(receipt.qrPayload))
    setCart({})
  }

  const totalsLine = (d: DayTotals): string =>
    `Σ ${euro(d.totalGross)} · ${d.byVatRate.map((g) => `${(g.rate * 100).toFixed(0)}%=${euro(g.gross)}`).join(' · ')}`

  async function doX(): Promise<void> {
    const r = await reportX(token!, KASSE)
    setReport(`X-Bericht — ${totalsLine(r.totals)}`)
  }
  async function doZ(): Promise<void> {
    const r = await reportZ(token!, KASSE)
    setReport(`Z-Bericht #${r.seqNr} — ${totalsLine(r.totals)}`)
  }
  async function close(): Promise<void> {
    const counted = askCents('Kassensturz: contado (€)')
    const s = await closeShift(token!, shiftId!, counted)
    setReport(`Turno fechado — Differenz ${euro(s.differenz ?? 0)}`)
    setShiftId(null)
  }

  // --- telas ---
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

  if (!shiftId) {
    return (
      <div style={{ fontFamily: 'system-ui', display: 'grid', placeItems: 'center', height: '100vh', gap: 8 }}>
        <h2>Turno fechado</h2>
        <label>
          Float de abertura (€){' '}
          <input value={float} onChange={(e) => setFloat(e.target.value)} style={{ width: 80 }} />
        </label>
        <button onClick={() => void open()}>Abrir turno</button>
        {report && <p>{report}</p>}
      </div>
    )
  }

  return (
    <div style={{ fontFamily: 'system-ui', padding: 16, display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16 }}>
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
          <div>
            <button onClick={() => setMode('im_haus')} disabled={mode === 'im_haus'}>{t('pos.mode.im_haus')}</button>
            <button onClick={() => setMode('ausser_haus')} disabled={mode === 'ausser_haus'}>{t('pos.mode.ausser_haus')}</button>
          </div>
          <select value={i18n.language} onChange={(e) => void i18n.changeLanguage(e.target.value)}>
            {SUPPORTED_LOCALES.map((l) => <option key={l} value={l}>{l.toUpperCase()}</option>)}
          </select>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
          {products.map((p) => (
            <button key={p.id} onClick={() => add(p.id)} style={{ padding: 16 }}>
              {p.name}<br />{euro(p.netCents)}{cart[p.id] ? ` ×${cart[p.id]}` : ''}
            </button>
          ))}
        </div>
        <button onClick={() => void finalize()} style={{ marginTop: 12, padding: 12, width: '100%' }}>
          {t('pos.finalize')}
        </button>
      </div>
      <div style={{ display: 'grid', gap: 8, alignContent: 'start' }}>
        <h3>Kasse</h3>
        <button onClick={() => void cashMovement(token, shiftId, 'sangria', askCents('Sangria (€)'))}>Sangria</button>
        <button onClick={() => void cashMovement(token, shiftId, 'suprimento', askCents('Suprimento (€)'))}>Suprimento</button>
        <button onClick={() => void drawerOpen(token)}>Gaveta</button>
        <button onClick={() => void doX()}>X-Bericht</button>
        <button onClick={() => void doZ()}>Z-Bericht</button>
        <button onClick={() => void close()} style={{ marginTop: 8 }}>Fechar turno</button>
        {report && <p style={{ fontSize: 13 }}>{report}</p>}
        <h3>{t('pos.receipt.title')} (QR)</h3>
        {qr ? <img src={qr} alt="QR" style={{ width: '100%' }} /> : <p>—</p>}
      </div>
    </div>
  )
}
