import { Inject, Injectable, ConflictException, NotFoundException } from '@nestjs/common'
import { consentPurposeForChannel, eligibleRecipients, type CampaignSender, type ConsentAction } from '@gelato/compliance'
import { PrismaService } from '../prisma/prisma.service'

export const CAMPAIGN_SENDER = 'CAMPAIGN_SENDER'

@Injectable()
export class CampaignsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CAMPAIGN_SENDER) private readonly sender: CampaignSender,
  ) {}

  async list(tenantId: string) {
    return this.prisma.campaign.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' } })
  }

  async create(tenantId: string, dto: { name: string; channel: string; subject?: string; body: string }) {
    const c = await this.prisma.campaign.create({ data: { tenantId, name: dto.name, channel: dto.channel, subject: dto.subject, body: dto.body } })
    return { id: c.id }
  }

  async recipients(tenantId: string, id: string) {
    const c = await this.prisma.campaign.findFirst({ where: { id, tenantId } })
    if (!c) throw new NotFoundException('campaign')
    return this.prisma.campaignDispatch.findMany({ where: { tenantId, campaignId: id }, orderBy: { at: 'asc' } })
  }

  async send(tenantId: string, id: string) {
    const c = await this.prisma.campaign.findFirst({ where: { id, tenantId } })
    if (!c) throw new NotFoundException('campaign')
    if (c.status === 'sent') throw new ConflictException('campaign already sent')

    const purpose = consentPurposeForChannel(c.channel)
    const customers = await this.prisma.customer.findMany({ where: { tenantId }, include: { consents: true } })
    const candidates = customers.map((cust) => ({
      id: cust.id,
      anonymized: cust.anonymizedAt != null,
      contact: c.channel === 'email' ? cust.email : cust.phone,
      records: cust.consents.map((r) => ({ purpose: r.purpose, action: r.action as ConsentAction, at: r.at.getTime() })),
    }))
    const eligible = new Set(eligibleRecipients(candidates, purpose))
    const recipients = candidates.filter((x) => eligible.has(x.id)).map((x) => ({ id: x.id, contact: x.contact as string }))

    await this.sender.send({ channel: c.channel, recipients, subject: c.subject ?? undefined, body: c.body })

    await this.prisma.$transaction([
      ...recipients.map((r) => this.prisma.campaignDispatch.create({ data: { tenantId, campaignId: id, customerId: r.id, channel: c.channel } })),
      this.prisma.campaign.update({ where: { id }, data: { status: 'sent', sentAt: new Date(), recipientCount: recipients.length } }),
    ])
    return { recipientCount: recipients.length }
  }
}
