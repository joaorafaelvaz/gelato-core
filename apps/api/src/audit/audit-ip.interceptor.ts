import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Observable, tap } from 'rxjs';
import { MetricsController } from '../metrics/metrics.controller';

@Injectable()
export class AuditIpInterceptor implements NestInterceptor {
  constructor(private readonly moduleRef: ModuleRef) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest();
    const ip =
      request.headers['x-forwarded-for']?.split(',')[0]?.trim() ??
      request.socket?.remoteAddress ??
      request.ip;

    request.clientIp = ip;
    request.deviceInfo = request.headers['user-agent'] ?? null;

    return next.handle().pipe(
      tap(() => {
        try {
          const metrics = this.moduleRef.get(MetricsController, { strict: false });
          metrics?.increment();
        } catch {
          // Metrics module not available, ignore
        }
      }),
    );
  }
}