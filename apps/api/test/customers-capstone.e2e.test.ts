import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import type { AddressInfo } from 'node:net'
import { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AppModule } from '../src/app.module'

// Capstone 4a: ciclo de vida DSGVO — cliente → publica termo → consente
// email_marketing (snapshot) → withdraw → anonimiza → PII some, consentimentos
// withdrawn, mas a trilha append-only sobrevive (auditoria).
describe('Customers capstone (e2e)', () => {
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
  const get = (path: string) => fetch(`${baseUrl}${path}`, { headers: { authorization: `Bearer ${token}` } })

  it('runs the full DSGVO consent lifecycle, preserving the audit trail', async () => {
    const purpose = `cap-${crypto.randomUUID().slice(0, 8)}`
    await post('/consent-versions', { purpose, text: 'Einwilligung E-Mail-Werbung v1' })
    const id = ((await (await post('/customers', { name: 'Max Mustermann', email: 'max@x.de' })).json()) as { id: string }).id

    await post(`/customers/${id}/consent`, { purpose, action: 'granted' })
    let c = (await (await get(`/customers/${id}`)).json()) as { consents: Record<string, string> }
    expect(c.consents[purpose]).toBe('granted')

    // o registro fotografou a versão do termo
    const granted = await prisma.consentRecord.findFirst({ where: { customerId: id, purpose, action: 'granted' } })
    expect(granted?.version).toBe(1)
    expect(granted?.textSnapshot).toContain('v1')

    await post(`/customers/${id}/consent`, { purpose, action: 'withdrawn' })
    await post(`/customers/${id}/anonymize`, {})

    c = (await (await get(`/customers/${id}`)).json()) as { name: string | null; email: string | null; anonymizedAt: string | null; consents: Record<string, string> }
    expect(c.name).toBeNull()
    expect(c.email).toBeNull()
    expect(c.anonymizedAt).not.toBeNull()
    expect(c.consents[purpose]).toBe('withdrawn')

    // a trilha de auditoria sobrevive ao esquecimento
    const records = await prisma.consentRecord.findMany({ where: { customerId: id }, orderBy: { at: 'asc' } })
    expect(records.length).toBeGreaterThanOrEqual(2)
    expect(records[0].action).toBe('granted')
  })
})
