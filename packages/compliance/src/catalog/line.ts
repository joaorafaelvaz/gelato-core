import type { Cents } from '@gelato/domain'

export interface SaleLineModifier {
  id: string
  name: string
  net: Cents
}
export interface SaleLineBase {
  baseNetCents: Cents
  mwstCode: string
}
export interface SaleLineVariant {
  netCents: Cents
}
export interface SaleLine {
  unitNet: Cents
  mwstCode: string
  modifiers: SaleLineModifier[]
}

/**
 * Compõe a linha vendida: o net da variante (ABSOLUTO) substitui o do produto, e os
 * modifiers (acréscimos) são somados. A MwSt herda o código do produto (resolução da
 * alíquota fica no motor/tax_rates). Os modifiers são devolvidos como snapshot. Puro.
 */
export function buildSaleLine(
  base: SaleLineBase,
  variant: SaleLineVariant | undefined,
  modifiers: SaleLineModifier[],
): SaleLine {
  const baseNet = variant?.netCents ?? base.baseNetCents
  const unitNet = baseNet + modifiers.reduce((s, m) => s + m.net, 0)
  return { unitNet, mwstCode: base.mwstCode, modifiers }
}
