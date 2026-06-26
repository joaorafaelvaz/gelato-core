import { describe, it, expect } from 'vitest'
import { centsToDecimal, toCsv, type Column } from '../src/dsfinvk/csv'

describe('dsfinvk/csv', () => {
  it('formats cents as a decimal with a dot and two places', () => {
    expect(centsToDecimal(119)).toBe('1.19')
    expect(centsToDecimal(0)).toBe('0.00')
    expect(centsToDecimal(5)).toBe('0.05')
    expect(centsToDecimal(-7)).toBe('-0.07')
  })

  it('serializes rows with ; delimiter, header, and CRLF lines', () => {
    const cols: Column[] = [
      { name: 'A', type: 'string' },
      { name: 'B', type: 'number' },
    ]
    const csv = toCsv(cols, [{ A: 'x', B: '1.00' }])
    expect(csv).toBe('"A";"B"\r\n"x";1.00\r\n')
  })

  it('quotes strings and escapes embedded quotes', () => {
    const cols: Column[] = [{ name: 'A', type: 'string' }]
    expect(toCsv(cols, [{ A: 'a"b;c' }])).toBe('"A"\r\n"a""b;c"\r\n')
  })
})
