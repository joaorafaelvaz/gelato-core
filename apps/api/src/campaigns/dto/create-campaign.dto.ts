import { IsDateString, IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateCampaignDto {
  @IsUUID()
  tenantId!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsOptional()
  channel?: 'EMAIL' | 'WHATSAPP' | 'SMS';

  @IsOptional()
  segment?: Record<string, unknown>;

  @IsDateString()
  @IsOptional()
  scheduledAt?: string;

  @IsString()
  @IsOptional()
  status?: 'DRAFT' | 'SCHEDULED' | 'SENT' | 'CANCELLED';

  @IsOptional()
  content?: Record<string, unknown>;
}

export class UpdateCampaignStatusDto {
  @IsString()
  @IsNotEmpty()
  status!: 'DRAFT' | 'SCHEDULED' | 'SENT' | 'CANCELLED';
}