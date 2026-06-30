import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { AuditLogService } from './audit-log.service';
import { AuditLogController } from './audit-log.controller';

@Global()
@Module({
  providers: [AuditService, AuditLogService],
  controllers: [AuditLogController],
  exports: [AuditService, AuditLogService],
})
export class AuditModule {}