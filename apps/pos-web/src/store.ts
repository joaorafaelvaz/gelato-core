import type { SaleEvent } from '@gelato/domain'

export interface OutboxRow {
  client_event_id: string
  payload: string
  status: string
  attempts: number
  next_attempt_at: number
  created_at: number
}

/**
 * Porta de armazenamento local do terminal (append-only + outbox), ASYNC para
 * funcionar tanto com IndexedDB (web/PWA) quanto com SQLite (Electron).
 */
export interface SaleStore {
  saveFinalizedSale(event: SaleEvent, now?: number): Promise<void>
  pendingOutbox(now?: number): Promise<OutboxRow[]>
  markSent(clientEventId: string): Promise<void>
  markFailed(clientEventId: string, nextAttemptAt: number): Promise<void>
}
