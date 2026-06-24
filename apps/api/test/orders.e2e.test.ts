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
      order: { mode: 'ausser_haus', total_net: 200, total_mwst: 14, total_gross: 214 },
      items: [{ product_id: 'p1', qty: 1, unit_net: 200, mwst_rate: 0.07, mwst_code: 'reduced_7' }],
      payment: { method: 'cash', amount: 214 },
      receipt: { qr_payload: 'V0;...' },
      tse_transaction: {
        tx_number: 1,
        signature_counter: 1,
        signature_value: 'SIG',
        log_time: '2026-06-24T10:00:00.000Z',
      },
    },
  }
}

describe('GET /orders (e2e)', () => {
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

  async function adminToken(): Promise<string> {
    const res = await request(server)
      .post('/auth/login')
      .send({ email: 'admin@demo.test', password: 'admin123' })
    return res.body.access_token
  }

  it('lists ledger orders for the tenant after a sale lands', async () => {
    const token = await adminToken()
    const eid = crypto.randomUUID()
    await request(server)
      .post('/pos/sync')
      .set('Authorization', `Bearer ${token}`)
      .send(makeEvent(eid))

    const res = await request(server).get('/orders').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
    expect(res.body.some((o: { totalGross: number }) => o.totalGross === 214)).toBe(true)
  })

  it('rejects a caller without pos.report.x (403)', async () => {
    const login = await request(server)
      .post('/auth/login')
      .send({ email: 'lager@demo.test', password: 'lager123' })
    const res = await request(server)
      .get('/orders')
      .set('Authorization', `Bearer ${login.body.access_token}`)
    expect(res.status).toBe(403)
  })
})
