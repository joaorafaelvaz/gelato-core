import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { PermissionsGuard } from '../rbac/permissions.guard'
import { StockService } from './stock.service'
import { StockController } from './stock.controller'

@Module({
  imports: [AuthModule],
  controllers: [StockController],
  providers: [StockService, PermissionsGuard],
})
export class StockModule {}
