import { IsNotEmpty, IsNumber, IsString, IsUUID, Min } from 'class-validator';

export class AwardPointsDto {
  @IsUUID()
  customerId!: string;

  @IsNumber()
  @Min(1)
  points!: number;

  @IsString()
  @IsNotEmpty()
  reason!: string;
}