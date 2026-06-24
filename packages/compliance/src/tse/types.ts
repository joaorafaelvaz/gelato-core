/** Tipo de processo TSE para um recibo de venda (KassenSichV). */
export type TseProcessType = 'Kassenbeleg-V1'

/** Meio de pagamento no nível da TSE: Bar (dinheiro) ou Unbar (não-dinheiro). */
export type TsePaymentType = 'Bar' | 'Unbar'

export interface TseAmountByVatRate {
  rate: number
  gross: number
}

export interface TseSignRequest {
  /** Id do client TSE vinculado à Kasse. */
  clientId: string
  processType: TseProcessType
  /** Brutos por alíquota — entram nos dados de processo assinados. */
  amountsByVatRate: TseAmountByVatRate[]
  paymentType: TsePaymentType
  grossTotal: number
}

/** Resultado de uma assinatura TSE — gravado junto da venda (append-only). */
export interface TseTransactionResult {
  txNumber: number
  signatureCounter: number
  signatureValue: string
  logTime: string
  startTime: string
  serialNumber: string
  processType: TseProcessType
  publicKey: string
  /** Dados de processo assinados (ProzessDaten), usados também no QR. */
  processData: string
  signatureAlgorithm: string
  logTimeFormat: string
}
