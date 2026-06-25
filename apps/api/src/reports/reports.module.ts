import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { PermissionsGuard } from '../rbac/permissions.guard'
import { ReportsService } from './reports.service'
import { ReportsController } from './reports.controller'

@Module({
  imports: [AuthModule],
  controllers: [ReportsController],
  providers: [ReportsService, PermissionsGuard],
})
export class ReportsModule {}
