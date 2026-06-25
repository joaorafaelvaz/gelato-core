import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AppModule } from '../src/app.module'

const KASSE = 'kasse-1b-capstone'

function sale(
  shiftId: string,
  mode: 'im_haus' | 'ausser_haus',
  net: number,
  mwst: number,
  gross: number,
  rate: number,
  code: string,
): Record<string, unknown> {
  return {
    client_event_id: crypto.randomUUID(),
    type: 'sale',
    kasse_id: KASSE,
    payload: {
      order: { mode, shift_id: shiftId, total_net: net, total_mwst: mwst, total_gross: gross },
      items: [{ product_id: 'p1', qty: 1, unit_net: net, mwst_rate: rate, mwst_code: code }],
      payment: { method: 'cash', amount: gross },
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

describe('CAPSTONE 1b: shift -> sales -> cash -> X -> close -> Z (e2e)', () => {
  let app: INestApplication
  let server: ReturnType<INestApplication['getHttpServer']>
  let prisma: PrismaClient
  let token: string

  beforeAll(async () => {
    prisma = new PrismaClient()
    await prisma.kasse.upsert({
      where: { id: KASSE },
      update: {},
      create: { id: KASSE, betriebsstaetteId: 'demo-bs', name: 'Capstone Kasse' },
    })
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = moduleRef.createNestApplication()
    await app.init()
    server = app.getHttpServer()
    token = (
      await request(server).post('/auth/login').send({ email: 'admin@demo.test', password: 'admin123' })
    ).body.access_token
  }, 30000)

  afterAll(async () => {
    await prisma?.$disconnect()
    await app?.close()
  })

  const auth = () => ({ Authorization: `Bearer ${token}` })

  it('ties the whole Tagesablauf together with correct Differenz and Z totals', async () => {
    // Z de reset: zera o período (z_reports é append-only entre runs)
    const base = (await request(server).post('/pos/reports/z').set(auth()).send({ kasse_id: KASSE })).body
      .seqNr as number

    // Abre turno com 100,00 € de float
    const opened = await request(server)
      .post('/pos/shifts/open')
      .set(auth())
      .send({ kasse_id: KASSE, opening_float: 10000 })
    const shiftId = opened.body.id as string

    // Duas vendas no turno: im_haus 19% (476) e ausser_haus 7% (321)
    await request(server).post('/pos/sync').set(auth()).send(sale(shiftId, 'im_haus', 400, 76, 476, 0.19, 'standard_19'))
    await request(server).post('/pos/sync').set(auth()).send(sale(shiftId, 'ausser_haus', 300, 21, 321, 0.07, 'reduced_7'))

    // Sangria de 30,00 €
    await request(server)
      .post(`/pos/shifts/${shiftId}/cash-movement`)
      .set(auth())
      .send({ type: 'sangria', amount: 3000 })

    // X-Bericht: snapshot com as duas vendas (não persiste)
    const x = await request(server).post('/pos/reports/x').set(auth()).send({ kasse_id: KASSE })
    expect(x.body.totals.totalGross).toBe(797)
    expect(x.body.totals.byVatRate).toEqual([
      { rate: 0.07, net: 300, mwst: 21, gross: 321 },
      { rate: 0.19, net: 400, mwst: 76, gross: 476 },
    ])

    // Fecha turno: esperado = 10000 + 797 (vendas cash) - 3000 (sangria) = 7797
    const closed = await request(server)
      .post(`/pos/shifts/${shiftId}/close`)
      .set(auth())
      .send({ counted: 7797 })
    expect(closed.body.expected).toBe(7797)
    expect(closed.body.differenz).toBe(0)

    // Z-Bericht: numerado (base+1), cobre as duas vendas, totais batem com o ledger
    const zb = await request(server).post('/pos/reports/z').set(auth()).send({ kasse_id: KASSE })
    expect(zb.body.seqNr).toBe(base + 1)
    expect(zb.body.totals.totalGross).toBe(797)
    expect(zb.body.totals.byPayment).toEqual([{ method: 'cash', amount: 797 }])
    expect(zb.body.totals.byVatRate).toEqual([
      { rate: 0.07, net: 300, mwst: 21, gross: 321 },
      { rate: 0.19, net: 400, mwst: 76, gross: 476 },
    ])

    // Novo dia: mais uma venda → Z (base+2) cobre SÓ a nova
    await request(server).post('/pos/sync').set(auth()).send(sale(shiftId, 'im_haus', 400, 76, 476, 0.19, 'standard_19'))
    const zc = await request(server).post('/pos/reports/z').set(auth()).send({ kasse_id: KASSE })
    expect(zc.body.seqNr).toBe(base + 2)
    expect(zc.body.totals.totalGross).toBe(476)
  })
})
