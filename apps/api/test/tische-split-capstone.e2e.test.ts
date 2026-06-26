import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import type { AddressInfo } from 'node:net'
import { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { FakeTseProvider } from '@gelato/compliance'
import { AppModule } from '../src/app.module'

const tse = new FakeTseProvider({ serialNumber: 'SER-SPLIT' })

async function signedBestellung(sessionId: string, items: { product_id: string; qty: number; unit_net: number; mwst_rate: number; mwst_code: string }[]) {
  const r = await tse.sign({ clientId: 'c1', processType: 'Bestellung-V1', amountsByVatRate: [], paymentType: 'Bar', grossTotal: 0 })
  return {
    client_event_id: crypto.randomUUID(), type: 'bestellung' as const, session_id: sessionId, kasse_id: 'demo-kasse', items,
    tse_transaction: { tx_number: r.txNumber, signature_counter: r.signatureCounter, signature_value: r.signatureValue, log_time: r.logTime, process_type: r.processType, serial_number: r.serialNumber, public_key: r.publicKey },
  }
}

/**
 * CAPSTONE 1a-2: conta (333) → split em 3 pagamentos parciais até quitar.
 * Afirma: Σ Kassenbelege da sessão = total, sessão `paid` só no fim, orders
 * append-only (UPDATE rejeitado), pagamento parcial idempotente.
 */
describe('Tische split capstone (conta -> 3 parciais -> quitada)', () => {
  let app: INestApplication
  let baseUrl: string
  let token: string
  let prisma: PrismaClient
  let TISCH = ''

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = mod.createNestApplication()
    await app.listen(0)
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`
    prisma = new PrismaClient()
    token = ((await (await fetch(`${baseUrl}/auth/pin`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kasse_id: 'demo-kasse', pin: '1234' }) })).json()) as { access_token: string }).access_token
    TISCH = `tisch-split-${crypto.randomUUID().slice(0, 8)}`
    await prisma.tisch.create({ data: { id: TISCH, betriebsstaetteId: 'demo-bs', name: 'split capstone' } })
  }, 30000)

  afterAll(async () => {
    await prisma?.$disconnect()
    await app?.close()
  })

  const post = (path: string, body: unknown) =>
    fetch(`${baseUrl}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body) })
  const get = (path: string) => fetch(`${baseUrl}${path}`, { headers: { authorization: `Bearer ${token}` } })

  async function payAmount(sessionId: string, amount: number, eventId = crypto.randomUUID()) {
    const r = await tse.sign({ clientId: 'c1', processType: 'Kassenbeleg-V1', amountsByVatRate: [], paymentType: 'Bar', grossTotal: amount })
    return post(`/pos/sessions/${sessionId}/pay`, {
      client_event_id: eventId, amount, payment: { method: 'cash', amount },
      tse: { tx_number: r.txNumber, signature_counter: r.signatureCounter, signature_value: r.signatureValue, log_time: r.logTime, process_type: r.processType, serial_number: r.serialNumber, public_key: r.publicKey },
    })
  }

  it('splits a 333 tab into 3 reconciling payments, append-only and idempotent', async () => {
    const sessionId = ((await (await post(`/pos/tables/${TISCH}/open`, { kasse_id: 'demo-kasse' })).json()) as { id: string }).id
    await post(`/pos/sessions/${sessionId}/bestellung`, await signedBestellung(sessionId, [
      { product_id: 'p1', qty: 1, unit_net: 100, mwst_rate: 0.19, mwst_code: 'standard_19' },
      { product_id: 'p2', qty: 1, unit_net: 200, mwst_rate: 0.07, mwst_code: 'reduced_7' },
    ]))

    // 3 parciais
    for (let i = 0; i < 3; i++) {
      const remaining = ((await (await get(`/pos/sessions/${sessionId}`)).json()) as { remaining: { totalGross: number } }).remaining.totalGross
      const amount = i < 2 ? Math.ceil(remaining / (3 - i)) : remaining
      const eventId = crypto.randomUUID()
      const res = await payAmount(sessionId, amount, eventId)
      expect(res.status).toBe(200)
      const body = (await res.json()) as { settled: boolean }
      expect(body.settled).toBe(i === 2)
      // idempotência do parcial: reenviar o mesmo client_event_id não duplica
      const dup = await payAmount(sessionId, amount, eventId)
      expect(((await dup.json()) as { duplicate: boolean }).duplicate).toBe(true)
    }

    const orders = await prisma.order.findMany({ where: { tischSessionId: sessionId } })
    expect(orders).toHaveLength(3)
    expect(orders.reduce((s, o) => s + o.totalGross, 0)).toBe(333)
    // order é append-only (UPDATE rejeitado mesmo p/ o owner)
    await expect(prisma.$executeRawUnsafe(`UPDATE orders SET "totalGross"=0 WHERE id='${orders[0].id}'`)).rejects.toThrow()
    const sess = await prisma.tischsession.findUnique({ where: { id: sessionId } })
    expect(sess?.status).toBe('paid')
  })
})
