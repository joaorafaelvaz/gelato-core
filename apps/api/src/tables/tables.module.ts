import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { PermissionsGuard } from '../rbac/permissions.guard'
import { TablesService } from './tables.service'
import { TablesController } from './tables.controller'

@Module({
  imports: [AuthModule],
  controllers: [TablesController],
  providers: [TablesService, PermissionsGuard],
})
export class TablesModule {}
