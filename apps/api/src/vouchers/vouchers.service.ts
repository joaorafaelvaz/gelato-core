import { Injectable, ConflictException, NotFoundException } from '@nestjs/common'
import { voucherDiscountGross, type VoucherType } from '@gelato/compliance'
import { PrismaService } from '../prisma/prisma.service'

@Injectable()
export class VouchersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(tenantId: string) {
    const vouchers = await this.prisma.voucher.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' } })
    const counts = await this.prisma.voucherRedemption.groupBy({ by: ['voucherId'], where: { tenantId }, _count: { _all: true } })
    const byId = new Map(counts.map((c) => [c.voucherId, c._count._all]))
    return vouchers.map((v) => ({ ...v, usedCount: byId.get(v.id) ?? 0 }))
  }

  async create(tenantId: string, dto: { code: string; type: VoucherType; value: number; max_uses?: number; valid_from?: string; valid_to?: string }) {
    const exists = await this.prisma.voucher.findFirst({ where: { tenantId, code: dto.code } })
    if (exists) throw new ConflictException('voucher code already exists')
    const v = await this.prisma.voucher.create({
      data: { tenantId, code: dto.code, type: dto.type, value: dto.value, maxUses: dto.max_uses ?? null, validFrom: dto.valid_from ? new Date(dto.valid_from) : null, validTo: dto.valid_to ? new Date(dto.valid_to) : null },
    })
    return { id: v.id }
  }

  async update(tenantId: string, id: string, dto: { active?: boolean; value?: number; max_uses?: number }) {
    const v = await this.prisma.voucher.findFirst({ where: { id, tenantId } })
    if (!v) throw new NotFoundException('voucher')
    await this.prisma.voucher.update({ where: { id }, data: { active: dto.active, value: dto.value, maxUses: dto.max_uses } })
    return { id }
  }

  /** Valida e computa o desconto. valid:false (não erro) para inválido/esgotado. */
  async quote(tenantId: string, dto: { code: string; gross_cents: number }) {
    const v = await this.prisma.voucher.findFirst({ where: { tenantId, code: dto.code } })
    if (!v || !v.active) return { valid: false }
    const now = new Date()
    if (v.validFrom && now < v.validFrom) return { valid: false }
    if (v.validTo && now > v.validTo) return { valid: false }
    if (v.maxUses != null) {
      const used = await this.prisma.voucherRedemption.count({ where: { tenantId, voucherId: v.id } })
      if (used >= v.maxUses) return { valid: false }
    }
    const discount = voucherDiscountGross(v.type as VoucherType, v.value, dto.gross_cents)
    return { valid: true, type: v.type, value: v.value, discount_cents: discount }
  }
}
