import { describe, it, expect } from 'vitest'
import { currentConsents, canContact } from '../src/consent/state'

describe('currentConsents', () => {
  it('takes the latest action per purpose (by at)', () => {
    const recs = [
      { purpose: 'email_marketing', action: 'granted' as const, at: 100 },
      { purpose: 'email_marketing', action: 'withdrawn' as const, at: 200 },
      { purpose: 'email_marketing', action: 'granted' as const, at: 300 },
      { purpose: 'sms_marketing', action: 'granted' as const, at: 150 },
    ]
    expect(currentConsents(recs)).toEqual({ email_marketing: 'granted', sms_marketing: 'granted' })
  })
  it('empty → {}', () => {
    expect(currentConsents([])).toEqual({})
  })
})

describe('canContact', () => {
  const recs = [
    { purpose: 'email_marketing', action: 'granted' as const, at: 100 },
    { purpose: 'sms_marketing', action: 'granted' as const, at: 100 },
    { purpose: 'sms_marketing', action: 'withdrawn' as const, at: 200 },
  ]
  it('true only when latest is granted and not anonymized', () => {
    expect(canContact(recs, 'email_marketing', false)).toBe(true)
    expect(canContact(recs, 'sms_marketing', false)).toBe(false) // withdrawn
    expect(canContact(recs, 'email_marketing', true)).toBe(false) // anonymized
    expect(canContact(recs, 'unknown', false)).toBe(false) // sem registro
  })
})
