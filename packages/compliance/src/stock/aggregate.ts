export interface StockMovementInput {
  stockItemId: string
  qtyDelta: number // inteiro assinado, em unidade-base (g/ml/Stück)
}
export interface StockLevel {
  stockItemId: string
  qty: number
}

/**
 * Estoque atual = soma de TODOS os deltas por item (entrada +, ajuste/contagem +/−).
 * Append-only-friendly: nunca materializa; só agrega. Ordena por stockItemId
 * (determinístico). Itens sem movimento simplesmente não aparecem (qty 0 é
 * responsabilidade de quem junta com o cadastro de itens). Pode ser negativo.
 */
export function aggregateStock(movements: StockMovementInput[]): StockLevel[] {
  const byItem = new Map<string, number>()
  for (const m of movements) {
    byItem.set(m.stockItemId, (byItem.get(m.stockItemId) ?? 0) + m.qtyDelta)
  }
  return [...byItem.entries()]
    .map(([stockItemId, qty]) => ({ stockItemId, qty }))
    .sort((a, b) => (a.stockItemId < b.stockItemId ? -1 : a.stockItemId > b.stockItemId ? 1 : 0))
}
