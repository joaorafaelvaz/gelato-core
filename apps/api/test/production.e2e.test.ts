import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AppModule } from '../src/app.module'

describe('Production (e2e)', () => {
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

  const newItem = async (unit = 'g'): Promise<string> =>
    ((await (await post('/stock/items', { name: `i-${crypto.randomUUID().slice(0, 8)}`, unit })).json()) as { id: string }).id
  const levelOf = async (id: string): Promise<number> =>
    ((await (await get('/stock')).json()) as { id: string; qty: number }[]).find((l) => l.id === id)!.qty

  it('creates a production recipe (409 duplicate, 400 invalid)', async () => {
    const out = await newItem('ml')
    const ing = await newItem('g')
    expect((await post('/production/recipes', { output_stock_item_id: out, yield_qty: 1000, ingredients: [{ stock_item_id: ing, qty: 100 }] })).status).toBe(201)
    expect((await post('/production/recipes', { output_stock_item_id: out, yield_qty: 1000, ingredients: [{ stock_item_id: ing, qty: 100 }] })).status).toBe(409)
    const out2 = await newItem('ml')
    expect((await post('/production/recipes', { output_stock_item_id: out2, yield_qty: 0, ingredients: [{ stock_item_id: ing, qty: 100 }] })).status).toBe(400)
    expect((await post('/production/recipes', { output_stock_item_id: out2, yield_qty: 1000, ingredients: [] })).status).toBe(400)
  })

  it('produces a batch: consumes ingredients, produces output', async () => {
    const out = await newItem('ml')
    const milch = await newItem('ml')
    const zucker = await newItem('g')
    await post('/production/recipes', { output_stock_item_id: out, yield_qty: 1000, ingredients: [{ stock_item_id: milch, qty: 800 }, { stock_item_id: zucker, qty: 200 }] })
    await post('/stock/receive', { stock_item_id: milch, qty: 5000 })
    await post('/stock/receive', { stock_item_id: zucker, qty: 5000 })

    const r = await post('/production', { output_stock_item_id: out, batches: 2 })
    expect(r.status).toBe(201)
    expect(await levelOf(out)).toBe(2000) // 1000 * 2
    expect(await levelOf(milch)).toBe(5000 - 1600) // 800*2
    expect(await levelOf(zucker)).toBe(5000 - 400)
  })

  it('producing without a recipe → 404; batches <= 0 → 400', async () => {
    const out = await newItem('ml')
    expect((await post('/production', { output_stock_item_id: out, batches: 1 })).status).toBe(404)
    const out2 = await newItem('ml')
    const ing = await newItem('g')
    await post('/production/recipes', { output_stock_item_id: out2, yield_qty: 1000, ingredients: [{ stock_item_id: ing, qty: 10 }] })
    expect((await post('/production', { output_stock_item_id: out2, batches: 0 })).status).toBe(400)
  })
})
