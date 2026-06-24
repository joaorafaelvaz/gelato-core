import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { PermissionsGuard } from '../rbac/permissions.guard'
import { OrdersController } from './orders.controller'

@Module({
  imports: [AuthModule],
  controllers: [OrdersController],
  providers: [PermissionsGuard],
})
export class OrdersModule {}
