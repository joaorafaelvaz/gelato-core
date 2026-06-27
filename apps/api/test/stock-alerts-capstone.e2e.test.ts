import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import type { AddressInfo } from 'node:net'
import { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { FakeTseProvider } from '@gelato/compliance'
import { AppModule } from '../src/app.module'

const tse = new FakeTseProvider({ serialNumber: 'SER-ALERT' })

// Capstone 2d: insumo minStock 100 / qty 120 (ok) → vender via receita até 80 (low)
// → vender até negativo → o alerta acompanha. Liga o decremento (2c) ao alerta (2d).
describe('Stock alerts capstone (e2e)', () => {
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
  const stateOf = async (id: string): Promise<string | undefined> =>
    ((await (await get('/stock/alerts')).json()) as { id: string; state: string }[]).find((a) => a.id === id)?.state

  async function sell(productId: string, qty: number): Promise<void> {
    const r = await tse.sign({ clientId: 'c1', processType: 'Kassenbeleg-V1', amountsByVatRate: [], paymentType: 'Bar', grossTotal: 119 * qty })
    await post('/pos/sync', {
      client_event_id: crypto.randomUUID(), type: 'sale', kasse_id: 'demo-kasse',
      payload: {
        order: { mode: 'ausser_haus', total_net: 100 * qty, total_mwst: 19 * qty, total_gross: 119 * qty },
        items: [{ product_id: productId, qty, unit_net: 100, mwst_rate: 0.19, mwst_code: 'standard_19' }],
        payment: { method: 'cash', amount: 119 * qty },
        receipt: { qr_payload: '', format: 'digital' },
        tse_transaction: { tx_number: r.txNumber, signature_counter: r.signatureCounter, signature_value: r.signatureValue, log_time: r.logTime, process_type: r.processType, serial_number: r.serialNumber, public_key: r.publicKey },
      },
    })
  }

  it('a sale drives an item from ok → low → negative in /stock/alerts', async () => {
    const stockId = ((await (await post('/stock/items', { name: `cap-${crypto.randomUUID().slice(0, 8)}`, unit: 'g', min_stock: 100 })).json()) as { id: string }).id
    await post('/stock/receive', { stock_item_id: stockId, qty: 120 })
    const product = await prisma.product.create({ data: { tenantId: 'demo-tenant', name: `AP-${crypto.randomUUID().slice(0, 8)}`, netCents: 100, mwstCodeImHaus: 'standard_19', mwstCodeAusserHaus: 'reduced_7' } })
    await post('/recipes', { product_id: product.id, ingredients: [{ stock_item_id: stockId, qty: 20 }] }) // 20g por unidade

    expect(await stateOf(stockId)).toBeUndefined() // 120 ≥ 100 → ok, fora dos alertas

    await sell(product.id, 2) // 120 - 40 = 80 (< 100) → low
    expect(await stateOf(stockId)).toBe('low')

    await sell(product.id, 5) // 80 - 100 = -20 → negative
    expect(await stateOf(stockId)).toBe('negative')
  })
})
