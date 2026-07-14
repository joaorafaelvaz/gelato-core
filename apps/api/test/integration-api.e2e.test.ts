import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AppModule } from '../src/app.module'

describe('/integration/* (e2e)', () => {
  let app: INestApplication
  let server: ReturnType<INestApplication['getHttpServer']>
  let token: string
  let operatorToken: string

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = moduleRef.createNestApplication()
    await app.init()
    server = app.getHttpServer()
    const jwt = app.get(JwtService)
    token = jwt.sign({
      sub: 'svc-test', tenant_id: 'demo-tenant',
      permissions: ['integration.read'], escalated: false,
    })
    // Rota real: @Controller('auth') + @Post('pin') → POST /auth/pin (ver auth.controller.ts)
    const login = await request(server)
      .post('/auth/pin')
      .send({ kasse_id: 'demo-kasse', pin: '1234' })
    operatorToken = login.body.access_token
  }, 30000)

  afterAll(async () => {
    await app?.close()
  })

  const get = (path: string, t = token) =>
    request(server).get(path).set('Authorization', `Bearer ${t}`)

  it('rejeita sem token (401) e sem permissão (403)', async () => {
    expect((await request(server).get('/integration/stores')).status).toBe(401)
    expect((await get('/integration/stores', operatorToken)).status).toBe(403)
  })

  it('GET /integration/stores devolve Kassen com moeda/fuso constantes', async () => {
    const res = await get('/integration/stores')
    expect(res.status).toBe(200)
    const demo = res.body.find((s: { id: string }) => s.id === 'demo-kasse')
    expect(demo).toMatchObject({ currency: 'EUR', timezone: 'Europe/Berlin' })
  })

  it('GET /integration/products devolve net e gross im_haus em cents', async () => {
    const res = await get('/integration/products')
    expect(res.status).toBe(200)
    const eis = res.body.find((p: { name: string }) => p.name === 'Eiskugel')
    // seed: netCents 150, im_haus standard_19 → gross = 150 + round(150*0.19) = 179
    expect(eis).toMatchObject({ net_cents: 150, gross_cents_im_haus: 179 })
  })

  it('GET /integration/staff devolve operadores do tenant', async () => {
    const res = await get('/integration/staff')
    expect(res.status).toBe(200)
    expect(res.body.some((u: { name: string }) => u.name === 'Operator')).toBe(true)
    expect(res.body[0]).toHaveProperty('active')
    expect(res.body[0]).not.toHaveProperty('email') // sem PII desnecessária
  })

  it('GET /integration/events pagina por cursor em ordem de seq', async () => {
    const res = await get('/integration/events?after=0&limit=500')
    expect(res.status).toBe(200)
    const seqs = res.body.map((e: { seq: number }) => e.seq)
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs)
    if (res.body.length > 1) {
      const cut = seqs[0]
      const res2 = await get(`/integration/events?after=${cut}&limit=500`)
      expect(res2.body.every((e: { seq: number }) => e.seq > cut)).toBe(true)
    }
  })

  it('GET /integration/events rejeita params inválidos com 400', async () => {
    for (const q of ['after=abc', 'limit=0', 'limit=1001']) {
      expect((await get(`/integration/events?${q}`)).status, q).toBe(400)
    }
  })
})
