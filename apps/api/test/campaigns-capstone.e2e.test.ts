import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AppModule } from '../src/app.module'

// Capstone 4d: A consente email_marketing, B retira, C anonimiza → campanha email
// → só A na trilha → status sent → re-enviar 409. (GDPR: nunca contata sem consentimento.)
describe('Campaigns capstone (e2e)', () => {
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

  const mk = async (): Promise<string> => ((await (await post('/customers', { name: 'X', email: `cap-${crypto.randomUUID().slice(0, 8)}@x.de` })).json()) as { id: string }).id

  it('only consented customers are contacted', async () => {
    const a = await mk()
    await post(`/customers/${a}/consent`, { purpose: 'email_marketing', action: 'granted' })
    const b = await mk()
    await post(`/customers/${b}/consent`, { purpose: 'email_marketing', action: 'granted' })
    await post(`/customers/${b}/consent`, { purpose: 'email_marketing', action: 'withdrawn' })
    const c = await mk()
    await post(`/customers/${c}/consent`, { purpose: 'email_marketing', action: 'granted' })
    await post(`/customers/${c}/anonymize`, {})

    const camp = ((await (await post('/campaigns', { name: `Cap-${crypto.randomUUID().slice(0, 8)}`, channel: 'email', subject: 'S', body: 'B' })).json()) as { id: string }).id
    const res = (await (await post(`/campaigns/${camp}/send`, {})).json()) as { recipientCount: number }
    expect(res.recipientCount).toBeGreaterThanOrEqual(1)

    const ids = new Set(((await (await get(`/campaigns/${camp}/recipients`)).json()) as { customerId: string }[]).map((r) => r.customerId))
    expect(ids.has(a)).toBe(true)
    expect(ids.has(b)).toBe(false)
    expect(ids.has(c)).toBe(false)

    const camps = (await (await get('/campaigns')).json()) as { id: string; status: string }[]
    expect(camps.find((x) => x.id === camp)!.status).toBe('sent')
    expect((await post(`/campaigns/${camp}/send`, {})).status).toBe(409)
  })
})
