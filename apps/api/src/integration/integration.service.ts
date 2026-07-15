import { Injectable } from '@nestjs/common'
import { applyRate } from '@gelato/domain'
import { PrismaService } from '../prisma/prisma.service'

/**
 * Leituras read-only para a integração Skyview. Todas escopadas por tenant
 * (do JWT do service token). Dinheiro sempre em cents (convenção do domínio).
 */
@Injectable()
export class IntegrationService {
  constructor(private readonly prisma: PrismaService) {}

  async events(tenantId: string, after: number, limit: number) {
    const rows = await this.prisma.integrationEvent.findMany({
      where: { tenantId, seq: { gt: after } },
      orderBy: { seq: 'asc' },
      take: limit,
    })
    // seq é BigInt no Prisma; Number é seguro (<< 2^53) e serializável em JSON.
    return rows.map((e) => ({
      seq: Number(e.seq),
      type: e.type,
      kasse_id: e.kasseId,
      payload: e.payload,
      created_at: e.createdAt.toISOString(),
    }))
  }

  async stores(tenantId: string) {
    const kassen = await this.prisma.kasse.findMany({
      where: { betriebsstaette: { tenantId } },
      select: { id: true, name: true, betriebsstaette: { select: { name: true } } },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    })
    // v1: todas as lojas gelato-core são alemãs — constantes (spec §4.3).
    return kassen.map((k) => ({
      id: k.id,
      name: k.name,
      betriebsstaette: k.betriebsstaette.name,
      currency: 'EUR',
      timezone: 'Europe/Berlin',
    }))
  }

  async products(tenantId: string) {
    const now = new Date()
    const [prods, rates] = await Promise.all([
      this.prisma.product.findMany({
        where: { tenantId },
        include: { category: { select: { name: true } } },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
      }),
      // validFrom desc + find(): se houver mais de uma alíquota válida para o
      // mesmo código, "vigente" é deterministicamente a de validFrom mais recente.
      this.prisma.taxRate.findMany({ where: { tenantId }, orderBy: { validFrom: 'desc' } }),
    ])
    const pickRate = (code: string) =>
      rates.find((r) => r.code === code && r.validFrom <= now && (!r.validTo || r.validTo > now))
    return prods.map((p) => {
      const rate = pickRate(p.mwstCodeImHaus)
      const gross = rate ? p.netCents + applyRate(p.netCents, Number(rate.rate)) : p.netCents
      return {
        id: p.id,
        name: p.name,
        type: p.type,
        category: p.category?.name ?? null,
        net_cents: p.netCents,
        gross_cents_im_haus: gross,
        active: p.active,
        created_at: p.createdAt.toISOString(),
        updated_at: p.updatedAt.toISOString(),
      }
    })
  }

  async staff(tenantId: string) {
    const users = await this.prisma.user.findMany({
      where: { tenantId },
      select: { id: true, name: true, active: true, createdAt: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    })
    return users.map((u) => ({
      id: u.id,
      name: u.name,
      active: u.active,
      created_at: u.createdAt.toISOString(),
    }))
  }

  async orders(
    tenantId: string,
    opts: { kasseId?: string; from?: Date; to?: Date; limit: number; offset: number },
  ) {
    const rows = await this.prisma.order.findMany({
      where: {
        kasse: { betriebsstaette: { tenantId } },
        ...(opts.kasseId ? { kasseId: opts.kasseId } : {}),
        ...(opts.from || opts.to
          ? { ts: { ...(opts.from ? { gte: opts.from } : {}), ...(opts.to ? { lt: opts.to } : {}) } }
          : {}),
      },
      orderBy: [{ ts: 'asc' }, { id: 'asc' }], // determinístico para paginação de backfill
      take: opts.limit,
      skip: opts.offset,
      include: {
        items: { orderBy: { id: 'asc' } },
        payments: { orderBy: { id: 'asc' } },
        shift: { select: { userId: true } },
      },
    })
    return rows.map((o) => ({
      id: o.id,
      kasse_id: o.kasseId,
      ts: o.ts.toISOString(),
      mode: o.mode,
      status: o.status,
      total_net: o.totalNet,
      total_mwst: o.totalMwst,
      total_gross: o.totalGross,
      customer_id: o.customerId,
      operator_user_id: o.shift?.userId ?? null,
      items: o.items.map((i) => ({
        id: i.id,
        product_id: i.productId,
        variant_id: i.variantId,
        qty: i.qty,
        unit_net: i.unitNet,
        mwst_rate: Number(i.mwstRate),
        mwst_code: i.mwstCode,
      })),
      payments: o.payments.map((p) => ({ id: p.id, method: p.method, amount: p.amount })),
    }))
  }

  async shifts(tenantId: string, from?: Date, to?: Date) {
    const rows = await this.prisma.shift.findMany({
      where: {
        kasse: { betriebsstaette: { tenantId } },
        ...(from || to
          ? { openedAt: { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) } }
          : {}),
      },
      orderBy: { openedAt: 'asc' },
      select: { id: true, kasseId: true, userId: true, status: true, openedAt: true, closedAt: true },
    })
    return rows.map((s) => ({
      id: s.id,
      kasse_id: s.kasseId,
      user_id: s.userId,
      status: s.status,
      opened_at: s.openedAt.toISOString(),
      closed_at: s.closedAt?.toISOString() ?? null,
    }))
  }
}
