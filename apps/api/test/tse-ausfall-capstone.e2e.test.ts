import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import type { AddressInfo } from 'node:net'
import { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { LocalRepo, finalizeSale, runOutboxOnce, HttpSyncClient } from '@gelato/pos-terminal'
import { FakeTseProvider, FailingTseProvider, AusfallTracker, type TaxRate } from '@gelato/compliance'
import { AppModule } from '../src/app.module'

/**
 * CAPSTONE 1d: apagão da TSE → recuperação, atravessando o stack DE VERDADE.
 * 2 vendas durante o Ausfall (gravadas SEM assinatura, period started uma vez) →
 * TSE volta → venda assinada + period ended uma vez. O outbox sincroniza por HTTP
 * real ao ledger imutável; reenviar não duplica (idempotente).
 */
describe('TSE-Ausfall capstone (terminal -> real HTTP -> ledger)', () => {
  let app: INestApplication
  let baseUrl: string
  let token: string
  let prisma: PrismaClient
  const KASSE = 'kasse-1d-capstone'

  const rates: TaxRate[] = [
    { code: 'standard_19', rate: 0.19, validFrom: new Date('2020-01-01') },
    { code: 'reduced_7', rate: 0.07, validFrom: new Date('2020-01-01') },
  ]
  const cart = [
    {
      product: {
        id: 'p1',
        name: 'Eiskugel',
        netCents: 100,
        mwstCodeImHaus: 'standard_19',
        mwstCodeAusserHaus: 'reduced_7',
      },
      qty: 1,
    },
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
    // Kasse dedicada → isola a contagem de orders/log dos demais arquivos de teste.
    const bs = await prisma.betriebsstaette.findFirst()
    await prisma.kasse.upsert({
      where: { id: KASSE },
      update: {},
      create: { id: KASSE, name: '1d capstone', betriebsstaetteId: bs!.id },
    })
  }, 30000)

  afterAll(async () => {
    await prisma?.$disconnect()
    await app?.close()
  })

  it('blackout then recovery: ausfall sales + paired started/ended, idempotent', async () => {
    const repo = new LocalRepo()
    const tracker = new AusfallTracker()
    const base = {
      cart,
      mode: 'ausser_haus' as const,
      rates,
      kasseId: KASSE,
      tseClientId: 'c1',
      seller: { name: 'Demo' },
      repo,
      tracker,
    }

    // 2 vendas durante o apagão (TSE lança → Ausfall)
    await finalizeSale({ ...base, at: new Date('2026-06-25T10:00:00Z'), tse: new FailingTseProvider('down') })
    await finalizeSale({ ...base, at: new Date('2026-06-25T10:01:00Z'), tse: new FailingTseProvider('down') })
    // recuperação: venda assinada
    await finalizeSale({
      ...base,
      at: new Date('2026-06-25T10:05:00Z'),
      tse: new FakeTseProvider({ serialNumber: 'X', clock: () => new Date('2026-06-25T10:05:00Z') }),
    })

    const client = new HttpSyncClient(baseUrl, token)
    const r1 = await runOutboxOnce(repo, client)
    expect(r1.sent).toBe(5) // 3 vendas + started + ended
    const r2 = await runOutboxOnce(repo, client) // 2ª passada: nada pendente
    expect(r2.sent).toBe(0)

    const orders = await prisma.order.findMany({
      where: { kasseId: KASSE },
      include: { tseTransaction: true },
    })
    expect(orders).toHaveLength(3)
    expect(orders.filter((o) => o.tseTransaction?.isAusfall)).toHaveLength(2)

    const log = await prisma.tseAusfallLog.findMany({ where: { kasseId: KASSE }, orderBy: { at: 'asc' } })
    expect(log.map((l) => l.eventType)).toEqual(['started', 'ended'])

    repo.close()
  })
})
