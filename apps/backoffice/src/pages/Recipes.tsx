import { useEffect, useState } from 'react'
import { apiGet, type RecipeRow, type Availability } from '../api'

export function Recipes({ token }: { token: string }) {
  const [recipes, setRecipes] = useState<RecipeRow[]>([])
  const [avail, setAvail] = useState<Record<string, number>>({})
  useEffect(() => {
    apiGet<RecipeRow[]>('/recipes', token)
      .then(setRecipes)
      .catch(() => setRecipes([]))
    apiGet<Availability[]>('/recipes/availability', token)
      .then((a) => setAvail(Object.fromEntries(a.map((x) => [x.recipeId, x.maxProducible]))))
      .catch(() => setAvail({}))
  }, [token])

  return (
    <section style={{ marginTop: '2rem' }}>
      <h2>Receitas</h2>
      <ul>
        {recipes.map((r) => (
          <li key={r.id}>
            <strong>
              {r.productName}
              {r.variantName ? ` (${r.variantName})` : ''}
            </strong>
            {r.id in avail && ` — dá p/ ${avail[r.id]}`}
            {!r.active && ' — inativa'}
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
