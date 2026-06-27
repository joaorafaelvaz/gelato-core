import type { RecipeIngredientInput } from './explode'

/**
 * Quantas unidades vendáveis dá p/ produzir com o estoque atual: o insumo
 * limitante (min de floor(estoque / qtyReceita)). Estoque negativo/insuficiente
 * ou insumo ausente → 0. Sem ingredientes → 0. Ignora qty ≤ 0.
 */
export function maxProducible(ingredients: RecipeIngredientInput[], stockByItem: Map<string, number>): number {
  let min = Infinity
  for (const ing of ingredients) {
    if (ing.qty <= 0) continue
    const have = stockByItem.get(ing.stockItemId) ?? 0
    min = Math.min(min, Math.floor(have / ing.qty))
  }
  return min === Infinity ? 0 : Math.max(0, min)
}
