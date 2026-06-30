import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { OutboxEvent, SyncPushResponse } from '@gelato/sync';

@Injectable()
export class SyncService {
  constructor(private readonly prisma: PrismaService) {}

  async pushEvents(kasseId: string, eventsInput: OutboxEvent[]): Promise<SyncPushResponse> {
    const events = Array.isArray(eventsInput) ? eventsInput : [];
    const processed: string[] = [];
    const failed: { clientEventId: string; error: string }[] = [];
    const skipped: string[] = [];

    for (const event of events) {
      const existing = await this.prisma.outboxEvent.findUnique({
        where: { clientEventId: event.clientEventId },
      });
      if (existing) {
        if (existing.status === 'delivered') {
          skipped.push(event.clientEventId);
          continue;
        }
      }

      try {
        await this.prisma.$transaction(async (tx) => {
          await tx.outboxEvent.upsert({
            where: { clientEventId: event.clientEventId },
            create: {
              id: event.id,
              clientEventId: event.clientEventId,
              kasseId,
              entity: event.entity,
              action: event.action,
              payload: event.payload as any,
              status: 'delivered',
              retryCount: 0,
              deliveredAt: new Date(),
            },
            update: {
              status: 'delivered',
              retryCount: { increment: 1 },
              deliveredAt: new Date(),
              error: null,
            },
          });

          await this.applyEvent(tx, event);
        });

        processed.push(event.clientEventId);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        failed.push({ clientEventId: event.clientEventId, error: message });
        await this.prisma.outboxEvent.upsert({
          where: { clientEventId: event.clientEventId },
          create: {
            id: event.id,
            clientEventId: event.clientEventId,
            kasseId,
            entity: event.entity,
            action: event.action,
            payload: event.payload as any,
            status: 'failed',
            retryCount: 1,
            error: message,
          },
          update: {
            status: 'failed',
            retryCount: { increment: 1 },
            error: message,
          },
        });
      }
    }

    return { processed, failed, skipped };
  }

  private async applyEvent(_tx: any, _event: OutboxEvent) {
    // Server-side reconciliation hooks per entity/action.
  }
}
