import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import type { AddressInfo } from 'node:net'
import { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AppModule } from '../src/app.module'

describe('Customers / consent (e2e)', () => {
  let app: INestApplication
  let baseUrl: string
  let token: string
  let prisma: PrismaClient

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = mod.createNestApplication()
    await app.listen(0)
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`
    prisma = new PrismaClient()
    token = ((await (await fetch(`${baseUrl}/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'admin@demo.test', password: 'admin123' }),
    })).json()) as { access_token: string }).access_token
  }, 30000)

  afterAll(async () => {
    await prisma?.$disconnect()
    await app?.close()
  })

  const post = (path: string, body: unknown) =>
    fetch(`${baseUrl}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body) })
  const patch = (path: string, body: unknown) =>
    fetch(`${baseUrl}${path}`, { method: 'PATCH', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body) })
  const get = (path: string) => fetch(`${baseUrl}${path}`, { headers: { authorization: `Bearer ${token}` } })

  const newCustomer = async (email = `c-${crypto.randomUUID().slice(0, 8)}@x.de`): Promise<string> =>
    ((await (await post('/customers', { name: 'Anna', email })).json()) as { id: string }).id

  it('creates a customer (needs at least one contact)', async () => {
    expect((await post('/customers', { name: 'Anna', email: 'a@x.de' })).status).toBe(201)
    expect((await post('/customers', {})).status).toBe(400)
  })

  it('records granted/withdrawn consent and derives the current state', async () => {
    const purpose = `p-${crypto.randomUUID().slice(0, 8)}`
    await post('/consent-versions', { purpose, text: 'Term v1' })
    const id = await newCustomer()
    expect((await post(`/customers/${id}/consent`, { purpose, action: 'granted' })).status).toBe(201)
    let c = (await (await get(`/customers/${id}`)).json()) as { consents: Record<string, string> }
    expect(c.consents[purpose]).toBe('granted')
    await post(`/customers/${id}/consent`, { purpose, action: 'withdrawn' })
    c = (await (await get(`/customers/${id}`)).json()) as { consents: Record<string, string> }
    expect(c.consents[purpose]).toBe('withdrawn')
  })

  it('granting without a published term → 400', async () => {
    const id = await newCustomer()
    expect((await post(`/customers/${id}/consent`, { purpose: `none-${crypto.randomUUID().slice(0, 8)}`, action: 'granted' })).status).toBe(400)
  })

  it('anonymize wipes PII, withdraws consents, keeps the trail; idempotent', async () => {
    const purpose = `p-${crypto.randomUUID().slice(0, 8)}`
    await post('/consent-versions', { purpose, text: 'Term' })
    const id = await newCustomer()
    await post(`/customers/${id}/consent`, { purpose, action: 'granted' })
    expect((await post(`/customers/${id}/anonymize`, {})).status).toBe(201)
    const c = (await (await get(`/customers/${id}`)).json()) as { name: string | null; email: string | null; anonymizedAt: string | null; consents: Record<string, string> }
    expect(c.name).toBeNull()
    expect(c.email).toBeNull()
    expect(c.anonymizedAt).not.toBeNull()
    expect(c.consents[purpose]).toBe('withdrawn')
    const records = await prisma.consentRecord.count({ where: { customerId: id } })
    expect(records).toBeGreaterThanOrEqual(2) // granted + withdrawn(anonymize)
    expect((await post(`/customers/${id}/anonymize`, {})).status).toBe(201) // idempotente
  })

  it('404 for a customer from another tenant; 409 patch on anonymized', async () => {
    const other = await prisma.customer.create({ data: { tenantId: 'tenant-other', email: 'x@x.de' } })
    expect((await get(`/customers/${other.id}`)).status).toBe(404)
    const id = await newCustomer()
    await post(`/customers/${id}/anonymize`, {})
    expect((await patch(`/customers/${id}`, { name: 'X' })).status).toBe(409)
  })

  it('publishing a new version deactivates the previous', async () => {
    const purpose = `p-${crypto.randomUUID().slice(0, 8)}`
    await post('/consent-versions', { purpose, text: 'v1' })
    await post('/consent-versions', { purpose, text: 'v2' })
    const versions = (await (await get('/consent-versions')).json()) as { purpose: string; version: number; active: boolean }[]
    const mine = versions.filter((v) => v.purpose === purpose)
    expect(mine.find((v) => v.version === 2)!.active).toBe(true)
    expect(mine.find((v) => v.version === 1)!.active).toBe(false)
  })
})
