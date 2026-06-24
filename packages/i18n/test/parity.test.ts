import { describe, it, expect } from 'vitest'
import { de, en, pt, SUPPORTED_LOCALES } from '../src/resources'
import { flattenKeys, flattenEntries } from '../src/keys'

const locales = { de, en, pt } as const

describe('i18n key parity', () => {
  const reference = new Set(flattenKeys(de))

  it('declares the three Ciclo 0 locales', () => {
    expect(SUPPORTED_LOCALES).toEqual(['de', 'en', 'pt'])
  })

  it('every locale has exactly the same key set (no missing/extra keys)', () => {
    for (const [name, table] of Object.entries(locales)) {
      const keys = new Set(flattenKeys(table))
      const missing = [...reference].filter((k) => !keys.has(k))
      const extra = [...keys].filter((k) => !reference.has(k))
      expect({ name, missing, extra }).toEqual({ name, missing: [], extra: [] })
    }
  })

  it('has no empty string values', () => {
    for (const table of Object.values(locales)) {
      for (const [key, value] of flattenEntries(table)) {
        expect(value, `empty value at ${key}`).not.toBe('')
        expect(typeof value).toBe('string')
      }
    }
  })
})
