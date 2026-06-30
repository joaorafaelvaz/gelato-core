import { useEffect, useState, useCallback } from 'react';

const QUEUE_KEY = 'gelato_offline_queue';

export interface QueuedOrder {
  clientEventId: string;
  kasseId: string;
  shiftId: string;
  mode: 'IM_HAUS' | 'AUSSER_HAUS';
  items: {
    productId: string;
    variantId?: string;
    qty: number;
    modifiers?: { modifierId: string; priceDelta: string }[];
  }[];
  payments: { method: string; amount: string }[];
  createdAt: string;
}

function loadQueue(): QueuedOrder[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function saveQueue(queue: QueuedOrder[]) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

export function useOfflineQueue(
  isOnline: boolean,
  processOrder: (order: QueuedOrder) => Promise<void>,
) {
  const [queue, setQueue] = useState<QueuedOrder[]>(loadQueue);
  const [syncing, setSyncing] = useState(false);

  const enqueue = useCallback((order: QueuedOrder) => {
    setQueue((prev) => {
      const next = [...prev, order];
      saveQueue(next);
      return next;
    });
  }, []);

  const sync = useCallback(async () => {
    if (syncing || queue.length === 0) return;
    setSyncing(true);
    const remaining: QueuedOrder[] = [];
    for (const order of queue) {
      try {
        await processOrder(order);
      } catch {
        remaining.push(order);
      }
    }
    setQueue(remaining);
    saveQueue(remaining);
    setSyncing(false);
  }, [queue, syncing, processOrder]);

  // Auto-sync when coming back online
  useEffect(() => {
    if (isOnline && queue.length > 0) {
      sync();
    }
  }, [isOnline, queue.length, sync]);

  const clear = useCallback(() => {
    setQueue([]);
    saveQueue([]);
  }, []);

  return { queue, enqueue, sync, syncing, clear };
}