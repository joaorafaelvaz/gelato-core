import type { SaleEvent } from '@gelato/domain'
import type { AusfallOpenState } from '@gelato/compliance'

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
  enqueueOutbox(clientEventId: string, payload: string, now?: number): Promise<void>
  pendingOutbox(now?: number): Promise<OutboxRow[]>
  markSent(clientEventId: string): Promise<void>
  markFailed(clientEventId: string, nextAttemptAt: number): Promise<void>
  getAusfallState(): Promise<AusfallOpenState | null>
  setAusfallState(state: AusfallOpenState | null): Promise<void>
}
