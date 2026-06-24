/**
 * A chave de idempotência de um evento é o seu `client_event_id`. A garantia
 * forte vive no central (tabela `sync_events` com unique). Estes helpers são
 * para a lógica do outbox-worker e testes.
 */
export function eventKey(event: { client_event_id: string }): string {
  return event.client_event_id
}

export function isDuplicate(seen: Set<string>, clientEventId: string): boolean {
  return seen.has(clientEventId)
}

export function remember(seen: Set<string>, clientEventId: string): void {
  seen.add(clientEventId)
}
