export interface RecipeIngredientInput {
  stockItemId: string
  qty: number // unidade-base do insumo, por 1 unidade vendida
}
export interface SoldLine {
  ingredients: RecipeIngredientInput[]
  qtySold: number
}
export interface Consumption {
  stockItemId: string
  qty: number
}

/** Consumo de uma linha = cada ingrediente × qtySold. Puro. */
export function explodeRecipe(ingredients: RecipeIngredientInput[], qtySold: number): Consumption[] {
  return ingredients.map((i) => ({ stockItemId: i.stockItemId, qty: i.qty * qtySold }))
}

/**
 * Consumo total de uma cesta de linhas vendidas, somado por insumo e ordenado
 * por stockItemId (determinístico). Base p/ o decremento/disponibilidade da 2c.
 */
export function aggregateConsumption(lines: SoldLine[]): Consumption[] {
  const byItem = new Map<string, number>()
  for (const line of lines) {
    for (const c of explodeRecipe(line.ingredients, line.qtySold)) {
      byItem.set(c.stockItemId, (byItem.get(c.stockItemId) ?? 0) + c.qty)
    }
  }
  return [...byItem.entries()]
    .map(([stockItemId, qty]) => ({ stockItemId, qty }))
    .sort((a, b) => (a.stockItemId < b.stockItemId ? -1 : a.stockItemId > b.stockItemId ? 1 : 0))
}
