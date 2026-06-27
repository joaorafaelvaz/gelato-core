import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import type { AddressInfo } from 'node:net'
import { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AppModule } from '../src/app.module'

const TENANT = 'demo-tenant'

describe('Recipes (e2e)', () => {
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
  const put = (path: string, body: unknown) =>
    fetch(`${baseUrl}${path}`, { method: 'PUT', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body) })
  const get = (path: string) => fetch(`${baseUrl}${path}`, { headers: { authorization: `Bearer ${token}` } })

  // Insumo dedicado p/ os testes (evita acoplar a ids de seed).
  async function newStock(unit = 'g'): Promise<string> {
    return ((await (await post('/stock/items', { name: `ing-${crypto.randomUUID().slice(0, 8)}`, unit })).json()) as { id: string }).id
  }
  // Produto dedicado do tenant demo (evita colidir com a unicidade da seed).
  async function newProduct(): Promise<string> {
    const p = await prisma.product.create({ data: { tenantId: TENANT, name: `P-${crypto.randomUUID().slice(0, 8)}`, netCents: 100, mwstCodeImHaus: 'standard_19', mwstCodeAusserHaus: 'reduced_7' } })
    return p.id
  }

  it('creates a recipe and GET returns it enriched', async () => {
    const milch = await newStock('ml')
    const zucker = await newStock('g')
    const prod = await newProduct()
    const r = await post('/recipes', { product_id: prod, ingredients: [{ stock_item_id: milch, qty: 100 }, { stock_item_id: zucker, qty: 40 }] })
    expect(r.status).toBe(201)
    const list = (await (await get('/recipes')).json()) as { id: string; productId: string; ingredients: { stockItemId: string; qty: number }[] }[]
    const rec = list.find((x) => x.productId === prod)!
    expect(rec.ingredients).toEqual([
      { stockItemId: milch, stockItemName: expect.any(String), unit: 'ml', qty: 100 },
      { stockItemId: zucker, stockItemName: expect.any(String), unit: 'g', qty: 40 },
    ])
  })

  it('rejects a duplicate recipe for the same (product, variant) → 409', async () => {
    const s = await newStock('ml')
    const prod = await newProduct()
    expect((await post('/recipes', { product_id: prod, ingredients: [{ stock_item_id: s, qty: 10 }] })).status).toBe(201)
    expect((await post('/recipes', { product_id: prod, ingredients: [{ stock_item_id: s, qty: 10 }] })).status).toBe(409)
  })

  it('404 when the product belongs to another tenant', async () => {
    const s = await newStock('g')
    const other = await prisma.tenant.create({ data: { id: `tenant-other-${crypto.randomUUID().slice(0, 8)}`, name: 'Other' } })
    const foreign = await prisma.product.create({ data: { tenantId: other.id, name: 'X', netCents: 100, mwstCodeImHaus: 'standard_19', mwstCodeAusserHaus: 'reduced_7' } })
    expect((await post('/recipes', { product_id: foreign.id, ingredients: [{ stock_item_id: s, qty: 10 }] })).status).toBe(404)
  })

  it('400 on empty ingredients or qty <= 0', async () => {
    const s = await newStock('g')
    const prod = await newProduct()
    expect((await post('/recipes', { product_id: prod, ingredients: [] })).status).toBe(400)
    expect((await post('/recipes', { product_id: prod, ingredients: [{ stock_item_id: s, qty: 0 }] })).status).toBe(400)
  })

  it('PUT replaces the ingredient set', async () => {
    const a = await newStock('ml')
    const b = await newStock('g')
    const prod = await newProduct()
    const id = ((await (await post('/recipes', { product_id: prod, ingredients: [{ stock_item_id: a, qty: 10 }] })).json()) as { id: string }).id
    expect((await put(`/recipes/${id}`, { ingredients: [{ stock_item_id: b, qty: 25 }] })).status).toBe(200)
    const list = (await (await get('/recipes')).json()) as { id: string; ingredients: { stockItemId: string; qty: number }[] }[]
    const rec = list.find((x) => x.id === id)!
    expect(rec.ingredients.map((i) => ({ stockItemId: i.stockItemId, qty: i.qty }))).toEqual([{ stockItemId: b, qty: 25 }])
  })
})
