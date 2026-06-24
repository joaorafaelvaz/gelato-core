import { openDB, type IDBPDatabase } from 'idb'
import type { SaleEvent } from '@gelato/domain'
import type { OutboxRow, SaleStore } from './store'

const DB_NAME = 'gelato-pos'
const VERSION = 1

/**
 * Armazenamento local do terminal no NAVEGADOR (IndexedDB). Vendas append-only +
 * outbox, mesma semântica do LocalRepo (SQLite) do Electron — implementa SaleStore.
 */
export class IdbStore implements SaleStore {
  private readonly dbp: Promise<IDBPDatabase>

  constructor(dbName: string = DB_NAME) {
    this.dbp = openDB(dbName, VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('sales')) {
          db.createObjectStore('sales', { keyPath: 'client_event_id' })
        }
        if (!db.objectStoreNames.contains('outbox')) {
          db.createObjectStore('outbox', { keyPath: 'client_event_id' })
        }
      },
    })
  }

  async saveFinalizedSale(event: SaleEvent, now: number = Date.now()): Promise<void> {
    const db = await this.dbp
    const json = JSON.stringify(event)
    const tx = db.transaction(['sales', 'outbox'], 'readwrite')
    const sales = tx.objectStore('sales')
    if ((await sales.getKey(event.client_event_id)) === undefined) {
      await sales.add({
        client_event_id: event.client_event_id,
        total_gross: event.payload.order.total_gross,
        mode: event.payload.order.mode,
        payload: json,
        created_at: now,
      })
    }
    const outbox = tx.objectStore('outbox')
    if ((await outbox.getKey(event.client_event_id)) === undefined) {
      await outbox.add({
        client_event_id: event.client_event_id,
        payload: json,
        status: 'pending',
        attempts: 0,
        next_attempt_at: 0,
        created_at: now,
      })
    }
    await tx.done
  }

  async pendingOutbox(now: number = Date.now()): Promise<OutboxRow[]> {
    const db = await this.dbp
    const all = (await db.getAll('outbox')) as OutboxRow[]
    return all
      .filter((r) => r.status === 'pending' && r.next_attempt_at <= now)
      .sort((a, b) => a.created_at - b.created_at)
  }

  async markSent(clientEventId: string): Promise<void> {
    const db = await this.dbp
    const row = (await db.get('outbox', clientEventId)) as OutboxRow | undefined
    if (row) {
      row.status = 'sent'
      await db.put('outbox', row)
    }
  }

  async markFailed(clientEventId: string, nextAttemptAt: number): Promise<void> {
    const db = await this.dbp
    const row = (await db.get('outbox', clientEventId)) as OutboxRow | undefined
    if (row) {
      row.attempts += 1
      row.next_attempt_at = nextAttemptAt
      await db.put('outbox', row)
    }
  }

  async countSales(): Promise<number> {
    const db = await this.dbp
    return db.count('sales')
  }

  async countOutbox(status?: string): Promise<number> {
    const db = await this.dbp
    if (!status) return db.count('outbox')
    const all = (await db.getAll('outbox')) as OutboxRow[]
    return all.filter((r) => r.status === status).length
  }
}
