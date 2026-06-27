import { Injectable, ConflictException, NotFoundException, BadRequestException } from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import { aggregateTab, apportionSplit, paidByRate, type TabItemInput } from '@gelato/compliance'
import type { BestellungEvent, SaleEvent } from '@gelato/domain'
import { PrismaService } from '../prisma/prisma.service'
import { LedgerService, type Actor } from '../pos/ledger.service'
import { consumeForSale } from '../stock/consume'

@Injectable()
export class TablesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
  ) {}

  /** Mesas da Betriebsstätte da Kasse + posição (Tischplan) + total da conta aberta. */
  async listTables(kasseId: string) {
    const kasse = await this.prisma.kasse.findUnique({ where: { id: kasseId } })
    if (!kasse) throw new NotFoundException('kasse')
    const tische = await this.prisma.tisch.findMany({
      where: { betriebsstaetteId: kasse.betriebsstaetteId, active: true },
      orderBy: { name: 'asc' },
    })
    const open = await this.prisma.tischsession.findMany({
      where: { status: 'open', tischId: { in: tische.map((t) => t.id) } },
      include: { bestellungen: { include: { items: true } } },
    })
    const byTisch = new Map(
      open.map((s) => {
        const items: TabItemInput[] = s.bestellungen.flatMap((b) =>
          b.items.map((i) => ({ productId: i.productId, qty: i.qty, unitNet: i.unitNet, mwstRate: Number(i.mwstRate), mwstCode: i.mwstCode })),
        )
        return [s.tischId, { sessionId: s.id, total: aggregateTab(items).totalGross }] as const
      }),
    )
    return tische.map((t) => {
      const o = byTisch.get(t.id)
      return { id: t.id, name: t.name, posX: t.posX, posY: t.posY, openSessionId: o?.sessionId ?? null, openTotalGross: o?.total ?? null }
    })
  }

  /** Reposiciona a mesa na planta (operacional/mutável — sem registro fiscal). */
  async updatePosition(id: string, posX: number, posY: number, tenantId: string) {
    const tisch = await this.prisma.tisch.findFirst({ where: { id, betriebsstaette: { tenantId } } })
    if (!tisch) throw new NotFoundException('tisch')
    return this.prisma.tisch.update({ where: { id }, data: { posX, posY } })
  }

  /** Abre uma conta na mesa (≤1 sessão aberta por mesa). */
  async openSession(tischId: string, kasseId: string, userId?: string) {
    const existing = await this.prisma.tischsession.findFirst({ where: { tischId, status: 'open' } })
    if (existing) throw new ConflictException({ message: 'table already open', sessionId: existing.id })
    return this.prisma.tischsession.create({ data: { tischId, kasseId, status: 'open', openedBy: userId } })
  }

  /** Conta corrente da sessão (derivada das Bestellungen) + remanescente (− já pago). */
  async getSession(id: string) {
    const session = await this.prisma.tischsession.findUnique({
      where: { id },
      include: { bestellungen: { include: { items: true } }, orders: { include: { items: true } } },
    })
    if (!session) throw new NotFoundException('session')
    const items: TabItemInput[] = session.bestellungen.flatMap((b) =>
      b.items.map((i) => ({
        productId: i.productId,
        qty: i.qty,
        unitNet: i.unitNet,
        mwstRate: Number(i.mwstRate),
        mwstCode: i.mwstCode,
      })),
    )
    const tab = aggregateTab(items)
    const paid = paidByRate(
      session.orders.map((o) => ({ items: o.items.map((i) => ({ unitNet: i.unitNet, qty: i.qty, mwstRate: Number(i.mwstRate) })) })),
    )
    const paidGross = paid.reduce((s, p) => s + p.gross, 0)
    return {
      id: session.id,
      tischId: session.tischId,
      status: session.status,
      orderId: session.orderId,
      tab,
      remaining: { totalGross: Math.max(0, tab.totalGross - paidGross) },
    }
  }

  /** Lança uma Bestellung (append-only) + sua transação TSE. Idempotente. */
  async addBestellung(sessionId: string, event: BestellungEvent, userId?: string): Promise<{ duplicate: boolean; bestellungId: string }> {
    const seen = await this.prisma.bestellung.findUnique({ where: { clientEventId: event.client_event_id } })
    if (seen) return { duplicate: true, bestellungId: seen.id }
    const session = await this.prisma.tischsession.findUnique({ where: { id: sessionId } })
    if (!session || session.status !== 'open') throw new ConflictException('session not open')

    const te = event.tse_transaction
    const isAusfall = te.is_ausfall === true
    if (!isAusfall && (!te.signature_value || te.signature_counter == null || !te.log_time)) {
      throw new BadRequestException('incomplete TSE transaction data')
    }
    const tab = aggregateTab(
      event.items.map((i) => ({ productId: i.product_id, qty: i.qty, unitNet: i.unit_net, mwstRate: i.mwst_rate, mwstCode: i.mwst_code })),
    )

    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${sessionId}, 0))`
      const last = await tx.bestellung.findFirst({ where: { sessionId }, orderBy: { seqNr: 'desc' } })
      const seqNr = (last?.seqNr ?? 0) + 1
      const b = await tx.bestellung.create({
        data: {
          clientEventId: event.client_event_id,
          sessionId,
          kasseId: event.kasse_id,
          seqNr,
          createdBy: userId,
          totalNet: tab.totalNet,
          totalMwst: tab.totalMwst,
          totalGross: tab.totalGross,
          items: {
            create: event.items.map((i) => ({
              productId: i.product_id,
              variantId: i.variant_id,
              qty: i.qty,
              unitNet: i.unit_net,
              mwstRate: i.mwst_rate,
              mwstCode: i.mwst_code,
              modifiers: i.modifiers as Prisma.InputJsonValue | undefined,
              stornoOf: i.storno_of,
            })),
          },
          tseTransaction: {
            create: {
              txNumber: te.tx_number ?? null,
              signatureCounter: te.signature_counter ?? null,
              signatureValue: te.signature_value ?? null,
              logTime: te.log_time ? new Date(te.log_time) : null,
              processType: te.process_type ?? 'Bestellung-V1',
              serialNumber: te.serial_number,
              publicKey: te.public_key,
              isAusfall,
            },
          },
        },
      })
      // Decremento de estoque (2c): a Bestellung é o ponto de produção do salão.
      await consumeForSale(tx, {
        kasseId: event.kasse_id,
        lines: event.items.map((i) => ({ productId: i.product_id, variantId: i.variant_id ?? null, qty: i.qty })),
        refType: 'bestellung',
        refId: b.id,
      })
      await tx.auditLog.create({
        data: { userId, action: 'pos.bestellung.create', entity: 'bestellung', entityId: b.id, payload: { sessionId, seqNr } },
      })
      return { duplicate: false, bestellungId: b.id }
    })
  }

  /**
   * Fecha a conta: grava o Kassenbeleg imutável (reusa o ledger → resiliência
   * TSE-Ausfall), liga `order` ↔ sessão e marca a sessão `paid`. Idempotente.
   */
  async pay(
    sessionId: string,
    body: { client_event_id: string; amount?: number; payment: { method: 'cash'; amount: number; ref?: string }; tse: Record<string, unknown> },
    actor: Actor,
  ): Promise<{ orderId: string; settled: boolean; remainingGross: number; duplicate: boolean }> {
    const session = await this.prisma.tischsession.findUnique({
      where: { id: sessionId },
      include: { bestellungen: { include: { items: true } }, orders: { include: { items: true } } },
    })
    if (!session) throw new NotFoundException('session')

    // Idempotência: pagamento já gravado → devolve-o.
    const existing = await this.prisma.order.findUnique({ where: { clientEventId: body.client_event_id } })
    if (existing) return { orderId: existing.id, settled: session.status === 'paid', remainingGross: 0, duplicate: true }

    const items: TabItemInput[] = session.bestellungen.flatMap((b) =>
      b.items.map((i) => ({ productId: i.productId, qty: i.qty, unitNet: i.unitNet, mwstRate: Number(i.mwstRate), mwstCode: i.mwstCode })),
    )
    const fullTab = aggregateTab(items)
    const paid = paidByRate(
      session.orders.map((o) => ({ items: o.items.map((i) => ({ unitNet: i.unitNet, qty: i.qty, mwstRate: Number(i.mwstRate) })) })),
    )
    const paidGross = paid.reduce((s, p) => s + p.gross, 0)
    const remainingGross = fullTab.totalGross - paidGross
    if (remainingGross <= 0) throw new ConflictException('session already settled')

    const amount = body.amount ?? remainingGross
    if (amount <= 0 || amount > remainingGross) throw new BadRequestException('invalid amount')

    let eventItems: { product_id: string; qty: number; unit_net: number; mwst_rate: number; mwst_code: string }[]
    let totals: { net: number; mwst: number; gross: number }
    if (amount === remainingGross && session.orders.length === 0) {
      // Pagamento integral sem parciais anteriores → Beleg itemizado real (1a-1).
      const lines = fullTab.lines.filter((l) => l.qty !== 0)
      eventItems = lines.map((l) => ({ product_id: l.productId, qty: l.qty, unit_net: Math.round(l.net / l.qty), mwst_rate: l.mwstRate, mwst_code: l.mwstCode }))
      totals = { net: fullTab.totalNet, mwst: fullTab.totalMwst, gross: fullTab.totalGross }
    } else {
      const split = apportionSplit(fullTab, paid.map((p) => ({ rate: p.rate, net: p.net })), amount)
      eventItems = split.lines.map((l) => ({ product_id: l.productId, qty: l.qty, unit_net: l.unitNet, mwst_rate: l.mwstRate, mwst_code: l.mwstCode }))
      totals = { net: split.totalNet, mwst: split.totalMwst, gross: split.totalGross }
    }

    const saleEvent: SaleEvent = {
      client_event_id: body.client_event_id,
      type: 'sale',
      kasse_id: session.kasseId,
      payload: {
        order: { mode: 'im_haus', table_id: session.tischId, tisch_session_id: session.id, total_net: totals.net, total_mwst: totals.mwst, total_gross: totals.gross },
        items: eventItems,
        payment: { method: 'cash', amount: totals.gross },
        receipt: { qr_payload: '', format: 'digital' },
        tse_transaction: body.tse as SaleEvent['payload']['tse_transaction'],
      },
    }
    const result = await this.ledger.ingest(saleEvent, actor)
    const newRemaining = remainingGross - totals.gross
    if (newRemaining <= 0) {
      await this.prisma.tischsession.update({
        where: { id: sessionId },
        data: { status: 'paid', closedAt: new Date(), orderId: result.orderId },
      })
    }
    return { orderId: result.orderId, settled: newRemaining <= 0, remainingGross: Math.max(0, newRemaining), duplicate: result.duplicate }
  }

  /** Transfere a conta inteira para outra mesa (operacional). Guarda: destino livre. */
  async transfer(sessionId: string, targetTischId: string, userId?: string) {
    const session = await this.prisma.tischsession.findUnique({ where: { id: sessionId } })
    if (!session) throw new NotFoundException('session')
    if (session.status !== 'open') throw new ConflictException('session not open')
    const occupied = await this.prisma.tischsession.findFirst({ where: { tischId: targetTischId, status: 'open' } })
    if (occupied) throw new ConflictException('target table occupied')
    await this.prisma.tischsession.update({ where: { id: sessionId }, data: { tischId: targetTischId } })
    await this.prisma.auditLog.create({
      data: { userId, action: 'pos.table.transfer', entity: 'tischsession', entityId: sessionId, payload: { from: session.tischId, to: targetTischId } },
    })
    return { id: sessionId, tischId: targetTischId }
  }
}
