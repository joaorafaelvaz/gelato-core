/**
 * Payload do QR-Code de verificação de recibo (DFKA "QR-Code für die
 * Belegprüfung"). Os campos são unidos por ";" na ordem abaixo.
 *
 * ⚠️ A ordem/conjunto EXATO de campos DEVE ser validado contra a especificação
 * DFKA vigente antes de produção — não confiar em memória. O teste de snapshot
 * apenas trava o comportamento atual, não a conformidade legal.
 */
export interface DfkaQrInput {
  version: string // ex.: 'V0'
  kasseSerialNumber: string
  processType: string // 'Kassenbeleg-V1'
  processData: string
  transactionNumber: number
  signatureCounter: number
  startTime: string
  logTime: string
  signatureAlgorithm: string // ex.: 'ecdsa-plain-SHA256'
  logTimeFormat: string // 'utcTime' | 'unixTime'
  signature: string // base64
  publicKey: string // base64
}

export function buildDfkaQrPayload(i: DfkaQrInput): string {
  return [
    i.version,
    i.kasseSerialNumber,
    i.processType,
    i.processData,
    String(i.transactionNumber),
    String(i.signatureCounter),
    i.startTime,
    i.logTime,
    i.signatureAlgorithm,
    i.logTimeFormat,
    i.signature,
    i.publicKey,
  ].join(';')
}
