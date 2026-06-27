import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import type { AddressInfo } from 'node:net'
import { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { FakeTseProvider } from '@gelato/compliance'
import { AppModule } from '../src/app.module'

const TENANT = 'demo-tenant'
const tse = new FakeTseProvider({ serialNumber: 'SER-C' })

describe('Stock consume on sale (e2e)', () => {
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

  // Cria insumo + produto + receita (1 insumo, qty por unidade) com estoque inicial.
  async function setup(perUnit: number, initial: number): Promise<{ productId: string; stockId: string }> {
    const stockId = ((await (await post('/stock/items', { name: `c-${crypto.randomUUID().slice(0, 8)}`, unit: 'g' })).json()) as { id: string }).id
    const product = await prisma.product.create({ data: { tenantId: TENANT, name: `P-${crypto.randomUUID().slice(0, 8)}`, netCents: 100, mwstCodeImHaus: 'standard_19', mwstCodeAusserHaus: 'reduced_7' } })
    await post('/recipes', { product_id: product.id, ingredients: [{ stock_item_id: stockId, qty: perUnit }] })
    await post('/stock/receive', { stock_item_id: stockId, qty: initial })
    return { productId: product.id, stockId }
  }

  const levelOf = async (stockId: string): Promise<number> =>
    ((await (await get('/stock')).json()) as { id: string; qty: number }[]).find((l) => l.id === stockId)!.qty

  async function directSale(clientEventId: string, productId: string, qty: number): Promise<Response> {
    const r = await tse.sign({ clientId: 'c1', processType: 'Kassenbeleg-V1', amountsByVatRate: [], paymentType: 'Bar', grossTotal: 119 })
    return post('/pos/sync', {
      client_event_id: clientEventId, type: 'sale', kasse_id: 'demo-kasse',
      payload: {
        order: { mode: 'ausser_haus', total_net: 100 * qty, total_mwst: 19 * qty, total_gross: 119 * qty },
        items: [{ product_id: productId, qty, unit_net: 100, mwst_rate: 0.19, mwst_code: 'standard_19' }],
        payment: { method: 'cash', amount: 119 * qty },
        receipt: { qr_payload: '', format: 'digital' },
        tse_transaction: { tx_number: r.txNumber, signature_counter: r.signatureCounter, signature_value: r.signatureValue, log_time: r.logTime, process_type: r.processType, serial_number: r.serialNumber, public_key: r.publicKey },
      },
    })
  }

  it('a direct sale decrements stock by recipe × qty', async () => {
    const { productId, stockId } = await setup(50, 1000)
    expect(await levelOf(stockId)).toBe(1000)
    expect((await directSale(crypto.randomUUID(), productId, 3)).status).toBe(200)
    expect(await levelOf(stockId)).toBe(850) // 1000 - 3*50
  })

  it('the direct sale is idempotent (no double decrement on retry)', async () => {
    const { productId, stockId } = await setup(50, 1000)
    const id = crypto.randomUUID()
    await directSale(id, productId, 2)
    await directSale(id, productId, 2) // mesmo client_event_id
    expect(await levelOf(stockId)).toBe(900) // 1000 - 1*(2*50)
  })

  it('a product without an active recipe does not decrement', async () => {
    const stockId = ((await (await post('/stock/items', { name: `n-${crypto.randomUUID().slice(0, 8)}`, unit: 'g' })).json()) as { id: string }).id
    await post('/stock/receive', { stock_item_id: stockId, qty: 500 })
    const product = await prisma.product.create({ data: { tenantId: TENANT, name: `NR-${crypto.randomUUID().slice(0, 8)}`, netCents: 100, mwstCodeImHaus: 'standard_19', mwstCodeAusserHaus: 'reduced_7' } })
    await directSale(crypto.randomUUID(), product.id, 5)
    expect(await levelOf(stockId)).toBe(500) // inalterado
  })

  it('salão: Bestellung decrements; the payment does NOT decrement again', async () => {
    const { productId, stockId } = await setup(50, 1000)
    const tisch = `tisch-${crypto.randomUUID().slice(0, 8)}`
    await prisma.tisch.create({ data: { id: tisch, betriebsstaetteId: 'demo-bs', name: 'consume' } })
    const sessionId = ((await (await post(`/pos/tables/${tisch}/open`, { kasse_id: 'demo-kasse' })).json()) as { id: string }).id

    const sign = await tse.sign({ clientId: 'c1', processType: 'Bestellung-V1', amountsByVatRate: [], paymentType: 'Bar', grossTotal: 238 })
    await post(`/pos/sessions/${sessionId}/bestellung`, {
      client_event_id: crypto.randomUUID(), type: 'bestellung', session_id: sessionId, kasse_id: 'demo-kasse',
      items: [{ product_id: productId, qty: 2, unit_net: 100, mwst_rate: 0.19, mwst_code: 'standard_19' }],
      tse_transaction: { tx_number: sign.txNumber, signature_counter: sign.signatureCounter, signature_value: sign.signatureValue, log_time: sign.logTime, process_type: sign.processType, serial_number: sign.serialNumber, public_key: sign.publicKey },
    })
    expect(await levelOf(stockId)).toBe(900) // baixou na Bestellung (1000 - 2*50)

    const pay = await tse.sign({ clientId: 'c1', processType: 'Kassenbeleg-V1', amountsByVatRate: [], paymentType: 'Bar', grossTotal: 238 })
    await post(`/pos/sessions/${sessionId}/pay`, {
      client_event_id: crypto.randomUUID(),
      payment: { method: 'cash', amount: 238 },
      tse: { tx_number: pay.txNumber, signature_counter: pay.signatureCounter, signature_value: pay.signatureValue, log_time: pay.logTime, process_type: pay.processType, serial_number: pay.serialNumber, public_key: pay.publicKey },
    })
    expect(await levelOf(stockId)).toBe(900) // pagamento NÃO re-baixa
  })

  it('a Storno line returns stock', async () => {
    const { productId, stockId } = await setup(50, 1000)
    const tisch = `tisch-${crypto.randomUUID().slice(0, 8)}`
    await prisma.tisch.create({ data: { id: tisch, betriebsstaetteId: 'demo-bs', name: 'storno' } })
    const sessionId = ((await (await post(`/pos/tables/${tisch}/open`, { kasse_id: 'demo-kasse' })).json()) as { id: string }).id
    const mkBest = async (qty: number, stornoOf?: string) => {
      const s = await tse.sign({ clientId: 'c1', processType: 'Bestellung-V1', amountsByVatRate: [], paymentType: 'Bar', grossTotal: 119 })
      return post(`/pos/sessions/${sessionId}/bestellung`, {
        client_event_id: crypto.randomUUID(), type: 'bestellung', session_id: sessionId, kasse_id: 'demo-kasse',
        items: [{ product_id: productId, qty, unit_net: 100, mwst_rate: 0.19, mwst_code: 'standard_19', storno_of: stornoOf }],
        tse_transaction: { tx_number: s.txNumber, signature_counter: s.signatureCounter, signature_value: s.signatureValue, log_time: s.logTime, process_type: s.processType, serial_number: s.serialNumber, public_key: s.publicKey },
      })
    }
    await mkBest(2) // -100
    expect(await levelOf(stockId)).toBe(900)
    await mkBest(-1, 'x') // Storno devolve +50
    expect(await levelOf(stockId)).toBe(950)
  })
})
