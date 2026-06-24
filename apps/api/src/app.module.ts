import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { PrismaModule } from './prisma/prisma.module'
import { HealthController } from './health/health.controller'
import { AuthModule } from './auth/auth.module'
import { PermissionsGuard } from './rbac/permissions.guard'
import { MeController } from './me/me.controller'

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule, AuthModule],
  controllers: [HealthController, MeController],
  providers: [PermissionsGuard],
})
export class AppModule {}
