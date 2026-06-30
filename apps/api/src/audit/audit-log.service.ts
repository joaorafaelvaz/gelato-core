import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuditLogService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(params: {
    tenantId: string;
    action?: string;
    entity?: string;
    userId?: string;
    limit?: number;
    offset?: number;
  }) {
    const where: Record<string, unknown> = { tenantId: params.tenantId };
    if (params.action) where.action = { contains: params.action };
    if (params.entity) where.entity = params.entity;
    if (params.userId) where.userId = params.userId;

    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: params.limit ?? 50,
        skip: params.offset ?? 0,
        include: {
          user: { select: { id: true, name: true, email: true } },
        },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return { rows, total };
  }
}