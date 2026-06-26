import { applyRate, type Cents } from '@gelato/domain'
import type { TabState } from './aggregate'

export interface PaidLike {
  rate: number
  net: Cents
}
export interface PaidGroup {
  rate: number
  net: Cents
  mwst: Cents
  gross: Cents
}
export interface SplitLine {
  productId: string
  qty: number
  unitNet: Cents
  mwstRate: number
  mwstCode: string
}
export interface SplitResult {
  lines: SplitLine[]
  totalNet: Cents
  totalMwst: Cents
  totalGross: Cents
  settles: boolean
}

/** Soma os itens dos orders (já pagos) por alíquota → {rate,net,mwst,gross}. Net-centric. */
export function paidByRate(
  orders: { items: { unitNet: Cents; qty: number; mwstRate: number }[] }[],
): PaidGroup[] {
  const byRate = new Map<number, Cents>()
  for (const o of orders) {
    for (const it of o.items) {
      byRate.set(it.mwstRate, (byRate.get(it.mwstRate) ?? 0) + it.unitNet * it.qty)
    }
  }
  return [...byRate.entries()].map(([rate, net]) => {
    const mwst = applyRate(net, rate)
    return { rate, net, mwst, gross: net + mwst }
  })
}

/**
 * Fatia um pagamento de `payGross` (bruto) sobre a conta. NET-CENTRIC: cada linha tem
 * `unitNet`, e o bruto é sempre `net + applyRate(net,rate)` (igual ao ledger). Rateia
 * proporcional ao bruto remanescente; o pagamento que cobre o resto (`settles`) toma o
 * remanescente de NET EXATO por alíquota → Σ de todos os pagamentos = a conta, exato.
 */
export function apportionSplit(fullTab: TabState, paid: PaidLike[], payGross: Cents): SplitResult {
  const paidNet = new Map(paid.map((p) => [p.rate, p.net]))
  const remaining = fullTab.byVatRate
    .map((g) => {
      const code = fullTab.lines.find((l) => l.mwstRate === g.rate)?.mwstCode ?? String(g.rate)
      const net = g.net - (paidNet.get(g.rate) ?? 0)
      return { rate: g.rate, code, net, gross: net + applyRate(net, g.rate) }
    })
    .filter((r) => r.net > 0)
  const totalRemainingGross = remaining.reduce((s, r) => s + r.gross, 0)

  let chosen: { rate: number; code: string; net: Cents }[]
  let settles = false
  if (payGross >= totalRemainingGross) {
    chosen = remaining.map((r) => ({ rate: r.rate, code: r.code, net: r.net }))
    settles = true
  } else {
    chosen = remaining
      .map((r) => {
        const targetGross = Math.round((payGross * r.gross) / totalRemainingGross)
        const net = Math.min(Math.round(targetGross / (1 + r.rate)), r.net)
        return { rate: r.rate, code: r.code, net }
      })
      .filter((c) => c.net > 0)
  }

  const lines: SplitLine[] = chosen.map((c) => ({
    productId: `split:${c.code}`,
    qty: 1,
    unitNet: c.net,
    mwstRate: c.rate,
    mwstCode: c.code,
  }))
  const totalNet = chosen.reduce((s, c) => s + c.net, 0)
  const totalMwst = chosen.reduce((s, c) => s + applyRate(c.net, c.rate), 0)
  return { lines, totalNet, totalMwst, totalGross: totalNet + totalMwst, settles }
}
