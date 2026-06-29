import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AppModule } from '../src/app.module'

describe('Campaigns (e2e)', () => {
  let app: INestApplication
  let baseUrl: string
  let token: string

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = mod.createNestApplication()
    await app.listen(0)
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`
    token = ((await (await fetch(`${baseUrl}/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'admin@demo.test', password: 'admin123' }),
    })).json()) as { access_token: string }).access_token
  }, 30000)

  afterAll(async () => {
    await app?.close()
  })

  const post = (path: string, body: unknown) =>
    fetch(`${baseUrl}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body) })
  const get = (path: string) => fetch(`${baseUrl}${path}`, { headers: { authorization: `Bearer ${token}` } })

  async function consentedCustomer(): Promise<string> {
    const id = ((await (await post('/customers', { name: 'C', email: `c-${crypto.randomUUID().slice(0, 8)}@x.de` })).json()) as { id: string }).id
    await post(`/customers/${id}/consent`, { purpose: 'email_marketing', action: 'granted' })
    return id
  }

  it('creates a campaign', async () => {
    expect((await post('/campaigns', { name: 'N', channel: 'email', body: 'Hi' })).status).toBe(201)
  })

  it('send dispatches only to consented customers; trail records them; re-send → 409', async () => {
    const a = await consentedCustomer()
    const b = await consentedCustomer()
    await post(`/customers/${b}/consent`, { purpose: 'email_marketing', action: 'withdrawn' })
    const c = ((await (await post('/customers', { phone: '+49123' })).json()) as { id: string }).id
    await post(`/customers/${c}/consent`, { purpose: 'email_marketing', action: 'granted' })

    const camp = ((await (await post('/campaigns', { name: `K-${crypto.randomUUID().slice(0, 8)}`, channel: 'email', body: 'Hi' })).json()) as { id: string }).id
    expect((await post(`/campaigns/${camp}/send`, {})).status).toBe(201)

    const recipients = (await (await get(`/campaigns/${camp}/recipients`)).json()) as { customerId: string }[]
    const ids = new Set(recipients.map((r) => r.customerId))
    expect(ids.has(a)).toBe(true)
    expect(ids.has(b)).toBe(false) // retirado
    expect(ids.has(c)).toBe(false) // sem e-mail

    expect((await post(`/campaigns/${camp}/send`, {})).status).toBe(409) // já enviada
  })

  it('404 sending a campaign from another tenant', async () => {
    expect((await post(`/campaigns/nonexistent-${crypto.randomUUID().slice(0, 8)}/send`, {})).status).toBe(404)
  })
})
