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
  let operatorId: string
  let shiftId: string
  let foreignOrderId: string

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = moduleRef.createNestApplication()
    await app.init()
    server = app.getHttpServer()
    token = app.get(JwtService).sign({
      sub: 'svc-test', tenant_id: 'demo-tenant',
      permissions: ['integration.read'], escalated: false,
    })
    const prisma = app.get(PrismaService)

    // Fixture 1: order com item + payment na janela isolada, sem shift (operator_user_id null)
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

    // Fixture 2: segunda order na janela (para paginação real)
    await prisma.order.create({
      data: {
        clientEventId: crypto.randomUUID(),
        kasseId: 'demo-kasse',
        mode: 'ausser_haus',
        totalNet: 222, totalMwst: 0, totalGross: 222,
        ts: at(2),
      },
    })

    // Fixture 3: shift do Operator (usuário real do seed) + order ligada a ele
    const operator = await prisma.user.findUniqueOrThrow({ where: { email: 'operator@demo.test' } })
    operatorId = operator.id
    const shift = await prisma.shift.create({
      data: { kasseId: 'demo-kasse', userId: operatorId, openedAt: at(1) },
    })
    shiftId = shift.id
    await prisma.order.create({
      data: {
        clientEventId: crypto.randomUUID(),
        kasseId: 'demo-kasse',
        shiftId: shift.id,
        mode: 'ausser_haus',
        totalNet: 333, totalMwst: 0, totalGross: 333,
        ts: at(3),
      },
    })

    // Fixture 4: OUTRO tenant com order na MESMA janela (não pode vazar)
    const suffix = crypto.randomUUID().slice(0, 8)
    const t2 = await prisma.tenant.create({ data: { name: `t2-${suffix}` } })
    const bs2 = await prisma.betriebsstaette.create({ data: { tenantId: t2.id, name: `bs2-${suffix}` } })
    const k2 = await prisma.kasse.create({ data: { betriebsstaetteId: bs2.id, name: `k2-${suffix}` } })
    const foreign = await prisma.order.create({
      data: {
        clientEventId: crypto.randomUUID(),
        kasseId: k2.id,
        mode: 'ausser_haus',
        totalNet: 777001, totalMwst: 0, totalGross: 777001,
        ts: at(4),
      },
    })
    foreignOrderId = foreign.id
  }, 30000)

  afterAll(async () => {
    await app?.close()
  })

  const get = (p: string) => request(server).get(p).set('Authorization', `Bearer ${token}`)
  const windowQ = `from=${iso(WINDOW_START)}&to=${iso(at(24))}`

  it('devolve orders com items, payments e operator_user_id embutidos, ts asc', async () => {
    const res = await get(`/integration/orders?${windowQ}&limit=100`)
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(3)
    expect(res.body.map((o: { ts: string }) => o.ts)).toEqual([iso(at(1)), iso(at(2)), iso(at(3))])
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
    expect(some.body).toHaveLength(3)
  })

  it('pagina deterministicamente (limit/offset, ts asc)', async () => {
    const page0 = await get(`/integration/orders?${windowQ}&limit=1&offset=0`)
    expect(page0.status).toBe(200)
    expect(page0.body).toHaveLength(1)
    expect(page0.body[0]).toMatchObject({ total_gross: 161, ts: iso(at(1)) })

    const page1 = await get(`/integration/orders?${windowQ}&limit=1&offset=1`)
    expect(page1.status).toBe(200)
    expect(page1.body).toHaveLength(1)
    expect(page1.body[0]).toMatchObject({ total_gross: 222, ts: iso(at(2)) })

    // páginas distintas e em ordem de ts
    expect(page1.body[0].id).not.toBe(page0.body[0].id)
    expect(page0.body[0].ts < page1.body[0].ts).toBe(true)
  })

  it('order ligada a um shift expõe operator_user_id do turno', async () => {
    const res = await get(`/integration/orders?${windowQ}&limit=100`)
    const withShift = res.body.find((o: { total_gross: number }) => o.total_gross === 333)
    expect(withShift).toBeDefined()
    expect(withShift.operator_user_id).toBe(operatorId)
  })

  it('não vaza orders de outro tenant na mesma janela', async () => {
    const res = await get(`/integration/orders?${windowQ}&limit=100`)
    expect(res.status).toBe(200)
    expect(res.body.some((o: { id: string }) => o.id === foreignOrderId)).toBe(false)
    expect(res.body.every((o: { kasse_id: string }) => o.kasse_id === 'demo-kasse')).toBe(true)
  })

  it('GET /integration/shifts devolve o turno seedado com user_id/kasse_id/status/opened_at', async () => {
    const res = await get(`/integration/shifts?${windowQ}`)
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0]).toMatchObject({
      id: shiftId,
      kasse_id: 'demo-kasse',
      user_id: operatorId,
      status: 'open',
      opened_at: iso(at(1)),
      closed_at: null,
    })
  })
})
