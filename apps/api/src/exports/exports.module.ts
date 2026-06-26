import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { PermissionsGuard } from '../rbac/permissions.guard'
import { ExportsService } from './exports.service'
import { ExportsController } from './exports.controller'

@Module({
  imports: [AuthModule],
  controllers: [ExportsController],
  providers: [ExportsService, PermissionsGuard],
})
export class ExportsModule {}
