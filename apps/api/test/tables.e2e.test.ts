import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import type { AddressInfo } from 'node:net'
import { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { FakeTseProvider } from '@gelato/compliance'
import { AppModule } from '../src/app.module'

const tse = new FakeTseProvider({ serialNumber: 'SER-T' })

/** Monta um BestellungEvent assinado (Bestellung-V1) — o terminal faria isso. */
async function signedBestellung(sessionId: string, items: { product_id: string; qty: number; unit_net: number; mwst_rate: number; mwst_code: string; storno_of?: string }[]) {
  const gross = items.reduce((s, i) => s + Math.round(i.unit_net * i.qty * (1 + i.mwst_rate)), 0)
  const r = await tse.sign({ clientId: 'c1', processType: 'Bestellung-V1', amountsByVatRate: [], paymentType: 'Bar', grossTotal: gross })
  return {
    client_event_id: crypto.randomUUID(),
    type: 'bestellung' as const,
    session_id: sessionId,
    kasse_id: 'demo-kasse',
    items,
    tse_transaction: {
      tx_number: r.txNumber, signature_counter: r.signatureCounter, signature_value: r.signatureValue,
      log_time: r.logTime, process_type: r.processType, serial_number: r.serialNumber, public_key: r.publicKey,
    },
  }
}

describe('Tables / conta aberta (e2e)', () => {
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
    TISCH = `tisch-${crypto.randomUUID().slice(0, 8)}`
    await prisma.tisch.create({ data: { id: TISCH, betriebsstaetteId: 'demo-bs', name: 'e2e' } })
  }, 30000)

  afterAll(async () => {
    await prisma?.$disconnect()
    await app?.close()
  })

  const post = (path: string, body: unknown) =>
    fetch(`${baseUrl}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body) })
  const get = (path: string) => fetch(`${baseUrl}${path}`, { headers: { authorization: `Bearer ${token}` } })

  it('opens a table once (409 on the second open)', async () => {
    const r1 = await post(`/pos/tables/${TISCH}/open`, { kasse_id: 'demo-kasse' })
    expect(r1.status).toBe(200)
    const r2 = await post(`/pos/tables/${TISCH}/open`, { kasse_id: 'demo-kasse' })
    expect(r2.status).toBe(409)
  })

  it('appends bestellungen and derives the tab', async () => {
    const open = await post(`/pos/tables/${TISCH}/open`, { kasse_id: 'demo-kasse' })
    // a mesa já está aberta do teste anterior → 409 traz o sessionId existente
    const body = (await open.json()) as { id?: string; sessionId?: string }
    const sessionId = body.id ?? body.sessionId!

    await post(`/pos/sessions/${sessionId}/bestellung`, await signedBestellung(sessionId, [
      { product_id: 'p1', qty: 2, unit_net: 100, mwst_rate: 0.19, mwst_code: 'standard_19' },
    ]))
    await post(`/pos/sessions/${sessionId}/bestellung`, await signedBestellung(sessionId, [
      { product_id: 'p2', qty: 1, unit_net: 200, mwst_rate: 0.07, mwst_code: 'reduced_7' },
      { product_id: 'p1', qty: -1, unit_net: 100, mwst_rate: 0.19, mwst_code: 'standard_19', storno_of: 'x' },
    ]))

    const s = await (await get(`/pos/sessions/${sessionId}`)).json() as { tab: { totalGross: number; byVatRate: { rate: number; gross: number }[] } }
    // p1: 2-1=1 net100 → 19% gross 119 ; p2: net200 → 7% gross 214 ; total 333
    expect(s.tab.totalGross).toBe(333)
    expect(s.tab.byVatRate.find((g) => g.rate === 0.19)!.gross).toBe(119)
  })

  it('lists tables with the open session', async () => {
    const list = await (await get(`/pos/tables?kasse_id=demo-kasse`)).json() as { id: string; openSessionId: string | null }[]
    const row = list.find((t) => t.id === TISCH)!
    expect(row.openSessionId).toBeTruthy()
  })

  it('pays a session: writes a Kassenbeleg linked to the table and marks it paid (idempotent)', async () => {
    const tisch = `tisch-${crypto.randomUUID().slice(0, 8)}`
    await prisma.tisch.create({ data: { id: tisch, betriebsstaetteId: 'demo-bs', name: 'pay' } })
    const sessionId = ((await (await post(`/pos/tables/${tisch}/open`, { kasse_id: 'demo-kasse' })).json()) as { id: string }).id
    await post(`/pos/sessions/${sessionId}/bestellung`, await signedBestellung(sessionId, [
      { product_id: 'p1', qty: 3, unit_net: 100, mwst_rate: 0.19, mwst_code: 'standard_19' },
    ]))
    const tab = ((await (await get(`/pos/sessions/${sessionId}`)).json()) as { tab: { totalGross: number } }).tab
    expect(tab.totalGross).toBe(357) // 3 * 100 * 1.19

    const r = await tse.sign({ clientId: 'c1', processType: 'Kassenbeleg-V1', amountsByVatRate: [], paymentType: 'Bar', grossTotal: tab.totalGross })
    const clientEventId = crypto.randomUUID()
    const payBody = {
      client_event_id: clientEventId,
      payment: { method: 'cash', amount: tab.totalGross },
      tse: { tx_number: r.txNumber, signature_counter: r.signatureCounter, signature_value: r.signatureValue, log_time: r.logTime, process_type: r.processType, serial_number: r.serialNumber, public_key: r.publicKey },
    }
    const pay = await post(`/pos/sessions/${sessionId}/pay`, payBody)
    expect(pay.status).toBe(200)
    const orderId = ((await pay.json()) as { orderId: string }).orderId

    const order = await prisma.order.findUnique({ where: { clientEventId } })
    expect(order?.tableId).toBe(tisch)
    const after = (await (await get(`/pos/sessions/${sessionId}`)).json()) as { status: string; orderId: string }
    expect(after.status).toBe('paid')
    expect(after.orderId).toBe(orderId)

    // retry idempotente do mesmo pagamento → mesmo order, sem duplicar
    const pay2 = await post(`/pos/sessions/${sessionId}/pay`, payBody)
    expect(pay2.status).toBe(200)
    expect(((await pay2.json()) as { duplicate: boolean }).duplicate).toBe(true)
    expect(await prisma.order.count({ where: { clientEventId } })).toBe(1)
  })
})
