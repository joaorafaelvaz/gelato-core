import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { apiGet, type ChecklistStatusRow, type OrderRow, type OrdersSummary, type StockAlert } from '../api'
import { useFetch } from '../useFetch'
import { euro } from '../format'
import { periodRange, type Period } from '../date-util'
import { MetricCard } from '../ui/MetricCard'
import { Spinner } from '../ui/Spinner'
import { ErrorState } from '../ui/ErrorState'
import { EmptyState } from '../ui/EmptyState'
import type { PageProps } from './types'

const PERIODS: Period[] = ['today', 'yesterday', 'month', 'year']

export function Dashboard({ token, navigate }: PageProps) {
  const { t } = useTranslation()
  const [period, setPeriod] = useState<Period>('today')
  const range = periodRange(period, new Date())
  const windowQ = `from=${encodeURIComponent(range.from.toISOString())}&to=${encodeURIComponent(range.to.toISOString())}`
  const summary = useFetch(
    () => apiGet<OrdersSummary>(`/orders/summary?${windowQ}`, token),
    [token, period],
  )
  const alerts = useFetch(() => apiGet<StockAlert[]>('/stock/alerts', token), [token])
  const status = useFetch(() => apiGet<ChecklistStatusRow[]>('/checklists/status', token), [token])
  const last = useFetch(() => apiGet<OrderRow[]>(`/orders?${windowQ}&limit=10`, token), [token, period])

  const alertCount = (alerts.data ?? []).length
  const overdue = (status.data ?? []).filter((s) => s.overdue).length

  return (
    <section>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        {PERIODS.map((p) => (
          <button
            key={p}
            className={p === period ? 'btn-primary' : undefined}
            onClick={() => setPeriod(p)}
          >
            {t(`backoffice.dashboard.period.${p}`)}
          </button>
        ))}
      </div>
      <div className="metrics">
        <MetricCard
          label={`${t('backoffice.dashboard.sales')} — ${t(`backoffice.dashboard.period.${period}`)}`}
          tone="accent"
          value={summary.loading ? '…' : summary.error ? '—' : euro(summary.data?.totalGross ?? 0)}
          onClick={() => navigate({ group: 'fiscal', page: 'sales' })}
        />
        <MetricCard
          label={t('backoffice.dashboard.stockAlerts')}
          tone={alertCount > 0 ? 'warning' : 'neutral'}
          value={alerts.loading ? '…' : alerts.error ? '—' : String(alertCount)}
          onClick={() => navigate({ group: 'operations', page: 'stock' })}
        />
        <MetricCard
          label={t('backoffice.dashboard.haccpOverdue')}
          tone={overdue > 0 ? 'danger' : 'success'}
          value={status.loading ? '…' : status.error ? '—' : String(overdue)}
          onClick={() => navigate({ group: 'fiscal', page: 'haccp' })}
        />
      </div>
      <h3>{t('backoffice.dashboard.lastSales')}</h3>
      {last.loading && <Spinner />}
      {last.error && <ErrorState onRetry={last.reload} />}
      {last.data && last.data.length === 0 && <EmptyState message={t('backoffice.common.empty')} />}
      {last.data && last.data.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>{t('backoffice.sales.date')}</th>
              <th>{t('pos.mode.label')}</th>
              <th align="right">{t('pos.receipt.total')}</th>
            </tr>
          </thead>
          <tbody>
            {last.data.map((o) => (
              <tr key={o.id}>
                <td>{new Date(o.ts).toLocaleString('de-DE')}</td>
                <td>{t(`pos.mode.${o.mode}`)}</td>
                <td align="right">{euro(o.totalGross)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
