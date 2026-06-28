import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { PermissionsGuard } from '../rbac/permissions.guard'
import { ChecklistsService } from './checklists.service'
import { ChecklistsController } from './checklists.controller'

@Module({
  imports: [AuthModule],
  controllers: [ChecklistsController],
  providers: [ChecklistsService, PermissionsGuard],
})
export class ChecklistsModule {}
