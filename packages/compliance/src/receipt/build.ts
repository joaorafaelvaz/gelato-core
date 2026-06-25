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
  tse: TseTransactionResult | null
  qrPayload: string
  /** Recibo emitido sem assinatura TSE (período de Ausfall). */
  isAusfall: boolean
}

export interface BuildReceiptInput {
  seller: SellerInfo
  issuedAt: string
  mode: ConsumptionMode
  lines: ReceiptLine[]
  breakdown: MwstBreakdown
  payment: { method: string; amount: Cents }
  tse: TseTransactionResult | null
}

/**
 * Monta o modelo de recibo (Belegausgabepflicht) com itens, totais por alíquota,
 * meio de pagamento, dados da TSE e o payload do QR DFKA. Função pura.
 */
export function buildReceipt(input: BuildReceiptInput): ReceiptModel {
  const t = input.tse
  const qrPayload = t
    ? buildDfkaQrPayload({
        version: 'V0',
        kasseSerialNumber: t.serialNumber,
        processType: t.processType,
        processData: t.processData,
        transactionNumber: t.txNumber,
        signatureCounter: t.signatureCounter,
        startTime: t.startTime,
        logTime: t.logTime,
        signatureAlgorithm: t.signatureAlgorithm,
        logTimeFormat: t.logTimeFormat,
        signature: t.signatureValue,
        publicKey: t.publicKey,
      })
    : ''

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
    tse: t,
    qrPayload,
    isAusfall: t === null,
  }
}
