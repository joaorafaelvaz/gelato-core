import type { PosEvent } from '@gelato/domain'
import type { LocalRepo } from '../db/local-repo'

export interface SyncResponse {
  ok: boolean
  duplicate?: boolean
  status: number
}

export interface SyncClient {
  post(event: PosEvent): Promise<SyncResponse>
}

export interface OutboxRunResult {
  sent: number
  failed: number
}

/**
 * Processa o outbox uma vez: para cada evento pendente, faz POST. 2xx (ou
 * duplicate) marca como enviado; falha de rede/erro reagenda com backoff e mantém
 * pendente. Idempotência garante reprocessar com segurança.
 */
export async function runOutboxOnce(
  repo: LocalRepo,
  client: SyncClient,
  now: number = Date.now(),
  backoffMs = 5000,
): Promise<OutboxRunResult> {
  const pending = repo.pendingOutbox(now)
  let sent = 0
  let failed = 0

  for (const row of pending) {
    const event = JSON.parse(row.payload) as PosEvent
    try {
      const res = await client.post(event)
      if (res.ok || res.duplicate) {
        repo.markSent(row.client_event_id)
        sent++
      } else {
        repo.markFailed(row.client_event_id, now + backoffMs * (row.attempts + 1))
        failed++
      }
    } catch {
      repo.markFailed(row.client_event_id, now + backoffMs * (row.attempts + 1))
      failed++
    }
  }

  return { sent, failed }
}

/** Cliente HTTP real para o /pos/sync do central (usado pelo app Electron). */
export class HttpSyncClient implements SyncClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
  ) {}

  async post(event: PosEvent): Promise<SyncResponse> {
    const res = await fetch(`${this.baseUrl}/pos/sync`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.token}` },
      body: JSON.stringify(event),
    })
    let duplicate = false
    try {
      const body = (await res.json()) as { duplicate?: boolean }
      duplicate = Boolean(body.duplicate)
    } catch {
      // resposta sem corpo JSON — ignora
    }
    return { ok: res.ok, duplicate, status: res.status }
  }
}
