import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import type { AddressInfo } from 'node:net'
import { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AppModule } from '../src/app.module'

// Capstone 2a: item novo → receive 1000 → adjust −250 (750) → count 700
// (gera movimento count de −50) → GET /stock = 700, histórico com 3 movimentos.
describe('Stock capstone (e2e)', () => {
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

  it('derives the right level through receive → adjust → count', async () => {
    const id = ((await (await post('/stock/items', { name: `cap-${crypto.randomUUID().slice(0, 8)}`, unit: 'ml' })).json()) as { id: string }).id
    await post('/stock/receive', { stock_item_id: id, qty: 1000 })
    await post('/stock/adjust', { stock_item_id: id, qty_delta: -250 })
    const mid = ((await (await get('/stock')).json()) as { id: string; qty: number }[]).find((l) => l.id === id)!
    expect(mid.qty).toBe(750)

    await post('/stock/count', { stock_item_id: id, counted: 700 })
    const lvl = ((await (await get('/stock')).json()) as { id: string; qty: number }[]).find((l) => l.id === id)!
    expect(lvl.qty).toBe(700)

    const movs = await prisma.stockMovement.findMany({ where: { stockItemId: id }, orderBy: { createdAt: 'asc' } })
    expect(movs.map((m) => [m.type, m.qtyDelta])).toEqual([['receive', 1000], ['adjust', -250], ['count', -50]])
  })
})
