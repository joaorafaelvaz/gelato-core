import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { apiGet, apiPost, type ProductionRecipeRow } from '../api'
import { useFetch } from '../useFetch'
import { useToast } from '../ui/Toast'
import { Spinner } from '../ui/Spinner'
import { ErrorState } from '../ui/ErrorState'
import { EmptyState } from '../ui/EmptyState'

export function Production({ token }: { token: string }) {
  const { t } = useTranslation()
  const toast = useToast()
  const [batches, setBatches] = useState<Record<string, string>>({})
  const recipes = useFetch(() => apiGet<ProductionRecipeRow[]>('/production/recipes', token), [token])

  async function produce(outputId: string): Promise<void> {
    const n = Number(batches[outputId])
    if (!n || n <= 0) return
    try {
      await apiPost('/production', token, { output_stock_item_id: outputId, batches: n })
      toast('success', t('backoffice.production.produced'))
      setBatches((b) => ({ ...b, [outputId]: '' }))
      recipes.reload()
    } catch {
      toast('error', t('backoffice.common.actionFailed'))
    }
  }

  if (recipes.loading) return <Spinner />
  if (recipes.error) return <ErrorState onRetry={recipes.reload} />
  if (!recipes.data || recipes.data.length === 0) {
    return <EmptyState message={t('backoffice.common.empty')} />
  }

  return (
    <section>
      <ul>
        {recipes.data.map((r) => (
          <li key={r.id}>
            <strong>{r.outputName}</strong> — {t('backoffice.production.yieldPerBatch', { qty: r.yieldQty, unit: r.unit })}
            <ul>
              {r.ingredients.map((i) => (
                <li key={i.stockItemId}>
                  {i.qty} {i.unit} — {i.name}
                </li>
              ))}
            </ul>
            <input
              type="number"
              placeholder={t('backoffice.production.batches')}
              value={batches[r.outputStockItemId] ?? ''}
              onChange={(e) => setBatches((b) => ({ ...b, [r.outputStockItemId]: e.target.value }))}
            />
            <button onClick={() => void produce(r.outputStockItemId)}>{t('backoffice.production.produce')}</button>
          </li>
        ))}
      </ul>
    </section>
  )
}
