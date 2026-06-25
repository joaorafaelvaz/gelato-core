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
  idGen?: () => string
}

/**
 * Finaliza a venda INTEIRAMENTE no navegador: MwSt → assina (TSE) → recibo+QR →
 * grava no IndexedDB (append-only) + enfileira no outbox. Mesma lógica fiscal do
 * terminal Electron (pacotes @gelato/*), só que com store async.
 */
export async function finalizeSale(
  opts: FinalizeOpts,
): Promise<{ event: SaleEvent; receipt: ReceiptModel }> {
  const { cart, mode, at, rates, kasseId, shiftId, tseClientId, tse, store, seller, idGen } = opts
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

  await store.saveFinalizedSale(event, at.getTime())
  return { event, receipt }
}

export interface SyncResponse {
  ok: boolean
  duplicate?: boolean
  status: number
}

export interface SyncClient {
  post(event: SaleEvent): Promise<SyncResponse>
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
    const event = JSON.parse(row.payload) as SaleEvent
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

  async post(event: SaleEvent): Promise<SyncResponse> {
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
