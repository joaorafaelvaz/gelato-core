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
import { ProductsService } from './products.service';
import {
  CreateProductCategoryDto,
  CreateProductDto,
  CreateProductModifierDto,
  CreateProductVariantDto,
} from './dto/create-product.dto';

@Controller('products')
@UseGuards(JwtAuthGuard)
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Post('categories')
  @RequirePermissions('product.manage')
  createCategory(
    @Body() dto: CreateProductCategoryDto,
    @CurrentUser('userId') userId: string,
  ) {
    return this.productsService.createCategory(userId, dto);
  }

  @Get('categories')
  @RequirePermissions('product.view')
  findCategories(@CurrentUser('tenantId') tenantId: string) {
    return this.productsService.findCategoriesByTenant(tenantId);
  }

  @Post()
  @RequirePermissions('product.manage')
  createProduct(
    @Body() dto: CreateProductDto,
    @CurrentUser('userId') userId: string,
  ) {
    return this.productsService.createProduct(userId, dto);
  }

  @Get()
  @RequirePermissions('product.view')
  findByTenant(@CurrentUser('tenantId') tenantId: string) {
    return this.productsService.findByTenant(tenantId);
  }

  @Get(':id')
  @RequirePermissions('product.view')
  findById(@Param('id') id: string) {
    return this.productsService.findById(id);
  }

  @Post('variants')
  @RequirePermissions('product.manage')
  createVariant(@Body() dto: CreateProductVariantDto) {
    return this.productsService.createVariant(dto);
  }

  @Post('modifiers')
  @RequirePermissions('product.manage')
  createModifier(@Body() dto: CreateProductModifierDto) {
    return this.productsService.createModifier(dto);
  }
}
