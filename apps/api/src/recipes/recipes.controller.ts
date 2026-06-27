import { Body, Controller, Get, HttpCode, Param, Post, Put, Req, UseGuards } from '@nestjs/common'
import { z } from 'zod'
import { RecipesService } from './recipes.service'
import { JwtAuthGuard, type JwtUser } from '../auth/jwt-auth.guard'
import { PermissionsGuard } from '../rbac/permissions.guard'
import { RequirePermission } from '../rbac/require-permission.decorator'
import { parseOrThrow } from '../common/zod'

const Ingredient = z.object({ stock_item_id: z.string().min(1), qty: z.number().int().positive() })
const CreateDto = z.object({
  product_id: z.string().min(1),
  variant_id: z.string().min(1).nullish(),
  ingredients: z.array(Ingredient).min(1),
})
const UpdateDto = z.object({
  ingredients: z.array(Ingredient).min(1).optional(),
  active: z.boolean().optional(),
})

@Controller('recipes')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class RecipesController {
  constructor(private readonly recipes: RecipesService) {}

  @Get()
  @RequirePermission('recipe.view')
  async list(@Req() req: { user: JwtUser }) {
    return this.recipes.list(req.user.tenant_id)
  }

  @Post()
  @RequirePermission('recipe.manage')
  async create(@Req() req: { user: JwtUser }, @Body() body: unknown) {
    return this.recipes.create(req.user.tenant_id, parseOrThrow(CreateDto, body))
  }

  @Put(':id')
  @HttpCode(200)
  @RequirePermission('recipe.manage')
  async update(@Req() req: { user: JwtUser }, @Param('id') id: string, @Body() body: unknown) {
    return this.recipes.update(req.user.tenant_id, id, parseOrThrow(UpdateDto, body))
  }
}
