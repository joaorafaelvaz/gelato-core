import type { ShiftCashInput, ShiftCashResult } from './types'

/**
 * Kassensturz: confere o caixa do turno.
 * esperado = float de abertura + vendas em dinheiro + suprimentos − sangrias;
 * Differenz = contado − esperado (negativo = falta, positivo = sobra).
 */
export function computeShiftCash(i: ShiftCashInput): ShiftCashResult {
  const expected = i.openingFloat + i.cashSales + i.suprimentos - i.sangrias
  return { expected, counted: i.counted, differenz: i.counted - expected }
}
