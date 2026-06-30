import {
  IsUUID,
  IsString,
  IsOptional,
  IsNumber,
  IsEnum,
} from 'class-validator';

export enum StockMovementTypeDto {
  MANUAL_ADJUST = 'MANUAL_ADJUST',
  RECEIVING = 'RECEIVING',
  SALE_CONSUMPTION = 'SALE_CONSUMPTION',
  WASTE = 'WASTE',
  PRODUCTION = 'PRODUCTION',
  TRANSFER = 'TRANSFER',
  COUNT = 'COUNT',
}

export class CreateIngredientDto {
  @IsUUID()
  tenantId!: string;

  @IsString()
  name!: string;

  @IsString()
  baseUnit!: string;

  @IsString()
  @IsOptional()
  description?: string;
}

export class CreateStockItemDto {
  @IsUUID()
  ingredientId!: string;

  @IsUUID()
  betriebsstaetteId!: string;

  @IsNumber()
  @IsOptional()
  qtyBase?: number;

  @IsNumber()
  @IsOptional()
  mindestbestand?: number;
}

export class CreateStockMovementDto {
  @IsUUID()
  stockItemId!: string;

  @IsEnum(StockMovementTypeDto)
  type!: StockMovementTypeDto;

  @IsNumber()
  qtyBase!: number;

  @IsString()
  @IsOptional()
  reason?: string;

  @IsUUID()
  @IsOptional()
  refOrderId?: string;
}

export class CreateRecipeDto {
  @IsUUID()
  productId!: string;

  @IsNumber()
  yieldQty!: number;

  @IsString()
  yieldUnit!: string;

  @IsNumber()
  @IsOptional()
  active?: number;
}

export class CreateRecipeIngredientDto {
  @IsUUID()
  recipeId!: string;

  @IsUUID()
  ingredientId!: string;

  @IsNumber()
  qty!: number;

  @IsString()
  unit!: string;
}
