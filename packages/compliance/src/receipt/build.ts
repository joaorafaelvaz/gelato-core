import type { Cents, ConsumptionMode } from '@gelato/domain'
import type { MwstBreakdown, MwstGroup } from '../mwst/types'
import type { TseTransactionResult } from '../tse/types'
import { buildDfkaQrPayload } from './qr'

export interface SellerInfo {
  name: string
  address?: string
  vatId?: string
}

export interface ReceiptLine {
  name: string
  qty: number
  unitGross: Cents
  lineGross: Cents
  mwstCode: string
}

export interface ReceiptModel {
  seller: SellerInfo
  issuedAt: string
  mode: ConsumptionMode
  lines: ReceiptLine[]
  vatGroups: MwstGroup[]
  total: { net: Cents; mwst: Cents; gross: Cents }
  payment: { method: string; amount: Cents }
  tse: TseTransactionResult
  qrPayload: string
}

export interface BuildReceiptInput {
  seller: SellerInfo
  issuedAt: string
  mode: ConsumptionMode
  lines: ReceiptLine[]
  breakdown: MwstBreakdown
  payment: { method: string; amount: Cents }
  tse: TseTransactionResult
}

/**
 * Monta o modelo de recibo (Belegausgabepflicht) com itens, totais por alíquota,
 * meio de pagamento, dados da TSE e o payload do QR DFKA. Função pura.
 */
export function buildReceipt(input: BuildReceiptInput): ReceiptModel {
  const qrPayload = buildDfkaQrPayload({
    version: 'V0',
    kasseSerialNumber: input.tse.serialNumber,
    processType: input.tse.processType,
    processData: input.tse.processData,
    transactionNumber: input.tse.txNumber,
    signatureCounter: input.tse.signatureCounter,
    startTime: input.tse.startTime,
    logTime: input.tse.logTime,
    signatureAlgorithm: input.tse.signatureAlgorithm,
    logTimeFormat: input.tse.logTimeFormat,
    signature: input.tse.signatureValue,
    publicKey: input.tse.publicKey,
  })

  return {
    seller: input.seller,
    issuedAt: input.issuedAt,
    mode: input.mode,
    lines: input.lines,
    vatGroups: input.breakdown.groups,
    total: {
      net: input.breakdown.totalNet,
      mwst: input.breakdown.totalMwst,
      gross: input.breakdown.totalGross,
    },
    payment: input.payment,
    tse: input.tse,
    qrPayload,
  }
}
