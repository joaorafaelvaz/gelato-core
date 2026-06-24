import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { PermissionsGuard } from '../rbac/permissions.guard'
import { LedgerService } from './ledger.service'
import { SyncController } from './sync.controller'

@Module({
  imports: [AuthModule],
  controllers: [SyncController],
  providers: [LedgerService, PermissionsGuard],
})
export class PosModule {}
