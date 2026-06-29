import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { PermissionsGuard } from '../rbac/permissions.guard'
import { CustomersService } from './customers.service'
import { CustomersController } from './customers.controller'
import { ConsentVersionsController } from './consent-versions.controller'

@Module({
  imports: [AuthModule],
  controllers: [CustomersController, ConsentVersionsController],
  providers: [CustomersService, PermissionsGuard],
})
export class CustomersModule {}
