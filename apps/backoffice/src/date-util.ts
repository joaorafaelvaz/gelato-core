/** Início do dia LOCAL do instante dado (p/ "Vendas hoje" do dashboard). */
export function todayRange(now: Date): { from: Date } {
  return { from: new Date(now.getFullYear(), now.getMonth(), now.getDate()) }
}

export type Period = 'today' | 'yesterday' | 'month' | 'year' | 'custom'

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/

/**
 * Janela LOCAL [from, to) a partir de duas datas 'YYYY-MM-DD' de date-picker,
 * com "até" INCLUSIVO (to + 1 dia). Parse por componentes — `new Date('YYYY-MM-DD')`
 * interpretaria como UTC e deslocaria o dia. Null se faltar/for inválida.
 */
export function customRange(fromYmd: string, toYmd: string): { from: Date; to: Date } | null {
  const f = YMD.exec(fromYmd)
  const t = YMD.exec(toYmd)
  if (!f || !t) return null
  return {
    from: new Date(Number(f[1]), Number(f[2]) - 1, Number(f[3])),
    to: new Date(Number(t[1]), Number(t[2]) - 1, Number(t[3]) + 1),
  }
}

/**
 * Janela LOCAL [from, to) do período relativo ao instante dado — o construtor de
 * Date normaliza dia 0 / mês 12 etc., então as bordas de mês/ano saem de graça.
 */
export function periodRange(period: Exclude<Period, 'custom'>, now: Date): { from: Date; to: Date } {
  const y = now.getFullYear()
  const m = now.getMonth()
  const d = now.getDate()
  switch (period) {
    case 'today':
      return { from: new Date(y, m, d), to: new Date(y, m, d + 1) }
    case 'yesterday':
      return { from: new Date(y, m, d - 1), to: new Date(y, m, d) }
    case 'month':
      return { from: new Date(y, m, 1), to: new Date(y, m + 1, 1) }
    case 'year':
      return { from: new Date(y, 0, 1), to: new Date(y + 1, 0, 1) }
  }
}
