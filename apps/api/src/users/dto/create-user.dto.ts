import { IsArray, IsBoolean, IsEmail, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateUserDto {
  @IsString()
  @IsNotEmpty()
  tenantId!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsNotEmpty()
  password!: string;

  @IsString()
  @IsOptional()
  pin?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  roleKeys?: string[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  betriebsstaetteIds?: string[];

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
