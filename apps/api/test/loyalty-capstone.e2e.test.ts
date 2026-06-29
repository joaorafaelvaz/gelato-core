import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import type { AddressInfo } from 'node:net'
import { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { FakeTseProvider } from '@gelato/compliance'
import { AppModule } from '../src/app.module'

const tse = new FakeTseProvider({ serialNumber: 'SER-LC' })

// Capstone 4b: programa ativo → venda com cliente → earn (refType order) → saldo →
// resgate reduz → resgate > saldo → 400. Ganho calculado da config ATIVA (robusto).
describe('Loyalty capstone (e2e)', () => {
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

  it('earns on a sale, reflects the balance, and redeems', async () => {
    const id = ((await (await post('/customers', { name: 'Max', email: `cap-${crypto.randomUUID().slice(0, 8)}@x.de` })).json()) as { id: string }).id
    const prog = (await (await get('/loyalty/program')).json()) as { pointsPerEuro: number; stampsPerItem: number; active: boolean }

    const r = await tse.sign({ clientId: 'c1', processType: 'Kassenbeleg-V1', amountsByVatRate: [], paymentType: 'Bar', grossTotal: 1190 })
    await post('/pos/sync', {
      client_event_id: crypto.randomUUID(), type: 'sale', kasse_id: 'demo-kasse',
      payload: {
        order: { mode: 'ausser_haus', customer_id: id, total_net: 1000, total_mwst: 190, total_gross: 1190 },
        items: [{ product_id: 'p1', qty: 3, unit_net: 333, mwst_rate: 0.19, mwst_code: 'standard_19' }],
        payment: { method: 'cash', amount: 1190 },
        receipt: { qr_payload: '', format: 'digital' },
        tse_transaction: { tx_number: r.txNumber, signature_counter: r.signatureCounter, signature_value: r.signatureValue, log_time: r.logTime, process_type: r.processType, serial_number: r.serialNumber, public_key: r.publicKey },
      },
    })

    const expPoints = prog.active ? Math.trunc(1190 / 100) * prog.pointsPerEuro : 0
    const expStamps = prog.active ? 3 * prog.stampsPerItem : 0
    const lo = (await (await get(`/customers/${id}/loyalty`)).json()) as { balance: { points: number; stamps: number }; entries: { kind: string; refType: string | null }[] }
    expect(lo.balance).toEqual({ points: expPoints, stamps: expStamps })
    expect(lo.entries[0].refType).toBe('order')

    if (expPoints > 0) {
      expect((await post(`/customers/${id}/loyalty/redeem`, { points: 1 })).status).toBe(201)
      const after = (await (await get(`/customers/${id}/loyalty`)).json()) as { balance: { points: number } }
      expect(after.balance.points).toBe(expPoints - 1)
    }
    expect((await post(`/customers/${id}/loyalty/redeem`, { points: 999999 })).status).toBe(400)
  })
})
