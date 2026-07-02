/** Início do dia LOCAL do instante dado (p/ "Vendas hoje" do dashboard). */
export function todayRange(now: Date): { from: Date } {
  return { from: new Date(now.getFullYear(), now.getMonth(), now.getDate()) }
}
