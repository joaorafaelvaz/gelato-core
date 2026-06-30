import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTenantDto } from './dto/create-tenant.dto';

@Injectable()
export class TenantsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateTenantDto) {
    return this.prisma.tenant.create({
      data: {
        name: dto.name,
        slug: dto.slug,
        legalName: dto.legalName,
        taxId: dto.taxId,
        addressLine1: dto.addressLine1,
        addressLine2: dto.addressLine2,
        zipCode: dto.zipCode,
        city: dto.city,
        email: dto.email,
        phone: dto.phone,
      },
    });
  }

  async findBySlug(slug: string) {
    return this.prisma.tenant.findUnique({ where: { slug } });
  }

  async findAll() {
    return this.prisma.tenant.findMany();
  }
}
