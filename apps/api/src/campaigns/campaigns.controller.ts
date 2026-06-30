import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequirePermissions } from '../permissions/permissions.decorator';
import { CampaignsService } from './campaigns.service';
import { CreateCampaignDto, UpdateCampaignStatusDto } from './dto/create-campaign.dto';

@Controller('campaigns')
@UseGuards(JwtAuthGuard)
export class CampaignsController {
  constructor(private readonly campaignsService: CampaignsService) {}

  @Post()
  @RequirePermissions('marketing.manage')
  create(@Body() dto: CreateCampaignDto, @CurrentUser('userId') userId: string) {
    return this.campaignsService.create(userId, dto);
  }

  @Get()
  @RequirePermissions('marketing.view')
  findAll(@CurrentUser('tenantId') tenantId: string) {
    return this.campaignsService.findByTenant(tenantId);
  }

  @Get(':id')
  @RequirePermissions('marketing.view')
  findById(@Param('id') id: string) {
    return this.campaignsService.findById(id);
  }

  @Post(':id/status')
  @RequirePermissions('marketing.manage')
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateCampaignStatusDto,
    @CurrentUser('userId') userId: string,
    @CurrentUser('tenantId') tenantId: string,
  ) {
    return this.campaignsService.updateStatus(userId, id, dto, tenantId);
  }

  @Post('segment/preview')
  @RequirePermissions('marketing.view')
  previewSegment(
    @CurrentUser('tenantId') tenantId: string,
    @Body() body: { segment?: Record<string, unknown> },
  ) {
    return this.campaignsService.previewSegment(tenantId, body.segment ?? null);
  }
}