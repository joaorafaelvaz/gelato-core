import { Body, Controller, HttpCode, Post, Req, UseGuards } from '@nestjs/common'
import { PosEventSchema } from '@gelato/domain'
import { LedgerService } from './ledger.service'
import { JwtAuthGuard, type JwtUser } from '../auth/jwt-auth.guard'
import { PermissionsGuard } from '../rbac/permissions.guard'
import { RequirePermission } from '../rbac/require-permission.decorator'
import { parseOrThrow } from '../common/zod'

interface PosRequest {
  user: JwtUser
  ip?: string
  headers: Record<string, string>
}

@Controller('pos')
export class SyncController {
  constructor(private readonly ledger: LedgerService) {}

  /** Push idempotente do outbox do terminal. Chave: client_event_id. */
  @Post('sync')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('pos.sale.create')
  async sync(@Req() req: PosRequest, @Body() body: unknown) {
    const event = parseOrThrow(PosEventSchema, body)
    const actor = { userId: req.user.sub, ip: req.ip, device: req.headers['user-agent'] }
    const result =
      event.type === 'tse_ausfall'
        ? await this.ledger.ingestAusfall(event, actor)
        : await this.ledger.ingest(event, actor)
    return { ok: true, ...result }
  }
}
