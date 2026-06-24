import Database from 'better-sqlite3'
import type { SaleEvent } from '@gelato/domain'

// SQLite local = buffer offline-first. As linhas de venda são gravadas append-only;
// o outbox guarda o evento a sincronizar (status operacional pode mudar).
const SCHEMA = `
CREATE TABLE IF NOT EXISTS local_sales (
  client_event_id TEXT PRIMARY KEY,
  total_gross INTEGER NOT NULL,
  mode TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS outbox (
  client_event_id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
`

export interface OutboxRow {
  client_event_id: string
  payload: string
  status: string
  attempts: number
  next_attempt_at: number
  created_at: number
}

export class LocalRepo {
  private readonly db: Database.Database

  constructor(filename = ':memory:') {
    this.db = new Database(filename)
    this.db.pragma('journal_mode = WAL')
    this.db.exec(SCHEMA)
  }

  /** Grava a venda finalizada (append-only) e enfileira no outbox. Idempotente. */
  saveFinalizedSale(event: SaleEvent, now: number = Date.now()): void {
    const json = JSON.stringify(event)
    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT OR IGNORE INTO local_sales (client_event_id, total_gross, mode, payload, created_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(event.client_event_id, event.payload.order.total_gross, event.payload.order.mode, json, now)
      this.db
        .prepare(
          `INSERT OR IGNORE INTO outbox (client_event_id, payload, status, attempts, next_attempt_at, created_at)
           VALUES (?, ?, 'pending', 0, 0, ?)`,
        )
        .run(event.client_event_id, json, now)
    })
    tx()
  }

  pendingOutbox(now: number = Date.now()): OutboxRow[] {
    return this.db
      .prepare(
        `SELECT * FROM outbox WHERE status = 'pending' AND next_attempt_at <= ? ORDER BY created_at ASC`,
      )
      .all(now) as OutboxRow[]
  }

  markSent(clientEventId: string): void {
    this.db.prepare(`UPDATE outbox SET status = 'sent' WHERE client_event_id = ?`).run(clientEventId)
  }

  markFailed(clientEventId: string, nextAttemptAt: number): void {
    this.db
      .prepare(`UPDATE outbox SET attempts = attempts + 1, next_attempt_at = ? WHERE client_event_id = ?`)
      .run(nextAttemptAt, clientEventId)
  }

  countSales(): number {
    return (this.db.prepare(`SELECT count(*) AS c FROM local_sales`).get() as { c: number }).c
  }

  countOutbox(status?: string): number {
    const row = status
      ? this.db.prepare(`SELECT count(*) AS c FROM outbox WHERE status = ?`).get(status)
      : this.db.prepare(`SELECT count(*) AS c FROM outbox`).get()
    return (row as { c: number }).c
  }

  close(): void {
    this.db.close()
  }
}
