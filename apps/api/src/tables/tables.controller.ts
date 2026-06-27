import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Req, UseGuards, BadRequestException } from '@nestjs/common'
import { z } from 'zod'
import { BestellungEventSchema } from '@gelato/domain'
import { TablesService } from './tables.service'
import { JwtAuthGuard, type JwtUser } from '../auth/jwt-auth.guard'
import { PermissionsGuard } from '../rbac/permissions.guard'
import { RequirePermission } from '../rbac/require-permission.decorator'
import { parseOrThrow } from '../common/zod'

@Controller('pos')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class TablesController {
  constructor(private readonly tables: TablesService) {}

  @Get('tables')
  @RequirePermission('pos.table.view')
  async list(@Query('kasse_id') kasseId: string) {
    if (!kasseId) throw new BadRequestException('kasse_id required')
    return this.tables.listTables(kasseId)
  }

  @Post('tables/:tischId/open')
  @HttpCode(200)
  @RequirePermission('pos.table.open')
  async open(@Req() req: { user: JwtUser }, @Param('tischId') tischId: string, @Body() body: { kasse_id?: string }) {
    if (!body?.kasse_id) throw new BadRequestException('kasse_id required')
    return this.tables.openSession(tischId, body.kasse_id, req.user.sub)
  }

  @Get('sessions/:id')
  @RequirePermission('pos.table.view')
  async session(@Param('id') id: string) {
    return this.tables.getSession(id)
  }

  @Post('sessions/:id/bestellung')
  @HttpCode(200)
  @RequirePermission('pos.sale.create')
  async bestellung(@Req() req: { user: JwtUser }, @Param('id') id: string, @Body() body: unknown) {
    const event = parseOrThrow(BestellungEventSchema, body)
    if (event.session_id !== id) throw new BadRequestException('session_id mismatch')
    return this.tables.addBestellung(id, event, req.user.sub)
  }

  @Post('sessions/:id/pay')
  @HttpCode(200)
  @RequirePermission('pos.sale.create')
  async pay(@Req() req: { user: JwtUser; ip?: string; headers: Record<string, string> }, @Param('id') id: string, @Body() body: unknown) {
    const dto = parseOrThrow(PayDto, body)
    return this.tables.pay(id, dto, { userId: req.user.sub, ip: req.ip, device: req.headers['user-agent'] })
  }

  @Post('sessions/:id/transfer')
  @HttpCode(200)
  @RequirePermission('pos.table.open')
  async transfer(@Req() req: { user: JwtUser }, @Param('id') id: string, @Body() body: { target_tisch_id?: string }) {
    if (!body?.target_tisch_id) throw new BadRequestException('target_tisch_id required')
    return this.tables.transfer(id, body.target_tisch_id, req.user.sub)
  }

  @Patch('tables/:id/position')
  @HttpCode(200)
  @RequirePermission('pos.table.open')
  async position(@Req() req: { user: JwtUser }, @Param('id') id: string, @Body() body: unknown) {
    const dto = parseOrThrow(PositionDto, body)
    return this.tables.updatePosition(id, dto.pos_x, dto.pos_y, req.user.tenant_id)
  }
}

const PositionDto = z.object({ pos_x: z.number().int(), pos_y: z.number().int() })

const PayDto = z.object({
  client_event_id: z.string().uuid(),
  amount: z.number().int().positive().optional(),
  payment: z.object({ method: z.literal('cash'), amount: z.number().int(), ref: z.string().optional() }),
  tse: z.record(z.unknown()),
})
