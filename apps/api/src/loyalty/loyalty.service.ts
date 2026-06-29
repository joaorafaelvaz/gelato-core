import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common'
import { loyaltyBalance } from '@gelato/compliance'
import { PrismaService } from '../prisma/prisma.service'

@Injectable()
export class LoyaltyService {
  constructor(private readonly prisma: PrismaService) {}

  private async ownOr404(tenantId: string, customerId: string) {
    const c = await this.prisma.customer.findFirst({ where: { id: customerId, tenantId } })
    if (!c) throw new NotFoundException('customer')
    return c
  }

  async balance(tenantId: string, customerId: string) {
    await this.ownOr404(tenantId, customerId)
    const entries = await this.prisma.loyaltyEntry.findMany({ where: { tenantId, customerId }, orderBy: { at: 'desc' } })
    return { balance: loyaltyBalance(entries), entries }
  }

  async redeem(tenantId: string, customerId: string, dto: { points?: number; stamps?: number; reason?: string }) {
    await this.ownOr404(tenantId, customerId)
    const points = dto.points ?? 0
    const stamps = dto.stamps ?? 0
    if (points <= 0 && stamps <= 0) throw new BadRequestException('nothing to redeem')
    const entries = await this.prisma.loyaltyEntry.findMany({ where: { tenantId, customerId } })
    const bal = loyaltyBalance(entries)
    if (points > bal.points || stamps > bal.stamps) throw new BadRequestException('insufficient balance')
    await this.prisma.loyaltyEntry.create({ data: { tenantId, customerId, kind: 'redeem', points: -points, stamps: -stamps, reason: dto.reason } })
    return { ok: true }
  }

  async getProgram(tenantId: string) {
    const p = await this.prisma.loyaltyProgram.findUnique({ where: { tenantId } })
    return p ?? { tenantId, pointsPerEuro: 0, stampsPerItem: 0, active: true }
  }

  async putProgram(tenantId: string, dto: { points_per_euro?: number; stamps_per_item?: number; active?: boolean }) {
    return this.prisma.loyaltyProgram.upsert({
      where: { tenantId },
      update: { pointsPerEuro: dto.points_per_euro, stampsPerItem: dto.stamps_per_item, active: dto.active },
      create: { tenantId, pointsPerEuro: dto.points_per_euro ?? 0, stampsPerItem: dto.stamps_per_item ?? 0, active: dto.active ?? true },
    })
  }
}
