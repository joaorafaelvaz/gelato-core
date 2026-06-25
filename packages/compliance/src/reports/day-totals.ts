import type { DayTotals, DayTotalsInput, PaymentGroup, VatGroup } from './types'

/**
 * Totais de um período (X = snapshot, Z = fechamento) computados sobre o ledger.
 * Agrupa por alíquota MwSt (mwst = gross − net por grupo) e por meio de pagamento,
 * conta recibos/stornos, e acumula o Grand Total (soma bruta desde a criação da
 * Kasse — expectativa GoBD). Função pura.
 */
export function computeDayTotals(input: DayTotalsInput): DayTotals {
  const vatMap = new Map<number, { net: number; gross: number }>()
  for (const l of input.lines) {
    const g = vatMap.get(l.mwstRate) ?? { net: 0, gross: 0 }
    g.net += l.net
    g.gross += l.gross
    vatMap.set(l.mwstRate, g)
  }
  const byVatRate: VatGroup[] = [...vatMap.entries()]
    .sort(([a], [b]) => a - b)
    .map(([rate, g]) => ({ rate, net: g.net, mwst: g.gross - g.net, gross: g.gross }))

  const payMap = new Map<string, number>()
  for (const p of input.payments) payMap.set(p.method, (payMap.get(p.method) ?? 0) + p.amount)
  const byPayment: PaymentGroup[] = [...payMap.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([method, amount]) => ({ method, amount }))

  const totalNet = byVatRate.reduce((s, g) => s + g.net, 0)
  const totalMwst = byVatRate.reduce((s, g) => s + g.mwst, 0)
  const totalGross = byVatRate.reduce((s, g) => s + g.gross, 0)

  return {
    byVatRate,
    byPayment,
    totalNet,
    totalMwst,
    totalGross,
    receiptCount: input.receiptCount,
    stornoCount: input.stornoCount,
    grandTotal: input.priorGrandTotal + totalGross,
  }
}
