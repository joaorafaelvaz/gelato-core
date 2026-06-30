interface SqlDb {
  execute: (sql: string, params?: unknown[]) => Promise<unknown>;
  select: (sql: string, params?: unknown[]) => Promise<OutboxRow[]>;
}

let dbInstance: SqlDb | null = null;

export async function getDb(): Promise<SqlDb | null> {
  if (typeof window === 'undefined') return null;
  if (dbInstance) return dbInstance;

  try {
    const { default: Database } = await import('@tauri-apps/plugin-sql');
    const db = (await Database.load('sqlite:gelato_pos.db')) as SqlDb;
    dbInstance = db;
    await ensureSchema(db);
    return db;
  } catch (err) {
    console.warn('Tauri SQLite not available, running in browser fallback mode', err);
    return createFallbackDb();
  }
}

async function ensureSchema(db: SqlDb) {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS outbox_events (
      id TEXT PRIMARY KEY,
      client_event_id TEXT UNIQUE NOT NULL,
      kasse_id TEXT,
      entity TEXT NOT NULL,
      action TEXT NOT NULL,
      payload TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      retry_count INTEGER DEFAULT 0,
      error TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      delivered_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_outbox_status ON outbox_events(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_outbox_kasse ON outbox_events(kasse_id, client_event_id);
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS local_orders (
      id TEXT PRIMARY KEY,
      kasse_id TEXT NOT NULL,
      shift_id TEXT,
      mode TEXT DEFAULT 'IM_HAUS',
      status TEXT DEFAULT 'OPEN',
      total_net TEXT,
      total_mwst TEXT,
      total_gross TEXT,
      customer_id TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

function createFallbackDb() {
  // Minimal in-memory fallback for browser dev without Tauri.
  const memory = new Map<string, unknown[]>();
  return {
    execute: async (sql: string) => {
      console.log('[fallback db execute]', sql);
      return { rowsAffected: 0 };
    },
    select: async <T = unknown>(sql: string, _params?: unknown[]) => {
      console.log('[fallback db select]', sql);
      return (memory.get('default') ?? []) as T[];
    },
  };
}

export type OutboxRow = {
  id: string;
  client_event_id: string;
  kasse_id: string | null;
  entity: string;
  action: string;
  payload: string;
  status: 'pending' | 'delivered' | 'failed';
  retry_count: number;
  error: string | null;
  created_at: string;
  delivered_at: string | null;
};

export async function insertOutboxEvent(db: SqlDb, event: Omit<OutboxRow, 'retry_count' | 'error' | 'delivered_at'>) {
  await db.execute(
    `INSERT INTO outbox_events (id, client_event_id, kasse_id, entity, action, payload, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [event.id, event.client_event_id, event.kasse_id, event.entity, event.action, event.payload, event.status, event.created_at],
  );
}

export async function getPendingOutboxEvents(db: SqlDb, limit = 100) {
  return db.select(
    `SELECT * FROM outbox_events WHERE status = 'pending' ORDER BY created_at ASC LIMIT ?`,
    [limit],
  );
}

export async function markOutboxDelivered(db: SqlDb, clientEventId: string) {
  await db.execute(
    `UPDATE outbox_events SET status = 'delivered', delivered_at = CURRENT_TIMESTAMP WHERE client_event_id = ?`,
    [clientEventId],
  );
}

export async function markOutboxFailed(db: SqlDb, clientEventId: string, error: string) {
  await db.execute(
    `UPDATE outbox_events SET status = 'failed', retry_count = retry_count + 1, error = ? WHERE client_event_id = ?`,
    [error, clientEventId],
  );
}
