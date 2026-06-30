import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async validateUser(email: string, password: string, tenantSlug: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { slug: tenantSlug },
    });
    if (!tenant) return null;

    const user = await this.prisma.user.findUnique({
      where: { tenantId_email: { tenantId: tenant.id, email } },
      include: {
        userRoles: {
          include: {
            role: {
              include: {
                rolePermissions: { include: { permission: true } },
              },
            },
          },
        },
        betriebsstaetten: true,
      },
    });
    if (!user || !user.isActive) return null;

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return null;

    return { user, tenant };
  }

  async login(email: string, password: string, tenantSlug: string) {
    const validated = await this.validateUser(email, password, tenantSlug);
    if (!validated) throw new UnauthorizedException('Invalid credentials');

    const { user, tenant } = validated;
    const permissions = new Set(
      user.userRoles
        .flatMap((ur: { role: { rolePermissions: { permission: { key: string } }[] } }) => ur.role.rolePermissions)
        .map((rp: { permission: { key: string } }) => rp.permission.key),
    );

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const payload = {
      sub: user.id,
      tenantId: tenant.id,
      email: user.email,
      roles: user.userRoles.map((ur: { role: { key: string } }) => ur.role.key),
      permissions: Array.from(permissions),
    };

    return {
      accessToken: this.jwtService.sign(payload),
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        tenantId: tenant.id,
        tenantSlug: tenant.slug,
        betriebsstaetteIds: user.betriebsstaetten.map((b: { betriebsstaetteId: string }) => b.betriebsstaetteId),
        roles: payload.roles,
        permissions: payload.permissions,
      },
    };
  }
}
