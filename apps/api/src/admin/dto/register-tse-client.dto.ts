import { IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

export class RegisterTseClientDto {
  @IsUUID()
  kasseId!: string;

  @IsString()
  @IsNotEmpty()
  provider!: 'fiskaly' | 'swissbit';

  @IsString()
  @IsNotEmpty()
  serialNumber!: string;

  @IsString()
  @IsOptional()
  apiUrl?: string;

  @IsString()
  @IsOptional()
  apiKey?: string;

  @IsString()
  @IsOptional()
  apiSecret?: string;

  @IsString()
  @IsOptional()
  tssId?: string;
}