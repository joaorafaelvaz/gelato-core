import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import type { AddressInfo } from 'node:net'
import { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { FakeTseProvider } from '@gelato/compliance'
import { AppModule } from '../src/app.module'

const tse = new FakeTseProvider({ serialNumber: 'SER-CAP' })

// Capstone 2c: receita Eisbecher L (200ml Milch + 80g Zucker) → receive estoque
// dedicado → vender no salão (Bestellung L) → estoque cai exatamente → disponibilidade recalcula.
describe('Consume capstone (e2e)', () => {
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
  const levelOf = async (id: string) => ((await (await get('/stock')).json()) as { id: string; qty: number }[]).find((l) => l.id === id)?.qty ?? 0

  it('selling an Eisbecher L in the salão decrements Milch/Zucker and updates availability', async () => {
    const milch = ((await (await post('/stock/items', { name: `milch-${crypto.randomUUID().slice(0, 8)}`, unit: 'ml' })).json()) as { id: string }).id
    const zucker = ((await (await post('/stock/items', { name: `zucker-${crypto.randomUUID().slice(0, 8)}`, unit: 'g' })).json()) as { id: string }).id
    const product = await prisma.product.create({ data: { tenantId: 'demo-tenant', name: `Becher-${crypto.randomUUID().slice(0, 8)}`, netCents: 600, mwstCodeImHaus: 'standard_19', mwstCodeAusserHaus: 'reduced_7' } })
    const variant = await prisma.productVariant.create({ data: { productId: product.id, name: 'L', netCents: 600 } })
    const recId = ((await (await post('/recipes', { product_id: product.id, variant_id: variant.id, ingredients: [{ stock_item_id: milch, qty: 200 }, { stock_item_id: zucker, qty: 80 }] })).json()) as { id: string }).id
    await post('/stock/receive', { stock_item_id: milch, qty: 1000 })
    await post('/stock/receive', { stock_item_id: zucker, qty: 1000 })

    // disponibilidade inicial: min(floor(1000/200), floor(1000/80)) = min(5,12) = 5
    const av0 = (await (await get('/recipes/availability')).json()) as { recipeId: string; maxProducible: number }[]
    expect(av0.find((r) => r.recipeId === recId)!.maxProducible).toBe(5)

    // vende 1× L no salão
    const tisch = `tisch-${crypto.randomUUID().slice(0, 8)}`
    await prisma.tisch.create({ data: { id: tisch, betriebsstaetteId: 'demo-bs', name: 'cap' } })
    const sessionId = ((await (await post(`/pos/tables/${tisch}/open`, { kasse_id: 'demo-kasse' })).json()) as { id: string }).id
    const s = await tse.sign({ clientId: 'c1', processType: 'Bestellung-V1', amountsByVatRate: [], paymentType: 'Bar', grossTotal: 714 })
    await post(`/pos/sessions/${sessionId}/bestellung`, {
      client_event_id: crypto.randomUUID(), type: 'bestellung', session_id: sessionId, kasse_id: 'demo-kasse',
      items: [{ product_id: product.id, variant_id: variant.id, qty: 1, unit_net: 600, mwst_rate: 0.19, mwst_code: 'standard_19' }],
      tse_transaction: { tx_number: s.txNumber, signature_counter: s.signatureCounter, signature_value: s.signatureValue, log_time: s.logTime, process_type: s.processType, serial_number: s.serialNumber, public_key: s.publicKey },
    })

    expect(await levelOf(milch)).toBe(800) // 1000 - 200
    expect(await levelOf(zucker)).toBe(920) // 1000 - 80
    // movimento de consumo ligado à Bestellung
    const consume = await prisma.stockMovement.findFirst({ where: { stockItemId: milch, type: 'consume' } })
    expect(consume?.refType).toBe('bestellung')
    expect(consume?.qtyDelta).toBe(-200)

    const av1 = (await (await get('/recipes/availability')).json()) as { recipeId: string; maxProducible: number }[]
    expect(av1.find((r) => r.recipeId === recId)!.maxProducible).toBe(4) // floor(800/200)=4
  })
})
