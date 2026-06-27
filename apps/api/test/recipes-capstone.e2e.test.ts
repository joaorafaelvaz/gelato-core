import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import type { AddressInfo } from 'node:net'
import { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { aggregateConsumption, type SoldLine } from '@gelato/compliance'
import { AppModule } from '../src/app.module'

const TENANT = 'demo-tenant'

// Capstone 2b: cria receitas "S" e "L" via API → busca via GET → monta a cesta
// "2×L + 1×S" a partir dos ingredientes RETORNADOS → aggregateConsumption dá o
// consumo correto de Milch/Zucker. É exatamente a ponte que a 2c usará (sem tocar estoque).
describe('Recipes capstone (e2e)', () => {
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

  it('stores recipes and explodes a basket into correct total consumption', async () => {
    const milch = ((await (await post('/stock/items', { name: `m-${crypto.randomUUID().slice(0, 8)}`, unit: 'ml' })).json()) as { id: string }).id
    const zucker = ((await (await post('/stock/items', { name: `z-${crypto.randomUUID().slice(0, 8)}`, unit: 'g' })).json()) as { id: string }).id
    const prodS = (await prisma.product.create({ data: { tenantId: TENANT, name: `S-${crypto.randomUUID().slice(0, 8)}`, netCents: 300, mwstCodeImHaus: 'standard_19', mwstCodeAusserHaus: 'reduced_7' } })).id
    const prodL = (await prisma.product.create({ data: { tenantId: TENANT, name: `L-${crypto.randomUUID().slice(0, 8)}`, netCents: 600, mwstCodeImHaus: 'standard_19', mwstCodeAusserHaus: 'reduced_7' } })).id

    const recS = ((await (await post('/recipes', { product_id: prodS, ingredients: [{ stock_item_id: milch, qty: 100 }, { stock_item_id: zucker, qty: 40 }] })).json()) as { id: string }).id
    const recL = ((await (await post('/recipes', { product_id: prodL, ingredients: [{ stock_item_id: milch, qty: 200 }, { stock_item_id: zucker, qty: 80 }] })).json()) as { id: string }).id

    // Busca as receitas pela API e monta as linhas vendidas a partir do que voltou.
    const list = (await (await get('/recipes')).json()) as { id: string; ingredients: { stockItemId: string; qty: number }[] }[]
    const ingFor = (id: string) => list.find((r) => r.id === id)!.ingredients.map((i) => ({ stockItemId: i.stockItemId, qty: i.qty }))

    const basket: SoldLine[] = [
      { ingredients: ingFor(recL), qtySold: 2 },
      { ingredients: ingFor(recS), qtySold: 1 },
    ]
    const consumption = aggregateConsumption(basket)
    const byId = new Map(consumption.map((c) => [c.stockItemId, c.qty]))
    expect(byId.get(milch)).toBe(500) // 2*200 + 1*100
    expect(byId.get(zucker)).toBe(200) // 2*80 + 1*40
  })
})
