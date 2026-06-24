import { Controller, Get, Req, UseGuards } from '@nestjs/common'
import { JwtAuthGuard, type JwtUser } from '../auth/jwt-auth.guard'
import { PermissionsGuard } from '../rbac/permissions.guard'
import { RequirePermission } from '../rbac/require-permission.decorator'

/** Rotas auxiliares para inspeção/teste de auth + RBAC. */
@Controller()
export class MeController {
  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@Req() req: { user: JwtUser }) {
    return { sub: req.user.sub, tenant_id: req.user.tenant_id, permissions: req.user.permissions }
  }

  @Get('admin/ping')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('admin.users')
  adminPing() {
    return { ok: true }
  }
}
