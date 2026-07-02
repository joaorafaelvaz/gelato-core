import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { apiGet, type OrderRow } from '../api'
import { useFetch } from '../useFetch'
import { euro } from '../format'
import { Spinner } from '../ui/Spinner'
import { ErrorState } from '../ui/ErrorState'
import { EmptyState } from '../ui/EmptyState'

const PAGE = 25

export function Sales({ token }: { token: string }) {
  const { t } = useTranslation()
  const [extra, setExtra] = useState<OrderRow[]>([])
  const [end, setEnd] = useState(false)
  const first = useFetch(() => apiGet<OrderRow[]>(`/orders?limit=${PAGE}`, token), [token])

  async function loadMore(): Promise<void> {
    const offset = PAGE + extra.length
    const next = await apiGet<OrderRow[]>(`/orders?limit=${PAGE}&offset=${offset}`, token)
    setExtra((xs) => [...xs, ...next])
    if (next.length < PAGE) setEnd(true)
  }

  if (first.loading) return <Spinner />
  if (first.error) return <ErrorState onRetry={first.reload} />
  const orders = [...(first.data ?? []), ...extra]
  if (orders.length === 0) return <EmptyState message={t('backoffice.common.empty')} />

  return (
    <section>
      <table>
        <thead>
          <tr>
            <th>{t('backoffice.sales.date')}</th>
            <th>{t('pos.mode.label')}</th>
            <th align="right">{t('pos.receipt.total')}</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o.id}>
              <td>{new Date(o.ts).toLocaleString('de-DE')}</td>
              <td>{t(`pos.mode.${o.mode}`)}</td>
              <td align="right">{euro(o.totalGross)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!end && (first.data?.length ?? 0) === PAGE && (
        <button onClick={() => void loadMore()} style={{ marginTop: 8 }}>
          {t('backoffice.sales.loadMore')}
        </button>
      )}
    </section>
  )
}
