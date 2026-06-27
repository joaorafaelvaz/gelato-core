import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common'
import { z } from 'zod'
import { StockService } from './stock.service'
import { JwtAuthGuard, type JwtUser } from '../auth/jwt-auth.guard'
import { PermissionsGuard } from '../rbac/permissions.guard'
import { RequirePermission } from '../rbac/require-permission.decorator'
import { parseOrThrow } from '../common/zod'

const CreateItemDto = z.object({ name: z.string().min(1), unit: z.string().min(1), min_stock: z.number().int().nonnegative().optional() })
const ReceiveDto = z.object({ stock_item_id: z.string().min(1), qty: z.number().int().positive(), reason: z.string().optional() })
const AdjustDto = z.object({ stock_item_id: z.string().min(1), qty_delta: z.number().int().refine((n) => n !== 0, 'qty_delta must be non-zero'), reason: z.string().optional() })
const CountDto = z.object({ stock_item_id: z.string().min(1), counted: z.number().int().nonnegative() })

@Controller('stock')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class StockController {
  constructor(private readonly stock: StockService) {}

  @Get()
  @RequirePermission('stock.view')
  async levels(@Req() req: { user: JwtUser }) {
    return this.stock.levels(req.user.tenant_id)
  }

  @Post('items')
  @RequirePermission('stock.adjust')
  async createItem(@Req() req: { user: JwtUser }, @Body() body: unknown) {
    return this.stock.createItem(req.user.tenant_id, parseOrThrow(CreateItemDto, body))
  }

  @Post('receive')
  @RequirePermission('stock.receive')
  async receive(@Req() req: { user: JwtUser }, @Body() body: unknown) {
    return this.stock.receive(req.user.tenant_id, parseOrThrow(ReceiveDto, body), req.user.sub)
  }

  @Post('adjust')
  @RequirePermission('stock.adjust')
  async adjust(@Req() req: { user: JwtUser }, @Body() body: unknown) {
    return this.stock.adjust(req.user.tenant_id, parseOrThrow(AdjustDto, body), req.user.sub)
  }

  @Post('count')
  @RequirePermission('stock.count')
  async count(@Req() req: { user: JwtUser }, @Body() body: unknown) {
    return this.stock.count(req.user.tenant_id, parseOrThrow(CountDto, body), req.user.sub)
  }
}
