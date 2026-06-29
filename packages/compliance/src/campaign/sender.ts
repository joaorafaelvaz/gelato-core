export interface CampaignRecipient {
  id: string
  contact: string
}
export interface CampaignSendParams {
  channel: string
  recipients: CampaignRecipient[]
  subject?: string
  body: string
}

/** Porta de envio — o transporte real (email/SMS) fica atrás desta interface. */
export interface CampaignSender {
  send(params: CampaignSendParams): Promise<{ sent: number }>
}

/** Default de dev/teste: não envia de verdade, só conta. */
export class FakeCampaignSender implements CampaignSender {
  async send(params: CampaignSendParams): Promise<{ sent: number }> {
    return { sent: params.recipients.length }
  }
}

/** Esqueleto NÃO VERIFICADO de um provider real (email/SMS). Precisa de provider + creds + integração. */
export class SkeletonCampaignSender implements CampaignSender {
  async send(): Promise<{ sent: number }> {
    throw new Error('campaign sender not configured (NOT VERIFIED)')
  }
}
