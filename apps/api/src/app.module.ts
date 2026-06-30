import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { TenantsModule } from './tenants/tenants.module';
import { BranchesModule } from './branches/branches.module';
import { KassenModule } from './kassen/kassen.module';
import { PermissionsModule } from './permissions/permissions.module';
import { PrismaModule } from './prisma/prisma.module';
import { AuditModule } from './audit/audit.module';
import { ComplianceModule } from './compliance/compliance.module';
import { FiscalModule } from './fiscal/fiscal.module';
import { PosModule } from './pos/pos.module';
import { SyncModule } from './sync/sync.module';
import { ProductsModule } from './products/products.module';
import { StockModule } from './stock/stock.module';

import { ReportsModule } from './reports/reports.module';
import { ExportsModule } from './exports/exports.module';

import { HealthModule } from './health/health.module';
import { AuditIpInterceptor } from './audit/audit-ip.interceptor';
import { MetricsModule } from './metrics/metrics.module';
import { AdminModule } from './admin/admin.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { CustomersModule } from './customers/customers.module';
import { LoyaltyModule } from './loyalty/loyalty.module';
import { VouchersModule } from './vouchers/vouchers.module';
import { PromotionsModule } from './promotions/promotions.module';
import { CampaignsModule } from './campaigns/campaigns.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    PrismaModule,
    AuditModule,
    AuthModule,
    UsersModule,
    TenantsModule,
    BranchesModule,
    KassenModule,
    PermissionsModule,
    ComplianceModule,
    FiscalModule,
    PosModule,
    SyncModule,
    ProductsModule,
    StockModule,
    ReportsModule,
    ExportsModule,
    HealthModule,
    MetricsModule,
    AdminModule,
    AnalyticsModule,
    CustomersModule,
    LoyaltyModule,
    VouchersModule,
    PromotionsModule,
    CampaignsModule,
  ],
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditIpInterceptor,
    },
  ],
})
export class AppModule {}
