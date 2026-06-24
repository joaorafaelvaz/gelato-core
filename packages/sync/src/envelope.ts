import { SaleEventSchema, type SaleEvent, type SalePayload } from '@gelato/domain'

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
