import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { PermissionsGuard } from '../rbac/permissions.guard'
import { TablesService } from './tables.service'
import { TablesController } from './tables.controller'
import { LedgerService } from '../pos/ledger.service'

@Module({
  imports: [AuthModule],
  controllers: [TablesController],
  providers: [TablesService, LedgerService, PermissionsGuard],
})
export class TablesModule {}
