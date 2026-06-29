export interface LoyaltyProgramConfig {
  pointsPerEuro: number
  stampsPerItem: number
}

/** Ganho de uma venda: pontos por € inteiro + carimbos por item. Puro. */
export function earnFromSale(grossCents: number, itemCount: number, program: LoyaltyProgramConfig): { points: number; stamps: number } {
  const euros = Math.trunc(grossCents / 100)
  return { points: euros * program.pointsPerEuro, stamps: itemCount * program.stampsPerItem }
}

/** Saldo = Σ dos deltas de points e stamps. Puro. */
export function loyaltyBalance(entries: { points: number; stamps: number }[]): { points: number; stamps: number } {
  return entries.reduce((acc, e) => ({ points: acc.points + e.points, stamps: acc.stamps + e.stamps }), { points: 0, stamps: 0 })
}
