import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { PermissionsGuard } from '../rbac/permissions.guard'
import { RecipesService } from './recipes.service'
import { RecipesController } from './recipes.controller'

@Module({
  imports: [AuthModule],
  controllers: [RecipesController],
  providers: [RecipesService, PermissionsGuard],
})
export class RecipesModule {}
