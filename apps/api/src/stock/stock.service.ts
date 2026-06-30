import { Injectable, NotFoundException } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  CreateIngredientDto,
  CreateRecipeDto,
  CreateRecipeIngredientDto,
  CreateStockItemDto,
  CreateStockMovementDto,
} from './dto/create-stock.dto';

@Injectable()
export class StockService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async createIngredient(userId: string, dto: CreateIngredientDto) {
    const ingredient = await this.prisma.ingredient.create({
      data: {
        tenantId: dto.tenantId,
        name: dto.name,
        baseUnit: dto.baseUnit,
        description: dto.description ?? null,
        avgCost: null,
      },
    });
    await this.audit.log({
      userId,
      tenantId: dto.tenantId,
      action: 'stock.manage',
      entity: 'ingredient',
      entityId: ingredient.id,
      payload: { name: dto.name, baseUnit: dto.baseUnit },
    });
    return ingredient;
  }

  async createStockItem(userId: string, dto: CreateStockItemDto) {
    const item = await this.prisma.stockItem.create({
      data: {
        ingredientId: dto.ingredientId,
        betriebsstaetteId: dto.betriebsstaetteId,
        qtyBase: dto.qtyBase ?? 0,
        mindestbestand: dto.mindestbestand ?? 0,
      },
    });
    await this.audit.log({
      userId,
      tenantId: (await this.prisma.ingredient.findUnique({ where: { id: dto.ingredientId } }))?.tenantId ?? '',
      action: 'stock.manage',
      entity: 'stockItem',
      entityId: item.id,
      payload: { qtyBase: dto.qtyBase, mindestbestand: dto.mindestbestand },
    });
    return item;
  }

  async createMovement(userId: string, dto: CreateStockMovementDto) {
    const item = await this.prisma.stockItem.findUnique({
      where: { id: dto.stockItemId },
      include: { ingredient: true },
    });
    if (!item) throw new NotFoundException('StockItem not found');

    const movement = await this.prisma.$transaction(async (tx) => {
      const mov = await tx.stockMovement.create({
        data: {
          stockItemId: dto.stockItemId,
          type: dto.type,
          qtyBase: dto.qtyBase,
          reason: dto.reason ?? null,
          refOrderId: dto.refOrderId ?? null,
          userId: userId ?? null,
        },
      });

      await tx.stockItem.update({
        where: { id: dto.stockItemId },
        data: {
          qtyBase: { increment: dto.qtyBase },
        },
      });

      return mov;
    });

    await this.audit.log({
      userId,
      tenantId: item.ingredient.tenantId,
      action: `stock.${dto.type.toLowerCase()}`,
      entity: 'stockMovement',
      entityId: movement.id,
      payload: { type: dto.type, qtyBase: dto.qtyBase },
    });

    return movement;
  }

  async createRecipe(userId: string, dto: CreateRecipeDto) {
    const product = await this.prisma.product.findUnique({
      where: { id: dto.productId },
    });
    if (!product) throw new NotFoundException('Product not found');

    const recipe = await this.prisma.recipe.create({
      data: {
        productId: dto.productId,
        active: dto.active === 1 ? true : false,
        yieldQty: dto.yieldQty,
        yieldUnit: dto.yieldUnit,
      },
    });

    await this.audit.log({
      userId,
      tenantId: product.tenantId,
      action: 'recipe.manage',
      entity: 'recipe',
      entityId: recipe.id,
      payload: { productId: dto.productId, yieldQty: dto.yieldQty },
    });

    return recipe;
  }

  async createRecipeIngredient(userId: string, dto: CreateRecipeIngredientDto) {
    const recipe = await this.prisma.recipe.findUnique({
      where: { id: dto.recipeId },
      include: { product: true },
    });
    if (!recipe) throw new NotFoundException('Recipe not found');

    const ri = await this.prisma.recipeIngredient.create({
      data: {
        recipeId: dto.recipeId,
        ingredientId: dto.ingredientId,
        qty: dto.qty,
        unit: dto.unit,
      },
    });

    await this.audit.log({
      userId,
      tenantId: recipe.product.tenantId,
      action: 'recipe.manage',
      entity: 'recipeIngredient',
      entityId: ri.id,
      payload: { recipeId: dto.recipeId, ingredientId: dto.ingredientId, qty: dto.qty },
    });

    return ri;
  }

  async findIngredientsByTenant(tenantId: string) {
    return this.prisma.ingredient.findMany({
      where: { tenantId },
      include: { stockItems: { include: { betriebsstaette: true } } },
    });
  }

  async findStockByBranch(betriebsstaetteId: string) {
    return this.prisma.stockItem.findMany({
      where: { betriebsstaetteId },
      include: { ingredient: true, movements: true },
    });
  }

  async getAvailability(productId: string, betriebsstaetteId: string): Promise<number | null> {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      include: {
        recipe: {
          include: {
            ingredients: true,
          },
        },
      },
    });
    if (!product || !product.recipe || !product.recipe.active) return null;

    const stockItems = await this.prisma.stockItem.findMany({
      where: {
        betriebsstaetteId,
        ingredientId: { in: product.recipe.ingredients.map((i) => i.ingredientId) },
      },
    });
    const stockMap = new Map(stockItems.map((s) => [s.ingredientId, new Decimal(s.qtyBase.toString())]));

    let minBuildable: Decimal | null = null;
    for (const ri of product.recipe.ingredients) {
      const stockQty = stockMap.get(ri.ingredientId);
      if (stockQty === undefined) return 0;
      const requiredPerYield = new Decimal(ri.qty.toString());
      const yieldQty = new Decimal(product.recipe.yieldQty.toString());
      const requiredPerUnit = requiredPerYield.dividedBy(yieldQty);
      const buildable = stockQty.dividedBy(requiredPerUnit).floor();
      if (minBuildable === null || buildable.lessThan(minBuildable)) {
        minBuildable = buildable;
      }
    }

    return minBuildable?.toNumber() ?? null;
  }

  async getStockAlerts(betriebsstaetteId: string) {
    const items = await this.prisma.stockItem.findMany({
      where: { betriebsstaetteId },
      include: { ingredient: true },
    });

    const alerts = [];
    for (const item of items) {
      const qty = new Decimal(item.qtyBase.toString());
      const min = new Decimal(item.mindestbestand.toString());
      if (qty.lessThan(min)) {
        alerts.push({
          stockItemId: item.id,
          ingredientId: item.ingredientId,
          ingredientName: item.ingredient.name,
          qtyBase: item.qtyBase,
          mindestbestand: item.mindestbestand,
          severity: qty.lessThanOrEqualTo(0) ? 'out_of_stock' : 'below_min',
        });
      }
    }
    return alerts;
  }

  async consumeForOrder(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { items: true, kasse: { include: { betriebsstaette: true } } },
    });
    if (!order || order.status !== 'CLOSED') return;

    const betriebsstaetteId = order.kasse.betriebsstaetteId;

    for (const item of order.items) {
      const product = await this.prisma.product.findUnique({
        where: { id: item.productId },
        include: {
          recipe: {
            include: { ingredients: true },
          },
        },
      });
      if (!product?.recipe?.active) continue;

      const recipe = product.recipe;
      const qty = new Decimal(item.qty.toString());
      const yieldQty = new Decimal(recipe.yieldQty.toString());
      const factor = qty.dividedBy(yieldQty);

      for (const ri of recipe.ingredients) {
        const stockItem = await this.prisma.stockItem.findUnique({
          where: {
            ingredientId_betriebsstaetteId: {
              ingredientId: ri.ingredientId,
              betriebsstaetteId,
            },
          },
        });
        if (!stockItem) continue;

        const consumed = new Decimal(ri.qty.toString()).times(factor).negated();
        await this.prisma.stockMovement.create({
          data: {
            stockItemId: stockItem.id,
            type: 'SALE_CONSUMPTION',
            qtyBase: consumed.toNumber(),
            reason: `Sale consumption for order ${orderId}`,
            refOrderId: orderId,
            userId: null,
          },
        });

        await this.prisma.stockItem.update({
          where: { id: stockItem.id },
          data: { qtyBase: { increment: consumed.toNumber() } },
        });
      }
    }
  }
}
