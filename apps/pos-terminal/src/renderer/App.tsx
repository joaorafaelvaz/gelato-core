import { useState } from 'react'
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

export function App() {
  const [logged, setLogged] = useState(false)
  const [pin, setPin] = useState('')
  const [products, setProducts] = useState<Product[]>([])
  const [cart, setCart] = useState<Record<string, number>>({})
  const [mode, setMode] = useState<Mode>('im_haus')
  const [qr, setQr] = useState<string | null>(null)
  const [msg, setMsg] = useState('')

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
    setQr(await QRCode.toDataURL(r.receipt.qrPayload))
    setCart({})
    setMsg('')
  }

  if (!logged) {
    return (
      <div
        style={{ fontFamily: 'system-ui', display: 'grid', placeItems: 'center', height: '100vh', gap: 8 }}
      >
        <h1>🍦 gelato-core</h1>
        <input
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          placeholder="PIN"
          type="password"
        />
        <button onClick={() => void login()}>Entrar</button>
        {msg && <span style={{ color: 'crimson' }}>{msg}</span>}
      </div>
    )
  }

  return (
    <div
      style={{
        fontFamily: 'system-ui',
        padding: 16,
        display: 'grid',
        gridTemplateColumns: '2fr 1fr',
        gap: 16,
      }}
    >
      <div>
        <div style={{ marginBottom: 8 }}>
          <button onClick={() => setMode('im_haus')} disabled={mode === 'im_haus'}>
            Im Haus
          </button>
          <button onClick={() => setMode('ausser_haus')} disabled={mode === 'ausser_haus'}>
            Außer Haus
          </button>
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
          Finalizar
        </button>
        {msg && <p style={{ color: 'crimson' }}>{msg}</p>}
      </div>
      <div>
        <h3>Recibo (QR)</h3>
        {qr ? <img src={qr} alt="QR" style={{ width: '100%' }} /> : <p>—</p>}
      </div>
    </div>
  )
}
