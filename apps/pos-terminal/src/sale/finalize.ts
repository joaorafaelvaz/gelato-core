import {
  computeMwst,
  buildReceipt,
  signWithFallback,
  type AusfallTracker,
  type SignOutcome,
  type TseProvider,
  type TaxRate,
  type MwstProductRef,
  type ReceiptModel,
  type SellerInfo,
} from '@gelato/compliance'
import { makeEnvelope, makeAusfallEnvelope } from '@gelato/sync'
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
  shiftId?: string
  tseClientId: string
  tse: TseProvider
  repo: LocalRepo
  seller: SellerInfo
  tracker: AusfallTracker
  timeoutMs?: number
  idGen?: () => string
}

export interface FinalizeResult {
  event: SaleEvent
  receipt: ReceiptModel
  outcome: SignOutcome
}

/**
 * Finaliza uma venda no terminal: calcula MwSt → tenta assinar na TSE com timeout →
 * monta recibo (com ou sem QR) → grava append-only local + enfileira no outbox. Se a
 * TSE estiver indisponível (falha/timeout), a venda completa MESMO ASSIM em modo
 * TSE-Ausfall (sem assinatura): nunca bloqueia. O tracker emite started/ended na
 * borda do período (enfileirados no outbox) e o estado é persistido localmente.
 */
export async function finalizeSale(opts: FinalizeOpts): Promise<FinalizeResult> {
  const { cart, mode, at, rates, kasseId, shiftId, tseClientId, tse, repo, seller, tracker, timeoutMs, idGen } =
    opts
  if (cart.length === 0) throw new Error('empty cart')

  const lines = cart.map((l) => ({ product: l.product, qty: l.qty }))
  const breakdown = computeMwst(lines, mode, at, rates)

  const codeFor = (l: CartLine): string =>
    mode === 'im_haus' ? l.product.mwstCodeImHaus : l.product.mwstCodeAusserHaus
  const rateFor = (code: string): number => breakdown.groups.find((g) => g.code === code)?.rate ?? 0

  const outcome = await signWithFallback(
    tse,
    {
      clientId: tseClientId,
      processType: 'Kassenbeleg-V1',
      amountsByVatRate: breakdown.groups.map((g) => ({ rate: g.rate, gross: g.gross })),
      paymentType: 'Bar',
      grossTotal: breakdown.totalGross,
    },
    { timeoutMs },
  )
  const tseResult = outcome.kind === 'signed' ? outcome.tse : null

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

  const tseTransaction = tseResult
    ? {
        tx_number: tseResult.txNumber,
        signature_counter: tseResult.signatureCounter,
        signature_value: tseResult.signatureValue,
        log_time: tseResult.logTime,
        process_type: tseResult.processType,
        serial_number: tseResult.serialNumber,
        public_key: tseResult.publicKey,
        is_ausfall: false,
      }
    : { is_ausfall: true }

  const event = makeEnvelope(
    kasseId,
    {
      order: {
        mode,
        shift_id: shiftId,
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
      tse_transaction: tseTransaction,
    },
    idGen,
  )

  const now = at.getTime()
  repo.saveFinalizedSale(event, now)

  // Borda do período: emite started/ended uma única vez e persiste o estado.
  const reason = outcome.kind === 'ausfall' ? outcome.reason : ''
  for (const kind of tracker.record(outcome.kind, at.toISOString(), reason)) {
    const env = makeAusfallEnvelope(
      kasseId,
      { event_type: kind, at: at.toISOString(), reason: kind === 'started' ? reason : undefined },
      idGen,
    )
    repo.enqueueOutbox(env.client_event_id, JSON.stringify(env), now)
  }
  repo.setAusfallState(tracker.current)

  return { event, receipt, outcome }
}
