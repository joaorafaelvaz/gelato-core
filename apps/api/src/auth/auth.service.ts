import { Injectable, UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { PrismaService } from '../prisma/prisma.service'
import { verifySecret } from './hash'
import { effectivePermissions } from '../rbac/effective'

interface IssueOpts {
  kasseId?: string
  escalated?: boolean
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  private async issueToken(
    userId: string,
    opts: IssueOpts,
  ): Promise<{ access_token: string; permissions: string[] }> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: {
        roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
      },
    })
    const roles = user.roles.map((ur) => ({
      permissions: ur.role.permissions.map((rp) => ({ key: rp.permission.key })),
    }))
    const permissions = effectivePermissions(roles)
    const access_token = await this.jwt.signAsync({
      sub: user.id,
      tenant_id: user.tenantId,
      kasse_id: opts.kasseId,
      permissions,
      escalated: opts.escalated ?? false,
    })
    return { access_token, permissions }
  }

  async loginPassword(email: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { email } })
    if (!user || !user.active || !(await verifySecret(user.passwordHash, password))) {
      throw new UnauthorizedException('invalid credentials')
    }
    return this.issueToken(user.id, { escalated: true })
  }

  async loginPin(kasseId: string, pin: string) {
    const kasse = await this.prisma.kasse.findUnique({
      where: { id: kasseId },
      include: { betriebsstaette: true },
    })
    if (!kasse) throw new UnauthorizedException('invalid kasse')
    const candidates = await this.prisma.user.findMany({
      where: { tenantId: kasse.betriebsstaette.tenantId, active: true, pinHash: { not: null } },
    })
    for (const u of candidates) {
      if (u.pinHash && (await verifySecret(u.pinHash, pin))) {
        return this.issueToken(u.id, { kasseId, escalated: false })
      }
    }
    throw new UnauthorizedException('invalid pin')
  }

  async escalate(userId: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } })
    if (!user || !(await verifySecret(user.passwordHash, password))) {
      throw new UnauthorizedException('invalid credentials')
    }
    return this.issueToken(user.id, { escalated: true })
  }
}
