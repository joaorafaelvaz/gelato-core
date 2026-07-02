import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { apiGet, apiPost, type VoucherRow } from '../api'
import { useFetch } from '../useFetch'
import { useToast } from '../ui/Toast'
import { euro } from '../format'
import { Spinner } from '../ui/Spinner'
import { ErrorState } from '../ui/ErrorState'
import { EmptyState } from '../ui/EmptyState'
import { Pagination } from '../ui/Pagination'

const PAGE = 25

export function Vouchers({ token }: { token: string }) {
  const { t } = useTranslation()
  const toast = useToast()
  const [code, setCode] = useState('')
  const [type, setType] = useState('percent')
  const [value, setValue] = useState('')
  const [page, setPage] = useState(0)
  const vouchers = useFetch(() => apiGet<VoucherRow[]>('/vouchers', token), [token])

  async function create(e: FormEvent): Promise<void> {
    e.preventDefault()
    if (!code || !value) return
    try {
      await apiPost('/vouchers', token, { code, type, value: Number(value) })
      toast('success', t('backoffice.common.saved'))
      setCode('')
      setValue('')
      vouchers.reload()
    } catch {
      toast('error', t('backoffice.common.actionFailed'))
    }
  }

  const rows = vouchers.data ?? []
  const pageCount = Math.ceil(rows.length / PAGE)
  const visible = rows.slice(page * PAGE, (page + 1) * PAGE)

  return (
    <section>
      {vouchers.loading && <Spinner />}
      {vouchers.error && <ErrorState onRetry={vouchers.reload} />}
      {vouchers.data && rows.length === 0 && <EmptyState message={t('backoffice.common.empty')} />}
      {rows.length > 0 && (
        <>
          <table>
            <thead>
              <tr>
                <th>{t('backoffice.vouchers.code')}</th>
                <th>{t('backoffice.vouchers.type')}</th>
                <th>{t('backoffice.vouchers.value')}</th>
                <th>{t('backoffice.vouchers.uses')}</th>
                <th>{t('backoffice.vouchers.active')}</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((v) => (
                <tr key={v.id} style={!v.active ? { color: 'var(--text-muted)' } : undefined}>
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
          <Pagination page={page} pageCount={pageCount} onPage={setPage} />
        </>
      )}
      <form onSubmit={create} style={{ marginTop: '0.5rem', display: 'flex', gap: '0.5rem' }}>
        <input value={code} onChange={(e) => setCode(e.target.value)} placeholder={t('backoffice.vouchers.code')} />
        <select value={type} onChange={(e) => setType(e.target.value)}>
          <option value="percent">percent</option>
          <option value="fixed">fixed (cents)</option>
        </select>
        <input type="number" value={value} onChange={(e) => setValue(e.target.value)} placeholder={type === 'percent' ? '%' : 'cents'} />
        <button type="submit">{t('backoffice.vouchers.create')}</button>
      </form>
    </section>
  )
}
