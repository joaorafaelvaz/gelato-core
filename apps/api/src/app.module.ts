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
  ],
  controllers: [HealthController, MeController],
  providers: [PermissionsGuard],
})
export class AppModule {}
