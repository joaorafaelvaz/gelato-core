import {
  IsString,
  IsOptional,
  IsUUID,
  IsDecimal,
  IsBoolean,
  IsEnum,
  IsArray,
} from 'class-validator';

export enum ProductTypeDto {
  VENDAVEL = 'VENDAVEL',
  INSUMO = 'INSUMO',
  SEMI_ACABADO = 'SEMI_ACABADO',
}

export class CreateProductCategoryDto {
  @IsUUID()
  tenantId!: string;

  @IsString()
  name!: string;

  @IsUUID()
  @IsOptional()
  parentId?: string;

  @IsString()
  @IsOptional()
  color?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

export class CreateProductDto {
  @IsUUID()
  tenantId!: string;

  @IsUUID()
  @IsOptional()
  categoryId?: string;

  @IsEnum(ProductTypeDto)
  type!: ProductTypeDto;

  @IsString()
  name!: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsDecimal()
  @IsOptional()
  basePrice?: string;

  @IsDecimal()
  mwstImHaus!: string;

  @IsDecimal()
  mwstAusserHaus!: string;

  @IsString()
  @IsOptional()
  gtin?: string;

  @IsArray()
  @IsOptional()
  allergens?: string[];

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

export class CreateProductVariantDto {
  @IsUUID()
  productId!: string;

  @IsString()
  name!: string;

  @IsDecimal()
  @IsOptional()
  priceDelta?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

export class CreateProductModifierDto {
  @IsUUID()
  productId!: string;

  @IsString()
  name!: string;

  @IsDecimal()
  @IsOptional()
  priceDelta?: string;

  @IsString()
  @IsOptional()
  groupKey?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
