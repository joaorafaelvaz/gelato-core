import { describe, it, expect } from 'vitest'
import { classifyReading, evaluateResult } from '../src/checklist/result'

describe('classifyReading', () => {
  it('classifies value against the range (boundaries inclusive)', () => {
    expect(classifyReading(-2000, -2200, -1800)).toBe('in_range')
    expect(classifyReading(-2200, -2200, -1800)).toBe('in_range') // == min
    expect(classifyReading(-1800, -2200, -1800)).toBe('in_range') // == max
    expect(classifyReading(-2300, -2200, -1800)).toBe('too_low')
    expect(classifyReading(900, 200, 700)).toBe('too_high')
  })
})

describe('evaluateResult', () => {
  it('boolean: ok only when true', () => {
    expect(evaluateResult({ type: 'boolean', valueBool: true })).toEqual({ ok: true, reading: null })
    expect(evaluateResult({ type: 'boolean', valueBool: false })).toEqual({ ok: false, reading: null })
  })
  it('temperature: ok only in range, exposes reading', () => {
    expect(evaluateResult({ type: 'temperature', valueNum: 500, validMin: 200, validMax: 700 })).toEqual({ ok: true, reading: 'in_range' })
    expect(evaluateResult({ type: 'temperature', valueNum: 900, validMin: 200, validMax: 700 })).toEqual({ ok: false, reading: 'too_high' })
    expect(evaluateResult({ type: 'temperature', valueNum: null, validMin: 200, validMax: 700 })).toEqual({ ok: false, reading: null })
  })
  it('text: always ok', () => {
    expect(evaluateResult({ type: 'text', valueText: 'x' })).toEqual({ ok: true, reading: null })
  })
})
