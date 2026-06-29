import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { PermissionsGuard } from '../rbac/permissions.guard'
import { VouchersService } from './vouchers.service'
import { VouchersController } from './vouchers.controller'

@Module({
  imports: [AuthModule],
  controllers: [VouchersController],
  providers: [VouchersService, PermissionsGuard],
})
export class VouchersModule {}
