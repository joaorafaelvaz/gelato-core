import type { TaxRate } from './types'

/**
 * Seleciona a alíquota vigente para um código numa data.
 * `validFrom` é inclusivo, `validTo` é exclusivo. Lança se não houver vigente.
 */
export function pickRate(rates: TaxRate[], code: string, at: Date): TaxRate {
  const match = rates.find(
    (r) => r.code === code && r.validFrom <= at && (r.validTo === undefined || at < r.validTo),
  )
  if (!match) {
    throw new Error(`No valid tax rate for code "${code}" at ${at.toISOString()}`)
  }
  return match
}
