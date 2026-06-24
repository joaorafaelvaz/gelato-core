import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AppModule } from '../src/app.module'
import { runSeed } from '../prisma/seed'

describe('auth + rbac (e2e)', () => {
  let app: INestApplication
  let server: ReturnType<INestApplication['getHttpServer']>

  beforeAll(async () => {
    await runSeed()
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

  it('logs in admin by password and includes admin.users in permissions', async () => {
    const res = await request(server)
      .post('/auth/login')
      .send({ email: 'admin@demo.test', password: 'admin123' })
    expect(res.status).toBe(200)
    expect(res.body.access_token).toBeTruthy()
    expect(res.body.permissions).toContain('admin.users')
  })

  it('rejects wrong password with 401', async () => {
    const res = await request(server)
      .post('/auth/login')
      .send({ email: 'admin@demo.test', password: 'nope' })
    expect(res.status).toBe(401)
  })

  it('rejects malformed login body with 400', async () => {
    const res = await request(server).post('/auth/login').send({ email: 'not-an-email' })
    expect(res.status).toBe(400)
  })

  it('logs in operator by PIN with operator permissions (no admin)', async () => {
    const res = await request(server).post('/auth/pin').send({ kasse_id: 'demo-kasse', pin: '1234' })
    expect(res.status).toBe(200)
    expect(res.body.permissions).toContain('pos.sale.create')
    expect(res.body.permissions).not.toContain('admin.users')
  })

  it('rejects wrong PIN with 401', async () => {
    const res = await request(server).post('/auth/pin').send({ kasse_id: 'demo-kasse', pin: '0000' })
    expect(res.status).toBe(401)
  })

  it('GET /me requires a token (401 without)', async () => {
    const res = await request(server).get('/me')
    expect(res.status).toBe(401)
  })

  it('GET /me returns the caller permissions', async () => {
    const token = await operatorToken()
    const res = await request(server).get('/me').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.permissions).toContain('pos.sale.create')
  })

  it('blocks operator from an admin-only route (403)', async () => {
    const token = await operatorToken()
    const res = await request(server).get('/admin/ping').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(403)
  })

  it('allows admin on the admin-only route (200)', async () => {
    const token = await adminToken()
    const res = await request(server).get('/admin/ping').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true })
  })

  it('escalates an operator session with the correct password', async () => {
    const token = await operatorToken()
    const res = await request(server)
      .post('/auth/escalate')
      .set('Authorization', `Bearer ${token}`)
      .send({ password: 'op123' })
    expect(res.status).toBe(200)
    expect(res.body.access_token).toBeTruthy()
  })
})
