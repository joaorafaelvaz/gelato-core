import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { apiGet, apiPut, type CustomerRow, type LoyaltyProgram, type LoyaltyView } from '../api'
import { useFetch } from '../useFetch'
import { useToast } from '../ui/Toast'
import { Spinner } from '../ui/Spinner'
import { ErrorState } from '../ui/ErrorState'
import { EmptyState } from '../ui/EmptyState'

export function Loyalty({ token }: { token: string }) {
  const { t } = useTranslation()
  const toast = useToast()
  const [form, setForm] = useState<LoyaltyProgram | null>(null)
  const [balances, setBalances] = useState<Record<string, { points: number; stamps: number }>>({})
  const program = useFetch(() => apiGet<LoyaltyProgram>('/loyalty/program', token), [token])
  const customers = useFetch(() => apiGet<CustomerRow[]>('/customers', token), [token])

  useEffect(() => {
    if (program.data) setForm(program.data)
  }, [program.data])

  async function save(): Promise<void> {
    if (!form) return
    try {
      await apiPut('/loyalty/program', token, { points_per_euro: form.pointsPerEuro, stamps_per_item: form.stampsPerItem, active: form.active })
      toast('success', t('backoffice.common.saved'))
      program.reload()
    } catch {
      toast('error', t('backoffice.common.actionFailed'))
    }
  }

  async function showBalance(id: string): Promise<void> {
    try {
      const v = await apiGet<LoyaltyView>(`/customers/${id}/loyalty`, token)
      setBalances((b) => ({ ...b, [id]: v.balance }))
    } catch {
      toast('error', t('backoffice.common.actionFailed'))
    }
  }

  return (
    <section>
      {program.loading && <Spinner />}
      {program.error && <ErrorState onRetry={program.reload} />}
      {form && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <label>
            {t('backoffice.loyalty.pointsPerEuro')}{' '}
            <input type="number" value={form.pointsPerEuro} onChange={(e) => setForm({ ...form, pointsPerEuro: Number(e.target.value) })} />
          </label>
          <label>
            {t('backoffice.loyalty.stampsPerItem')}{' '}
            <input type="number" value={form.stampsPerItem} onChange={(e) => setForm({ ...form, stampsPerItem: Number(e.target.value) })} />
          </label>
          <label>
            {t('backoffice.loyalty.active')}{' '}
            <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
          </label>
          <button onClick={() => void save()}>{t('backoffice.loyalty.save')}</button>
        </div>
      )}
      {customers.loading && <Spinner />}
      {customers.error && <ErrorState onRetry={customers.reload} />}
      {customers.data && customers.data.filter((c) => !c.anonymizedAt).length === 0 && (
        <EmptyState message={t('backoffice.common.empty')} />
      )}
      {customers.data && (
        <ul>
          {customers.data.filter((c) => !c.anonymizedAt).map((c) => {
            const b = balances[c.id]
            return (
              <li key={c.id}>
                {c.name ?? c.email ?? c.id}{' '}
                <button onClick={() => void showBalance(c.id)}>{t('backoffice.loyalty.showBalance')}</button>
                {b && ` — ${t('backoffice.loyalty.balance', { points: b.points, stamps: b.stamps })}`}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
