import { useTranslation } from 'react-i18next'
import { apiGet, type ChecklistStatusRow, type OrderRow, type OrdersSummary, type StockAlert } from '../api'
import { useFetch } from '../useFetch'
import { euro } from '../format'
import { todayRange } from '../date-util'
import { MetricCard } from '../ui/MetricCard'
import { Spinner } from '../ui/Spinner'
import { ErrorState } from '../ui/ErrorState'
import { EmptyState } from '../ui/EmptyState'
import type { PageProps } from './types'

export function Dashboard({ token, navigate }: PageProps) {
  const { t } = useTranslation()
  const fromIso = todayRange(new Date()).from.toISOString()
  const summary = useFetch(
    () => apiGet<OrdersSummary>(`/orders/summary?from=${encodeURIComponent(fromIso)}`, token),
    [token],
  )
  const alerts = useFetch(() => apiGet<StockAlert[]>('/stock/alerts', token), [token])
  const status = useFetch(() => apiGet<ChecklistStatusRow[]>('/checklists/status', token), [token])
  const last = useFetch(() => apiGet<OrderRow[]>('/orders?limit=10', token), [token])

  const alertCount = (alerts.data ?? []).length
  const overdue = (status.data ?? []).filter((s) => s.overdue).length

  return (
    <section>
      <div className="metrics">
        <MetricCard
          label={t('backoffice.dashboard.salesToday')}
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
