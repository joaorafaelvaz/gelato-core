import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AppModule } from '../src/app.module'
import { PrismaService } from '../src/prisma/prisma.service'

const DAY_MS = 24 * 3600 * 1000
const WINDOW_START = new Date(Date.UTC(1500, 0, 1) + Math.floor(Math.random() * 100_000) * DAY_MS)
const at = (h: number) => new Date(WINDOW_START.getTime() + h * 3600 * 1000)
const iso = (d: Date) => d.toISOString()

describe('/integration/orders + /integration/shifts (e2e)', () => {
  let app: INestApplication
  let server: ReturnType<INestApplication['getHttpServer']>
  let token: string

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = moduleRef.createNestApplication()
    await app.init()
    server = app.getHttpServer()
    token = app.get(JwtService).sign({
      sub: 'svc-test', tenant_id: 'demo-tenant',
      permissions: ['integration.read'], escalated: false,
    })
    // Fixture: order com item + payment na janela isolada
    const prisma = app.get(PrismaService)
    await prisma.order.create({
      data: {
        clientEventId: crypto.randomUUID(),
        kasseId: 'demo-kasse',
        mode: 'ausser_haus',
        totalNet: 150, totalMwst: 11, totalGross: 161,
        ts: at(1),
        items: { create: [{ productId: 'prod-i', qty: 2, unitNet: 75, mwstRate: 0.07, mwstCode: 'reduced_7' }] },
        payments: { create: [{ method: 'cash', amount: 161 }] },
      },
    })
  }, 30000)

  afterAll(async () => {
    await app?.close()
  })

  const get = (p: string) => request(server).get(p).set('Authorization', `Bearer ${token}`)
  const windowQ = `from=${iso(WINDOW_START)}&to=${iso(at(24))}`

  it('devolve orders com items, payments e operator_user_id embutidos, ts asc', async () => {
    const res = await get(`/integration/orders?${windowQ}&limit=100`)
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    const o = res.body[0]
    expect(o).toMatchObject({ kasse_id: 'demo-kasse', total_gross: 161, operator_user_id: null })
    expect(o.items).toHaveLength(1)
    expect(o.items[0]).toMatchObject({ product_id: 'prod-i', qty: 2, unit_net: 75 })
    expect(o.payments[0]).toMatchObject({ method: 'cash', amount: 161 })
  })

  it('filtra por kasse_id', async () => {
    const none = await get(`/integration/orders?${windowQ}&kasse_id=inexistente`)
    expect(none.body).toHaveLength(0)
    const some = await get(`/integration/orders?${windowQ}&kasse_id=demo-kasse`)
    expect(some.body).toHaveLength(1)
  })

  it('pagina deterministicamente (limit/offset, ts asc)', async () => {
    const res = await get(`/integration/orders?${windowQ}&limit=1&offset=1`)
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(0) // só 1 order na janela
  })

  it('GET /integration/shifts devolve turnos com user_id', async () => {
    const res = await get(`/integration/shifts`)
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
    if (res.body.length > 0) {
      expect(res.body[0]).toHaveProperty('user_id')
      expect(res.body[0]).toHaveProperty('kasse_id')
    }
  })
})
