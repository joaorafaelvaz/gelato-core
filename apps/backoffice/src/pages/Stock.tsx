import { useEffect, useState, type FormEvent } from 'react'
import { apiGet, apiPost, type StockLevel, type StockAlert } from '../api'

export function Stock({ token }: { token: string }) {
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
