import { Test, TestingModule } from '@nestjs/testing';
import Decimal from 'decimal.js';
import { ReportsService } from './reports.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

describe('ReportsService', () => {
  let service: ReportsService;

  const mockOrders = [
    {
      id: 'o1',
      status: 'CLOSED',
      totalNet: new Decimal(10),
      totalMwst: new Decimal(1.9),
      totalGross: new Decimal(11.9),
      items: [
        { productId: 'p1', qty: new Decimal(1), mwstRate: new Decimal(19), totalNet: new Decimal(10), totalGross: new Decimal(11.9) },
      ],
      payments: [{ method: 'CASH', amount: new Decimal(11.9) }],
      tseTx: null,
    },
  ];

  const mockPrisma = {
    kasse: {
      findUnique: jest.fn(async () => ({ id: 'k1', betriebsstaette: { tenantId: 't1' } })),
    },
    order: {
      findMany: jest.fn(async () => mockOrders),
    },
    shift: {
      findFirst: jest.fn(async () => ({ id: 's1', openedAt: new Date('2026-06-25T08:00:00Z'), zReportId: null })),
      findUnique: jest.fn(async () => null),
      update: jest.fn(async (args) => ({ id: args.where.id, zReportId: args.data.zReportId, closedAt: args.data.closedAt })),
    },
    zReport: {
      findFirst: jest.fn(async () => null),
      create: jest.fn(async (args) => ({ id: 'z1', generatedAt: new Date(), ...args.data })),
      findMany: jest.fn(async () => []),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditService, useValue: { log: jest.fn() } },
      ],
    }).compile();

    service = module.get<ReportsService>(ReportsService);
    jest.clearAllMocks();
  });

  it('should generate an X-report with totals', async () => {
    const report = await service.xReport('k1', '2026-06-25');

    expect(report.type).toBe('X_REPORT');
    expect(report.totalGross).toBeCloseTo(11.9);
    expect(report.orderCount).toBe(1);
    expect(report.mwstByRate).toHaveLength(1);
  });

  it('should create a Z-report and close the shift', async () => {
    const report = await service.zReport('k1');

    expect(report.type).toBe('Z_REPORT');
    expect(report.seqNr).toBe(1);
    expect(mockPrisma.zReport.create).toHaveBeenCalled();
  });
});
