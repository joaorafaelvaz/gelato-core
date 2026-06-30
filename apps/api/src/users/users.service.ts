import { Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateUserDto) {
    const passwordHash = await bcrypt.hash(dto.password, 12);
    const pinHash = dto.pin ? await bcrypt.hash(dto.pin, 12) : null;

    const roleKeys = dto.roleKeys ?? [];
    const roles =
      roleKeys.length > 0
        ? await this.prisma.role.findMany({
            where: { tenantId: dto.tenantId, key: { in: roleKeys } },
          })
        : [];

    return this.prisma.user.create({
      data: {
        tenantId: dto.tenantId,
        email: dto.email,
        name: dto.name,
        passwordHash,
        pinHash,
        isActive: dto.isActive ?? true,
        userRoles: {
          create: roles.map((role: { id: string }) => ({ roleId: role.id })),
        },
        betriebsstaetten: {
          create:
            dto.betriebsstaetteIds?.map((id: string) => ({
              betriebsstaetteId: id,
            })) ?? [],
        },
      },
      include: { userRoles: { include: { role: true } } },
    });
  }

  async findById(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: {
        userRoles: { include: { role: { include: { rolePermissions: { include: { permission: true } } } } } },
        betriebsstaetten: true,
      },
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async findByTenant(tenantId: string) {
    return this.prisma.user.findMany({
      where: { tenantId },
      include: { userRoles: { include: { role: true } } },
    });
  }
}
