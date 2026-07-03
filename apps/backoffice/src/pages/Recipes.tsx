import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { apiGet, apiPost, apiPut, type Availability, type ProductRow, type RecipeRow, type StockLevel } from '../api'
import { useFetch } from '../useFetch'
import { useToast } from '../ui/Toast'
import { Spinner } from '../ui/Spinner'
import { ErrorState } from '../ui/ErrorState'
import { EmptyState } from '../ui/EmptyState'

interface IngredientRow {
  stockItemId: string
  qty: string
}

export function Recipes({ token }: { token: string }) {
  const { t } = useTranslation()
  const toast = useToast()
  const [productId, setProductId] = useState('')
  const [variantId, setVariantId] = useState('')
  const [rows, setRows] = useState<IngredientRow[]>([{ stockItemId: '', qty: '' }])
  const recipes = useFetch(() => apiGet<RecipeRow[]>('/recipes', token), [token])
  const availability = useFetch(() => apiGet<Availability[]>('/recipes/availability', token), [token])
  const products = useFetch(() => apiGet<ProductRow[]>('/products', token), [token])
  const stock = useFetch(() => apiGet<StockLevel[]>('/stock', token), [token])
  const avail = Object.fromEntries((availability.data ?? []).map((x) => [x.recipeId, x.maxProducible]))

  const selProduct = (products.data ?? []).find((p) => p.id === productId)
  const unitOf = (id: string): string => (stock.data ?? []).find((s) => s.id === id)?.unit ?? ''

  const setRow = (i: number, patch: Partial<IngredientRow>): void =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)))

  async function create(e: FormEvent): Promise<void> {
    e.preventDefault()
    const ingredients = rows
      .filter((r) => r.stockItemId && Number(r.qty) > 0)
      .map((r) => ({ stock_item_id: r.stockItemId, qty: Number(r.qty) }))
    if (!productId || ingredients.length === 0) return
    try {
      await apiPost('/recipes', token, {
        product_id: productId,
        ...(variantId ? { variant_id: variantId } : {}),
        ingredients,
      })
      toast('success', t('backoffice.common.saved'))
      setProductId('')
      setVariantId('')
      setRows([{ stockItemId: '', qty: '' }])
      recipes.reload()
      availability.reload()
    } catch {
      toast('error', t('backoffice.common.actionFailed'))
    }
  }

  async function toggle(r: RecipeRow): Promise<void> {
    try {
      await apiPut(`/recipes/${r.id}`, token, { active: !r.active })
      toast('success', t('backoffice.common.saved'))
      recipes.reload()
      availability.reload()
    } catch {
      toast('error', t('backoffice.common.actionFailed'))
    }
  }

  return (
    <section>
      {recipes.loading && <Spinner />}
      {recipes.error && <ErrorState onRetry={recipes.reload} />}
      {recipes.data && recipes.data.length === 0 && <EmptyState message={t('backoffice.common.empty')} />}
      {recipes.data && recipes.data.length > 0 && (
        <ul>
          {recipes.data.map((r) => (
            <li key={r.id}>
              <strong>
                {r.productName}
                {r.variantName ? ` (${r.variantName})` : ''}
              </strong>
              {r.id in avail && ` — ${t('backoffice.recipes.yields', { count: avail[r.id] })}`}
              {!r.active && ` — ${t('backoffice.recipes.inactive')}`}{' '}
              <button onClick={() => void toggle(r)} style={{ minHeight: 'auto', padding: '2px 10px' }}>
                {r.active ? t('backoffice.recipes.deactivate') : t('backoffice.recipes.activate')}
              </button>
              <ul>
                {r.ingredients.map((i) => (
                  <li key={i.stockItemId}>
                    {i.qty} {i.unit} — {i.stockItemName}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={create} style={{ marginTop: '0.5rem', display: 'grid', gap: '0.5rem', maxWidth: 560 }}>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <select
            value={productId}
            onChange={(e) => {
              setProductId(e.target.value)
              setVariantId('')
            }}
          >
            <option value="">— {t('backoffice.recipes.product')} —</option>
            {(products.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          {selProduct?.variants && selProduct.variants.length > 0 && (
            <select value={variantId} onChange={(e) => setVariantId(e.target.value)}>
              <option value="">{t('backoffice.recipes.baseOption')}</option>
              {selProduct.variants.map((v) => (
                <option key={v.id} value={v.id}>{v.name}</option>
              ))}
            </select>
          )}
        </div>
        {rows.map((r, i) => (
          <div key={i} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <select value={r.stockItemId} onChange={(e) => setRow(i, { stockItemId: e.target.value })}>
              <option value="">{t('backoffice.stock.selectItem')}</option>
              {(stock.data ?? []).map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            <input
              type="number"
              min={1}
              value={r.qty}
              onChange={(e) => setRow(i, { qty: e.target.value })}
              placeholder={t('backoffice.stock.qty')}
              style={{ width: 120 }}
            />
            <span style={{ color: 'var(--text-muted)' }}>{unitOf(r.stockItemId)}</span>
          </div>
        ))}
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button type="button" onClick={() => setRows((rs) => [...rs, { stockItemId: '', qty: '' }])}>
            {t('backoffice.recipes.addIngredient')}
          </button>
          <button type="submit">{t('backoffice.common.create')}</button>
        </div>
      </form>
    </section>
  )
}
