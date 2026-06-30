import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common'
import { z } from 'zod'
import { ProductionService } from './production.service'
import { JwtAuthGuard, type JwtUser } from '../auth/jwt-auth.guard'
import { PermissionsGuard } from '../rbac/permissions.guard'
import { RequirePermission } from '../rbac/require-permission.decorator'
import { parseOrThrow } from '../common/zod'

const Ingredient = z.object({ stock_item_id: z.string().min(1), qty: z.number().int().positive() })
const CreateDto = z.object({ output_stock_item_id: z.string().min(1), yield_qty: z.number().int(), ingredients: z.array(Ingredient) })
const ProduceDto = z.object({ output_stock_item_id: z.string().min(1), batches: z.number().int() })

@Controller('production')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ProductionController {
  constructor(private readonly production: ProductionService) {}

  @Get('recipes')
  @RequirePermission('stock.view')
  async listRecipes(@Req() req: { user: JwtUser }) {
    return this.production.listRecipes(req.user.tenant_id)
  }

  @Post('recipes')
  @RequirePermission('stock.adjust')
  async createRecipe(@Req() req: { user: JwtUser }, @Body() body: unknown) {
    return this.production.createRecipe(req.user.tenant_id, parseOrThrow(CreateDto, body))
  }

  @Post()
  @RequirePermission('stock.adjust')
  async produce(@Req() req: { user: JwtUser }, @Body() body: unknown) {
    return this.production.produce(req.user.tenant_id, parseOrThrow(ProduceDto, body), req.user.sub)
  }
}
