import { describe, expect, it } from 'vitest'
import { periodRange, todayRange, type Period } from './date-util'

describe('todayRange', () => {
  it('returns local midnight of the given instant', () => {
    const { from } = todayRange(new Date(2026, 6, 2, 15, 42, 7))
    expect([from.getFullYear(), from.getMonth(), from.getDate()]).toEqual([2026, 6, 2])
    expect([from.getHours(), from.getMinutes(), from.getSeconds(), from.getMilliseconds()]).toEqual([0, 0, 0, 0])
  })

  it('is idempotent at midnight', () => {
    const d = new Date(2026, 0, 1, 0, 0, 0, 0)
    expect(todayRange(d).from.getTime()).toBe(d.getTime())
  })
})

describe('periodRange', () => {
  const now = new Date(2026, 6, 3, 15, 42, 7) // 3 jul 2026, 15:42 local

  const ymd = (d: Date): [number, number, number] => [d.getFullYear(), d.getMonth(), d.getDate()]

  it('today: [hoje 00:00, amanhã 00:00)', () => {
    const { from, to } = periodRange('today', now)
    expect(ymd(from)).toEqual([2026, 6, 3])
    expect(ymd(to)).toEqual([2026, 6, 4])
    expect(from.getHours()).toBe(0)
  })

  it('yesterday: [ontem 00:00, hoje 00:00)', () => {
    const { from, to } = periodRange('yesterday', now)
    expect(ymd(from)).toEqual([2026, 6, 2])
    expect(ymd(to)).toEqual([2026, 6, 3])
  })

  it('yesterday atravessa mês/ano (1 jan → 31 dez do ano anterior)', () => {
    const { from, to } = periodRange('yesterday', new Date(2026, 0, 1, 9, 0))
    expect(ymd(from)).toEqual([2025, 11, 31])
    expect(ymd(to)).toEqual([2026, 0, 1])
  })

  it('month: [dia 1 do mês, dia 1 do mês seguinte)', () => {
    const { from, to } = periodRange('month', now)
    expect(ymd(from)).toEqual([2026, 6, 1])
    expect(ymd(to)).toEqual([2026, 7, 1])
  })

  it('month vira o ano em dezembro', () => {
    const { to } = periodRange('month', new Date(2026, 11, 15))
    expect(ymd(to)).toEqual([2027, 0, 1])
  })

  it('year: [1 jan, 1 jan do ano seguinte)', () => {
    const { from, to } = periodRange('year', now)
    expect(ymd(from)).toEqual([2026, 0, 1])
    expect(ymd(to)).toEqual([2027, 0, 1])
  })

  it('cobre todos os períodos sem sobreposição com o agora', () => {
    const periods: Period[] = ['today', 'yesterday', 'month', 'year']
    for (const p of periods) {
      const { from, to } = periodRange(p, now)
      expect(from.getTime()).toBeLessThan(to.getTime())
    }
  })
})
