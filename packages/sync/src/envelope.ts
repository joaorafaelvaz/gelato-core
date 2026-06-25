import {
  SaleEventSchema,
  AusfallEventSchema,
  type SaleEvent,
  type SalePayload,
  type AusfallEvent,
} from '@gelato/domain'

/** Gerador de id padrão (Web Crypto, disponível em Node 19+ e no renderer). */
const defaultIdGen = (): string => crypto.randomUUID()

/**
 * Monta um envelope de evento de venda com `client_event_id` (chave de
 * idempotência). Valida contra o schema do domínio. `idGen` é injetável para
 * testes determinísticos.
 */
export function makeEnvelope(
  kasseId: string,
  payload: SalePayload,
  idGen: () => string = defaultIdGen,
): SaleEvent {
  const event: SaleEvent = {
    client_event_id: idGen(),
    type: 'sale',
    kasse_id: kasseId,
    payload,
  }
  return SaleEventSchema.parse(event)
}

/**
 * Monta um envelope de evento de Ausfall (período de indisponibilidade da TSE)
 * com `client_event_id` idempotente. Valida contra o schema do domínio.
 */
export function makeAusfallEnvelope(
  kasseId: string,
  payload: AusfallEvent['payload'],
  idGen: () => string = defaultIdGen,
): AusfallEvent {
  return AusfallEventSchema.parse({
    client_event_id: idGen(),
    type: 'tse_ausfall',
    kasse_id: kasseId,
    payload,
  })
}
