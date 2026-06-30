import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditLogInput {
  userId?: string;
  tenantId: string;
  action: string;
  entity: string;
  entityId?: string;
  payload?: Record<string, unknown>;
  ipAddress?: string;
  deviceInfo?: string;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async log(input: AuditLogInput) {
    return this.prisma.auditLog.create({
      data: {
        userId: input.userId ?? null,
        tenantId: input.tenantId,
        action: input.action,
        entity: input.entity,
        entityId: input.entityId ?? null,
        payload: (input.payload ?? undefined) as any,
        ipAddress: input.ipAddress ?? null,
        deviceInfo: input.deviceInfo ?? null,
      },
    });
  }
}