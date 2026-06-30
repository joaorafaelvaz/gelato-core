import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreatePromotionDto } from './dto/create-promotion.dto';

@Injectable()
export class PromotionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(userId: string, dto: CreatePromotionDto) {
    const promo = await this.prisma.promotion.create({
      data: {
        tenantId: dto.tenantId,
        name: dto.name,
        rule: dto.rule as any,
        activeFrom: new Date(dto.activeFrom),
        activeTo: dto.activeTo ? new Date(dto.activeTo) : null,
        isActive: dto.isActive ?? true,
      },
    });

    await this.audit.log({
      userId,
      tenantId: dto.tenantId,
      action: 'promotion.create',
      entity: 'promotion',
      entityId: promo.id,
      payload: { name: dto.name },
    });

    return promo;
  }

  async findByTenant(tenantId: string, activeOnly = false) {
    return this.prisma.promotion.findMany({
      where: {
        tenantId,
        ...(activeOnly ? { isActive: true } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async toggle(userId: string, id: string, active: boolean, tenantId: string) {
    const promo = await this.prisma.promotion.findUnique({ where: { id } });
    if (!promo) throw new NotFoundException('Promotion not found');

    await this.audit.log({
      userId,
      tenantId,
      action: active ? 'promotion.activate' : 'promotion.deactivate',
      entity: 'promotion',
      entityId: id,
    });

    return this.prisma.promotion.update({
      where: { id },
      data: { isActive: active },
    });
  }
}