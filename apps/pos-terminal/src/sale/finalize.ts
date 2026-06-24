import {
  computeMwst,
  buildReceipt,
  type TseProvider,
  type TaxRate,
  type MwstProductRef,
  type ReceiptModel,
  type SellerInfo,
} from '@gelato/compliance'
import { makeEnvelope } from '@gelato/sync'
import { applyRate, type ConsumptionMode, type SaleEvent } from '@gelato/domain'
import type { LocalRepo } from '../db/local-repo'

export interface CartLine {
  product: MwstProductRef & { name: string }
  qty: number
}

export interface FinalizeOpts {
  cart: CartLine[]
  mode: ConsumptionMode
  at: Date
  rates: TaxRate[]
  kasseId: string
  tseClientId: string
  tse: TseProvider
  repo: LocalRepo
  seller: SellerInfo
  idGen?: () => string
}

/**
 * Finaliza uma venda no terminal: calcula MwSt → assina na TSE → monta recibo+QR →
 * grava append-only local + enfileira no outbox. No Ciclo 0, se a assinatura falhar,
 * propaga o erro e NÃO grava nada (caminho feliz online; modo de falha = Ciclo 1).
 */
export async function finalizeSale(
  opts: FinalizeOpts,
): Promise<{ event: SaleEvent; receipt: ReceiptModel }> {
  const { cart, mode, at, rates, kasseId, tseClientId, tse, repo, seller, idGen } = opts
  if (cart.length === 0) throw new Error('empty cart')

  const lines = cart.map((l) => ({ product: l.product, qty: l.qty }))
  const breakdown = computeMwst(lines, mode, at, rates)

  const codeFor = (l: CartLine): string =>
    mode === 'im_haus' ? l.product.mwstCodeImHaus : l.product.mwstCodeAusserHaus
  const rateFor = (code: string): number => breakdown.groups.find((g) => g.code === code)?.rate ?? 0

  // Assina (pode lançar → caller bloqueia a venda; nada gravado)
  const tseResult = await tse.sign({
    clientId: tseClientId,
    processType: 'Kassenbeleg-V1',
    amountsByVatRate: breakdown.groups.map((g) => ({ rate: g.rate, gross: g.gross })),
    paymentType: 'Bar',
    grossTotal: breakdown.totalGross,
  })

  const receipt = buildReceipt({
    seller,
    issuedAt: at.toISOString(),
    mode,
    lines: cart.map((l) => {
      const code = codeFor(l)
      const lineNet = l.product.netCents * l.qty
      const lineGross = lineNet + applyRate(lineNet, rateFor(code))
      return {
        name: l.product.name,
        qty: l.qty,
        unitGross: Math.round(lineGross / l.qty),
        lineGross,
        mwstCode: code,
      }
    }),
    breakdown,
    payment: { method: 'cash', amount: breakdown.totalGross },
    tse: tseResult,
  })

  const event = makeEnvelope(
    kasseId,
    {
      order: {
        mode,
        total_net: breakdown.totalNet,
        total_mwst: breakdown.totalMwst,
        total_gross: breakdown.totalGross,
      },
      items: cart.map((l) => {
        const code = codeFor(l)
        return {
          product_id: l.product.id,
          qty: l.qty,
          unit_net: l.product.netCents,
          mwst_rate: rateFor(code),
          mwst_code: code,
        }
      }),
      payment: { method: 'cash', amount: breakdown.totalGross },
      receipt: { qr_payload: receipt.qrPayload, format: 'digital' },
      tse_transaction: {
        tx_number: tseResult.txNumber,
        signature_counter: tseResult.signatureCounter,
        signature_value: tseResult.signatureValue,
        log_time: tseResult.logTime,
        process_type: tseResult.processType,
        serial_number: tseResult.serialNumber,
        public_key: tseResult.publicKey,
      },
    },
    idGen,
  )

  repo.saveFinalizedSale(event, at.getTime())
  return { event, receipt }
}
