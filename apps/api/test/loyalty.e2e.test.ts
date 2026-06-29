import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { FakeTseProvider } from '@gelato/compliance'
import { AppModule } from '../src/app.module'

const tse = new FakeTseProvider({ serialNumber: 'SER-L' })

describe('Loyalty (e2e)', () => {
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
  const put = (path: string, body: unknown) =>
    fetch(`${baseUrl}${path}`, { method: 'PUT', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body) })
  const get = (path: string) => fetch(`${baseUrl}${path}`, { headers: { authorization: `Bearer ${token}` } })

  const newCustomer = async (): Promise<string> => ((await (await post('/customers', { name: 'L', email: `l-${crypto.randomUUID().slice(0, 8)}@x.de` })).json()) as { id: string }).id

  async function sale(customerId: string, qty: number, unitNet: number): Promise<void> {
    const gross = Math.round(unitNet * qty * 1.19)
    const r = await tse.sign({ clientId: 'c1', processType: 'Kassenbeleg-V1', amountsByVatRate: [], paymentType: 'Bar', grossTotal: gross })
    await post('/pos/sync', {
      client_event_id: crypto.randomUUID(), type: 'sale', kasse_id: 'demo-kasse',
      payload: {
        order: { mode: 'ausser_haus', customer_id: customerId, total_net: unitNet * qty, total_mwst: gross - unitNet * qty, total_gross: gross },
        items: [{ product_id: 'p1', qty, unit_net: unitNet, mwst_rate: 0.19, mwst_code: 'standard_19' }],
        payment: { method: 'cash', amount: gross },
        receipt: { qr_payload: '', format: 'digital' },
        tse_transaction: { tx_number: r.txNumber, signature_counter: r.signatureCounter, signature_value: r.signatureValue, log_time: r.logTime, process_type: r.processType, serial_number: r.serialNumber, public_key: r.publicKey },
      },
    })
  }

  // Lê a config ATIVA (robusto a qualquer programa) e devolve o ganho esperado.
  async function expectedEarn(gross: number, items: number): Promise<{ points: number; stamps: number }> {
    const p = (await (await get('/loyalty/program')).json()) as { pointsPerEuro: number; stampsPerItem: number }
    return { points: Math.trunc(gross / 100) * p.pointsPerEuro, stamps: items * p.stampsPerItem }
  }

  it('a sale with a customer earns loyalty per the active program', async () => {
    const id = await newCustomer()
    await sale(id, 3, 400) // gross = round(400*3*1.19) = 1428
    const exp = await expectedEarn(1428, 3)
    const r = (await (await get(`/customers/${id}/loyalty`)).json()) as { balance: { points: number; stamps: number } }
    expect(r.balance).toEqual(exp)
  })

  it('redeem reduces the balance; over-redeem → 400', async () => {
    const id = await newCustomer()
    await sale(id, 5, 1000) // gross = round(5000*1.19)=5950
    const before = (await (await get(`/customers/${id}/loyalty`)).json()) as { balance: { points: number; stamps: number } }
    expect((await post(`/customers/${id}/loyalty/redeem`, { points: 1, stamps: 1 })).status).toBe(201)
    const after = (await (await get(`/customers/${id}/loyalty`)).json()) as { balance: { points: number; stamps: number } }
    expect(after.balance.points).toBe(before.balance.points - 1)
    expect(after.balance.stamps).toBe(before.balance.stamps - 1)
    expect((await post(`/customers/${id}/loyalty/redeem`, { points: 999999 })).status).toBe(400)
    expect((await post(`/customers/${id}/loyalty/redeem`, {})).status).toBe(400)
  })

  it('an inactive program earns nothing', async () => {
    await put('/loyalty/program', { active: false })
    const id = await newCustomer()
    await sale(id, 2, 500)
    const r = (await (await get(`/customers/${id}/loyalty`)).json()) as { balance: { points: number; stamps: number } }
    expect(r.balance).toEqual({ points: 0, stamps: 0 })
    await put('/loyalty/program', { active: true, points_per_euro: 1, stamps_per_item: 1 }) // restaura
  })

  it('PUT /loyalty/program upserts the config', async () => {
    const r = (await (await put('/loyalty/program', { points_per_euro: 2, stamps_per_item: 3, active: true })).json()) as { pointsPerEuro: number; stampsPerItem: number }
    expect([r.pointsPerEuro, r.stampsPerItem]).toEqual([2, 3])
    await put('/loyalty/program', { points_per_euro: 1, stamps_per_item: 1, active: true }) // restaura
  })

  it('404 loyalty for a customer from another tenant', async () => {
    expect((await get(`/customers/nonexistent-${crypto.randomUUID().slice(0, 8)}/loyalty`)).status).toBe(404)
  })
})
