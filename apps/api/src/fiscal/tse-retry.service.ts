import {
  Injectable,
  Logger,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { TseFactory } from '../compliance/tse/tse-factory.service';
import { FiscalService } from '../fiscal/fiscal.service';

@Injectable()
export class TseRetryService {
  private readonly logger = new Logger(TseRetryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tseFactory: TseFactory,
    private readonly fiscal: FiscalService,
    private readonly audit: AuditService,
  ) {}

  @Cron('*/2 * * * *')
  async retryPending() {
    const pending = await this.prisma.tseTransaction.findMany({
      where: { isAusfall: true },
      include: { order: { include: { kasse: { include: { tseClient: true } } } } },
    });

    if (pending.length === 0) return;

    this.logger.log(`Retrying ${pending.length} TSE-Ausfall transaction(s)`);

    for (const tx of pending) {
      const tseClient = tx.order.kasse.tseClient;
      if (!tseClient) {
        this.logger.warn(`No TSE client for kasse ${tx.order.kasseId}`);
        continue;
      }

      try {
        const provider = this.tseFactory.create(tseClient.provider as any);
        await provider.initialize({
          provider: tseClient.provider as any,
          serialNumber: tseClient.serialNumber,
        });

        if (!provider.isHealthy()) {
          this.logger.warn(`TSE provider still unhealthy for kasse ${tx.order.kasseId}`);
          continue;
        }

        const { result } = await this.fiscal.signOrder(
          tx.orderId,
          tseClient.id,
          provider,
          tx.processType,
        );

        if (!result.isAusfall) {
          await this.audit.log({
            tenantId: tx.order.kasse.betriebsstaetteId,
            action: 'tse.ausfall.resigned',
            entity: 'tse_transaction',
            entityId: tx.id,
            payload: {
              newTxNumber: result.txNumber,
              signatureCounter: result.signatureCounter,
            },
          });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Retry failed for order ${tx.orderId}: ${msg}`);
      }
    }
  }
}
