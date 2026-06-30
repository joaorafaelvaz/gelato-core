import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateCampaignDto, UpdateCampaignStatusDto } from './dto/create-campaign.dto';

@Injectable()
export class CampaignsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(userId: string, dto: CreateCampaignDto) {
    const campaign = await this.prisma.campaign.create({
      data: {
        tenantId: dto.tenantId,
        name: dto.name,
        channel: (dto.channel as any) ?? 'EMAIL',
        segment: (dto.segment ?? undefined) as any,
        scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : null,
        status: (dto.status as any) ?? 'DRAFT',
        content: (dto.content ?? undefined) as any,
      },
    });

    await this.audit.log({
      userId,
      tenantId: dto.tenantId,
      action: 'campaign.create',
      entity: 'campaign',
      entityId: campaign.id,
      payload: { name: dto.name, channel: dto.channel ?? 'EMAIL' },
    });

    return campaign;
  }

  async findByTenant(tenantId: string) {
    return this.prisma.campaign.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(id: string) {
    const campaign = await this.prisma.campaign.findUnique({ where: { id } });
    if (!campaign) throw new NotFoundException('Campaign not found');
    return campaign;
  }

  async updateStatus(
    userId: string,
    id: string,
    dto: UpdateCampaignStatusDto,
    tenantId: string,
  ) {
    const campaign = await this.prisma.campaign.findUnique({ where: { id } });
    if (!campaign) throw new NotFoundException('Campaign not found');
    if (campaign.status === 'SENT') {
      throw new BadRequestException('Cannot modify a sent campaign');
    }

    const updated = await this.prisma.campaign.update({
      where: { id },
      data: { status: dto.status },
    });

    await this.audit.log({
      userId,
      tenantId,
      action: `campaign.${dto.status.toLowerCase()}`,
      entity: 'campaign',
      entityId: id,
      payload: { name: campaign.name, newStatus: dto.status },
    });

    return updated;
  }

  /**
   * Segment customers based on campaign segment rules.
   * Supported rules:
   *   { minPoints: number } — loyalty points >= minPoints
   *   { maxPoints: number } — loyalty points <= maxPoints
   *   { hasEmail: true } — customers with email in contact
   *   { city: string } — customers whose contact.city matches (case-insensitive)
   */
  async segmentCustomers(tenantId: string, segment: Record<string, unknown> | null) {
    if (!segment) {
      return this.prisma.customer.findMany({
        where: { tenantId, isActive: true },
        include: { loyaltyAccount: true },
      });
    }

    const where: any = { tenantId, isActive: true };

    if (segment.minPoints !== undefined || segment.maxPoints !== undefined) {
      where.loyaltyAccount = {};
      if (segment.minPoints !== undefined) {
        where.loyaltyAccount.points = { gte: segment.minPoints };
      }
      if (segment.maxPoints !== undefined) {
        where.loyaltyAccount.points = { ...(where.loyaltyAccount.points ?? {}), lte: segment.maxPoints };
      }
    }

    const customers = await this.prisma.customer.findMany({
      where,
      include: { loyaltyAccount: true },
    });

    // Post-filter for contact-based rules
    let filtered = customers;
    if (segment.hasEmail === true) {
      filtered = filtered.filter((c) => {
        const contact = c.contact as any;
        return contact?.email;
      });
    }
    if (segment.city) {
      filtered = filtered.filter((c) => {
        const contact = c.contact as any;
        return contact?.city?.toLowerCase?.() === String(segment.city).toLowerCase();
      });
    }

    return filtered;
  }

  async previewSegment(tenantId: string, segment: Record<string, unknown> | null) {
    const customers = await this.segmentCustomers(tenantId, segment);
    return {
      count: customers.length,
      sample: customers.slice(0, 10).map((c) => ({
        id: c.id,
        name: c.name,
        email: (c.contact as any)?.email,
        points: c.loyaltyAccount?.points ?? 0,
      })),
    };
  }
}