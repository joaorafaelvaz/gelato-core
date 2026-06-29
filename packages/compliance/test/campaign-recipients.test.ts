import { describe, it, expect } from 'vitest'
import { consentPurposeForChannel, eligibleRecipients } from '../src/campaign/recipients'
import { FakeCampaignSender } from '../src/campaign/sender'

describe('consentPurposeForChannel', () => {
  it('maps channels to purposes', () => {
    expect(consentPurposeForChannel('email')).toBe('email_marketing')
    expect(consentPurposeForChannel('sms')).toBe('sms_marketing')
    expect(consentPurposeForChannel('carrier-pigeon')).toBe('')
  })
})

describe('eligibleRecipients', () => {
  const granted = [{ purpose: 'email_marketing', action: 'granted' as const, at: 100 }]
  const withdrawn = [...granted, { purpose: 'email_marketing', action: 'withdrawn' as const, at: 200 }]

  it('includes consented + contactable; excludes withdrawn/anonymized/no-contact', () => {
    const out = eligibleRecipients(
      [
        { id: 'a', anonymized: false, contact: 'a@x.de', records: granted },
        { id: 'b', anonymized: false, contact: 'b@x.de', records: withdrawn },
        { id: 'c', anonymized: true, contact: 'c@x.de', records: granted },
        { id: 'd', anonymized: false, contact: null, records: granted },
      ],
      'email_marketing',
    )
    expect(out).toEqual(['a'])
  })
  it('empty purpose → []', () => {
    expect(eligibleRecipients([{ id: 'a', anonymized: false, contact: 'a@x.de', records: granted }], '')).toEqual([])
  })
})

describe('FakeCampaignSender', () => {
  it('counts recipients (does not actually send)', async () => {
    const out = await new FakeCampaignSender().send({ channel: 'email', recipients: [{ id: 'a', contact: 'a@x.de' }, { id: 'b', contact: 'b@x.de' }], body: 'Hi' })
    expect(out).toEqual({ sent: 2 })
  })
})
