import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequirePermissions } from '../permissions/permissions.decorator';
import { LoyaltyService } from './loyalty.service';
import { AwardPointsDto } from './dto/award-points.dto';

@Controller('loyalty')
@UseGuards(JwtAuthGuard)
export class LoyaltyController {
  constructor(private readonly loyaltyService: LoyaltyService) {}

  @Get()
  @RequirePermissions('customer.manage')
  findByTenant(@CurrentUser('tenantId') tenantId: string) {
    return this.loyaltyService.findByTenant(tenantId);
  }

  @Get('customer/:customerId')
  @RequirePermissions('customer.manage')
  getAccount(@Param('customerId') customerId: string) {
    return this.loyaltyService.getAccount(customerId);
  }

  @Post('award')
  @RequirePermissions('customer.manage')
  awardPoints(
    @Body() dto: AwardPointsDto,
    @CurrentUser('userId') userId: string,
  ) {
    return this.loyaltyService.awardPoints(dto.customerId, dto.points, dto.reason, userId);
  }

  @Post('redeem')
  @RequirePermissions('customer.manage')
  redeemPoints(
    @Body() dto: AwardPointsDto,
    @CurrentUser('userId') userId: string,
  ) {
    return this.loyaltyService.redeemPoints(dto.customerId, dto.points, dto.reason, userId);
  }
}