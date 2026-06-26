import { describe, it, expect } from 'vitest'
import { DSFINVK_TABLES } from '../src/dsfinvk/tables'

describe('dsfinvk/tables', () => {
  it('registers the core subset of files', () => {
    const names = DSFINVK_TABLES.map((t) => t.name)
    expect(names).toEqual([
      'stamm_abschluss', 'stamm_kassen', 'stamm_ust', 'stamm_tse', 'stamm_orte',
      'bonkopf', 'bonkopf_ust', 'bonkopf_zahlarten', 'bonpos', 'bonpos_ust', 'tse',
      'z_ust', 'z_zahlart', 'cash_per_country',
    ])
  })

  it('every table has at least one column and a filename ending in .csv', () => {
    for (const t of DSFINVK_TABLES) {
      expect(t.columns.length).toBeGreaterThan(0)
      expect(t.file).toBe(`${t.name}.csv`)
    }
  })

  it('tse table carries the Ausfall failure marker column', () => {
    const tse = DSFINVK_TABLES.find((t) => t.name === 'tse')!
    expect(tse.columns.map((c) => c.name)).toContain('TSE_TA_FEHLER')
  })
})
