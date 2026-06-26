import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import type { AddressInfo } from 'node:net'
import { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AppModule } from '../src/app.module'

/**
 * Ingestão de Ausfall no /pos/sync: (a) eventos tse_ausfall vão para o log fiscal
 * append-only, idempotentes; (b) uma venda com is_ausfall é gravada SEM assinatura
 * (guard relaxado). HTTP real, ledger real.
 */
describe('TSE-Ausfall ingest (e2e)', () => {
  let app: INestApplication
  let baseUrl: string
  let token: string
  let prisma: PrismaClient

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = moduleRef.createNestApplication()
    await app.listen(0)
    const port = (app.getHttpServer().address() as AddressInfo).port
    baseUrl = `http://127.0.0.1:${port}`
    const res = await fetch(`${baseUrl}/auth/pin`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kasse_id: 'demo-kasse', pin: '1234' }),
    })
    token = ((await res.json()) as { access_token: string }).access_token
    prisma = new PrismaClient()
  }, 30000)

  afterAll(async () => {
    await prisma?.$disconnect()
    await app?.close()
  })

  const post = (body: unknown): Promise<Response> =>
    fetch(`${baseUrl}/pos/sync`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    })

  it('persists an ausfall started event into tse_ausfall_log + audit, idempotently', async () => {
    const id = crypto.randomUUID()
    const event = {
      client_event_id: id,
      type: 'tse_ausfall',
      kasse_id: 'demo-kasse',
      payload: { event_type: 'started', at: '2026-06-25T10:00:00Z', reason: 'timeout' },
    }
    const r1 = await post(event)
    expect(r1.status).toBe(200)
    expect(((await r1.json()) as { duplicate: boolean }).duplicate).toBe(false)

    const r2 = await post(event)
    expect(((await r2.json()) as { duplicate: boolean }).duplicate).toBe(true)

    const rows = await prisma.tseAusfallLog.findMany({ where: { clientEventId: id } })
    expect(rows).toHaveLength(1)
    expect(rows[0].eventType).toBe('started')

    const audit = await prisma.auditLog.findMany({ where: { entityId: id } })
    expect(audit.some((a) => a.action === 'tse.ausfall.started')).toBe(true)
  })

  it('ingests an ausfall sale (no signature) when is_ausfall is true', async () => {
    const id = crypto.randomUUID()
    const saleEvent = {
      client_event_id: id,
      type: 'sale',
      kasse_id: 'demo-kasse',
      payload: {
        order: { mode: 'ausser_haus', total_net: 100, total_mwst: 7, total_gross: 107 },
        items: [{ product_id: 'p1', qty: 1, unit_net: 100, mwst_rate: 0.07, mwst_code: 'reduced' }],
        payment: { method: 'cash', amount: 107 },
        receipt: { qr_payload: '', format: 'digital' },
        tse_transaction: { is_ausfall: true },
      },
    }
    const r = await post(saleEvent)
    expect(r.status).toBe(200)

    const order = await prisma.order.findUnique({
      where: { clientEventId: id },
      include: { tseTransaction: true },
    })
    expect(order?.tseTransaction?.isAusfall).toBe(true)
    expect(order?.tseTransaction?.signatureValue).toBeNull()
  })

  it('still rejects a non-ausfall sale with incomplete TSE data', async () => {
    const id = crypto.randomUUID()
    const bad = {
      client_event_id: id,
      type: 'sale',
      kasse_id: 'demo-kasse',
      payload: {
        order: { mode: 'ausser_haus', total_net: 100, total_mwst: 7, total_gross: 107 },
        items: [{ product_id: 'p1', qty: 1, unit_net: 100, mwst_rate: 0.07, mwst_code: 'reduced' }],
        payment: { method: 'cash', amount: 107 },
        receipt: { qr_payload: '', format: 'digital' },
        tse_transaction: { tx_number: 1 }, // sem assinatura e sem is_ausfall
      },
    }
    const r = await post(bad)
    expect(r.status).toBe(400)
  })
})
