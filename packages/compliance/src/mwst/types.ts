import type { Cents } from '@gelato/domain'

/**
 * Alíquota de MwSt versionada. As taxas vêm sempre do banco (tabela `tax_rates`),
 * NUNCA hardcoded — a regra para gelato muda e exige histórico.
 */
export interface TaxRate {
  code: string
  rate: number
  validFrom: Date
  validTo?: Date
}

/** Referência mínima de produto para o cálculo de MwSt. */
export interface MwstProductRef {
  id: string
  netCents: Cents
  mwstCodeImHaus: string
  mwstCodeAusserHaus: string
}

export interface MwstLineInput {
  product: MwstProductRef
  qty: number
}

/** Totais agrupados por alíquota — necessário para TSE e DSFinV-K. */
export interface MwstGroup {
  code: string
  rate: number
  net: Cents
  mwst: Cents
  gross: Cents
}

export interface MwstBreakdown {
  groups: MwstGroup[]
  totalNet: Cents
  totalMwst: Cents
  totalGross: Cents
}
