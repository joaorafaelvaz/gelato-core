import { Controller, Get, Query, Req, Res, UseGuards, BadRequestException } from '@nestjs/common'
import { ExportsService } from './exports.service'
import { JwtAuthGuard, type JwtUser } from '../auth/jwt-auth.guard'
import { PermissionsGuard } from '../rbac/permissions.guard'
import { RequirePermission } from '../rbac/require-permission.decorator'

/** Subconjunto do response do Express que usamos para devolver binário (zip). */
interface ZipResponse {
  set(headers: Record<string, string>): void
  send(body: Buffer): void
}

@Controller('exports')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ExportsController {
  constructor(private readonly exports: ExportsService) {}

  @Get('kassen')
  @RequirePermission('admin.export.dsfinvk')
  async kassen(@Req() req: { user: JwtUser }) {
    return this.exports.kassen(req.user.tenant_id)
  }

  @Get('dsfinvk')
  @RequirePermission('admin.export.dsfinvk')
  async dsfinvk(
    @Req() req: { user: JwtUser },
    @Query('kasse_id') kasseId: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @Res() res: ZipResponse,
  ): Promise<void> {
    if (!kasseId || !from || !to) throw new BadRequestException('kasse_id, from, to required')
    const f = new Date(from)
    const t = new Date(to)
    if (isNaN(f.getTime()) || isNaN(t.getTime()) || f > t) throw new BadRequestException('invalid date range')
    const buf = await this.exports.dsfinvkZip(req.user.tenant_id, kasseId, f, t)
    res.set({
      'content-type': 'application/zip',
      'content-disposition': `attachment; filename="dsfinvk_${kasseId}_${from}_${to}.zip"`,
    })
    res.send(buf)
  }
}
