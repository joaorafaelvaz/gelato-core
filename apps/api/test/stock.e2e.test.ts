import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import type { AddressInfo } from 'node:net'
import { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AppModule } from '../src/app.module'

describe('Stock (e2e)', () => {
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

  async function newItem(name = 'e2e'): Promise<string> {
    const r = await post('/stock/items', { name: `${name}-${crypto.randomUUID().slice(0, 8)}`, unit: 'g' })
    expect(r.status).toBe(201)
    return ((await r.json()) as { id: string }).id
  }

  it('receive raises the derived level (GET /stock)', async () => {
    const id = await newItem('milch')
    expect((await post('/stock/receive', { stock_item_id: id, qty: 1000 })).status).toBe(201)
    const lvl = ((await (await get('/stock')).json()) as { id: string; qty: number }[]).find((l) => l.id === id)!
    expect(lvl.qty).toBe(1000)
  })

  it('adjust applies a negative delta', async () => {
    const id = await newItem('adj')
    await post('/stock/receive', { stock_item_id: id, qty: 500 })
    await post('/stock/adjust', { stock_item_id: id, qty_delta: -120, reason: 'Bruch' })
    const lvl = ((await (await get('/stock')).json()) as { id: string; qty: number }[]).find((l) => l.id === id)!
    expect(lvl.qty).toBe(380)
  })

  it('count records a movement of (counted − current) and the level becomes counted', async () => {
    const id = await newItem('count')
    await post('/stock/receive', { stock_item_id: id, qty: 1000 })
    expect((await post('/stock/count', { stock_item_id: id, counted: 700 })).status).toBe(201)
    const lvl = ((await (await get('/stock')).json()) as { id: string; qty: number }[]).find((l) => l.id === id)!
    expect(lvl.qty).toBe(700)
    const movs = await prisma.stockMovement.findMany({ where: { stockItemId: id }, orderBy: { createdAt: 'asc' } })
    expect(movs.map((m) => m.qtyDelta)).toEqual([1000, -300]) // receive +1000, count -300
    expect(movs[1].type).toBe('count')
  })

  it('a new item with no movements shows qty 0', async () => {
    const id = await newItem('zero')
    const lvl = ((await (await get('/stock')).json()) as { id: string; qty: number }[]).find((l) => l.id === id)!
    expect(lvl.qty).toBe(0)
  })

  it('an item from another tenant → 404 on receive', async () => {
    const id = `stock-other-${crypto.randomUUID().slice(0, 8)}`
    await prisma.stockItem.create({ data: { id, tenantId: 'tenant-other', name: 'X', unit: 'g' } })
    expect((await post('/stock/receive', { stock_item_id: id, qty: 10 })).status).toBe(404)
  })

  it('rejects invalid bodies (400): qty ≤ 0, qty_delta == 0', async () => {
    const id = await newItem('bad')
    expect((await post('/stock/receive', { stock_item_id: id, qty: 0 })).status).toBe(400)
    expect((await post('/stock/adjust', { stock_item_id: id, qty_delta: 0 })).status).toBe(400)
  })
})
