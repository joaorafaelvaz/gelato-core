import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { PermissionsGuard } from '../rbac/permissions.guard'
import { ProductionService } from './production.service'
import { ProductionController } from './production.controller'

@Module({
  imports: [AuthModule],
  controllers: [ProductionController],
  providers: [ProductionService, PermissionsGuard],
})
export class ProductionModule {}
