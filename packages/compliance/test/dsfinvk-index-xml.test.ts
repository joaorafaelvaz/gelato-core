import { describe, it, expect } from 'vitest'
import { buildIndexXml } from '../src/dsfinvk/index-xml'
import { DSFINVK_TABLES } from '../src/dsfinvk/tables'

describe('dsfinvk/index-xml', () => {
  it('lists every table with its file URL and all column names', () => {
    const xml = buildIndexXml(DSFINVK_TABLES)
    expect(xml).toContain('<?xml')
    for (const t of DSFINVK_TABLES) {
      expect(xml).toContain(`<URL>${t.file}</URL>`)
      for (const c of t.columns) expect(xml).toContain(`<Name>${c.name}</Name>`)
    }
  })
})
