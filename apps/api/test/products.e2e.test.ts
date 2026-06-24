import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AppModule } from '../src/app.module'

describe('products + tax-rates (e2e)', () => {
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

  async function operatorToken(): Promise<string> {
    const res = await request(server).post('/auth/pin').send({ kasse_id: 'demo-kasse', pin: '1234' })
    return res.body.access_token
  }

  it('lists the seeded product for the caller tenant', async () => {
    const token = await adminToken()
    const res = await request(server).get('/products').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.map((p: { name: string }) => p.name)).toContain('Eiskugel')
  })

  it('returns the tenant tax-rates', async () => {
    const token = await adminToken()
    const res = await request(server).get('/tax-rates').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.map((r: { code: string }) => r.code).sort()).toEqual(['reduced_7', 'standard_19'])
  })

  it('admin (product.manage) can create a product', async () => {
    const token = await adminToken()
    const res = await request(server)
      .post('/products')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Espresso',
        netCents: 200,
        mwstCodeImHaus: 'standard_19',
        mwstCodeAusserHaus: 'standard_19',
      })
    expect(res.status).toBe(201)
    expect(res.body.name).toBe('Espresso')
    expect(res.body.tenantId).toBe('demo-tenant')
  })

  it('operator (no product.manage) cannot create a product (403)', async () => {
    const token = await operatorToken()
    const res = await request(server)
      .post('/products')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'X',
        netCents: 1,
        mwstCodeImHaus: 'standard_19',
        mwstCodeAusserHaus: 'standard_19',
      })
    expect(res.status).toBe(403)
  })
})
