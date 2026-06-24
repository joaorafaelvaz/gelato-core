import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'

export interface CreateProductDto {
  name: string
  netCents: number
  mwstCodeImHaus: string
  mwstCodeAusserHaus: string
  type?: string
}

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  list(tenantId: string) {
    return this.prisma.product.findMany({
      where: { tenantId, active: true },
      orderBy: { name: 'asc' },
    })
  }

  create(tenantId: string, dto: CreateProductDto) {
    return this.prisma.product.create({ data: { tenantId, ...dto } })
  }

  taxRates(tenantId: string) {
    return this.prisma.taxRate.findMany({ where: { tenantId }, orderBy: { code: 'asc' } })
  }
}
