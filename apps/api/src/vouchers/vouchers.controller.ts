import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common'
import { z } from 'zod'
import { VouchersService } from './vouchers.service'
import { JwtAuthGuard, type JwtUser } from '../auth/jwt-auth.guard'
import { PermissionsGuard } from '../rbac/permissions.guard'
import { RequirePermission } from '../rbac/require-permission.decorator'
import { parseOrThrow } from '../common/zod'

const CreateDto = z.object({ code: z.string().min(1), type: z.enum(['percent', 'fixed']), value: z.number().int().nonnegative(), max_uses: z.number().int().positive().optional(), valid_from: z.string().optional(), valid_to: z.string().optional() })
const UpdateDto = z.object({ active: z.boolean().optional(), value: z.number().int().nonnegative().optional(), max_uses: z.number().int().positive().optional() })
const QuoteDto = z.object({ code: z.string().min(1), gross_cents: z.number().int().nonnegative() })

@Controller('vouchers')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class VouchersController {
  constructor(private readonly vouchers: VouchersService) {}

  @Get()
  @RequirePermission('marketing.view')
  async list(@Req() req: { user: JwtUser }) {
    return this.vouchers.list(req.user.tenant_id)
  }

  @Post()
  @RequirePermission('marketing.manage')
  async create(@Req() req: { user: JwtUser }, @Body() body: unknown) {
    return this.vouchers.create(req.user.tenant_id, parseOrThrow(CreateDto, body))
  }

  @Patch(':id')
  @RequirePermission('marketing.manage')
  async update(@Req() req: { user: JwtUser }, @Param('id') id: string, @Body() body: unknown) {
    return this.vouchers.update(req.user.tenant_id, id, parseOrThrow(UpdateDto, body))
  }

  @Post('quote')
  @RequirePermission('pos.sale.create')
  async quote(@Req() req: { user: JwtUser }, @Body() body: unknown) {
    return this.vouchers.quote(req.user.tenant_id, parseOrThrow(QuoteDto, body))
  }
}
