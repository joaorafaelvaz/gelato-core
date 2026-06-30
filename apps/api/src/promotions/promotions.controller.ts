import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequirePermissions } from '../permissions/permissions.decorator';
import { PromotionsService } from './promotions.service';
import { CreatePromotionDto } from './dto/create-promotion.dto';

@Controller('promotions')
@UseGuards(JwtAuthGuard)
export class PromotionsController {
  constructor(private readonly promotionsService: PromotionsService) {}

  @Post()
  @RequirePermissions('marketing.manage')
  create(@Body() dto: CreatePromotionDto, @CurrentUser('userId') userId: string) {
    return this.promotionsService.create(userId, dto);
  }

  @Get()
  @RequirePermissions('marketing.view')
  findAll(
    @CurrentUser('tenantId') tenantId: string,
    @Query('active') active?: string,
  ) {
    return this.promotionsService.findByTenant(tenantId, active === 'true');
  }

  @Post(':id/activate')
  @RequirePermissions('marketing.manage')
  activate(
    @Param('id') id: string,
    @CurrentUser('userId') userId: string,
    @CurrentUser('tenantId') tenantId: string,
  ) {
    return this.promotionsService.toggle(userId, id, true, tenantId);
  }

  @Post(':id/deactivate')
  @RequirePermissions('marketing.manage')
  deactivate(
    @Param('id') id: string,
    @CurrentUser('userId') userId: string,
    @CurrentUser('tenantId') tenantId: string,
  ) {
    return this.promotionsService.toggle(userId, id, false, tenantId);
  }
}