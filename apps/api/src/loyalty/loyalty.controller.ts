import { Body, Controller, Get, Param, Post, Put, Req, UseGuards } from '@nestjs/common'
import { z } from 'zod'
import { LoyaltyService } from './loyalty.service'
import { JwtAuthGuard, type JwtUser } from '../auth/jwt-auth.guard'
import { PermissionsGuard } from '../rbac/permissions.guard'
import { RequirePermission } from '../rbac/require-permission.decorator'
import { parseOrThrow } from '../common/zod'

const RedeemDto = z.object({ points: z.number().int().nonnegative().optional(), stamps: z.number().int().nonnegative().optional(), reason: z.string().optional() })
const ProgramDto = z.object({ points_per_euro: z.number().int().nonnegative().optional(), stamps_per_item: z.number().int().nonnegative().optional(), active: z.boolean().optional() })

@Controller()
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class LoyaltyController {
  constructor(private readonly loyalty: LoyaltyService) {}

  @Get('customers/:id/loyalty')
  @RequirePermission('marketing.view')
  async balance(@Req() req: { user: JwtUser }, @Param('id') id: string) {
    return this.loyalty.balance(req.user.tenant_id, id)
  }

  @Post('customers/:id/loyalty/redeem')
  @RequirePermission('customer.manage')
  async redeem(@Req() req: { user: JwtUser }, @Param('id') id: string, @Body() body: unknown) {
    return this.loyalty.redeem(req.user.tenant_id, id, parseOrThrow(RedeemDto, body))
  }

  @Get('loyalty/program')
  @RequirePermission('marketing.view')
  async getProgram(@Req() req: { user: JwtUser }) {
    return this.loyalty.getProgram(req.user.tenant_id)
  }

  @Put('loyalty/program')
  @RequirePermission('marketing.manage')
  async putProgram(@Req() req: { user: JwtUser }, @Body() body: unknown) {
    return this.loyalty.putProgram(req.user.tenant_id, parseOrThrow(ProgramDto, body))
  }
}
