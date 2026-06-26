import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import type { AddressInfo } from 'node:net'
import { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { FakeTseProvider } from '@gelato/compliance'
import { AppModule } from '../src/app.module'

const tse = new FakeTseProvider({ serialNumber: 'SER-CAP' })

async function signedBestellung(sessionId: string, items: { product_id: string; qty: number; unit_net: number; mwst_rate: number; mwst_code: string; storno_of?: string }[]) {
  const r = await tse.sign({ clientId: 'c1', processType: 'Bestellung-V1', amountsByVatRate: [], paymentType: 'Bar', grossTotal: 0 })
  return {
    client_event_id: crypto.randomUUID(), type: 'bestellung' as const, session_id: sessionId, kasse_id: 'demo-kasse', items,
    tse_transaction: { tx_number: r.txNumber, signature_counter: r.signatureCounter, signature_value: r.signatureValue, log_time: r.logTime, process_type: r.processType, serial_number: r.serialNumber, public_key: r.publicKey },
  }
}

/**
 * CAPSTONE 1a-1: mesa → 2 Bestellungen (a 2ª com Storno de item) → pagar.
 * Afirma: conta derivada = Σ − Storno, Kassenbeleg ligado à mesa, sessão paid,
 * Bestellungen append-only (UPDATE rejeitado mesmo p/ o owner), pagamento idempotente.
 */
describe('Tische capstone (conta aberta -> Bestellungen(+Storno) -> Kassenbeleg)', () => {
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
    TISCH = `tisch-cap-${crypto.randomUUID().slice(0, 8)}`
    await prisma.tisch.create({ data: { id: TISCH, betriebsstaetteId: 'demo-bs', name: 'capstone' } })
  }, 30000)

  afterAll(async () => {
    await prisma?.$disconnect()
    await app?.close()
  })

  const post = (path: string, body: unknown) =>
    fetch(`${baseUrl}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body) })
  const get = (path: string) => fetch(`${baseUrl}${path}`, { headers: { authorization: `Bearer ${token}` } })

  it('runs the full Tisch lifecycle coherently and idempotently', async () => {
    const sessionId = ((await (await post(`/pos/tables/${TISCH}/open`, { kasse_id: 'demo-kasse' })).json()) as { id: string }).id

    await post(`/pos/sessions/${sessionId}/bestellung`, await signedBestellung(sessionId, [
      { product_id: 'p1', qty: 2, unit_net: 100, mwst_rate: 0.19, mwst_code: 'standard_19' },
      { product_id: 'p2', qty: 1, unit_net: 200, mwst_rate: 0.07, mwst_code: 'reduced_7' },
    ]))
    await post(`/pos/sessions/${sessionId}/bestellung`, await signedBestellung(sessionId, [
      { product_id: 'p1', qty: -1, unit_net: 100, mwst_rate: 0.19, mwst_code: 'standard_19', storno_of: 'b1' },
    ]))

    // conta = p1(1×100→119) + p2(1×200→214) = 333
    const tab = ((await (await get(`/pos/sessions/${sessionId}`)).json()) as { tab: { totalGross: number } }).tab
    expect(tab.totalGross).toBe(333)

    // 2 Bestellungen append-only (UPDATE rejeitado mesmo p/ o owner via trigger)
    const bs = await prisma.bestellung.findMany({ where: { sessionId } })
    expect(bs).toHaveLength(2)
    await expect(prisma.$executeRawUnsafe(`UPDATE bestellungen SET "totalGross"=0 WHERE id='${bs[0].id}'`)).rejects.toThrow()

    // pagar (Kassenbeleg-V1)
    const r = await tse.sign({ clientId: 'c1', processType: 'Kassenbeleg-V1', amountsByVatRate: [], paymentType: 'Bar', grossTotal: tab.totalGross })
    const clientEventId = crypto.randomUUID()
    const payBody = { client_event_id: clientEventId, payment: { method: 'cash', amount: tab.totalGross }, tse: { tx_number: r.txNumber, signature_counter: r.signatureCounter, signature_value: r.signatureValue, log_time: r.logTime, process_type: r.processType, serial_number: r.serialNumber, public_key: r.publicKey } }
    expect((await post(`/pos/sessions/${sessionId}/pay`, payBody)).status).toBe(200)

    const order = await prisma.order.findUnique({ where: { clientEventId }, include: { items: true } })
    expect(order?.tableId).toBe(TISCH)
    expect(order?.totalGross).toBe(333)
    const sess = await prisma.tischsession.findUnique({ where: { id: sessionId } })
    expect(sess?.status).toBe('paid')
    expect(sess?.orderId).toBe(order!.id)

    // idempotência: reenviar o pagamento não duplica
    expect((await post(`/pos/sessions/${sessionId}/pay`, payBody)).status).toBe(200)
    expect(await prisma.order.count({ where: { clientEventId } })).toBe(1)
  })
})
