/**
 * Dinheiro é sempre representado em **inteiros (cents)** para evitar erros de
 * ponto flutuante. Nunca usar float para valores monetários no domínio fiscal.
 */
export type Cents = number

export interface NetTaxGross {
  net: Cents
  tax: Cents
  gross: Cents
}

/** Soma uma lista de valores em cents. */
export function sumCents(values: Cents[]): Cents {
  return values.reduce((a, b) => a + b, 0)
}

/**
 * Imposto (em cents) a partir de um valor net (em cents) e uma alíquota.
 * Arredondamento comercial (kaufmännisch / half-up), via Math.round.
 */
export function applyRate(netCents: Cents, rate: number): Cents {
  return Math.round(netCents * rate)
}

/**
 * Decompõe um valor **bruto** (gross, imposto incluído) em net + tax para uma
 * dada alíquota. Útil quando o preço de venda já é bruto (caso comum no varejo DE).
 */
export function splitGross(grossCents: Cents, rate: number): NetTaxGross {
  const net = Math.round(grossCents / (1 + rate))
  const tax = grossCents - net
  return { net, tax, gross: grossCents }
}
