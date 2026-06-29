import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import type { AddressInfo } from 'node:net'
import { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { FakeTseProvider } from '@gelato/compliance'
import { AppModule } from '../src/app.module'

const tse = new FakeTseProvider({ serialNumber: 'SER-VC' })

// Capstone 4c: voucher 10% maxUses 1 → quote 1190 → desconto 119 → venda com linha
// Rabatt -119 → Order gross 1071 + redemption gravado + usedCount 1 → quote esgotado.
describe('Vouchers capstone (e2e)', () => {
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

  it('quotes, applies a Rabatt line, records the redemption, then exhausts', async () => {
    const code = `CAP${crypto.randomUUID().slice(0, 8).toUpperCase()}`
    await post('/vouchers', { code, type: 'percent', value: 10, max_uses: 1 })

    const q = (await (await post('/vouchers/quote', { code, gross_cents: 1190 })).json()) as { valid: boolean; discount_cents: number }
    expect(q).toEqual({ valid: true, type: 'percent', value: 10, discount_cents: 119 })

    const items = [
      { product_id: 'p1', qty: 1, unit_net: 1000, mwst_rate: 0.19, mwst_code: 'standard_19' },
      { product_id: 'rabatt', qty: 1, unit_net: -100, mwst_rate: 0.19, mwst_code: 'standard_19' },
    ]
    const gross = items.reduce((s, i) => s + Math.round(i.unit_net * (1 + i.mwst_rate)) * i.qty, 0)
    expect(gross).toBe(1071)
    const sig = await tse.sign({ clientId: 'c1', processType: 'Kassenbeleg-V1', amountsByVatRate: [], paymentType: 'Bar', grossTotal: gross })
    const cid = crypto.randomUUID()
    await post('/pos/sync', {
      client_event_id: cid, type: 'sale', kasse_id: 'demo-kasse',
      payload: {
        order: { mode: 'ausser_haus', voucher_code: code, total_net: 900, total_mwst: 171, total_gross: gross },
        items,
        payment: { method: 'cash', amount: gross },
        receipt: { qr_payload: '', format: 'digital' },
        tse_transaction: { tx_number: sig.txNumber, signature_counter: sig.signatureCounter, signature_value: sig.signatureValue, log_time: sig.logTime, process_type: sig.processType, serial_number: sig.serialNumber, public_key: sig.publicKey },
      },
    })

    const order = await prisma.order.findUnique({ where: { clientEventId: cid } })
    expect(order?.totalGross).toBe(1071)
    const red = await prisma.voucherRedemption.findFirst({ where: { orderId: order!.id } })
    expect(red?.discountCents).toBe(119)

    const q2 = (await (await post('/vouchers/quote', { code, gross_cents: 1190 })).json()) as { valid: boolean }
    expect(q2.valid).toBe(false) // esgotado (maxUses 1)
  })
})
