import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { PermissionsGuard } from '../rbac/permissions.guard'
import { LoyaltyService } from './loyalty.service'
import { LoyaltyController } from './loyalty.controller'

@Module({
  imports: [AuthModule],
  controllers: [LoyaltyController],
  providers: [LoyaltyService, PermissionsGuard],
})
export class LoyaltyModule {}
