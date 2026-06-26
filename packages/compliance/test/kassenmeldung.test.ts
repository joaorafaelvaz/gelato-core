import { describe, it, expect } from 'vitest'
import { buildKassenmeldung, type KassenmeldungInput } from '../src/dsfinvk/kassenmeldung'

const input: KassenmeldungInput = {
  betrieb: { name: 'Gelateria Demo', street: 'Hauptstr. 1', plz: '10115', city: 'Berlin', finanzamtNr: '1101' },
  kasse: { id: 'k1', name: 'Kasse 1', serialNr: 'SER1', swBrand: 'gelato-core', swVersion: '1.0' },
  tse: { provider: 'fiskaly', serial: 'SANDBOX', certificate: 'CERT-X', inUseSince: '2026-01-01' },
  acquisition: { kind: 'Kauf', date: '2025-12-01' },
}

describe('buildKassenmeldung', () => {
  it('assembles the §146a notification payload (no submission)', () => {
    const p = buildKassenmeldung(input)
    expect(p.meldung).toBe('Mitteilung nach §146a Abs. 4 AO')
    expect(p.betrieb.finanzamtNr).toBe('1101')
    expect(p.kasse.serialNr).toBe('SER1')
    expect(p.tse.serial).toBe('SANDBOX')
    expect(p.tse.certificate).toBe('CERT-X')
    expect(p.submitted).toBe(false) // nunca submetido aqui
  })
})
