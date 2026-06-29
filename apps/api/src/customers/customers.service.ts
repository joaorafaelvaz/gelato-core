import { Injectable, BadRequestException, NotFoundException, ConflictException } from '@nestjs/common'
import { currentConsents, type ConsentAction } from '@gelato/compliance'
import { PrismaService } from '../prisma/prisma.service'

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  private view(c: { id: string; name: string | null; email: string | null; phone: string | null; anonymizedAt: Date | null; consents: { purpose: string; action: string; at: Date }[] }) {
    return {
      id: c.id,
      name: c.name,
      email: c.email,
      phone: c.phone,
      anonymizedAt: c.anonymizedAt,
      consents: currentConsents(c.consents.map((r) => ({ purpose: r.purpose, action: r.action as ConsentAction, at: r.at.getTime() }))),
    }
  }

  async list(tenantId: string) {
    const cs = await this.prisma.customer.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' }, include: { consents: true } })
    return cs.map((c) => this.view(c))
  }

  private async ownOr404(tenantId: string, id: string) {
    const c = await this.prisma.customer.findFirst({ where: { id, tenantId }, include: { consents: true } })
    if (!c) throw new NotFoundException('customer')
    return c
  }

  async get(tenantId: string, id: string) {
    return this.view(await this.ownOr404(tenantId, id))
  }

  async create(tenantId: string, dto: { name?: string; email?: string; phone?: string }) {
    if (!dto.name && !dto.email && !dto.phone) throw new BadRequestException('at least one contact field')
    const c = await this.prisma.customer.create({ data: { tenantId, name: dto.name, email: dto.email, phone: dto.phone } })
    return { id: c.id }
  }

  async update(tenantId: string, id: string, dto: { name?: string; email?: string; phone?: string }) {
    const c = await this.ownOr404(tenantId, id)
    if (c.anonymizedAt) throw new ConflictException('customer anonymized')
    await this.prisma.customer.update({ where: { id }, data: { name: dto.name, email: dto.email, phone: dto.phone } })
    return { id }
  }

  async recordConsent(tenantId: string, id: string, dto: { purpose: string; action: ConsentAction; source?: string }) {
    await this.ownOr404(tenantId, id)
    let version = 0
    let textSnapshot = ''
    if (dto.action === 'granted') {
      const cv = await this.prisma.consentVersion.findFirst({ where: { tenantId, purpose: dto.purpose, active: true }, orderBy: { version: 'desc' } })
      if (!cv) throw new BadRequestException('no published consent version for purpose')
      version = cv.version
      textSnapshot = cv.text
    }
    await this.prisma.consentRecord.create({ data: { tenantId, customerId: id, purpose: dto.purpose, version, textSnapshot, action: dto.action, source: dto.source } })
    return { ok: true }
  }

  async anonymize(tenantId: string, id: string) {
    const c = await this.ownOr404(tenantId, id)
    if (c.anonymizedAt) return { ok: true } // idempotente
    const current = currentConsents(c.consents.map((r) => ({ purpose: r.purpose, action: r.action as ConsentAction, at: r.at.getTime() })))
    const granted = Object.entries(current).filter(([, a]) => a === 'granted').map(([p]) => p)
    await this.prisma.$transaction([
      ...granted.map((p) => this.prisma.consentRecord.create({ data: { tenantId, customerId: id, purpose: p, action: 'withdrawn', source: 'anonymize' } })),
      this.prisma.customer.update({ where: { id }, data: { name: null, email: null, phone: null, anonymizedAt: new Date() } }),
    ])
    return { ok: true }
  }

  async listVersions(tenantId: string) {
    return this.prisma.consentVersion.findMany({ where: { tenantId }, orderBy: [{ purpose: 'asc' }, { version: 'desc' }] })
  }

  async publishVersion(tenantId: string, dto: { purpose: string; text: string }) {
    const last = await this.prisma.consentVersion.findFirst({ where: { tenantId, purpose: dto.purpose }, orderBy: { version: 'desc' } })
    const version = (last?.version ?? 0) + 1
    await this.prisma.$transaction([
      this.prisma.consentVersion.updateMany({ where: { tenantId, purpose: dto.purpose }, data: { active: false } }),
      this.prisma.consentVersion.create({ data: { tenantId, purpose: dto.purpose, version, text: dto.text, active: true } }),
    ])
    return { version }
  }
}
