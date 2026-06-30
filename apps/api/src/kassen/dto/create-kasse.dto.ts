import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateKasseDto {
  @IsString()
  @IsNotEmpty()
  betriebsstaetteId!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsOptional()
  serialNumber?: string;

  @IsString()
  @IsOptional()
  location?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
