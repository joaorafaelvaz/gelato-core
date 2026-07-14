import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { PrismaModule } from './prisma/prisma.module'
import { HealthController } from './health/health.controller'
import { AuthModule } from './auth/auth.module'
import { PermissionsGuard } from './rbac/permissions.guard'
import { MeController } from './me/me.controller'
import { PosModule } from './pos/pos.module'
import { ProductsModule } from './products/products.module'
import { OrdersModule } from './orders/orders.module'
import { ShiftsModule } from './shifts/shifts.module'
import { ReportsModule } from './reports/reports.module'
import { ExportsModule } from './exports/exports.module'
import { TablesModule } from './tables/tables.module'
import { StockModule } from './stock/stock.module'
import { RecipesModule } from './recipes/recipes.module'
import { ChecklistsModule } from './checklists/checklists.module'
import { CustomersModule } from './customers/customers.module'
import { LoyaltyModule } from './loyalty/loyalty.module'
import { VouchersModule } from './vouchers/vouchers.module'
import { CampaignsModule } from './campaigns/campaigns.module'
import { ProductionModule } from './production/production.module'
import { IntegrationModule } from './integration/integration.module'

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    PosModule,
    ProductsModule,
    OrdersModule,
    ShiftsModule,
    ReportsModule,
    ExportsModule,
    TablesModule,
    StockModule,
    RecipesModule,
    ChecklistsModule,
    CustomersModule,
    LoyaltyModule,
    VouchersModule,
    CampaignsModule,
    ProductionModule,
    IntegrationModule,
  ],
  controllers: [HealthController, MeController],
  providers: [PermissionsGuard],
})
export class AppModule {}
