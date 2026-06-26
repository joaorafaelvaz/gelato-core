import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import type { AddressInfo } from 'node:net'
import { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { LocalRepo, finalizeSale, runOutboxOnce, HttpSyncClient, type SyncClient } from '@gelato/pos-terminal'
import { FakeTseProvider, AusfallTracker, type TaxRate } from '@gelato/compliance'
import { AppModule } from '../src/app.module'

/**
 * CAPSTONE do Ciclo 0: a venda atravessa o stack DE VERDADE — finalizada no
 * terminal (local + outbox), enviada por HTTP real ao /pos/sync, persistida no
 * ledger imutável, e idempotente atravessando o limite HTTP (offline -> reconecta).
 */
describe('terminal -> central ledger (real HTTP e2e)', () => {
  let app: INestApplication
  let baseUrl: string
  let token: string
  let prisma: PrismaClient

  const rates: TaxRate[] = [
    { code: 'standard_19', rate: 0.19, validFrom: new Date('2020-01-01') },
    { code: 'reduced_7', rate: 0.07, validFrom: new Date('2020-01-01') },
  ]

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

  it('finalizes locally, survives an outage, then syncs idempotently to the immutable ledger', async () => {
    const repo = new LocalRepo()
    const at = new Date('2026-06-24T12:00:00.000Z')
    const eid = crypto.randomUUID()

    const { event } = await finalizeSale({
      cart: [
        {
          product: {
            id: 'p1',
            name: 'Eiskugel',
            netCents: 200,
            mwstCodeImHaus: 'standard_19',
            mwstCodeAusserHaus: 'reduced_7',
          },
          qty: 2,
        },
      ],
      mode: 'im_haus',
      at,
      rates,
      kasseId: 'demo-kasse',
      tseClientId: 'c1',
      tse: new FakeTseProvider({ clock: () => at }),
      repo,
      seller: { name: 'Demo' },
      tracker: new AusfallTracker(),
      idGen: () => eid,
    })
    expect(event.client_event_id).toBe(eid)

    // 1) Rede caída: cliente que falha mantém o evento pendente (com backoff).
    const downClient: SyncClient = { post: () => Promise.reject(new Error('offline')) }
    const r0 = await runOutboxOnce(repo, downClient, at.getTime())
    expect(r0).toEqual({ sent: 0, failed: 1 })

    // 2) Reconecta: HttpSyncClient real faz POST /pos/sync.
    const client = new HttpSyncClient(baseUrl, token)
    const r1 = await runOutboxOnce(repo, client, at.getTime() + 60_000)
    expect(r1.sent).toBe(1)
    expect(repo.countOutbox('sent')).toBe(1)

    // O ledger imutável central tem a venda.
    const order = await prisma.order.findUnique({ where: { clientEventId: eid } })
    expect(order?.totalGross).toBe(476)

    // 3) Reenvio do mesmo evento → central responde idempotente, sem duplicar.
    const dup = await client.post(event)
    expect(dup.duplicate).toBe(true)
    expect(await prisma.order.count({ where: { clientEventId: eid } })).toBe(1)
  })
})
