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
  customer_id: z.string().optional(),
})

export const OrderItemSchema = z.object({
  product_id: z.string(),
  variant_id: z.string().optional(),
  qty: z.number().int().positive(),
  unit_net: Cents,
  mwst_rate: z.number(),
  mwst_code: z.string(),
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
  tx_number: z.number().int(),
  signature_counter: z.number().int().optional(),
  signature_value: z.string().optional(),
  log_time: z.string().optional(),
  serial_number: z.string().optional(),
  process_type: z.string().optional(),
  public_key: z.string().optional(),
  start_time: z.string().optional(),
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

export type Order = z.infer<typeof OrderSchema>
export type OrderItem = z.infer<typeof OrderItemSchema>
export type Payment = z.infer<typeof PaymentSchema>
export type Receipt = z.infer<typeof ReceiptSchema>
export type TseTransactionData = z.infer<typeof TseTransactionSchema>
export type SalePayload = z.infer<typeof SalePayloadSchema>
export type SaleEvent = z.infer<typeof SaleEventSchema>
