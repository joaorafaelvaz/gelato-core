import { describe, it, expect } from 'vitest'
import { hashSecret, verifySecret } from './hash'

describe('hash', () => {
  it('round-trips a secret and rejects the wrong one', async () => {
    const h = await hashSecret('s3cret-pw')
    expect(h).not.toBe('s3cret-pw')
    expect(await verifySecret(h, 's3cret-pw')).toBe(true)
    expect(await verifySecret(h, 'wrong')).toBe(false)
  })

  it('returns false (not throw) for a malformed hash', async () => {
    expect(await verifySecret('not-a-hash', 'x')).toBe(false)
  })
})
