import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AppModule } from '../src/app.module'
import { PrismaService } from '../src/prisma/prisma.service'
import { LedgerService } from '../src/pos/ledger.service'
import type { SaleEvent } from '@gelato/domain'

function makeSale(clientEventId: string): SaleEvent {
  return {
    client_event_id: clientEventId,
    kasse_id: 'demo-kasse',
    type: 'sale',
    payload: {
      order: {
        mode: 'ausser_haus',
        total_net: 150,
        total_mwst: 11,
        total_gross: 161,
      },
      items: [
        { product_id: 'prod-x', qty: 1, unit_net: 150, mwst_rate: 0.07, mwst_code: 'reduced_7' },
      ],
      payment: { method: 'cash', amount: 161 },
      receipt: { qr_payload: 'test-qr' },
      // Ausfall: venda válida sem assinatura TSE (evita mock do provider no teste)
      tse_transaction: { is_ausfall: true, serial_number: 'TEST', public_key: 'TEST' },
    },
  } as SaleEvent
}

describe('outbox integration_events (e2e)', () => {
  let app: INestApplication
  let ledger: LedgerService
  let prisma: PrismaService

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = moduleRef.createNestApplication()
    await app.init()
    ledger = app.get(LedgerService)
    prisma = app.get(PrismaService)
  }, 30000)

  afterAll(async () => {
    await app?.close()
  })

  // Outros e2e rodam em paralelo no mesmo banco e (após esta task) também emitem
  // order.finalized — todas as asserções filtram pelo order.id DESTA venda.
  async function eventsForOrder(orderId: string) {
    const all = await prisma.integrationEvent.findMany({ where: { type: 'order.finalized' } })
    return all.filter((e) => (e.payload as { order: { id: string } }).order.id === orderId)
  }

  it('ingest emite order.finalized com payload denormalizado', async () => {
    const ceid = crypto.randomUUID()
    const result = await ledger.ingest(makeSale(ceid), { userId: 'test' })
    expect(result.duplicate).toBe(false)

    const evts = await eventsForOrder(result.orderId)
    expect(evts).toHaveLength(1)
    const payload = evts[0].payload as {
      order: { id: string; total_gross: number; operator_user_id: string | null }
      items: { id: string; product_id: string; qty: number }[]
      payments: { id: string; method: string; amount: number }[]
    }
    expect(payload.order.total_gross).toBe(161)
    expect(payload.order.operator_user_id).toBeNull() // sem shift
    expect(payload.items).toHaveLength(1)
    expect(payload.items[0].id).toBeTruthy() // cuid real do OrderItem
    expect(payload.payments[0].method).toBe('cash')
  })

  it('ingest duplicado NÃO emite segundo evento', async () => {
    const ceid = crypto.randomUUID()
    const first = await ledger.ingest(makeSale(ceid), { userId: 'test' })
    const dup = await ledger.ingest(makeSale(ceid), { userId: 'test' })
    expect(dup.duplicate).toBe(true)
    expect(await eventsForOrder(first.orderId)).toHaveLength(1)
  })

  it('falha APÓS o emit → NADA sobrevive (order, sync_event e evento no mesmo rollback)', async () => {
    // Injeção de falha escolhida: customer_id inexistente → earnLoyalty (que roda
    // DEPOIS do integrationEvent.create, na mesma transação) cria uma LoyaltyEntry
    // cujo customerId tem FK para customers → violação de FK determinística.
    // Alternativa descartada: voucher_code desconhecido NÃO serve — em
    // recordVoucherRedemption um código não encontrado retorna em silêncio.
    // earnLoyalty só grava se o programa do tenant estiver ativo com taxas > 0;
    // como loyalty.e2e.test.ts alterna active on/off no tenant demo em paralelo,
    // usamos uma Kasse isolada (tenant próprio, programa SEMPRE ativo 1/1) para
    // que o throw pós-emit seja determinístico.
    const suffix = crypto.randomUUID().slice(0, 8)
    const tenant = await prisma.tenant.create({ data: { name: `atomicity-${suffix}` } })
    await prisma.loyaltyProgram.create({
      data: { tenantId: tenant.id, pointsPerEuro: 1, stampsPerItem: 1, active: true },
    })
    const bs = await prisma.betriebsstaette.create({ data: { tenantId: tenant.id, name: 'bs-atomicity' } })
    const kasse = await prisma.kasse.create({ data: { betriebsstaetteId: bs.id, name: 'k-atomicity' } })

    const ceid = crypto.randomUUID()
    const sentinel = `atomicity-${ceid}` // OrderItem.productId não tem FK → sentinela segura
    const sale = makeSale(ceid)
    sale.kasse_id = kasse.id
    sale.payload.order.customer_id = `missing-customer-${suffix}` // FK violada em loyalty_entries
    sale.payload.items[0].product_id = sentinel

    await expect(ledger.ingest(sale, { userId: 'test' })).rejects.toThrow()

    // Rollback conjunto: nem a order, nem o sync_event, nem o evento da outbox.
    expect(await prisma.order.findUnique({ where: { clientEventId: ceid } })).toBeNull()
    expect(await prisma.syncEvent.findUnique({ where: { clientEventId: ceid } })).toBeNull()
    const all = await prisma.integrationEvent.findMany({ where: { type: 'order.finalized' } })
    const leaked = all.filter(
      (e) => (e.payload as { items?: { product_id: string }[] }).items?.[0]?.product_id === sentinel,
    )
    expect(leaked).toHaveLength(0)
  })
})
