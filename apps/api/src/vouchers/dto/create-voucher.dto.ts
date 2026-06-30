import { IsBoolean, IsDateString, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateVoucherDto {
  @IsUUID()
  tenantId!: string;

  @IsString()
  @IsNotEmpty()
  code!: string;

  @IsString()
  @IsOptional()
  type?: 'FIXED_AMOUNT' | 'PERCENTAGE' | 'PRODUCT';

  @IsString()
  @IsNotEmpty()
  value!: string;

  @IsDateString()
  validFrom!: string;

  @IsDateString()
  @IsOptional()
  validTo?: string;

  @IsNumber()
  @IsOptional()
  maxUses?: number;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

export class ValidateVoucherDto {
  @IsUUID()
  tenantId!: string;

  @IsString()
  @IsNotEmpty()
  code!: string;

  @IsNumber()
  @IsOptional()
  orderTotal?: number;
}