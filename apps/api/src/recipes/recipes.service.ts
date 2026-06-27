import { Injectable, ConflictException, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'

interface IngredientInput {
  stock_item_id: string
  qty: number
}

@Injectable()
export class RecipesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Receitas do tenant, enriquecidas (produto/variante + ingredientes c/ insumo). */
  async list(tenantId: string) {
    const recipes = await this.prisma.recipe.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'asc' },
      include: { product: true, variant: true, ingredients: { include: { stockItem: true }, orderBy: { stockItemId: 'asc' } } },
    })
    return recipes.map((r) => ({
      id: r.id,
      productId: r.productId,
      productName: r.product.name,
      variantId: r.variantId,
      variantName: r.variant?.name ?? null,
      active: r.active,
      ingredients: r.ingredients.map((i) => ({ stockItemId: i.stockItemId, stockItemName: i.stockItem.name, unit: i.stockItem.unit, qty: i.qty })),
    }))
  }

  private async assertTenantOwnsItems(tenantId: string, productId: string, variantId: string | null, ingredients: IngredientInput[]) {
    const product = await this.prisma.product.findFirst({ where: { id: productId, tenantId } })
    if (!product) throw new NotFoundException('product')
    if (variantId) {
      const variant = await this.prisma.productVariant.findFirst({ where: { id: variantId, productId } })
      if (!variant) throw new NotFoundException('variant')
    }
    for (const ing of ingredients) {
      const item = await this.prisma.stockItem.findFirst({ where: { id: ing.stock_item_id, tenantId } })
      if (!item) throw new NotFoundException('stock item')
    }
  }

  async create(tenantId: string, dto: { product_id: string; variant_id?: string | null; ingredients: IngredientInput[] }) {
    const variantId = dto.variant_id ?? null
    await this.assertTenantOwnsItems(tenantId, dto.product_id, variantId, dto.ingredients)
    const existing = await this.prisma.recipe.findFirst({ where: { tenantId, productId: dto.product_id, variantId } })
    if (existing) throw new ConflictException('recipe already exists for this product/variant')
    const recipe = await this.prisma.recipe.create({
      data: {
        tenantId,
        productId: dto.product_id,
        variantId,
        ingredients: { create: dto.ingredients.map((i) => ({ stockItemId: i.stock_item_id, qty: i.qty })) },
      },
    })
    return { id: recipe.id }
  }

  async update(tenantId: string, id: string, dto: { ingredients?: IngredientInput[]; active?: boolean }) {
    const recipe = await this.prisma.recipe.findFirst({ where: { id, tenantId } })
    if (!recipe) throw new NotFoundException('recipe')
    if (dto.ingredients) {
      for (const ing of dto.ingredients) {
        const item = await this.prisma.stockItem.findFirst({ where: { id: ing.stock_item_id, tenantId } })
        if (!item) throw new NotFoundException('stock item')
      }
      await this.prisma.$transaction([
        this.prisma.recipeIngredient.deleteMany({ where: { recipeId: id } }),
        this.prisma.recipeIngredient.createMany({ data: dto.ingredients.map((i) => ({ recipeId: id, stockItemId: i.stock_item_id, qty: i.qty })) }),
      ])
    }
    if (dto.active !== undefined) {
      await this.prisma.recipe.update({ where: { id }, data: { active: dto.active } })
    }
    return { id }
  }
}
