import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { FakeTseProvider } from '@gelato/compliance'
import { AppModule } from '../src/app.module'

const tse = new FakeTseProvider({ serialNumber: 'SER-V' })

describe('Vouchers (e2e)', () => {
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

  const newCode = () => `T${crypto.randomUUID().slice(0, 8).toUpperCase()}`

  async function sale(voucherCode: string, items: { product_id: string; qty: number; unit_net: number; mwst_rate: number; mwst_code: string }[]): Promise<void> {
    const net = items.reduce((s, i) => s + i.unit_net * i.qty, 0)
    const gross = items.reduce((s, i) => s + Math.round(i.unit_net * (1 + i.mwst_rate)) * i.qty, 0)
    const r = await tse.sign({ clientId: 'c1', processType: 'Kassenbeleg-V1', amountsByVatRate: [], paymentType: 'Bar', grossTotal: gross })
    await post('/pos/sync', {
      client_event_id: crypto.randomUUID(), type: 'sale', kasse_id: 'demo-kasse',
      payload: {
        order: { mode: 'ausser_haus', voucher_code: voucherCode, total_net: net, total_mwst: gross - net, total_gross: gross },
        items,
        payment: { method: 'cash', amount: gross },
        receipt: { qr_payload: '', format: 'digital' },
        tse_transaction: { tx_number: r.txNumber, signature_counter: r.signatureCounter, signature_value: r.signatureValue, log_time: r.logTime, process_type: r.processType, serial_number: r.serialNumber, public_key: r.publicKey },
      },
    })
  }

  const rabattItems = [
    { product_id: 'p1', qty: 1, unit_net: 1000, mwst_rate: 0.19, mwst_code: 'standard_19' },
    { product_id: 'rabatt', qty: 1, unit_net: -100, mwst_rate: 0.19, mwst_code: 'standard_19' },
  ]

  it('creates a voucher; duplicate code → 409', async () => {
    const code = newCode()
    expect((await post('/vouchers', { code, type: 'percent', value: 10 })).status).toBe(201)
    expect((await post('/vouchers', { code, type: 'percent', value: 10 })).status).toBe(409)
  })

  it('quote returns the discount for an active voucher', async () => {
    const code = newCode()
    await post('/vouchers', { code, type: 'percent', value: 10 })
    const q = (await (await post('/vouchers/quote', { code, gross_cents: 1190 })).json()) as { valid: boolean; discount_cents: number }
    expect(q.valid).toBe(true)
    expect(q.discount_cents).toBe(119)
  })

  it('quote on an exhausted voucher → valid:false', async () => {
    const code = newCode()
    await post('/vouchers', { code, type: 'percent', value: 10, max_uses: 1 })
    await sale(code, rabattItems) // esgota
    const q = (await (await post('/vouchers/quote', { code, gross_cents: 1190 })).json()) as { valid: boolean }
    expect(q.valid).toBe(false)
  })

  it('a sale with a voucher_code records a redemption and bumps usedCount', async () => {
    const code = newCode()
    await post('/vouchers', { code, type: 'percent', value: 10 })
    await sale(code, rabattItems)
    const v = ((await (await get('/vouchers')).json()) as { code: string; usedCount: number }[]).find((x) => x.code === code)!
    expect(v.usedCount).toBe(1)
  })
})
