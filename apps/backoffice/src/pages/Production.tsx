import { useEffect, useState } from 'react'
import { apiGet, apiPost, type ProductionRecipeRow } from '../api'

export function Production({ token }: { token: string }) {
  const [recipes, setRecipes] = useState<ProductionRecipeRow[]>([])
  const [batches, setBatches] = useState<Record<string, string>>({})

  const reload = (): void => {
    apiGet<ProductionRecipeRow[]>('/production/recipes', token).then(setRecipes).catch(() => setRecipes([]))
  }
  useEffect(reload, [token])

  async function produce(outputId: string): Promise<void> {
    const n = Number(batches[outputId])
    if (!n || n <= 0) return
    await apiPost('/production', token, { output_stock_item_id: outputId, batches: n })
    setBatches((b) => ({ ...b, [outputId]: '' }))
    reload()
  }

  return (
    <section style={{ marginTop: '2rem' }}>
      <h2>Produção (semi-acabados)</h2>
      <ul>
        {recipes.map((r) => (
          <li key={r.id}>
            <strong>{r.outputName}</strong> — rende {r.yieldQty} {r.unit}/lote
            <ul>
              {r.ingredients.map((i) => (
                <li key={i.stockItemId}>
                  {i.qty} {i.unit} — {i.name}
                </li>
              ))}
            </ul>
            <input
              type="number"
              placeholder="lotes"
              value={batches[r.outputStockItemId] ?? ''}
              onChange={(e) => setBatches((b) => ({ ...b, [r.outputStockItemId]: e.target.value }))}
            />
            <button onClick={() => produce(r.outputStockItemId)}>Produzir</button>
          </li>
        ))}
      </ul>
    </section>
  )
}
