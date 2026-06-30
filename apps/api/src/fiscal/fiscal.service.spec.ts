import { Test, TestingModule } from '@nestjs/testing';
import { FiscalService } from './fiscal.service';
import { PrismaService } from '../prisma/prisma.service';
import { FiskalyTseAdapter } from '../compliance/tse/fiskaly-tse.adapter';

describe('FiscalService', () => {
  let service: FiscalService;
  let prisma: PrismaService;
  let provider: FiskalyTseAdapter;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FiscalService,
        {
          provide: PrismaService,
          useValue: {
            tseTransaction: { create: jest.fn(async (args) => ({ id: 'tx-1', ...args.data })) },
          },
        },
      ],
    }).compile();

    service = module.get<FiscalService>(FiscalService);
    prisma = module.get<PrismaService>(PrismaService);
    provider = new FiskalyTseAdapter();
    await provider.initialize({ provider: 'fiskaly', serialNumber: 'TEST' });
  });

  it('should sign an order and mark Ausfall when TSE unhealthy', async () => {
    provider.setHealthy(false);
    const { result, tseTx } = await service.signOrder('order-1', 'tse-1', provider);

    expect(result.isAusfall).toBe(true);
    expect(tseTx.isAusfall).toBe(true);
    expect(prisma.tseTransaction.create).toHaveBeenCalled();
  });

  it('should sign an order normally when TSE healthy', async () => {
    const { result, tseTx } = await service.signOrder('order-2', 'tse-1', provider);

    expect(result.isAusfall).toBe(false);
    expect(result.signatureValue).toContain('FISKALY_MOCK');
    expect(tseTx.isAusfall).toBe(false);
  });
});
