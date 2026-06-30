import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateVoucherDto, ValidateVoucherDto } from './dto/create-voucher.dto';

@Injectable()
export class VouchersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(userId: string, dto: CreateVoucherDto) {
    const voucher = await this.prisma.voucher.create({
      data: {
        tenantId: dto.tenantId,
        code: dto.code.toUpperCase(),
        type: (dto.type as any) ?? 'FIXED_AMOUNT',
        value: parseFloat(dto.value),
        validFrom: new Date(dto.validFrom),
        validTo: dto.validTo ? new Date(dto.validTo) : null,
        maxUses: dto.maxUses ?? null,
        isActive: dto.isActive ?? true,
      },
    });

    await this.audit.log({
      userId,
      tenantId: dto.tenantId,
      action: 'voucher.create',
      entity: 'voucher',
      entityId: voucher.id,
      payload: { code: dto.code, type: dto.type, value: dto.value },
    });

    return voucher;
  }

  async findByTenant(tenantId: string) {
    return this.prisma.voucher.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async validate(dto: ValidateVoucherDto) {
    const voucher = await this.prisma.voucher.findFirst({
      where: { tenantId: dto.tenantId, code: dto.code.toUpperCase(), isActive: true },
    });

    if (!voucher) throw new NotFoundException('Voucher not found');

    const now = new Date();
    if (now < voucher.validFrom) {
      throw new BadRequestException('Voucher not yet valid');
    }
    if (voucher.validTo && now > voucher.validTo) {
      throw new BadRequestException('Voucher expired');
    }
    if (voucher.maxUses && voucher.usedCount >= voucher.maxUses) {
      throw new BadRequestException('Voucher usage limit reached');
    }

    let discountAmount = 0;
    if (voucher.type === 'FIXED_AMOUNT') {
      discountAmount = parseFloat(voucher.value.toString());
    } else if (voucher.type === 'PERCENTAGE' && dto.orderTotal) {
      discountAmount = (dto.orderTotal * parseFloat(voucher.value.toString())) / 100;
    }

    return {
      valid: true,
      voucherId: voucher.id,
      code: voucher.code,
      type: voucher.type,
      value: parseFloat(voucher.value.toString()),
      discountAmount: Math.round(discountAmount * 100) / 100,
    };
  }

  async redeem(voucherId: string, userId: string, tenantId: string) {
    const voucher = await this.prisma.voucher.findUnique({ where: { id: voucherId } });
    if (!voucher) throw new NotFoundException('Voucher not found');

    const updated = await this.prisma.voucher.update({
      where: { id: voucherId },
      data: { usedCount: { increment: 1 } },
    });

    await this.audit.log({
      userId,
      tenantId,
      action: 'voucher.redeem',
      entity: 'voucher',
      entityId: voucherId,
      payload: { code: voucher.code, usedCount: updated.usedCount },
    });

    return updated;
  }

  async deactivate(userId: string, id: string, tenantId: string) {
    const voucher = await this.prisma.voucher.findUnique({ where: { id } });
    if (!voucher) throw new NotFoundException('Voucher not found');

    await this.audit.log({
      userId,
      tenantId,
      action: 'voucher.deactivate',
      entity: 'voucher',
      entityId: id,
    });

    return this.prisma.voucher.update({
      where: { id },
      data: { isActive: false },
    });
  }
}