import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { PERMISSION_KEY } from './require-permission.decorator'
import type { JwtUser } from '../auth/jwt-auth.guard'

/** Exige a permissão marcada por @RequirePermission. Usar APÓS o JwtAuthGuard. */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string | undefined>(PERMISSION_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ])
    if (!required) return true
    const req = ctx.switchToHttp().getRequest<{ user?: JwtUser }>()
    const perms = req.user?.permissions ?? []
    if (!perms.includes(required)) {
      throw new ForbiddenException(`missing permission: ${required}`)
    }
    return true
  }
}
