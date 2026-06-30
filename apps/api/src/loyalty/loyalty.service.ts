import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class LoyaltyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async getAccount(customerId: string) {
    const account = await this.prisma.loyaltyAccount.findUnique({
      where: { customerId },
      include: { customer: true },
    });
    if (!account) throw new NotFoundException('Loyalty account not found');
    return account;
  }

  async findByTenant(tenantId: string) {
    return this.prisma.loyaltyAccount.findMany({
      where: { customer: { tenantId, isActive: true } },
      include: {
        customer: { select: { id: true, name: true, contact: true } },
      },
      orderBy: { points: 'desc' },
    });
  }

  async awardPoints(
    customerId: string,
    points: number,
    reason: string,
    userId?: string,
  ) {
    const account = await this.prisma.loyaltyAccount.findUnique({
      where: { customerId },
      include: { customer: true },
    });
    if (!account) throw new NotFoundException('Loyalty account not found');
    if (points <= 0) throw new BadRequestException('Points must be positive');

    const updated = await this.prisma.loyaltyAccount.update({
      where: { customerId },
      data: { points: { increment: points } },
    });

    if (userId) {
      await this.audit.log({
        userId,
        tenantId: account.customer.tenantId,
        action: 'loyalty.points.award',
        entity: 'loyalty_account',
        entityId: account.id,
        payload: { customerId, points, reason, newTotal: updated.points },
      });
    }

    return updated;
  }

  async redeemPoints(
    customerId: string,
    points: number,
    reason: string,
    userId?: string,
  ) {
    const account = await this.prisma.loyaltyAccount.findUnique({
      where: { customerId },
      include: { customer: true },
    });
    if (!account) throw new NotFoundException('Loyalty account not found');
    if (points <= 0) throw new BadRequestException('Points must be positive');
    if (account.points < points) {
      throw new BadRequestException('Insufficient points');
    }

    const updated = await this.prisma.loyaltyAccount.update({
      where: { customerId },
      data: { points: { decrement: points } },
    });

    if (userId) {
      await this.audit.log({
        userId,
        tenantId: account.customer.tenantId,
        action: 'loyalty.points.redeem',
        entity: 'loyalty_account',
        entityId: account.id,
        payload: { customerId, points, reason, newTotal: updated.points },
      });
    }

    return updated;
  }

  async awardStamps(customerId: string, stamps: number) {
    const account = await this.prisma.loyaltyAccount.findUnique({
      where: { customerId },
    });
    if (!account) throw new NotFoundException('Loyalty account not found');

    return this.prisma.loyaltyAccount.update({
      where: { customerId },
      data: { stamps: { increment: stamps } },
    });
  }

  /**
   * Award points for a finalized order.
   * Points = floor(totalGross / pointsPerEuro) where pointsPerEuro defaults to 10.
   */
  async awardForOrder(customerId: string, totalGross: number, pointsPerEuro = 10) {
    const points = Math.floor(totalGross / pointsPerEuro);
    if (points <= 0) return null;

    return this.awardPoints(customerId, points, `Order purchase (${totalGross} €)`);
  }
}