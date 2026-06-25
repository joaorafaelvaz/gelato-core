import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { PermissionsGuard } from '../rbac/permissions.guard'
import { ShiftsService } from './shifts.service'
import { ShiftsController } from './shifts.controller'

@Module({
  imports: [AuthModule],
  controllers: [ShiftsController],
  providers: [ShiftsService, PermissionsGuard],
})
export class ShiftsModule {}
