import { describe, it, expect } from 'vitest'
import { AusfallTracker } from '../src/tse/ausfall-tracker'

describe('AusfallTracker', () => {
  it('opens the period on the first ausfall and not again', () => {
    const t = new AusfallTracker()
    expect(t.record('ausfall', '2026-06-25T10:00:00Z', 'timeout')).toEqual(['started'])
    expect(t.current).toEqual({ startedAt: '2026-06-25T10:00:00Z', reason: 'timeout' })
    expect(t.record('ausfall', '2026-06-25T10:01:00Z', 'timeout')).toEqual([]) // já aberto
  })

  it('closes the period once when signing recovers', () => {
    const t = new AusfallTracker({ startedAt: '2026-06-25T10:00:00Z', reason: 'timeout' })
    expect(t.record('signed', '2026-06-25T10:05:00Z')).toEqual(['ended'])
    expect(t.current).toBeNull()
    expect(t.record('signed', '2026-06-25T10:06:00Z')).toEqual([]) // já fechado
  })

  it('emits nothing while signing normally with no open period', () => {
    const t = new AusfallTracker()
    expect(t.record('signed', '2026-06-25T10:00:00Z')).toEqual([])
    expect(t.current).toBeNull()
  })

  it('rehydrates from a persisted open state', () => {
    const t = new AusfallTracker({ startedAt: '2026-06-25T09:00:00Z', reason: 'boom' })
    expect(t.current?.startedAt).toBe('2026-06-25T09:00:00Z')
    expect(t.record('ausfall', '2026-06-25T09:01:00Z', 'boom')).toEqual([])
  })
})
