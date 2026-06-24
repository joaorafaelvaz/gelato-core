import { describe, it, expect } from 'vitest'
import { pickRate } from '../src/mwst/rates'
import type { TaxRate } from '../src/mwst/types'

// Demonstra alíquotas versionadas: reduced_7 mudou de 7% para 5% em 2021-01-01.
// (É exatamente o cenário "a regra do gelato mudou" — por isso rates vêm do banco.)
const rates: TaxRate[] = [
  { code: 'standard_19', rate: 0.19, validFrom: new Date('2020-01-01') },
  { code: 'reduced_7', rate: 0.07, validFrom: new Date('2020-01-01'), validTo: new Date('2021-01-01') },
  { code: 'reduced_7', rate: 0.05, validFrom: new Date('2021-01-01') },
]

describe('pickRate', () => {
  it('picks the rate valid at the given date', () => {
    expect(pickRate(rates, 'reduced_7', new Date('2020-06-01')).rate).toBe(0.07)
    expect(pickRate(rates, 'reduced_7', new Date('2026-06-01')).rate).toBe(0.05)
    expect(pickRate(rates, 'standard_19', new Date('2026-06-01')).rate).toBe(0.19)
  })

  it('treats validTo as exclusive', () => {
    // exatamente em 2021-01-01 já vale a nova (0.05), não a antiga (0.07)
    expect(pickRate(rates, 'reduced_7', new Date('2021-01-01')).rate).toBe(0.05)
  })

  it('throws when no rate is valid at the date or code unknown', () => {
    expect(() => pickRate(rates, 'reduced_7', new Date('2019-01-01'))).toThrow()
    expect(() => pickRate(rates, 'unknown', new Date('2026-06-01'))).toThrow()
  })
})
