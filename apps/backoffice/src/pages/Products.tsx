import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { apiGet, apiPost, type ProductRow, type TaxRateRow } from '../api'
import { useFetch } from '../useFetch'
import { useToast } from '../ui/Toast'
import { euro } from '../format'
import { Spinner } from '../ui/Spinner'
import { ErrorState } from '../ui/ErrorState'
import { EmptyState } from '../ui/EmptyState'

export function Products({ token }: { token: string }) {
  const { t } = useTranslation()
  const toast = useToast()
  const [name, setName] = useState('')
  const [price, setPrice] = useState('')
  const [imHaus, setImHaus] = useState('')
  const [ausserHaus, setAusserHaus] = useState('')
  const products = useFetch(() => apiGet<ProductRow[]>('/products', token), [token])
  const rates = useFetch(() => apiGet<TaxRateRow[]>('/tax-rates', token), [token])

  const codes = [...new Set((rates.data ?? []).map((r) => r.code))]
  const effImHaus = imHaus || (codes[0] ?? '')
  const effAusserHaus = ausserHaus || (codes[1] ?? codes[0] ?? '')

  async function create(e: FormEvent): Promise<void> {
    e.preventDefault()
    if (!name || !price || !effImHaus || !effAusserHaus) return
    try {
      await apiPost('/products', token, {
        name,
        netCents: Math.round(Number(price) * 100),
        mwstCodeImHaus: effImHaus,
        mwstCodeAusserHaus: effAusserHaus,
      })
      toast('success', t('backoffice.common.saved'))
      setName('')
      setPrice('')
      products.reload()
    } catch {
      toast('error', t('backoffice.common.actionFailed'))
    }
  }

  return (
    <section>
      {products.loading && <Spinner />}
      {products.error && <ErrorState onRetry={products.reload} />}
      {products.data && products.data.length === 0 && <EmptyState message={t('backoffice.common.empty')} />}
      {products.data && products.data.length > 0 && (
        <ul>
          {products.data.map((p) => (
            <li key={p.id}>
              {p.name} — {euro(p.netCents)}
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={create} style={{ marginTop: '0.5rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('backoffice.products.name')} />
        <input
          type="number"
          step="0.01"
          min="0"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          placeholder={t('backoffice.products.priceNet')}
          style={{ width: 140 }}
        />
        <label>
          {t('backoffice.products.mwstImHaus')}{' '}
          <select value={effImHaus} onChange={(e) => setImHaus(e.target.value)}>
            {codes.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </label>
        <label>
          {t('backoffice.products.mwstAusserHaus')}{' '}
          <select value={effAusserHaus} onChange={(e) => setAusserHaus(e.target.value)}>
            {codes.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </label>
        <button type="submit">{t('backoffice.common.create')}</button>
      </form>
    </section>
  )
}
