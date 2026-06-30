import { Injectable, BadRequestException, ConflictException, NotFoundException } from '@nestjs/common'
import { explodeProduction } from '@gelato/compliance'
import { PrismaService } from '../prisma/prisma.service'

interface IngredientInput {
  stock_item_id: string
  qty: number
}

@Injectable()
export class ProductionService {
  constructor(private readonly prisma: PrismaService) {}

  async listRecipes(tenantId: string) {
    const recipes = await this.prisma.productionRecipe.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'asc' },
      include: { output: true, ingredients: { include: { stockItem: true }, orderBy: { stockItemId: 'asc' } } },
    })
    return recipes.map((r) => ({
      id: r.id,
      outputStockItemId: r.outputStockItemId,
      outputName: r.output.name,
      unit: r.output.unit,
      yieldQty: r.yieldQty,
      active: r.active,
      ingredients: r.ingredients.map((i) => ({ stockItemId: i.stockItemId, name: i.stockItem.name, unit: i.stockItem.unit, qty: i.qty })),
    }))
  }

  async createRecipe(tenantId: string, dto: { output_stock_item_id: string; yield_qty: number; ingredients: IngredientInput[] }) {
    if (dto.yield_qty <= 0) throw new BadRequestException('yield_qty must be positive')
    if (dto.ingredients.length === 0) throw new BadRequestException('at least one ingredient')
    const output = await this.prisma.stockItem.findFirst({ where: { id: dto.output_stock_item_id, tenantId } })
    if (!output) throw new NotFoundException('output stock item')
    for (const ing of dto.ingredients) {
      const si = await this.prisma.stockItem.findFirst({ where: { id: ing.stock_item_id, tenantId } })
      if (!si) throw new NotFoundException('ingredient stock item')
    }
    const existing = await this.prisma.productionRecipe.findFirst({ where: { tenantId, outputStockItemId: dto.output_stock_item_id } })
    if (existing) throw new ConflictException('production recipe already exists for this output')
    const rec = await this.prisma.productionRecipe.create({
      data: { tenantId, outputStockItemId: dto.output_stock_item_id, yieldQty: dto.yield_qty, ingredients: { create: dto.ingredients.map((i) => ({ stockItemId: i.stock_item_id, qty: i.qty })) } },
    })
    return { id: rec.id }
  }

  async produce(tenantId: string, dto: { output_stock_item_id: string; batches: number }, userId?: string) {
    if (dto.batches <= 0) throw new BadRequestException('batches must be positive')
    const recipe = await this.prisma.productionRecipe.findFirst({
      where: { tenantId, outputStockItemId: dto.output_stock_item_id, active: true },
      include: { ingredients: true },
    })
    if (!recipe) throw new NotFoundException('production recipe')
    const { produce, consume } = explodeProduction(
      recipe.outputStockItemId,
      recipe.yieldQty,
      recipe.ingredients.map((i) => ({ stockItemId: i.stockItemId, qty: i.qty })),
      dto.batches,
    )
    const runId = crypto.randomUUID()
    await this.prisma.$transaction([
      ...consume.map((c) => this.prisma.stockMovement.create({ data: { tenantId, stockItemId: c.stockItemId, type: 'consume', qtyDelta: -c.qty, refType: 'production', refId: runId, createdBy: userId } })),
      this.prisma.stockMovement.create({ data: { tenantId, stockItemId: produce.stockItemId, type: 'produce', qtyDelta: produce.qty, refType: 'production', refId: runId, createdBy: userId } }),
    ])
    return { runId, produce, consume }
  }
}
