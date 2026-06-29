import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common'
import { z } from 'zod'
import { CampaignsService } from './campaigns.service'
import { JwtAuthGuard, type JwtUser } from '../auth/jwt-auth.guard'
import { PermissionsGuard } from '../rbac/permissions.guard'
import { RequirePermission } from '../rbac/require-permission.decorator'
import { parseOrThrow } from '../common/zod'

const CreateDto = z.object({ name: z.string().min(1), channel: z.enum(['email', 'sms']), subject: z.string().optional(), body: z.string().min(1) })

@Controller('campaigns')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class CampaignsController {
  constructor(private readonly campaigns: CampaignsService) {}

  @Get()
  @RequirePermission('marketing.view')
  async list(@Req() req: { user: JwtUser }) {
    return this.campaigns.list(req.user.tenant_id)
  }

  @Post()
  @RequirePermission('marketing.manage')
  async create(@Req() req: { user: JwtUser }, @Body() body: unknown) {
    return this.campaigns.create(req.user.tenant_id, parseOrThrow(CreateDto, body))
  }

  @Get(':id/recipients')
  @RequirePermission('marketing.view')
  async recipients(@Req() req: { user: JwtUser }, @Param('id') id: string) {
    return this.campaigns.recipients(req.user.tenant_id, id)
  }

  @Post(':id/send')
  @RequirePermission('marketing.manage')
  async send(@Req() req: { user: JwtUser }, @Param('id') id: string) {
    return this.campaigns.send(req.user.tenant_id, id)
  }
}
