import { describe, expect, it } from 'vitest'
import { todayRange } from './date-util'

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
