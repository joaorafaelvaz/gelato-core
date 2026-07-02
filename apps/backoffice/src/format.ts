/** Dinheiro em cents (Int) → string de-DE. Nunca float no domínio. */
export const euro = (cents: number): string =>
  (cents / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })
