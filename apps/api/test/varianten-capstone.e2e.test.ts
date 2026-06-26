import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import type { AddressInfo } from 'node:net'
import { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { FakeTseProvider } from '@gelato/compliance'
import { AppModule } from '../src/app.module'

const tse = new FakeTseProvider({ serialNumber: 'SER-VAR' })

async function signedBestellung(sessionId: string, items: unknown[]) {
  const r = await tse.sign({ clientId: 'c1', processType: 'Bestellung-V1', amountsByVatRate: [], paymentType: 'Bar', grossTotal: 0 })
  return {
    client_event_id: crypto.randomUUID(), type: 'bestellung' as const, session_id: sessionId, kasse_id: 'demo-kasse', items,
    tse_transaction: { tx_number: r.txNumber, signature_counter: r.signatureCounter, signature_value: r.signatureValue, log_time: r.logTime, process_type: r.processType, serial_number: r.serialNumber, public_key: r.publicKey },
  }
}

/**
 * CAPSTONE 1a-3: Eisbecher L (var-l, 600) + extra Sahne (mod-sahne, 50) = 650.
 * Afirma: BestellungItem.unitNet=650 com variantId + modifiers JSON; conta reflete;
 * pagar → Kassenbeleg; bestellung_items append-only (UPDATE rejeitado).
 */
describe('Varianten capstone (Eisbecher L + extra Sahne = 650)', () => {
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
    TISCH = `tisch-var-${crypto.randomUUID().slice(0, 8)}`
    await prisma.tisch.create({ data: { id: TISCH, betriebsstaetteId: 'demo-bs', name: 'var capstone' } })
  }, 30000)

  afterAll(async () => {
    await prisma?.$disconnect()
    await app?.close()
  })

  const post = (path: string, body: unknown) =>
    fetch(`${baseUrl}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body) })
  const get = (path: string) => fetch(`${baseUrl}${path}`, { headers: { authorization: `Bearer ${token}` } })

  it('records the combined line (variant+modifier), reflects in the tab, pays, append-only', async () => {
    const sessionId = ((await (await post(`/pos/tables/${TISCH}/open`, { kasse_id: 'demo-kasse' })).json()) as { id: string }).id
    await post(`/pos/sessions/${sessionId}/bestellung`, await signedBestellung(sessionId, [
      { product_id: 'prod-eisbecher', variant_id: 'var-l', qty: 1, unit_net: 650, mwst_rate: 0.19, mwst_code: 'standard_19', modifiers: [{ id: 'mod-sahne', name: 'extra Sahne', net: 50 }] },
    ]))

    const item = await prisma.bestellungItem.findFirst({ where: { variantId: 'var-l', bestellung: { sessionId } } })
    expect(item?.unitNet).toBe(650)
    expect(Array.isArray(item?.modifiers)).toBe(true)
    expect((item?.modifiers as { id: string }[])[0].id).toBe('mod-sahne')

    // conta: 650 net @19% → bruto 774 (650 + round(650*0.19)=124)
    const tab = ((await (await get(`/pos/sessions/${sessionId}`)).json()) as { tab: { totalGross: number } }).tab
    expect(tab.totalGross).toBe(774)

    // pagar
    const r = await tse.sign({ clientId: 'c1', processType: 'Kassenbeleg-V1', amountsByVatRate: [], paymentType: 'Bar', grossTotal: tab.totalGross })
    const res = await post(`/pos/sessions/${sessionId}/pay`, {
      client_event_id: crypto.randomUUID(), amount: tab.totalGross, payment: { method: 'cash', amount: tab.totalGross },
      tse: { tx_number: r.txNumber, signature_counter: r.signatureCounter, signature_value: r.signatureValue, log_time: r.logTime, process_type: r.processType, serial_number: r.serialNumber, public_key: r.publicKey },
    })
    expect(res.status).toBe(200)

    // append-only
    await expect(prisma.$executeRawUnsafe(`UPDATE bestellung_items SET "unitNet"=0 WHERE id='${item!.id}'`)).rejects.toThrow()
  })
})
