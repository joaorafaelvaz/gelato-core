import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { PermissionsGuard } from '../rbac/permissions.guard'
import { ProductsService } from './products.service'
import { ProductsController } from './products.controller'

@Module({
  imports: [AuthModule],
  controllers: [ProductsController],
  providers: [ProductsService, PermissionsGuard],
})
export class ProductsModule {}
