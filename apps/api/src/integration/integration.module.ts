import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { PermissionsGuard } from '../rbac/permissions.guard'
import { IntegrationController } from './integration.controller'
import { IntegrationService } from './integration.service'

@Module({
  imports: [AuthModule],
  controllers: [IntegrationController],
  providers: [IntegrationService, PermissionsGuard],
})
export class IntegrationModule {}
