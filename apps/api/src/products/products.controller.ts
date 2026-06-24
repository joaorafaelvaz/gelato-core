import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common'
import { z } from 'zod'
import { ProductsService } from './products.service'
import { JwtAuthGuard, type JwtUser } from '../auth/jwt-auth.guard'
import { PermissionsGuard } from '../rbac/permissions.guard'
import { RequirePermission } from '../rbac/require-permission.decorator'
import { parseOrThrow } from '../common/zod'

const ProductDto = z.object({
  name: z.string().min(1),
  netCents: z.number().int().nonnegative(),
  mwstCodeImHaus: z.string().min(1),
  mwstCodeAusserHaus: z.string().min(1),
  type: z.enum(['vendavel', 'insumo', 'semi_acabado']).optional(),
})

@Controller()
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get('products')
  @RequirePermission('product.view')
  list(@Req() req: { user: JwtUser }) {
    return this.products.list(req.user.tenant_id)
  }

  @Post('products')
  @RequirePermission('product.manage')
  create(@Req() req: { user: JwtUser }, @Body() body: unknown) {
    return this.products.create(req.user.tenant_id, parseOrThrow(ProductDto, body))
  }

  @Get('tax-rates')
  @RequirePermission('product.view')
  taxRates(@Req() req: { user: JwtUser }) {
    return this.products.taxRates(req.user.tenant_id)
  }
}
