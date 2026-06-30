import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequirePermissions } from '../permissions/permissions.decorator';
import { StockService } from './stock.service';
import {
  CreateIngredientDto,
  CreateRecipeDto,
  CreateRecipeIngredientDto,
  CreateStockItemDto,
  CreateStockMovementDto,
} from './dto/create-stock.dto';

@Controller('stock')
@UseGuards(JwtAuthGuard)
export class StockController {
  constructor(private readonly stockService: StockService) {}

  @Post('ingredients')
  @RequirePermissions('stock.manage')
  createIngredient(
    @Body() dto: CreateIngredientDto,
    @CurrentUser('userId') userId: string,
  ) {
    return this.stockService.createIngredient(userId, dto);
  }

  @Get('ingredients')
  @RequirePermissions('stock.view')
  findIngredients(@CurrentUser('tenantId') tenantId: string) {
    return this.stockService.findIngredientsByTenant(tenantId);
  }

  @Post('items')
  @RequirePermissions('stock.manage')
  createStockItem(
    @Body() dto: CreateStockItemDto,
    @CurrentUser('userId') userId: string,
  ) {
    return this.stockService.createStockItem(userId, dto);
  }

  @Get('items/:branchId')
  @RequirePermissions('stock.view')
  findStockByBranch(@Param('branchId') branchId: string) {
    return this.stockService.findStockByBranch(branchId);
  }

  @Post('movements')
  @RequirePermissions('stock.adjust')
  createMovement(
    @Body() dto: CreateStockMovementDto,
    @CurrentUser('userId') userId: string,
  ) {
    return this.stockService.createMovement(userId, dto);
  }

  @Post('recipes')
  @RequirePermissions('recipe.manage')
  createRecipe(
    @Body() dto: CreateRecipeDto,
    @CurrentUser('userId') userId: string,
  ) {
    return this.stockService.createRecipe(userId, dto);
  }

  @Post('recipes/ingredients')
  @RequirePermissions('recipe.manage')
  createRecipeIngredient(
    @Body() dto: CreateRecipeIngredientDto,
    @CurrentUser('userId') userId: string,
  ) {
    return this.stockService.createRecipeIngredient(userId, dto);
  }

  @Get('availability/:productId/:branchId')
  @RequirePermissions('stock.view')
  getAvailability(
    @Param('productId') productId: string,
    @Param('branchId') branchId: string,
  ) {
    return this.stockService.getAvailability(productId, branchId);
  }

  @Get('alerts/:branchId')
  @RequirePermissions('stock.view')
  getAlerts(@Param('branchId') branchId: string) {
    return this.stockService.getStockAlerts(branchId);
  }
}
