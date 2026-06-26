import { Injectable, ConflictException, NotFoundException, BadRequestException } from '@nestjs/common'
import { aggregateTab, type TabItemInput } from '@gelato/compliance'
import type { BestellungEvent, SaleEvent } from '@gelato/domain'
import { PrismaService } from '../prisma/prisma.service'
import { LedgerService, type Actor } from '../pos/ledger.service'

@Injectable()
export class TablesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
  ) {}

  /** Mesas da Betriebsstätte da Kasse + a sessão aberta (se houver). */
  async listTables(kasseId: string) {
    const kasse = await this.prisma.kasse.findUnique({ where: { id: kasseId } })
    if (!kasse) throw new NotFoundException('kasse')
    const tische = await this.prisma.tisch.findMany({
      where: { betriebsstaetteId: kasse.betriebsstaetteId, active: true },
      orderBy: { name: 'asc' },
    })
    const open = await this.prisma.tischsession.findMany({
      where: { status: 'open', tischId: { in: tische.map((t) => t.id) } },
    })
    const openByTisch = new Map(open.map((s) => [s.tischId, s.id]))
    return tische.map((t) => ({ id: t.id, name: t.name, openSessionId: openByTisch.get(t.id) ?? null }))
  }

  /** Abre uma conta na mesa (≤1 sessão aberta por mesa). */
  async openSession(tischId: string, kasseId: string, userId?: string) {
    const existing = await this.prisma.tischsession.findFirst({ where: { tischId, status: 'open' } })
    if (existing) throw new ConflictException({ message: 'table already open', sessionId: existing.id })
    return this.prisma.tischsession.create({ data: { tischId, kasseId, status: 'open', openedBy: userId } })
  }

  /** Conta corrente da sessão (derivada das Bestellungen via aggregateTab). */
  async getSession(id: string) {
    const session = await this.prisma.tischsession.findUnique({
      where: { id },
      include: { bestellungen: { include: { items: true } } },
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
    return { id: session.id, tischId: session.tischId, status: session.status, orderId: session.orderId, tab: aggregateTab(items) }
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
              qty: i.qty,
              unitNet: i.unit_net,
              mwstRate: i.mwst_rate,
              mwstCode: i.mwst_code,
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
    body: { client_event_id: string; payment: { method: 'cash'; amount: number; ref?: string }; tse: Record<string, unknown> },
    actor: Actor,
  ): Promise<{ orderId: string; duplicate: boolean }> {
    const session = await this.prisma.tischsession.findUnique({
      where: { id: sessionId },
      include: { bestellungen: { include: { items: true } } },
    })
    if (!session) throw new NotFoundException('session')
    if (session.status === 'paid') {
      // Retry idempotente do mesmo pagamento → devolve o pedido existente.
      const existing = await this.prisma.order.findUnique({ where: { clientEventId: body.client_event_id } })
      if (existing) return { orderId: existing.id, duplicate: true }
      throw new ConflictException('session already paid')
    }
    if (session.status !== 'open') throw new ConflictException('session not open')

    const items: TabItemInput[] = session.bestellungen.flatMap((b) =>
      b.items.map((i) => ({ productId: i.productId, qty: i.qty, unitNet: i.unitNet, mwstRate: Number(i.mwstRate), mwstCode: i.mwstCode })),
    )
    const tab = aggregateTab(items)
    const lines = tab.lines.filter((l) => l.qty !== 0)
    if (lines.length === 0) throw new BadRequestException('empty tab')

    const saleEvent: SaleEvent = {
      client_event_id: body.client_event_id,
      type: 'sale',
      kasse_id: session.kasseId,
      payload: {
        order: { mode: 'im_haus', table_id: session.tischId, total_net: tab.totalNet, total_mwst: tab.totalMwst, total_gross: tab.totalGross },
        items: lines.map((l) => ({ product_id: l.productId, qty: l.qty, unit_net: Math.round(l.net / l.qty), mwst_rate: l.mwstRate, mwst_code: l.mwstCode })),
        payment: body.payment,
        receipt: { qr_payload: '', format: 'digital' },
        tse_transaction: body.tse as SaleEvent['payload']['tse_transaction'],
      },
    }
    const result = await this.ledger.ingest(saleEvent, actor)
    await this.prisma.tischsession.update({
      where: { id: sessionId },
      data: { status: 'paid', closedAt: new Date(), orderId: result.orderId },
    })
    return { orderId: result.orderId, duplicate: result.duplicate }
  }
}
