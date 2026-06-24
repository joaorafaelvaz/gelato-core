import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'

export interface JwtUser {
  sub: string
  tenant_id: string
  kasse_id?: string
  permissions: string[]
  escalated: boolean
}

/** Verifica o Bearer JWT e popula req.user. */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<{ headers: Record<string, string>; user?: JwtUser }>()
    const header = req.headers['authorization']
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedException('missing bearer token')
    try {
      req.user = this.jwt.verify<JwtUser>(header.slice('Bearer '.length))
      return true
    } catch {
      throw new UnauthorizedException('invalid token')
    }
  }
}
