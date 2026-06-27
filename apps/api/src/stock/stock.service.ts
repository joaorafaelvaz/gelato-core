import { Injectable, NotFoundException } from '@nestjs/common'
import { aggregateStock, stockAlerts } from '@gelato/compliance'
import { PrismaService } from '../prisma/prisma.service'

@Injectable()
export class StockService {
  constructor(private readonly prisma: PrismaService) {}

  /** Nível atual por item (todos os itens ativos; sem movimento → qty 0). */
  async levels(tenantId: string) {
    const items = await this.prisma.stockItem.findMany({ where: { tenantId, active: true }, orderBy: { name: 'asc' } })
    const movements = await this.prisma.stockMovement.findMany({ where: { tenantId }, select: { stockItemId: true, qtyDelta: true } })
    const qtyById = new Map(aggregateStock(movements).map((l) => [l.stockItemId, l.qty]))
    return items.map((i) => ({ id: i.id, name: i.name, unit: i.unit, minStock: i.minStock, qty: qtyById.get(i.id) ?? 0 }))
  }

  /** Insumos em alerta (baixo/negativo), derivado do nível atual. */
  async alerts(tenantId: string) {
    return stockAlerts(await this.levels(tenantId))
  }

  async createItem(tenantId: string, dto: { name: string; unit: string; min_stock?: number }) {
    return this.prisma.stockItem.create({ data: { tenantId, name: dto.name, unit: dto.unit, minStock: dto.min_stock ?? null } })
  }

  private async ownItemOr404(tenantId: string, stockItemId: string) {
    const item = await this.prisma.stockItem.findFirst({ where: { id: stockItemId, tenantId } })
    if (!item) throw new NotFoundException('stock item')
    return item
  }

  private async currentQty(tenantId: string, stockItemId: string): Promise<number> {
    const movs = await this.prisma.stockMovement.findMany({ where: { tenantId, stockItemId }, select: { stockItemId: true, qtyDelta: true } })
    return aggregateStock(movs)[0]?.qty ?? 0
  }

  async receive(tenantId: string, dto: { stock_item_id: string; qty: number; reason?: string }, userId?: string) {
    await this.ownItemOr404(tenantId, dto.stock_item_id)
    return this.prisma.stockMovement.create({
      data: { tenantId, stockItemId: dto.stock_item_id, type: 'receive', qtyDelta: dto.qty, reason: dto.reason, createdBy: userId },
    })
  }

  async adjust(tenantId: string, dto: { stock_item_id: string; qty_delta: number; reason?: string }, userId?: string) {
    await this.ownItemOr404(tenantId, dto.stock_item_id)
    return this.prisma.stockMovement.create({
      data: { tenantId, stockItemId: dto.stock_item_id, type: 'adjust', qtyDelta: dto.qty_delta, reason: dto.reason, createdBy: userId },
    })
  }

  async count(tenantId: string, dto: { stock_item_id: string; counted: number }, userId?: string) {
    await this.ownItemOr404(tenantId, dto.stock_item_id)
    const delta = dto.counted - (await this.currentQty(tenantId, dto.stock_item_id))
    return this.prisma.stockMovement.create({
      data: { tenantId, stockItemId: dto.stock_item_id, type: 'count', qtyDelta: delta, createdBy: userId },
    })
  }
}
