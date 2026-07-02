import { useTranslation } from 'react-i18next'
import { apiGet, type ProductRow } from '../api'
import { useFetch } from '../useFetch'
import { euro } from '../format'
import { Spinner } from '../ui/Spinner'
import { ErrorState } from '../ui/ErrorState'
import { EmptyState } from '../ui/EmptyState'

export function Products({ token }: { token: string }) {
  const { t } = useTranslation()
  const products = useFetch(() => apiGet<ProductRow[]>('/products', token), [token])

  if (products.loading) return <Spinner />
  if (products.error) return <ErrorState onRetry={products.reload} />
  if (!products.data || products.data.length === 0) {
    return <EmptyState message={t('backoffice.common.empty')} />
  }

  return (
    <section>
      <ul>
        {products.data.map((p) => (
          <li key={p.id}>
            {p.name} — {euro(p.netCents)}
          </li>
        ))}
      </ul>
    </section>
  )
}
