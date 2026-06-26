import { applyRate, type Cents } from '@gelato/domain'

export interface TabItemInput {
  productId: string
  qty: number // pode ser negativo (Storno)
  unitNet: Cents
  mwstRate: number
  mwstCode: string
}
export interface TabLine {
  productId: string
  mwstCode: string
  mwstRate: number
  qty: number
  net: Cents
}
export interface TabVatGroup {
  rate: number
  net: Cents
  mwst: Cents
  gross: Cents
}
export interface TabState {
  lines: TabLine[]
  byVatRate: TabVatGroup[]
  totalNet: Cents
  totalMwst: Cents
  totalGross: Cents
}

/**
 * Estado corrente da conta = soma de TODAS as Bestellungen (Stornos têm qty
 * negativa e cancelam). Agrupa linhas por (produto, código de MwSt) e os totais
 * por alíquota (MwSt aplicada sobre o net somado — sem dupla arredondamento). Puro.
 */
export function aggregateTab(items: TabItemInput[]): TabState {
  const lineMap = new Map<string, TabLine>()
  for (const it of items) {
    const key = `${it.productId}|${it.mwstCode}`
    const l = lineMap.get(key) ?? {
      productId: it.productId,
      mwstCode: it.mwstCode,
      mwstRate: it.mwstRate,
      qty: 0,
      net: 0,
    }
    l.qty += it.qty
    l.net += it.unitNet * it.qty
    lineMap.set(key, l)
  }
  const lines = [...lineMap.values()]

  const vatMap = new Map<number, { rate: number; net: Cents }>()
  for (const l of lines) {
    const g = vatMap.get(l.mwstRate) ?? { rate: l.mwstRate, net: 0 }
    g.net += l.net
    vatMap.set(l.mwstRate, g)
  }
  const byVatRate: TabVatGroup[] = [...vatMap.values()].map((g) => {
    const mwst = applyRate(g.net, g.rate)
    return { rate: g.rate, net: g.net, mwst, gross: g.net + mwst }
  })

  return {
    lines,
    byVatRate,
    totalNet: byVatRate.reduce((s, g) => s + g.net, 0),
    totalMwst: byVatRate.reduce((s, g) => s + g.mwst, 0),
    totalGross: byVatRate.reduce((s, g) => s + g.gross, 0),
  }
}
