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
import { applyRate, type ConsumptionMode, type SaleEvent, type PosEvent } from '@gelato/domain'
import type { SaleStore } from './store'

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
  store: SaleStore
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
 * Finaliza a venda INTEIRAMENTE no navegador: MwSt → tenta assinar (TSE) com timeout →
 * recibo (com/sem QR) → grava no IndexedDB (append-only) + outbox. Se a TSE estiver
 * indisponível, a venda completa em modo TSE-Ausfall (sem assinatura) — nunca bloqueia.
 * Mesma lógica fiscal do terminal Electron (pacotes @gelato/*), só que com store async.
 */
export async function finalizeSale(opts: FinalizeOpts): Promise<FinalizeResult> {
  const { cart, mode, at, rates, kasseId, shiftId, tseClientId, tse, store, seller, tracker, timeoutMs, idGen } =
    opts
  if (cart.length === 0) throw new Error('empty cart')

  const breakdown = computeMwst(
    cart.map((l) => ({ product: l.product, qty: l.qty })),
    mode,
    at,
    rates,
  )
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
  await store.saveFinalizedSale(event, now)

  // Borda do período: emite started/ended uma única vez e persiste o estado.
  const reason = outcome.kind === 'ausfall' ? outcome.reason : ''
  for (const kind of tracker.record(outcome.kind, at.toISOString(), reason)) {
    const env = makeAusfallEnvelope(
      kasseId,
      { event_type: kind, at: at.toISOString(), reason: kind === 'started' ? reason : undefined },
      idGen,
    )
    await store.enqueueOutbox(env.client_event_id, JSON.stringify(env), now)
  }
  await store.setAusfallState(tracker.current)

  return { event, receipt, outcome }
}

export interface SyncResponse {
  ok: boolean
  duplicate?: boolean
  status: number
}

export interface SyncClient {
  post(event: PosEvent): Promise<SyncResponse>
}

/** Processa o outbox uma vez (igual ao terminal Electron, store async). */
export async function runOutboxOnce(
  store: SaleStore,
  client: SyncClient,
  now: number = Date.now(),
  backoffMs = 5000,
): Promise<{ sent: number; failed: number }> {
  const pending = await store.pendingOutbox(now)
  let sent = 0
  let failed = 0
  for (const row of pending) {
    const event = JSON.parse(row.payload) as PosEvent
    try {
      const res = await client.post(event)
      if (res.ok || res.duplicate) {
        await store.markSent(row.client_event_id)
        sent++
      } else {
        await store.markFailed(row.client_event_id, now + backoffMs * (row.attempts + 1))
        failed++
      }
    } catch {
      await store.markFailed(row.client_event_id, now + backoffMs * (row.attempts + 1))
      failed++
    }
  }
  return { sent, failed }
}

export class HttpSyncClient implements SyncClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
  ) {}

  async post(event: PosEvent): Promise<SyncResponse> {
    const res = await fetch(`${this.baseUrl}/pos/sync`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.token}` },
      body: JSON.stringify(event),
    })
    let duplicate = false
    try {
      const body = (await res.json()) as { duplicate?: boolean }
      duplicate = Boolean(body.duplicate)
    } catch {
      // sem corpo JSON
    }
    return { ok: res.ok, duplicate, status: res.status }
  }
}
