import { IsBoolean, IsDateString, IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreatePromotionDto {
  @IsUUID()
  tenantId!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsNotEmpty()
  rule!: Record<string, unknown>;

  @IsDateString()
  activeFrom!: string;

  @IsDateString()
  @IsOptional()
  activeTo?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}