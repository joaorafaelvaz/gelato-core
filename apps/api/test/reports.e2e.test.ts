import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AppModule } from '../src/app.module'

const KASSE = 'kasse-1b-reports' // Kasse dedicada — isola da concorrência entre arquivos de teste

function saleAusser(clientEventId: string): Record<string, unknown> {
  return {
    client_event_id: clientEventId,
    type: 'sale',
    kasse_id: KASSE,
    payload: {
      order: { mode: 'ausser_haus', total_net: 300, total_mwst: 21, total_gross: 321 },
      items: [{ product_id: 'p1', qty: 1, unit_net: 300, mwst_rate: 0.07, mwst_code: 'reduced_7' }],
      payment: { method: 'cash', amount: 321 },
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

describe('X/Z reports (e2e)', () => {
  let app: INestApplication
  let server: ReturnType<INestApplication['getHttpServer']>
  let prisma: PrismaClient

  beforeAll(async () => {
    prisma = new PrismaClient()
    await prisma.kasse.upsert({
      where: { id: KASSE },
      update: {},
      create: { id: KASSE, betriebsstaetteId: 'demo-bs', name: 'Reports Test Kasse' },
    })
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = moduleRef.createNestApplication()
    await app.init()
    server = app.getHttpServer()
  }, 30000)

  afterAll(async () => {
    await prisma?.$disconnect()
    await app?.close()
  })

  const adminToken = async () =>
    (await request(server).post('/auth/login').send({ email: 'admin@demo.test', password: 'admin123' }))
      .body.access_token as string

  const z = (token: string) =>
    request(server).post('/pos/reports/z').set('Authorization', `Bearer ${token}`).send({ kasse_id: KASSE })
  const x = (token: string) =>
    request(server).post('/pos/reports/x').set('Authorization', `Bearer ${token}`).send({ kasse_id: KASSE })
  const sale = (token: string) =>
    request(server).post('/pos/sync').set('Authorization', `Bearer ${token}`).send(saleAusser(crypto.randomUUID()))

  it('continuous Z-Nr; Z covers only sales since the previous Z; X is read-only; concurrency-safe', async () => {
    const token = await adminToken()

    // Z_a: limpa o período até agora; captura o seqNr base (z_reports é append-only entre runs)
    const za = await z(token)
    expect(za.status).toBe(200)
    const base = za.body.seqNr as number

    // uma venda ausser_haus (7%) → Z_b cobre só ela
    await sale(token)
    const zb = await z(token)
    expect(zb.body.seqNr).toBe(base + 1)
    expect(zb.body.totals.totalGross).toBe(321)
    expect(zb.body.totals.byVatRate).toEqual([{ rate: 0.07, net: 300, mwst: 21, gross: 321 }])
    expect(zb.body.totals.byPayment).toEqual([{ method: 'cash', amount: 321 }])

    // X não consome número: o próximo Z é base+2 (não base+3)
    const xr = await x(token)
    expect(xr.status).toBe(200)
    expect(xr.body.totals).toBeDefined()
    const zc = await z(token)
    expect(zc.body.seqNr).toBe(base + 2)

    // Concorrência: dois Z em paralelo → seqNrs distintos e consecutivos, sem duplicata
    await sale(token)
    const [r1, r2] = await Promise.all([z(token), z(token)])
    expect(r1.status).toBe(200)
    expect(r2.status).toBe(200)
    const seqs = [r1.body.seqNr, r2.body.seqNr].sort((a, b) => a - b)
    expect(seqs).toEqual([base + 3, base + 4])
  })

  it('rejects Z without pos.report.z (403) but allows X for an operator', async () => {
    const op = (
      await request(server).post('/auth/pin').send({ kasse_id: 'demo-kasse', pin: '1234' })
    ).body.access_token as string
    expect((await z(op)).status).toBe(403)
    expect((await x(op)).status).toBe(200)
  })
})
