/** Início do dia LOCAL do instante dado (p/ "Vendas hoje" do dashboard). */
export function todayRange(now: Date): { from: Date } {
  return { from: new Date(now.getFullYear(), now.getMonth(), now.getDate()) }
}

export type Period = 'today' | 'yesterday' | 'month' | 'year'

/**
 * Janela LOCAL [from, to) do período relativo ao instante dado — o construtor de
 * Date normaliza dia 0 / mês 12 etc., então as bordas de mês/ano saem de graça.
 */
export function periodRange(period: Period, now: Date): { from: Date; to: Date } {
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
