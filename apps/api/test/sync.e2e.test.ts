import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AppModule } from '../src/app.module'

function makeEvent(clientEventId: string): Record<string, unknown> {
  return {
    client_event_id: clientEventId,
    type: 'sale',
    kasse_id: 'demo-kasse',
    payload: {
      order: { mode: 'im_haus', total_net: 300, total_mwst: 57, total_gross: 357 },
      items: [{ product_id: 'p1', qty: 2, unit_net: 150, mwst_rate: 0.19, mwst_code: 'standard_19' }],
      payment: { method: 'cash', amount: 357 },
      receipt: { qr_payload: 'V0;TSE-1;Kassenbeleg-V1;...', format: 'digital' },
      tse_transaction: {
        tx_number: 1,
        signature_counter: 1,
        signature_value: 'SIG',
        log_time: '2026-06-24T10:00:00.000Z',
        process_type: 'Kassenbeleg-V1',
        serial_number: 'TSE-1',
        public_key: 'PUB',
      },
    },
  }
}

describe('/pos/sync (e2e)', () => {
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

  async function operatorToken(): Promise<string> {
    const res = await request(server).post('/auth/pin').send({ kasse_id: 'demo-kasse', pin: '1234' })
    return res.body.access_token
  }

  async function lageristToken(): Promise<string> {
    const res = await request(server)
      .post('/auth/login')
      .send({ email: 'lager@demo.test', password: 'lager123' })
    return res.body.access_token
  }

  it('persists a sale and is idempotent on the same client_event_id', async () => {
    const token = await operatorToken()
    // id novo a cada run: orders são append-only (não podem ser limpos entre runs)
    const event = makeEvent(crypto.randomUUID())

    const first = await request(server)
      .post('/pos/sync')
      .set('Authorization', `Bearer ${token}`)
      .send(event)
    expect(first.status).toBe(200)
    expect(first.body.duplicate).toBe(false)
    expect(first.body.orderId).toBeTruthy()

    const second = await request(server)
      .post('/pos/sync')
      .set('Authorization', `Bearer ${token}`)
      .send(event)
    expect(second.status).toBe(200)
    expect(second.body.duplicate).toBe(true)
    expect(second.body.orderId).toBe(first.body.orderId)
  })

  it('rejects a caller without pos.sale.create (403)', async () => {
    const token = await lageristToken()
    const res = await request(server)
      .post('/pos/sync')
      .set('Authorization', `Bearer ${token}`)
      .send(makeEvent('33333333-3333-4333-8333-333333333333'))
    expect(res.status).toBe(403)
  })

  it('rejects an invalid event body (400)', async () => {
    const token = await operatorToken()
    const res = await request(server)
      .post('/pos/sync')
      .set('Authorization', `Bearer ${token}`)
      .send({ client_event_id: 'not-a-uuid', type: 'sale' })
    expect(res.status).toBe(400)
  })

  it('rejects without a token (401)', async () => {
    const res = await request(server).post('/pos/sync').send(makeEvent('44444444-4444-4444-8444-444444444444'))
    expect(res.status).toBe(401)
  })
})
