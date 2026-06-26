import { useEffect, useState } from 'react'
import QRCode from 'qrcode'

type Product = {
  id: string
  name: string
  netCents: number
  mwstCodeImHaus: string
  mwstCodeAusserHaus: string
}
type Mode = 'im_haus' | 'ausser_haus'

const euro = (c: number): string =>
  (c / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })
const askCents = (label: string): number => Math.round(Number(window.prompt(label) ?? '0') * 100)

export function App() {
  const [logged, setLogged] = useState(false)
  const [pin, setPin] = useState('')
  const [shiftOpen, setShiftOpen] = useState(false)
  const [float, setFloat] = useState('100')
  const [products, setProducts] = useState<Product[]>([])
  const [cart, setCart] = useState<Record<string, number>>({})
  const [mode, setMode] = useState<Mode>('im_haus')
  const [qr, setQr] = useState<string | null>(null)
  const [report, setReport] = useState('')
  const [msg, setMsg] = useState('')
  const [ausfall, setAusfall] = useState(false)

  useEffect(() => {
    if (logged) void window.gelato.ausfallState().then((s) => setAusfall(s !== null))
  }, [logged])

  async function login(): Promise<void> {
    const r = await window.gelato.loginPin('demo-kasse', pin)
    if (!r.ok) {
      setMsg('PIN inválido')
      return
    }
    setLogged(true)
    setMsg('')
    setProducts(await window.gelato.products())
  }

  async function open(): Promise<void> {
    await window.gelato.shiftOpen(Math.round(Number(float) * 100))
    setShiftOpen(true)
  }

  function add(id: string): void {
    setCart((c) => ({ ...c, [id]: (c[id] ?? 0) + 1 }))
  }

  async function finalize(): Promise<void> {
    const items = products.filter((p) => cart[p.id]).map((p) => ({ ...p, qty: cart[p.id]! }))
    if (items.length === 0) return
    const r = await window.gelato.finalize(items, mode)
    if (!r.ok || !r.receipt) {
      setMsg(r.error ?? 'erro')
      return
    }
    setAusfall(Boolean(r.isAusfall))
    setQr(r.receipt.qrPayload ? await QRCode.toDataURL(r.receipt.qrPayload) : null)
    setCart({})
  }

  const totals = (d: { totalGross: number; byVatRate: { rate: number; gross: number }[] }): string =>
    `Σ ${euro(d.totalGross)} · ${d.byVatRate.map((g) => `${(g.rate * 100).toFixed(0)}%=${euro(g.gross)}`).join(' · ')}`

  async function doX(): Promise<void> {
    setReport(`X-Bericht — ${totals((await window.gelato.reportX()).totals)}`)
  }
  async function doZ(): Promise<void> {
    const r = await window.gelato.reportZ()
    setReport(`Z-Bericht #${r.seqNr} — ${totals(r.totals)}`)
  }
  async function close(): Promise<void> {
    const s = await window.gelato.shiftClose(askCents('Kassensturz: contado (€)'))
    setReport(`Turno fechado — Differenz ${euro(s.differenz ?? 0)}`)
    setShiftOpen(false)
  }

  if (!logged) {
    return (
      <div style={{ fontFamily: 'system-ui', display: 'grid', placeItems: 'center', height: '100vh', gap: 8 }}>
        <h1>🍦 gelato-core</h1>
        <input value={pin} onChange={(e) => setPin(e.target.value)} placeholder="PIN" type="password" />
        <button onClick={() => void login()}>Entrar</button>
        {msg && <span style={{ color: 'crimson' }}>{msg}</span>}
      </div>
    )
  }

  if (!shiftOpen) {
    return (
      <div style={{ fontFamily: 'system-ui', display: 'grid', placeItems: 'center', height: '100vh', gap: 8 }}>
        <h2>Turno fechado</h2>
        <label>
          Float de abertura (€) <input value={float} onChange={(e) => setFloat(e.target.value)} style={{ width: 80 }} />
        </label>
        <button onClick={() => void open()}>Abrir turno</button>
        {report && <p>{report}</p>}
      </div>
    )
  }

  return (
    <>
      {ausfall && (
        <div style={{ background: '#b91c1c', color: 'white', padding: 8, fontFamily: 'system-ui' }}>
          ⚠ TSE indisponível — vendas em modo Ausfall (sem assinatura). Documentado e sincronizado.
        </div>
      )}
      <div style={{ fontFamily: 'system-ui', padding: 16, display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16 }}>
      <div>
        <div style={{ marginBottom: 8 }}>
          <button onClick={() => setMode('im_haus')} disabled={mode === 'im_haus'}>Im Haus</button>
          <button onClick={() => setMode('ausser_haus')} disabled={mode === 'ausser_haus'}>Außer Haus</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
          {products.map((p) => (
            <button key={p.id} onClick={() => add(p.id)} style={{ padding: 16 }}>
              {p.name}<br />{euro(p.netCents)}{cart[p.id] ? ` ×${cart[p.id]}` : ''}
            </button>
          ))}
        </div>
        <button onClick={() => void finalize()} style={{ marginTop: 12, padding: 12, width: '100%' }}>Abschließen</button>
        {msg && <p style={{ color: 'crimson' }}>{msg}</p>}
      </div>
      <div style={{ display: 'grid', gap: 8, alignContent: 'start' }}>
        <h3>Kasse</h3>
        <button onClick={() => void window.gelato.cashMovement('sangria', askCents('Sangria (€)'))}>Sangria</button>
        <button onClick={() => void window.gelato.cashMovement('suprimento', askCents('Suprimento (€)'))}>Suprimento</button>
        <button onClick={() => void window.gelato.drawer()}>Gaveta</button>
        <button onClick={() => void doX()}>X-Bericht</button>
        <button onClick={() => void doZ()}>Z-Bericht</button>
        <button onClick={() => void close()} style={{ marginTop: 8 }}>Fechar turno</button>
        {report && <p style={{ fontSize: 13 }}>{report}</p>}
        <h3>Recibo (QR)</h3>
        {qr ? (
          <img src={qr} alt="QR" style={{ width: '100%' }} />
        ) : (
          <p>{ausfall ? 'TSE-Ausfall — sem QR' : '—'}</p>
        )}
      </div>
      </div>
    </>
  )
}
