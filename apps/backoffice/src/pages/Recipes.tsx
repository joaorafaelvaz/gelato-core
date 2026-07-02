import { useTranslation } from 'react-i18next'
import { apiGet, type Availability, type RecipeRow } from '../api'
import { useFetch } from '../useFetch'
import { Spinner } from '../ui/Spinner'
import { ErrorState } from '../ui/ErrorState'
import { EmptyState } from '../ui/EmptyState'

export function Recipes({ token }: { token: string }) {
  const { t } = useTranslation()
  const recipes = useFetch(() => apiGet<RecipeRow[]>('/recipes', token), [token])
  const availability = useFetch(() => apiGet<Availability[]>('/recipes/availability', token), [token])
  const avail = Object.fromEntries((availability.data ?? []).map((x) => [x.recipeId, x.maxProducible]))

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
            <strong>
              {r.productName}
              {r.variantName ? ` (${r.variantName})` : ''}
            </strong>
            {r.id in avail && ` — ${t('backoffice.recipes.yields', { count: avail[r.id] })}`}
            {!r.active && ` — ${t('backoffice.recipes.inactive')}`}
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
    </section>
  )
}
