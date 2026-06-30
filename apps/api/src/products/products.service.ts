import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  CreateProductCategoryDto,
  CreateProductDto,
  CreateProductModifierDto,
  CreateProductVariantDto,
} from './dto/create-product.dto';

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async createCategory(userId: string, dto: CreateProductCategoryDto) {
    const cat = await this.prisma.productCategory.create({
      data: {
        tenantId: dto.tenantId,
        parentId: dto.parentId ?? null,
        name: dto.name,
        color: dto.color ?? null,
        isActive: dto.isActive ?? true,
      },
    });
    await this.audit.log({
      userId,
      tenantId: dto.tenantId,
      action: 'product.manage',
      entity: 'productCategory',
      entityId: cat.id,
      payload: { name: dto.name },
    });
    return cat;
  }

  async createProduct(userId: string, dto: CreateProductDto) {
    const product = await this.prisma.product.create({
      data: {
        tenantId: dto.tenantId,
        categoryId: dto.categoryId ?? null,
        type: dto.type,
        name: dto.name,
        description: dto.description ?? null,
        basePrice: dto.basePrice ? Number(dto.basePrice) : null,
        mwstImHaus: Number(dto.mwstImHaus),
        mwstAusserHaus: Number(dto.mwstAusserHaus),
        gtin: dto.gtin ?? null,
        allergens: dto.allergens ?? [],
        isActive: dto.isActive ?? true,
      },
    });
    await this.audit.log({
      userId,
      tenantId: dto.tenantId,
      action: 'product.manage',
      entity: 'product',
      entityId: product.id,
      payload: { name: dto.name, type: dto.type },
    });
    return product;
  }

  async createVariant(dto: CreateProductVariantDto) {
    return this.prisma.productVariant.create({
      data: {
        productId: dto.productId,
        name: dto.name,
        priceDelta: dto.priceDelta ? Number(dto.priceDelta) : 0,
        isActive: dto.isActive ?? true,
      },
    });
  }

  async createModifier(dto: CreateProductModifierDto) {
    return this.prisma.productModifier.create({
      data: {
        productId: dto.productId,
        name: dto.name,
        priceDelta: dto.priceDelta ? Number(dto.priceDelta) : 0,
        groupKey: dto.groupKey ?? null,
        isActive: dto.isActive ?? true,
      },
    });
  }

  async findByTenant(tenantId: string) {
    return this.prisma.product.findMany({
      where: { tenantId },
      include: { category: true, variants: true, modifiers: true, recipe: { include: { ingredients: true } } },
    });
  }

  async findById(id: string) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: { category: true, variants: true, modifiers: true, recipe: { include: { ingredients: true } } },
    });
    if (!product) throw new NotFoundException('Product not found');
    return product;
  }

  async findCategoriesByTenant(tenantId: string) {
    return this.prisma.productCategory.findMany({
      where: { tenantId },
      include: { children: true },
    });
  }
}
