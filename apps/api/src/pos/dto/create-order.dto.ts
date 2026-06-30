import { IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class OrderItemModifierDto {
  @IsUUID()
  modifierId!: string;

  @IsString()
  priceDelta!: string;
}

export class OrderItemDto {
  @IsUUID()
  productId!: string;

  @IsUUID()
  @IsOptional()
  variantId?: string;

  @IsNumber()
  qty!: number;

  @ValidateNested({ each: true })
  @Type(() => OrderItemModifierDto)
  @IsOptional()
  modifiers?: OrderItemModifierDto[];
}

export class OrderPaymentDto {
  @IsString()
  @IsNotEmpty()
  method!: string;

  @IsString()
  amount!: string;

  @IsString()
  @IsOptional()
  reference?: string;
}

export class CreateOrderDto {
  @IsUUID()
  kasseId!: string;

  @IsUUID()
  shiftId!: string;

  @IsString()
  @IsNotEmpty()
  mode!: 'IM_HAUS' | 'AUSSER_HAUS';

  @IsString()
  @IsOptional()
  tableId?: string;

  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  items!: OrderItemDto[];

  @ValidateNested({ each: true })
  @Type(() => OrderPaymentDto)
  @IsOptional()
  payments?: OrderPaymentDto[];

  @IsString()
  @IsOptional()
  customerId?: string;

  @IsString()
  @IsOptional()
  discountType?: 'PERCENTAGE' | 'FIXED';

  @IsString()
  @IsOptional()
  discountValue?: string;

  @IsString()
  @IsOptional()
  voucherCode?: string;
}

export class OpenShiftDto {
  @IsUUID()
  kasseId!: string;

  @IsNumber()
  @IsOptional()
  openingFloat?: number;
}

export class CloseShiftDto {
  @IsNumber()
  @IsOptional()
  closingCount?: number;
}

export class VoidOrderDto {
  @IsString()
  @IsNotEmpty()
  reason!: string;
}