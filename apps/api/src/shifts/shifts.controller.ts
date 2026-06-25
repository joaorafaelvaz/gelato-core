import { Body, Controller, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common'
import { z } from 'zod'
import { ShiftsService } from './shifts.service'
import { JwtAuthGuard, type JwtUser } from '../auth/jwt-auth.guard'
import { PermissionsGuard } from '../rbac/permissions.guard'
import { RequirePermission } from '../rbac/require-permission.decorator'
import { parseOrThrow } from '../common/zod'

const OpenDto = z.object({ kasse_id: z.string().min(1), opening_float: z.number().int().nonnegative() })
const CashDto = z.object({
  type: z.enum(['sangria', 'suprimento']),
  amount: z.number().int().positive(),
  reason: z.string().optional(),
})
const CloseDto = z.object({ counted: z.number().int().nonnegative() })

interface PosReq {
  user: JwtUser
  ip?: string
  headers: Record<string, string>
}

@Controller('pos')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ShiftsController {
  constructor(private readonly shifts: ShiftsService) {}

  private ctx(req: PosReq) {
    return { userId: req.user.sub, ip: req.ip, device: req.headers['user-agent'] }
  }

  @Post('shifts/open')
  @HttpCode(200)
  @RequirePermission('pos.shift.open')
  async open(@Req() req: PosReq, @Body() body: unknown) {
    const dto = parseOrThrow(OpenDto, body)
    return this.shifts.open(dto.kasse_id, dto.opening_float, this.ctx(req))
  }

  @Post('shifts/:id/cash-movement')
  @HttpCode(200)
  @RequirePermission('pos.shift.open')
  async cashMovement(@Param('id') id: string, @Req() req: PosReq, @Body() body: unknown) {
    const dto = parseOrThrow(CashDto, body)
    return this.shifts.cashMovement(id, dto.type, dto.amount, dto.reason, this.ctx(req))
  }

  @Post('drawer/open')
  @HttpCode(200)
  @RequirePermission('pos.drawer.open')
  async drawer(@Req() req: PosReq) {
    return this.shifts.drawerOpen(this.ctx(req))
  }

  @Post('shifts/:id/close')
  @HttpCode(200)
  @RequirePermission('pos.shift.close')
  async close(@Param('id') id: string, @Req() req: PosReq, @Body() body: unknown) {
    const dto = parseOrThrow(CloseDto, body)
    return this.shifts.close(id, dto.counted, this.ctx(req))
  }
}
