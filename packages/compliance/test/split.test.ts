import { describe, it, expect } from 'vitest'
import { aggregateTab } from '../src/tab/aggregate'
import { apportionSplit, paidByRate, type PaidLike } from '../src/tab/split'

// conta: p1 1×100 @19% (gross119) + p2 1×200 @7% (gross214) = 333
const fullTab = aggregateTab([
  { productId: 'p1', qty: 1, unitNet: 100, mwstRate: 0.19, mwstCode: 'standard_19' },
  { productId: 'p2', qty: 1, unitNet: 200, mwstRate: 0.07, mwstCode: 'reduced_7' },
])

describe('apportionSplit', () => {
  it('a single full payment (no prior paid) settles the whole tab', () => {
    const r = apportionSplit(fullTab, [], fullTab.totalGross)
    expect(r.settles).toBe(true)
    expect(r.totalGross).toBe(333)
    expect(r.totalNet).toBe(300)
  })

  it('three partial payments reconcile exactly to the tab (Σ = full)', () => {
    const paid: { rate: number; net: number }[] = []
    let remaining = fullTab.totalGross
    const grosses: number[] = []
    for (let i = 0; i < 3; i++) {
      const r = apportionSplit(fullTab, paid as PaidLike[], Math.ceil(remaining / (3 - i)))
      grosses.push(r.totalGross)
      remaining -= r.totalGross
      for (const l of r.lines) {
        const g = paid.find((p) => p.rate === l.mwstRate)
        if (g) g.net += l.unitNet
        else paid.push({ rate: l.mwstRate, net: l.unitNet })
      }
    }
    expect(grosses.reduce((s, g) => s + g, 0)).toBe(333) // Σ pagamentos = total
    expect(remaining).toBe(0)
    expect(paid.find((p) => p.rate === 0.19)!.net).toBe(100)
    expect(paid.find((p) => p.rate === 0.07)!.net).toBe(200)
  })

  it('caps a partial at the remaining and never produces a negative line', () => {
    const r = apportionSplit(fullTab, [], 50)
    expect(r.totalGross).toBeLessThanOrEqual(52) // ~50, sem estourar
    expect(r.lines.every((l) => l.unitNet >= 0)).toBe(true)
  })

  it('paidByRate aggregates order items into {rate,net,mwst,gross}', () => {
    const groups = paidByRate([
      { items: [{ unitNet: 100, qty: 1, mwstRate: 0.19 }, { unitNet: 200, qty: 1, mwstRate: 0.07 }] },
    ])
    expect(groups.find((g) => g.rate === 0.19)).toMatchObject({ net: 100, mwst: 19, gross: 119 })
    expect(groups.find((g) => g.rate === 0.07)).toMatchObject({ net: 200, mwst: 14, gross: 214 })
  })
})
