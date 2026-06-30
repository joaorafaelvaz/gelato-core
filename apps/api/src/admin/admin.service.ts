import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RegisterTseClientDto } from './dto/register-tse-client.dto';

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async registerTseClient(userId: string, dto: RegisterTseClientDto) {
    const kasse = await this.prisma.kasse.findUnique({
      where: { id: dto.kasseId },
      include: { betriebsstaette: true, tseClient: true },
    });
    if (!kasse) throw new NotFoundException('Kasse not found');

    // Deactivate existing TSE client if any
    if (kasse.tseClient) {
      await this.prisma.tseClient.update({
        where: { id: kasse.tseClient.id },
        data: { isActive: false, deregistrationAt: new Date() },
      });
    }

    const credentials: Record<string, string> = {};
    if (dto.apiKey) credentials.apiKey = dto.apiKey;
    if (dto.apiSecret) credentials.apiSecret = dto.apiSecret;
    if (dto.tssId) credentials.tssId = dto.tssId;

    const tseClient = await this.prisma.tseClient.create({
      data: {
        kasseId: dto.kasseId,
        provider: dto.provider,
        serialNumber: dto.serialNumber,
        apiUrl: dto.apiUrl ?? null,
        credentials: Object.keys(credentials).length > 0 ? (credentials as any) : undefined,
        registeredAt: new Date(),
        isActive: true,
      },
    });

    await this.audit.log({
      userId,
      tenantId: kasse.betriebsstaette.tenantId,
      action: 'admin.tse.configure',
      entity: 'tse_client',
      entityId: tseClient.id,
      payload: { kasseId: dto.kasseId, provider: dto.provider, serialNumber: dto.serialNumber },
    });

    return tseClient;
  }

  async getTseClient(kasseId: string) {
    return this.prisma.tseClient.findFirst({
      where: { kasseId, isActive: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async listTseClients() {
    return this.prisma.tseClient.findMany({
      where: { isActive: true },
      include: { kasse: { select: { id: true, name: true, betriebsstaetteId: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async deregisterTseClient(userId: string, tseClientId: string) {
    const client = await this.prisma.tseClient.findUnique({
      where: { id: tseClientId },
      include: { kasse: { include: { betriebsstaette: true } } },
    });
    if (!client) throw new NotFoundException('TSE client not found');

    const updated = await this.prisma.tseClient.update({
      where: { id: tseClientId },
      data: { isActive: false, deregistrationAt: new Date() },
    });

    await this.audit.log({
      userId,
      tenantId: client.kasse.betriebsstaette.tenantId,
      action: 'admin.tse.deregister',
      entity: 'tse_client',
      entityId: tseClientId,
      payload: { kasseId: client.kasseId },
    });

    return updated;
  }

  async getSettings(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { settings: true },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');
    return tenant.settings ?? {};
  }

  async updateSettings(userId: string, tenantId: string, settings: Record<string, unknown>) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('Tenant not found');

    const updated = await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { settings: settings as any },
      select: { settings: true },
    });

    await this.audit.log({
      userId,
      tenantId,
      action: 'admin.settings.update',
      entity: 'tenant',
      entityId: tenantId,
      payload: settings,
    });

    return updated.settings;
  }
}