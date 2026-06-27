export type StockAlertState = 'low' | 'negative'

/** Classifica um nível de estoque. Negativo é mais urgente; low exige minStock. */
export function classifyStockAlert(qty: number, minStock: number | null): 'ok' | StockAlertState {
  if (qty < 0) return 'negative'
  if (minStock != null && qty < minStock) return 'low'
  return 'ok'
}

/**
 * Só os insumos em alerta (não-ok), ordenados por severidade (negative antes de
 * low) e, dentro, por qty ascendente (mais crítico primeiro). Genérica/pass-through.
 */
export function stockAlerts<T extends { qty: number; minStock: number | null }>(items: T[]): (T & { state: StockAlertState })[] {
  const rank: Record<StockAlertState, number> = { negative: 0, low: 1 }
  return items
    .map((i) => ({ ...i, state: classifyStockAlert(i.qty, i.minStock) }))
    .filter((i): i is T & { state: StockAlertState } => i.state !== 'ok')
    .sort((a, b) => rank[a.state] - rank[b.state] || a.qty - b.qty)
}
