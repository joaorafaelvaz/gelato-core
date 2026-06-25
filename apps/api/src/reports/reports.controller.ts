import { Body, Controller, HttpCode, Post, Req, UseGuards } from '@nestjs/common'
import { z } from 'zod'
import { ReportsService } from './reports.service'
import { JwtAuthGuard, type JwtUser } from '../auth/jwt-auth.guard'
import { PermissionsGuard } from '../rbac/permissions.guard'
import { RequirePermission } from '../rbac/require-permission.decorator'
import { parseOrThrow } from '../common/zod'

const KasseDto = z.object({ kasse_id: z.string().min(1) })

@Controller('pos')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Post('reports/x')
  @HttpCode(200)
  @RequirePermission('pos.report.x')
  async x(@Body() body: unknown) {
    const { kasse_id } = parseOrThrow(KasseDto, body)
    return this.reports.snapshotX(kasse_id)
  }

  @Post('reports/z')
  @HttpCode(200)
  @RequirePermission('pos.report.z')
  async z(@Req() req: { user: JwtUser }, @Body() body: unknown) {
    const { kasse_id } = parseOrThrow(KasseDto, body)
    return this.reports.createZ(kasse_id, req.user.sub)
  }
}
