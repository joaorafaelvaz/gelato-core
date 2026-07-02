import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AppModule } from '../src/app.module'
import { PrismaService } from '../src/prisma/prisma.service'

const WINDOW_START = new Date(Date.now() - 200 * 365 * 24 * 3600 * 1000)
const WINDOW_END = new Date(WINDOW_START.getTime() + 24 * 3600 * 1000)
const at = (hours: number): Date => new Date(WINDOW_START.getTime() + hours * 3600 * 1000)
const iso = (d: Date): string => d.toISOString()

describe('GET /orders query params + GET /orders/summary (e2e)', () => {
  let app: INestApplication
  let server: ReturnType<INestApplication['getHttpServer']>
  let token: string
  let foreignId: string

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = moduleRef.createNestApplication()
    await app.init()
    server = app.getHttpServer()
    const login = await request(server)
      .post('/auth/login')
      .send({ email: 'admin@demo.test', password: 'admin123' })
    token = login.body.access_token

    // Fixture: 3 orders do demo-tenant na janela + 1 order de OUTRO tenant na mesma janela.
    const prisma = app.get(PrismaService)
    const mk = (hours: number, gross: number) => ({
      clientEventId: crypto.randomUUID(),
      kasseId: 'demo-kasse',
      mode: 'ausser_haus',
      totalNet: gross,
      totalMwst: 0,
      totalGross: gross,
      ts: at(hours),
    })
    await prisma.order.create({ data: mk(1, 111) })
    await prisma.order.create({ data: mk(2, 222) })
    await prisma.order.create({ data: mk(3, 333) })

    const suffix = crypto.randomUUID().slice(0, 8)
    const t2 = await prisma.tenant.create({ data: { name: `t2-${suffix}` } })
    const bs2 = await prisma.betriebsstaette.create({ data: { tenantId: t2.id, name: 'bs2' } })
    const k2 = await prisma.kasse.create({ data: { betriebsstaetteId: bs2.id, name: 'k2' } })
    const foreign = await prisma.order.create({
      data: {
        clientEventId: crypto.randomUUID(),
        kasseId: k2.id,
        mode: 'ausser_haus',
        totalNet: 777001,
        totalMwst: 0,
        totalGross: 777001,
        ts: at(4),
      },
    })
    foreignId = foreign.id
  }, 30000)

  afterAll(async () => {
    await app?.close()
  })

  const get = (path: string) => request(server).get(path).set('Authorization', `Bearer ${token}`)
  const windowQ = `from=${iso(WINDOW_START)}&to=${iso(WINDOW_END)}`

  it('from/to filter the window and exclude the foreign tenant', async () => {
    const res = await get(`/orders?${windowQ}&limit=500`)
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(3)
    expect(res.body.map((o: { totalGross: number }) => o.totalGross)).toEqual([333, 222, 111])
    expect(res.body.some((o: { id: string }) => o.id === foreignId)).toBe(false)
  })

  it('limit caps the page and keeps ts desc', async () => {
    const res = await get(`/orders?${windowQ}&limit=2`)
    expect(res.body.map((o: { totalGross: number }) => o.totalGross)).toEqual([333, 222])
  })

  it('offset pages the window deterministically', async () => {
    const res = await get(`/orders?${windowQ}&limit=2&offset=2`)
    expect(res.body).toHaveLength(1)
    expect(res.body[0].totalGross).toBe(111)
  })

  it('rejects invalid params with 400', async () => {
    for (const q of ['limit=0', 'limit=501', 'limit=abc', 'offset=-1', 'from=banana', 'to=banana']) {
      const res = await get(`/orders?${q}`)
      expect(res.status, q).toBe(400)
    }
  })

  it('without params keeps the previous behavior (array, up to 100)', async () => {
    const res = await get('/orders')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
    expect(res.body.length).toBeLessThanOrEqual(100)
  })

  it('summary aggregates exactly the tenant orders in the window (foreign excluded)', async () => {
    const res = await get(`/orders/summary?${windowQ}`)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ count: 3, totalGross: 666 })
  })

  it('summary of an empty window is zero', async () => {
    const from = iso(new Date(WINDOW_START.getTime() - 2000))
    const to = iso(new Date(WINDOW_START.getTime() - 1000))
    const res = await get(`/orders/summary?from=${from}&to=${to}`)
    expect(res.body).toEqual({ count: 0, totalGross: 0 })
  })

  it('summary rejects invalid dates with 400', async () => {
    const res = await get('/orders/summary?from=banana')
    expect(res.status).toBe(400)
  })
})
