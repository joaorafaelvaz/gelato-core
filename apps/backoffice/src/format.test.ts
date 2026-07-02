import { describe, expect, it } from 'vitest'
import { euro } from './format'

const norm = (s: string): string => s.replace(/ /g, ' ')

describe('euro', () => {
  it('formats cents as de-DE EUR', () => {
    expect(norm(euro(450))).toBe('4,50 €')
    expect(norm(euro(0))).toBe('0,00 €')
    expect(norm(euro(123456))).toBe('1.234,56 €')
  })
})
