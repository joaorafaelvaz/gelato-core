import { describe, it, expect } from 'vitest'
import { isOverdue } from '../src/checklist/schedule'

const DAY = 86_400_000
const now = 20_000 * DAY + 50_000_000 // um instante qualquer dentro de um dia UTC

describe('isOverdue', () => {
  it('daily: overdue when never run or last run is an earlier UTC day', () => {
    expect(isOverdue('daily', null, now)).toBe(true)
    expect(isOverdue('daily', now - 1000, now)).toBe(false) // mesmo dia
    expect(isOverdue('daily', now - DAY, now)).toBe(true) // ontem
  })

  it('weekly: overdue across week buckets', () => {
    expect(isOverdue('weekly', null, now)).toBe(true)
    expect(isOverdue('weekly', now - DAY, now)).toBe(false) // mesma semana
    expect(isOverdue('weekly', now - 8 * DAY, now)).toBe(true) // semana anterior
  })

  it('per_shift / on_event / unknown: never overdue', () => {
    expect(isOverdue('per_shift', null, now)).toBe(false)
    expect(isOverdue('on_event', null, now)).toBe(false)
    expect(isOverdue('whatever', null, now)).toBe(false)
  })
})
