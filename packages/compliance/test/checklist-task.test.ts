import { describe, it, expect } from 'vitest'
import { isValidTaskDefinition, formatDecidegrees } from '../src/checklist/task'

describe('isValidTaskDefinition', () => {
  it('temperature requires a coherent range', () => {
    expect(isValidTaskDefinition('temperature', -2200, -1800)).toBe(true)
    expect(isValidTaskDefinition('temperature', 200, 200)).toBe(true) // min == max ok
    expect(isValidTaskDefinition('temperature', null, -1800)).toBe(false) // faixa incompleta
    expect(isValidTaskDefinition('temperature', 700, 200)).toBe(false) // min > max
  })
  it('boolean/text must not carry a range', () => {
    expect(isValidTaskDefinition('boolean', null, null)).toBe(true)
    expect(isValidTaskDefinition('text', null, null)).toBe(true)
    expect(isValidTaskDefinition('boolean', 0, 10)).toBe(false)
    expect(isValidTaskDefinition('text', null, 5)).toBe(false)
  })
})

describe('formatDecidegrees', () => {
  it('formats decidegrees as German Celsius', () => {
    expect(formatDecidegrees(-180)).toBe('-18,0 °C')
    expect(formatDecidegrees(0)).toBe('0,0 °C')
    expect(formatDecidegrees(205)).toBe('20,5 °C')
  })
})
