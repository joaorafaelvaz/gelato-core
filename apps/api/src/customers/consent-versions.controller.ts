import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common'
import { z } from 'zod'
import { CustomersService } from './customers.service'
import { JwtAuthGuard, type JwtUser } from '../auth/jwt-auth.guard'
import { PermissionsGuard } from '../rbac/permissions.guard'
import { RequirePermission } from '../rbac/require-permission.decorator'
import { parseOrThrow } from '../common/zod'

const VersionDto = z.object({ purpose: z.string().min(1), text: z.string().min(1) })

@Controller('consent-versions')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ConsentVersionsController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  @RequirePermission('marketing.view')
  async list(@Req() req: { user: JwtUser }) {
    return this.customers.listVersions(req.user.tenant_id)
  }

  @Post()
  @RequirePermission('marketing.manage')
  async publish(@Req() req: { user: JwtUser }, @Body() body: unknown) {
    return this.customers.publishVersion(req.user.tenant_id, parseOrThrow(VersionDto, body))
  }
}
