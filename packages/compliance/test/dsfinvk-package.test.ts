import { describe, it, expect } from 'vitest'
import { buildDsfinvkPackage } from '../src/dsfinvk/package'
import type { DsfinvkInput } from '../src/dsfinvk/records'

const input: DsfinvkInput = {
  kasse: { id: 'k1', name: 'Kasse 1' },
  location: { name: 'Filiale' },
  tse: { id: 'tse1' },
  taxRates: [{ code: 'reduced_7', rate: 0.07 }],
  zClosings: [],
}

describe('dsfinvk/package', () => {
  it('always includes index.xml and every table file', () => {
    const files = buildDsfinvkPackage(input)
    const names = files.map((f) => f.filename)
    expect(names).toContain('index.xml')
    expect(names).toContain('bonkopf.csv')
    expect(names).toContain('tse.csv')
    expect(names).toContain('z_ust.csv')
    expect(files).toHaveLength(15) // index.xml + 14 CSVs
  })

  it('each CSV has a header line', () => {
    const files = buildDsfinvkPackage(input)
    const bonkopf = files.find((f) => f.filename === 'bonkopf.csv')!
    expect(bonkopf.content.startsWith('"Z_KASSE_ID"')).toBe(true)
  })
})
