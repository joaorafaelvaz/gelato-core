export type OutboxEventStatus = 'pending' | 'delivered' | 'failed';

export interface OutboxEvent {
  id: string;
  clientEventId: string;
  kasseId?: string;
  entity: string;
  action: string;
  payload: Record<string, unknown>;
  status: OutboxEventStatus;
  retryCount: number;
  error?: string;
  createdAt: string;
  deliveredAt?: string;
}

export interface SyncPushRequest {
  kasseId: string;
  events: OutboxEvent[];
}

export interface SyncPushResponse {
  processed: string[]; // clientEventIds delivered
  failed: { clientEventId: string; error: string }[];
  skipped: string[]; // already processed
}
