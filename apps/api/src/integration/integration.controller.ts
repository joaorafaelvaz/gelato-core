import { BadRequestException, Controller, Get, Query, Req, UseGuards } from '@nestjs/common'
import { JwtAuthGuard, type JwtUser } from '../auth/jwt-auth.guard'
import { PermissionsGuard } from '../rbac/permissions.guard'
import { RequirePermission } from '../rbac/require-permission.decorator'
import { IntegrationService } from './integration.service'

function intParam(value: string | undefined, name: string, min: number, max: number, dflt: number): number {
  if (value === undefined) return dflt
  const n = Number(value)
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new BadRequestException(`${name} must be an integer between ${min} and ${max}`)
  }
  return n
}

/** API read-only para a integração Skyview (spec §4). */
@Controller('integration')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermission('integration.read')
export class IntegrationController {
  constructor(private readonly svc: IntegrationService) {}

  @Get('events')
  events(
    @Req() req: { user: JwtUser },
    @Query('after') after?: string,
    @Query('limit') limit?: string,
  ) {
    return this.svc.events(
      req.user.tenant_id,
      intParam(after, 'after', 0, Number.MAX_SAFE_INTEGER, 0),
      intParam(limit, 'limit', 1, 1000, 500),
    )
  }

  @Get('stores')
  stores(@Req() req: { user: JwtUser }) {
    return this.svc.stores(req.user.tenant_id)
  }

  @Get('products')
  products(@Req() req: { user: JwtUser }) {
    return this.svc.products(req.user.tenant_id)
  }

  @Get('staff')
  staff(@Req() req: { user: JwtUser }) {
    return this.svc.staff(req.user.tenant_id)
  }
}
