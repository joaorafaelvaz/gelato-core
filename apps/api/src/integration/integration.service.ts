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
}
