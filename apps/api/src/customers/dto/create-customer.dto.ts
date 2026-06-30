import { IsBoolean, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateCustomerDto {
  @IsUUID()
  tenantId!: string;

  @IsUUID()
  @IsOptional()
  betriebsstaetteId?: string;

  @IsString()
  @IsOptional()
  name?: string;

  @IsOptional()
  contact?: Record<string, unknown>;

  @IsOptional()
  consent?: Record<string, unknown>;

  @IsString()
  @IsOptional()
  birthDate?: string;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}