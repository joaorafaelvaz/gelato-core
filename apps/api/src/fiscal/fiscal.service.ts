import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ITseProvider, TseSignRequest } from '../compliance/tse/tse-provider.interface';

@Injectable()
export class FiscalService {
  constructor(private readonly prisma: PrismaService) {}

  async signOrder(
    orderId: string,
    tseClientId: string,
    provider: ITseProvider,
    processType = 'Beleg',
  ) {
    const startTime = new Date();
    const signReq: TseSignRequest = {
      clientId: tseClientId,
      processType,
      payload: { orderId, startTime: startTime.toISOString() },
    };

    const result = await provider.sign(signReq);

    const tseTx = await this.prisma.tseTransaction.create({
      data: {
        orderId,
        tseClientId,
        txNumber: result.txNumber ?? 'UNKNOWN',
        signatureCounter: result.signatureCounter ?? null,
        signatureValue: result.signatureValue ?? null,
        logTime: result.logTime ?? new Date(),
        processType,
        startTime: result.startTime ?? startTime,
        finishTime: result.finishTime ?? new Date(),
        errorMessage: result.errorMessage ?? null,
        isAusfall: result.isAusfall,
      },
    });

    return { result, tseTx };
  }
}
