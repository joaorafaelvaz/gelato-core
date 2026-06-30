import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AnalyticsService } from './analytics.service';

@Controller('analytics')
@UseGuards(JwtAuthGuard)
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('dashboard')
  async dashboard(
    @CurrentUser('tenantId') tenantId: string,
    @Query('days') days?: string,
  ) {
    return this.analyticsService.dashboard(tenantId, days ? parseInt(days, 10) : 30);
  }
}