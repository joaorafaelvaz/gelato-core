import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AppModule } from '../src/app.module'

function saleEvent(clientEventId: string, shiftId: string): Record<string, unknown> {
  return {
    client_event_id: clientEventId,
    type: 'sale',
    kasse_id: 'demo-kasse',
    payload: {
      order: { mode: 'im_haus', shift_id: shiftId, total_net: 400, total_mwst: 76, total_gross: 476 },
      items: [{ product_id: 'p1', qty: 2, unit_net: 200, mwst_rate: 0.19, mwst_code: 'standard_19' }],
      payment: { method: 'cash', amount: 476 },
      receipt: { qr_payload: 'V0;...' },
      tse_transaction: {
        tx_number: 1,
        signature_counter: 1,
        signature_value: 'SIG',
        log_time: '2026-06-25T10:00:00.000Z',
      },
    },
  }
}

describe('shifts (e2e)', () => {
  let app: INestApplication
  let server: ReturnType<INestApplication['getHttpServer']>

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = moduleRef.createNestApplication()
    await app.init()
    server = app.getHttpServer()
  }, 30000)

  afterAll(async () => {
    await app?.close()
  })

  const operator = async () =>
    (await request(server).post('/auth/pin').send({ kasse_id: 'demo-kasse', pin: '1234' })).body
      .access_token as string

  it('full shift lifecycle: open -> drawer -> sangria -> sale -> close with Differenz', async () => {
    const token = await operator()
    const auth = { Authorization: `Bearer ${token}` }

    const opened = await request(server)
      .post('/pos/shifts/open')
      .set(auth)
      .send({ kasse_id: 'demo-kasse', opening_float: 10000 })
    expect(opened.status).toBe(200)
    const shiftId = opened.body.id as string
    expect(opened.body.status).toBe('open')

    expect((await request(server).post('/pos/drawer/open').set(auth)).status).toBe(200)

    const sangria = await request(server)
      .post(`/pos/shifts/${shiftId}/cash-movement`)
      .set(auth)
      .send({ type: 'sangria', amount: 3000, reason: 'troco' })
    expect(sangria.status).toBe(200)

    // venda em dinheiro de 476 ligada ao turno
    await request(server).post('/pos/sync').set(auth).send(saleEvent(crypto.randomUUID(), shiftId))

    // esperado = 10000 (float) + 476 (vendas cash) - 3000 (sangria) = 7476
    const closed = await request(server)
      .post(`/pos/shifts/${shiftId}/close`)
      .set(auth)
      .send({ counted: 7476 })
    expect(closed.status).toBe(200)
    expect(closed.body.status).toBe('closed')
    expect(closed.body.expected).toBe(7476)
    expect(closed.body.differenz).toBe(0)
  })

  it('rejects opening a shift without pos.shift.open (403)', async () => {
    const login = await request(server)
      .post('/auth/login')
      .send({ email: 'lager@demo.test', password: 'lager123' })
    const res = await request(server)
      .post('/pos/shifts/open')
      .set('Authorization', `Bearer ${login.body.access_token}`)
      .send({ kasse_id: 'demo-kasse', opening_float: 0 })
    expect(res.status).toBe(403)
  })
})
