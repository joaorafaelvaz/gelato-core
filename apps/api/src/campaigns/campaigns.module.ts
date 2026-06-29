import { Module } from '@nestjs/common'
import { FakeCampaignSender } from '@gelato/compliance'
import { AuthModule } from '../auth/auth.module'
import { PermissionsGuard } from '../rbac/permissions.guard'
import { CampaignsService, CAMPAIGN_SENDER } from './campaigns.service'
import { CampaignsController } from './campaigns.controller'

@Module({
  imports: [AuthModule],
  controllers: [CampaignsController],
  providers: [CampaignsService, PermissionsGuard, { provide: CAMPAIGN_SENDER, useClass: FakeCampaignSender }],
})
export class CampaignsModule {}
