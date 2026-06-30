import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import type { AddressInfo } from 'node:net'
import { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { FakeTseProvider } from '@gelato/compliance'
import { AppModule } from '../src/app.module'

const tse = new FakeTseProvider({ serialNumber: 'SER-PROD' })

// Capstone 5a (BOM 2 níveis): receber Milch/Zucker → produzir 2 lotes de Eisbasis
// → criar produto acabado + receita de venda usando Eisbasis → vender o acabado →
// Eisbasis decrementado (2c). Raw → semi (produção) → acabado (venda).
describe('Production capstone (e2e)', () => {
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
  const newItem = async (unit: string): Promise<string> => ((await (await post('/stock/items', { name: `i-${crypto.randomUUID().slice(0, 8)}`, unit })).json()) as { id: string }).id
  const levelOf = async (id: string): Promise<number> => ((await (await get('/stock')).json()) as { id: string; qty: number }[]).find((l) => l.id === id)!.qty

  it('raw → semi (production) → finished (sale)', async () => {
    const milch = await newItem('ml')
    const zucker = await newItem('g')
    const eisbasis = await newItem('ml')
    await post('/production/recipes', { output_stock_item_id: eisbasis, yield_qty: 10000, ingredients: [{ stock_item_id: milch, qty: 8000 }, { stock_item_id: zucker, qty: 2000 }] })
    await post('/stock/receive', { stock_item_id: milch, qty: 20000 })
    await post('/stock/receive', { stock_item_id: zucker, qty: 5000 })

    // produz 2 lotes → Eisbasis +20000, Milch -16000, Zucker -4000
    await post('/production', { output_stock_item_id: eisbasis, batches: 2 })
    expect(await levelOf(eisbasis)).toBe(20000)
    expect(await levelOf(milch)).toBe(4000)
    expect(await levelOf(zucker)).toBe(1000)

    // produto acabado + receita de venda usando o semi-acabado (Eisbasis 200/unidade)
    const product = await prisma.product.create({ data: { tenantId: 'demo-tenant', name: `Becher-${crypto.randomUUID().slice(0, 8)}`, netCents: 300, mwstCodeImHaus: 'standard_19', mwstCodeAusserHaus: 'reduced_7' } })
    await post('/recipes', { product_id: product.id, ingredients: [{ stock_item_id: eisbasis, qty: 200 }] })

    // vende 3 → consumeForSale (2c) decrementa Eisbasis em 600
    const r = await tse.sign({ clientId: 'c1', processType: 'Kassenbeleg-V1', amountsByVatRate: [], paymentType: 'Bar', grossTotal: 1071 })
    await post('/pos/sync', {
      client_event_id: crypto.randomUUID(), type: 'sale', kasse_id: 'demo-kasse',
      payload: {
        order: { mode: 'ausser_haus', total_net: 900, total_mwst: 171, total_gross: 1071 },
        items: [{ product_id: product.id, qty: 3, unit_net: 300, mwst_rate: 0.19, mwst_code: 'standard_19' }],
        payment: { method: 'cash', amount: 1071 },
        receipt: { qr_payload: '', format: 'digital' },
        tse_transaction: { tx_number: r.txNumber, signature_counter: r.signatureCounter, signature_value: r.signatureValue, log_time: r.logTime, process_type: r.processType, serial_number: r.serialNumber, public_key: r.publicKey },
      },
    })
    expect(await levelOf(eisbasis)).toBe(20000 - 600) // 2 níveis: produção subiu, venda baixou
  })
})
