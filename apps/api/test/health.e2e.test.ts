import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AppModule } from '../src/app.module'

// Verifica a toolchain de ponta a ponta: SWC (metadata de decorators) + DI do Nest
// + PrismaService (conecta como gelato_app) + HTTP.
describe('health (e2e)', () => {
  let app: INestApplication

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = moduleRef.createNestApplication()
    await app.init()
  })

  afterAll(async () => {
    await app?.close()
  })

  it('GET /health returns ok and reaches Postgres', async () => {
    const res = await request(app.getHttpServer()).get('/health')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ status: 'ok' })
  })
})
