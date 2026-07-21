import { useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { apiGet, apiPatch, apiPost, apiUpload, type CategoryRow, type ProductRow, type TaxRateRow } from '../api'
import { useFetch } from '../useFetch'
import { useToast } from '../ui/Toast'
import { euro } from '../format'
import { Spinner } from '../ui/Spinner'
import { ErrorState } from '../ui/ErrorState'
import { EmptyState } from '../ui/EmptyState'

function CameraIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
      <path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z" />
      <circle cx="12" cy="13" r="3.2" />
    </svg>
  )
}

function ProductPhoto({ product, token, onUploaded }: { product: ProductRow; token: string; onUploaded: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy(true)
    try {
      const { url } = await apiUpload('/products/upload-image', token, file)
      await apiPatch(`/products/${product.id}`, token, { imageUrl: url })
      onUploaded()
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      className="menu-thumb"
      onClick={() => fileRef.current?.click()}
      disabled={busy}
      style={{
        backgroundImage: product.imageUrl ? `url(${product.imageUrl})` : undefined,
      }}
      title="Foto do produto"
    >
      <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" style={{ display: 'none' }} onChange={(e) => void handleFile(e)} />
      {!product.imageUrl && (busy ? '…' : <CameraIcon />)}
    </button>
  )
}

export function Products({ token }: { token: string }) {
  const { t } = useTranslation()
  const toast = useToast()
  const [name, setName] = useState('')
  const [price, setPrice] = useState('')
  const [imHaus, setImHaus] = useState('')
  const [ausserHaus, setAusserHaus] = useState('')
  const products = useFetch(() => apiGet<ProductRow[]>('/products', token), [token])
  const categories = useFetch(() => apiGet<CategoryRow[]>('/product-categories', token), [token])
  const rates = useFetch(() => apiGet<TaxRateRow[]>('/tax-rates', token), [token])

  const sortedCategories = [...(categories.data ?? [])].sort((a, b) => a.sortOrder - b.sortOrder)
  const groups: { id: string; name: string; items: ProductRow[] }[] = [
    ...sortedCategories.map((c) => ({
      id: c.id,
      name: c.name,
      items: (products.data ?? []).filter((p) => p.categoryId === c.id),
    })),
    {
      id: '__none',
      name: t('backoffice.products.noCategory'),
      items: (products.data ?? []).filter((p) => !p.categoryId),
    },
  ].filter((g) => g.items.length > 0)

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
        <div className="menu">
          {groups.map((g) => (
            <div key={g.id} className="menu-section">
              <h2 className="menu-section-title">{g.name}</h2>
              <div className="menu-grid">
                {g.items.map((p) => (
                  <div key={p.id} className="menu-card">
                    <ProductPhoto product={p} token={token} onUploaded={() => products.reload()} />
                    <div className="menu-card-name">{p.name}</div>
                    <div className="menu-card-price">{euro(p.netCents)}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
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
