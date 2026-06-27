import { describe, it, expect } from 'vitest'
import { tableState, clampPosition } from '../src/tischplan-util'

describe('tischplan-util', () => {
  it('tableState reflects an open session', () => {
    expect(tableState({ openSessionId: null })).toBe('free')
    expect(tableState({ openSessionId: 's1' })).toBe('occupied')
  })

  it('clampPosition keeps the table inside the canvas', () => {
    const b = { w: 480, h: 360, tw: 110, th: 60 }
    expect(clampPosition(-20, -20, b)).toEqual({ x: 0, y: 0 })
    expect(clampPosition(1000, 1000, b)).toEqual({ x: 370, y: 300 }) // 480-110, 360-60
    expect(clampPosition(100, 100, b)).toEqual({ x: 100, y: 100 })
  })
})
