import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateCustomerDto } from './dto/create-customer.dto';

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(userId: string, dto: CreateCustomerDto) {
    const customer = await this.prisma.customer.create({
      data: {
        tenantId: dto.tenantId,
        betriebsstaetteId: dto.betriebsstaetteId ?? null,
        name: dto.name ?? null,
        contact: (dto.contact ?? undefined) as any,
        consent: (dto.consent ?? undefined) as any,
        birthDate: dto.birthDate ? new Date(dto.birthDate) : null,
        notes: dto.notes ?? null,
        isActive: dto.isActive ?? true,
      },
    });

    await this.audit.log({
      userId,
      tenantId: dto.tenantId,
      action: 'customer.create',
      entity: 'customer',
      entityId: customer.id,
      payload: { name: dto.name },
    });

    return customer;
  }

  async findByTenant(tenantId: string, search?: string) {
    return this.prisma.customer.findMany({
      where: {
        tenantId,
        isActive: true,
        ...(search
          ? { name: { contains: search, mode: 'insensitive' as const } }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      include: { loyaltyAccount: true },
    });
  }

  async findById(id: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { id },
      include: { loyaltyAccount: true, orders: { take: 10, orderBy: { createdAt: 'desc' } } },
    });
    if (!customer) throw new NotFoundException('Customer not found');
    return customer;
  }

  async update(_userId: string, id: string, dto: Partial<CreateCustomerDto>) {
    const customer = await this.prisma.customer.findUnique({ where: { id } });
    if (!customer) throw new NotFoundException('Customer not found');

    return this.prisma.customer.update({
      where: { id },
      data: {
        name: dto.name,
        contact: dto.contact as any,
        notes: dto.notes,
        isActive: dto.isActive,
      },
    });
  }

  async deactivate(userId: string, id: string) {
    const customer = await this.prisma.customer.findUnique({ where: { id } });
    if (!customer) throw new NotFoundException('Customer not found');

    await this.audit.log({
      userId,
      tenantId: customer.tenantId,
      action: 'customer.deactivate',
      entity: 'customer',
      entityId: id,
    });

    return this.prisma.customer.update({
      where: { id },
      data: { isActive: false },
    });
  }
}