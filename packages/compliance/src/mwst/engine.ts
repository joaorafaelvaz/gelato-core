import { applyRate, type ConsumptionMode } from '@gelato/domain'
import type { MwstBreakdown, MwstGroup, MwstLineInput, TaxRate } from './types'
import { pickRate } from './rates'

/**
 * Calcula a decomposição de MwSt de um conjunto de linhas, para um modo de
 * consumo, numa data, contra um conjunto de alíquotas versionadas.
 *
 * Função pura: a alíquota aplicada a cada item depende do `mode`
 * (`im_haus` vs `ausser_haus`) e do código de alíquota do produto. Os totais
 * são agrupados por alíquota (exigido por TSE/DSFinV-K) e o arredondamento é
 * feito por grupo.
 */
export function computeMwst(
  lines: MwstLineInput[],
  mode: ConsumptionMode,
  at: Date,
  rates: TaxRate[],
): MwstBreakdown {
  // 1) acumula net (cents) por código de alíquota, conforme o modo de consumo
  const netByCode = new Map<string, number>()
  for (const { product, qty } of lines) {
    const code = mode === 'im_haus' ? product.mwstCodeImHaus : product.mwstCodeAusserHaus
    const net = product.netCents * qty
    netByCode.set(code, (netByCode.get(code) ?? 0) + net)
  }

  // 2) monta os grupos (ordenados por código p/ saída determinística)
  const groups: MwstGroup[] = [...netByCode.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([code, net]) => {
      const rate = pickRate(rates, code, at).rate
      const mwst = applyRate(net, rate)
      return { code, rate, net, mwst, gross: net + mwst }
    })

  // 3) totais
  return {
    groups,
    totalNet: groups.reduce((s, g) => s + g.net, 0),
    totalMwst: groups.reduce((s, g) => s + g.mwst, 0),
    totalGross: groups.reduce((s, g) => s + g.gross, 0),
  }
}
