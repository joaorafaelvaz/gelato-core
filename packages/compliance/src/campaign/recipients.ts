import { canContact, type ConsentRecordInput } from '../consent/state'

/** Canal → propósito de consentimento. Vazio = canal sem mapeamento (público vazio). Puro. */
export function consentPurposeForChannel(channel: string): string {
  if (channel === 'email') return 'email_marketing'
  if (channel === 'sms') return 'sms_marketing'
  return ''
}

export interface RecipientCandidate {
  id: string
  anonymized: boolean
  contact: string | null
  records: ConsentRecordInput[]
}

/** Ids elegíveis: consentimento válido p/ o propósito E contato do canal presente. Puro. */
export function eligibleRecipients(customers: RecipientCandidate[], purpose: string): string[] {
  if (!purpose) return []
  return customers.filter((c) => c.contact != null && canContact(c.records, purpose, c.anonymized)).map((c) => c.id)
}
