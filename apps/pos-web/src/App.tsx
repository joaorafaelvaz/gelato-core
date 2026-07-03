import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import QRCode from 'qrcode'
import { FakeTseProvider, AusfallTracker, type TaxRate } from '@gelato/compliance'
import { SUPPORTED_LOCALES } from '@gelato/i18n'
import { IdbStore } from './idb-store'
import { TischPanel } from './TischPanel'
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
let ausfallTracker = new AusfallTracker()
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
  const [ausfall, setAusfall] = useState(false)

  useEffect(() => {
    void store.getAusfallState().then((s) => {
      ausfallTracker = new AusfallTracker(s)
      setAusfall(s !== null)
    })
  }, [])

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
      setMsg(t('pos.login.invalidPin'))
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
    const { receipt, outcome } = await finalizeSale({
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
      tracker: ausfallTracker,
    })
    setAusfall(outcome.kind === 'ausfall' || ausfallTracker.current !== null)
    setQr(receipt.qrPayload ? await QRCode.toDataURL(receipt.qrPayload) : null)
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
    const counted = askCents(t('pos.shift.countedPrompt'))
    const s = await closeShift(token!, shiftId!, counted)
    setReport(t('pos.shift.closedReport', { diff: euro(s.differenz ?? 0) }))
    setShiftId(null)
  }

  // --- telas ---
  if (!token) {
    return (
      <div className="center-screen">
        <div className="card login-card">
          <h1>{t('common.appName')} · Kasse</h1>
          <input value={pin} onChange={(e) => setPin(e.target.value)} placeholder={t('auth.login.pin')} type="password" />
          <button className="btn-primary btn-big" onClick={() => void login()}>{t('auth.login.submit')}</button>
          {msg && <span className="error-text">{msg}</span>}
        </div>
      </div>
    )
  }

  if (!shiftId) {
    return (
      <div className="center-screen">
        <div className="card login-card">
          <h2>{t('pos.shift.closed')}</h2>
          <label style={{ justifyContent: 'center' }}>
            {t('pos.shift.float')}{' '}
            <input value={float} onChange={(e) => setFloat(e.target.value)} style={{ width: 100 }} />
          </label>
          <button className="btn-primary btn-big" onClick={() => void open()}>{t('pos.shift.open')}</button>
          {report && <p className="report-line">{report}</p>}
        </div>
      </div>
    )
  }

  return (
    <>
      {ausfall && (
        <div className="banner-ausfall">
          {t('pos.ausfall.banner')}
        </div>
      )}
      <header className="topbar">
        <span className="brand">{t('common.appName')} · Kasse</span>
        <div className="seg">
          <button className={mode === 'im_haus' ? 'active' : ''} onClick={() => setMode('im_haus')}>{t('pos.mode.im_haus')}</button>
          <button className={mode === 'ausser_haus' ? 'active' : ''} onClick={() => setMode('ausser_haus')}>{t('pos.mode.ausser_haus')}</button>
        </div>
        <div className="topbar-right">
          <select value={i18n.language} onChange={(e) => void i18n.changeLanguage(e.target.value)}>
            {SUPPORTED_LOCALES.map((l) => <option key={l} value={l}>{l.toUpperCase()}</option>)}
          </select>
        </div>
      </header>
      <div className="pos-main">
        <div className="card">
          <div className="tiles">
            {products.map((p) => (
              <button key={p.id} className="tile" onClick={() => add(p.id)}>
                {p.name}
                <span className="price">{euro(p.netCents)}</span>
                {cart[p.id] ? <span className="count">×{cart[p.id]}</span> : null}
              </button>
            ))}
          </div>
          <button className="btn-primary btn-big" onClick={() => void finalize()} style={{ marginTop: 12 }}>
            {t('pos.finalize')}
          </button>
        </div>
        <div>
          <div className="card actions">
            <h3>{t('pos.cash.title')}</h3>
            <div className="actions-row">
              <button onClick={() => void cashMovement(token, shiftId, 'sangria', askCents(`${t('pos.cash.sangria')} (€)`))}>{t('pos.cash.sangria')}</button>
              <button onClick={() => void cashMovement(token, shiftId, 'suprimento', askCents(`${t('pos.cash.suprimento')} (€)`))}>{t('pos.cash.suprimento')}</button>
              <button onClick={() => void drawerOpen(token)}>{t('pos.cash.drawer')}</button>
            </div>
            <div className="actions-row">
              <button onClick={() => void doX()}>X-Bericht</button>
              <button onClick={() => void doZ()}>Z-Bericht</button>
              <button onClick={() => void close()}>{t('pos.shift.close')}</button>
            </div>
            {report && <p className="report-line">{report}</p>}
          </div>
          <div className="card" style={{ marginTop: 12 }}>
            <h3>{t('pos.receipt.title')} (QR)</h3>
            {qr ? (
              <div className="qr-box"><img src={qr} alt="QR" /></div>
            ) : (
              <p className="muted">{ausfall ? t('pos.ausfall.noQr') : '—'}</p>
            )}
          </div>
        </div>
      </div>
      <div className="pos-salon">
        <TischPanel token={token} kasse={KASSE} products={products} rates={rates} tse={tse} />
      </div>
    </>
  )
}
