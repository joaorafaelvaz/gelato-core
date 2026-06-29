export type VoucherType = 'percent' | 'fixed'

/** Desconto bruto de um voucher sobre a base (gross). Capado no total. Puro. */
export function voucherDiscountGross(type: VoucherType, value: number, baseGross: number): number {
  if (baseGross <= 0) return 0
  const raw = type === 'percent' ? Math.floor((baseGross * value) / 100) : value
  return Math.max(0, Math.min(raw, baseGross))
}

export interface VatGross {
  rate: number
  gross: number
}
export interface DiscountLine {
  rate: number
  net: number
  mwst: number
  gross: number
}

/**
 * Rateia um desconto bruto entre as alíquotas (proporcional ao gross), net-centric;
 * a última alíquota leva o resto (Σ gross = -discountGross exato). Linhas NEGATIVAS. Puro.
 */
export function allocateDiscountByRate(byVatRate: VatGross[], discountGross: number): DiscountLine[] {
  const total = byVatRate.reduce((s, g) => s + g.gross, 0)
  if (total <= 0 || discountGross <= 0) return []
  let allocated = 0
  return byVatRate.map((g, i) => {
    const isLast = i === byVatRate.length - 1
    const share = isLast ? discountGross - allocated : Math.round((discountGross * g.gross) / total)
    allocated += share
    const net = Math.round(share / (1 + g.rate))
    return { rate: g.rate, net: -net, mwst: -(share - net), gross: -share }
  })
}
