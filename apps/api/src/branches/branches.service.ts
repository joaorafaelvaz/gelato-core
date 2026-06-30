import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateBranchDto } from './dto/create-branch.dto';

@Injectable()
export class BranchesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateBranchDto) {
    return this.prisma.betriebsstaette.create({
      data: {
        tenantId: dto.tenantId,
        name: dto.name,
        slug: dto.slug,
        finanzamtNr: dto.finanzamtNr,
        addressLine1: dto.addressLine1,
        addressLine2: dto.addressLine2,
        zipCode: dto.zipCode,
        city: dto.city,
        country: dto.country ?? 'DE',
        phone: dto.phone,
        email: dto.email,
        isActive: dto.isActive ?? true,
      },
    });
  }

  async findByTenant(tenantId: string) {
    return this.prisma.betriebsstaette.findMany({
      where: { tenantId },
      include: { kassen: true },
    });
  }

  async findById(id: string) {
    return this.prisma.betriebsstaette.findUnique({
      where: { id },
      include: { kassen: true },
    });
  }
}
