import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { apiGet, apiPost, type StockAlert, type StockLevel } from '../api'
import { useFetch } from '../useFetch'
import { useToast } from '../ui/Toast'
import { Spinner } from '../ui/Spinner'
import { ErrorState } from '../ui/ErrorState'
import { EmptyState } from '../ui/EmptyState'
import { Badge } from '../ui/Badge'

export function Stock({ token }: { token: string }) {
  const { t } = useTranslation()
  const toast = useToast()
  const [selected, setSelected] = useState('')
  const [qty, setQty] = useState('')
  const levels = useFetch(() => apiGet<StockLevel[]>('/stock', token), [token])
  const alerts = useFetch(() => apiGet<StockAlert[]>('/stock/alerts', token), [token])

  async function mutate(path: string, body: Record<string, unknown>): Promise<void> {
    try {
      await apiPost(path, token, body)
      toast('success', t('backoffice.common.saved'))
      setQty('')
      levels.reload()
      alerts.reload()
    } catch {
      toast('error', t('backoffice.common.actionFailed'))
    }
  }

  async function receive(e: FormEvent): Promise<void> {
    e.preventDefault()
    if (!selected || !qty) return
    await mutate('/stock/receive', { stock_item_id: selected, qty: Number(qty) })
  }

  async function count(): Promise<void> {
    if (!selected || !qty) return
    await mutate('/stock/count', { stock_item_id: selected, counted: Number(qty) })
  }

  return (
    <section>
      {alerts.data && alerts.data.length > 0 && (
        <p>
          <Badge tone="warning">{t('backoffice.stock.alerts', { count: alerts.data.length })}</Badge>{' '}
          {alerts.data.map((a) => (
            <span key={a.id} style={{ marginRight: 8, fontWeight: a.state === 'negative' ? 700 : 400 }}>
              {a.name} ({a.qty} {a.unit}
              {a.state === 'negative' ? `, ${t('backoffice.stock.negative')}` : ''})
            </span>
          ))}
        </p>
      )}
      {alerts.error && <ErrorState onRetry={alerts.reload} />}
      {levels.loading && <Spinner />}
      {levels.error && <ErrorState onRetry={levels.reload} />}
      {levels.data && levels.data.length === 0 && <EmptyState message={t('backoffice.common.empty')} />}
      {levels.data && levels.data.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>{t('backoffice.stock.item')}</th>
              <th>{t('backoffice.stock.unit')}</th>
              <th>{t('backoffice.stock.current')}</th>
              <th>{t('backoffice.stock.min')}</th>
            </tr>
          </thead>
          <tbody>
            {levels.data.map((l) => (
              <tr key={l.id} style={l.minStock != null && l.qty < l.minStock ? { color: 'var(--red-text)' } : undefined}>
                <td>{l.name}</td>
                <td>{l.unit}</td>
                <td>{l.qty}</td>
                <td>{l.minStock ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <form onSubmit={receive} style={{ marginTop: '0.5rem', display: 'flex', gap: '0.5rem' }}>
        <select value={selected} onChange={(e) => setSelected(e.target.value)}>
          <option value="">{t('backoffice.stock.selectItem')}</option>
          {(levels.data ?? []).map((l) => (
            <option key={l.id} value={l.id}>{l.name}</option>
          ))}
        </select>
        <input type="number" value={qty} onChange={(e) => setQty(e.target.value)} placeholder={t('backoffice.stock.qty')} />
        <button type="submit">{t('backoffice.stock.receive')}</button>
        <button type="button" onClick={() => void count()}>{t('backoffice.stock.count')}</button>
      </form>
    </section>
  )
}
