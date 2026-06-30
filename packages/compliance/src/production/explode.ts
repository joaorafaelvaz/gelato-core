export interface ProductionIngredient {
  stockItemId: string
  qty: number
}

/** Explode uma produção de N lotes: produz yieldQty×N do output, consome qty×N de cada insumo. Puro. */
export function explodeProduction(
  outputStockItemId: string,
  yieldQty: number,
  ingredients: ProductionIngredient[],
  batches: number,
): { produce: { stockItemId: string; qty: number }; consume: { stockItemId: string; qty: number }[] } {
  return {
    produce: { stockItemId: outputStockItemId, qty: yieldQty * batches },
    consume: ingredients.map((i) => ({ stockItemId: i.stockItemId, qty: i.qty * batches })),
  }
}
