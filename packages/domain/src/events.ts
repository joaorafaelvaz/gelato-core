import { z } from 'zod'
import { CONSUMPTION_MODES } from './consumption'

/** Valores monetários no envelope são inteiros (cents). */
const Cents = z.number().int()

export const OrderSchema = z.object({
  mode: z.enum(CONSUMPTION_MODES),
  total_net: Cents,
  total_mwst: Cents,
  total_gross: Cents,
  shift_id: z.string().optional(),
  table_id: z.string().optional(),
  tisch_session_id: z.string().optional(),
  customer_id: z.string().optional(),
  voucher_code: z.string().optional(),
})

/** Snapshot de um modificador aplicado (capturado no momento da venda). */
export const LineModifierSchema = z.object({ id: z.string(), name: z.string(), net: Cents })

export const OrderItemSchema = z.object({
  product_id: z.string(),
  variant_id: z.string().optional(),
  qty: z.number().int().positive(),
  unit_net: Cents,
  mwst_rate: z.number(),
  mwst_code: z.string(),
  modifiers: z.array(LineModifierSchema).optional(),
})

/** Ciclo 0: apenas dinheiro. Cartão/voucher entram no Ciclo 1. */
export const PaymentSchema = z.object({
  method: z.enum(['cash']),
  amount: Cents,
  ref: z.string().optional(),
})

export const ReceiptSchema = z.object({
  qr_payload: z.string(),
  format: z.enum(['print', 'digital']).optional(),
})

/**
 * Dados da transação TSE. No envelope estrutural só `tx_number` é obrigatório;
 * a completude semântica (signature_value etc.) é garantida na camada de
 * compliance/ledger, onde a venda é efetivamente assinada.
 */
export const TseTransactionSchema = z.object({
  tx_number: z.number().int().optional(),
  signature_counter: z.number().int().optional(),
  signature_value: z.string().optional(),
  log_time: z.string().optional(),
  serial_number: z.string().optional(),
  process_type: z.string().optional(),
  public_key: z.string().optional(),
  start_time: z.string().optional(),
  /** Venda registrada sem assinatura durante um Ausfall da TSE (KassenSichV). */
  is_ausfall: z.boolean().optional(),
})

export const SalePayloadSchema = z.object({
  order: OrderSchema,
  items: z.array(OrderItemSchema),
  payment: PaymentSchema,
  receipt: ReceiptSchema,
  tse_transaction: TseTransactionSchema,
})

/**
 * Evento de venda sincronizado do terminal para o central. `client_event_id`
 * é a chave de idempotência (uuid gerado no terminal).
 */
export const SaleEventSchema = z.object({
  client_event_id: z.string().uuid(),
  type: z.literal('sale'),
  kasse_id: z.string(),
  payload: SalePayloadSchema,
})

/** Evento de período de indisponibilidade da TSE (KassenSichV). Append-only no central. */
export const AusfallEventSchema = z.object({
  client_event_id: z.string().uuid(),
  type: z.literal('tse_ausfall'),
  kasse_id: z.string(),
  payload: z.object({
    event_type: z.enum(['started', 'ended']),
    at: z.string(),
    reason: z.string().optional(),
  }),
})

/** União dos eventos que o terminal sincroniza para o central via POST /pos/sync. */
export const PosEventSchema = z.discriminatedUnion('type', [SaleEventSchema, AusfallEventSchema])

/** Item de Bestellung: qty pode ser negativa (Storno referenciando a original). */
export const BestellungItemSchema = z.object({
  product_id: z.string(),
  variant_id: z.string().optional(),
  qty: z.number().int(),
  unit_net: Cents,
  mwst_rate: z.number(),
  mwst_code: z.string(),
  modifiers: z.array(LineModifierSchema).optional(),
  storno_of: z.string().optional(),
})

/** Evento de Bestellung (envio de itens à conta). Assinado na TSE (Bestellung-V1). */
export const BestellungEventSchema = z.object({
  client_event_id: z.string().uuid(),
  type: z.literal('bestellung'),
  session_id: z.string(),
  kasse_id: z.string(),
  items: z.array(BestellungItemSchema).min(1),
  tse_transaction: TseTransactionSchema,
})

export type LineModifier = z.infer<typeof LineModifierSchema>
export type BestellungItem = z.infer<typeof BestellungItemSchema>
export type BestellungEvent = z.infer<typeof BestellungEventSchema>
export type AusfallEvent = z.infer<typeof AusfallEventSchema>
export type PosEvent = z.infer<typeof PosEventSchema>
export type Order = z.infer<typeof OrderSchema>
export type OrderItem = z.infer<typeof OrderItemSchema>
export type Payment = z.infer<typeof PaymentSchema>
export type Receipt = z.infer<typeof ReceiptSchema>
export type TseTransactionData = z.infer<typeof TseTransactionSchema>
export type SalePayload = z.infer<typeof SalePayloadSchema>
export type SaleEvent = z.infer<typeof SaleEventSchema>
