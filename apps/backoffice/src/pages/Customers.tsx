import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { apiGet, apiPost, type CustomerRow } from '../api'
import { useFetch } from '../useFetch'
import { useToast } from '../ui/Toast'
import { Spinner } from '../ui/Spinner'
import { ErrorState } from '../ui/ErrorState'
import { EmptyState } from '../ui/EmptyState'
import { Pagination } from '../ui/Pagination'

const PAGE = 25

export function Customers({ token }: { token: string }) {
  const { t } = useTranslation()
  const toast = useToast()
  const [page, setPage] = useState(0)
  const customers = useFetch(() => apiGet<CustomerRow[]>('/customers', token), [token])

  async function anonymize(id: string): Promise<void> {
    try {
      await apiPost(`/customers/${id}/anonymize`, token, {})
      toast('success', t('backoffice.common.saved'))
      customers.reload()
    } catch {
      toast('error', t('backoffice.common.actionFailed'))
    }
  }

  if (customers.loading) return <Spinner />
  if (customers.error) return <ErrorState onRetry={customers.reload} />
  const rows = customers.data ?? []
  if (rows.length === 0) return <EmptyState message={t('backoffice.common.empty')} />
  const pageCount = Math.ceil(rows.length / PAGE)
  const visible = rows.slice(page * PAGE, (page + 1) * PAGE)

  return (
    <section>
      <table>
        <thead>
          <tr>
            <th>{t('backoffice.crm.name')}</th>
            <th>{t('backoffice.crm.contact')}</th>
            <th>{t('backoffice.crm.consents')}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {visible.map((c) => (
            <tr key={c.id} style={c.anonymizedAt ? { color: 'var(--text-muted)' } : undefined}>
              <td>{c.anonymizedAt ? t('backoffice.crm.anonymized') : (c.name ?? '—')}</td>
              <td>{c.email ?? c.phone ?? '—'}</td>
              <td>{Object.entries(c.consents).map(([p, a]) => `${p}: ${a}`).join('; ') || '—'}</td>
              <td>{!c.anonymizedAt && <button onClick={() => void anonymize(c.id)}>{t('backoffice.crm.anonymize')}</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <Pagination page={page} pageCount={pageCount} onPage={setPage} />
    </section>
  )
}
