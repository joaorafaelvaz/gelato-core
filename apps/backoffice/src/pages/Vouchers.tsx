import { useEffect, useState, type FormEvent } from 'react'
import { apiGet, apiPost, type VoucherRow } from '../api'
import { euro } from '../format'

export function Vouchers({ token }: { token: string }) {
  const [vouchers, setVouchers] = useState<VoucherRow[]>([])
  const [code, setCode] = useState('')
  const [type, setType] = useState('percent')
  const [value, setValue] = useState('')

  const reload = (): void => {
    apiGet<VoucherRow[]>('/vouchers', token).then(setVouchers).catch(() => setVouchers([]))
  }
  useEffect(reload, [token])

  async function create(e: FormEvent): Promise<void> {
    e.preventDefault()
    if (!code || !value) return
    await apiPost('/vouchers', token, { code, type, value: Number(value) })
    setCode('')
    setValue('')
    reload()
  }

  return (
    <section style={{ marginTop: '2rem' }}>
      <h2>Vouchers</h2>
      <table>
        <thead>
          <tr>
            <th>Código</th>
            <th>Tipo</th>
            <th>Valor</th>
            <th>Usos</th>
            <th>Ativo</th>
          </tr>
        </thead>
        <tbody>
          {vouchers.map((v) => (
            <tr key={v.id} style={!v.active ? { color: '#888' } : undefined}>
              <td>{v.code}</td>
              <td>{v.type}</td>
              <td>{v.type === 'percent' ? `${v.value}%` : euro(v.value)}</td>
              <td>
                {v.usedCount}
                {v.maxUses != null ? `/${v.maxUses}` : ''}
              </td>
              <td>{v.active ? '✓' : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <form onSubmit={create} style={{ marginTop: '0.5rem', display: 'flex', gap: '0.5rem' }}>
        <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="CÓDIGO" />
        <select value={type} onChange={(e) => setType(e.target.value)}>
          <option value="percent">percent</option>
          <option value="fixed">fixed (cents)</option>
        </select>
        <input type="number" value={value} onChange={(e) => setValue(e.target.value)} placeholder={type === 'percent' ? '% (ex. 10)' : 'cents'} />
        <button type="submit">Criar</button>
      </form>
    </section>
  )
}
