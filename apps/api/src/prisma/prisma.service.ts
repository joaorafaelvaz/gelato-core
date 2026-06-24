import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'

/**
 * Cliente Prisma de RUNTIME. Conecta como `gelato_app` (DATABASE_URL), NÃO como
 * owner — assim a imutabilidade fiscal (sem UPDATE/DELETE) vale também em runtime.
 * Migrações usam DATABASE_URL_OWNER (datasource do schema).
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({ datasourceUrl: process.env.DATABASE_URL })
  }

  async onModuleInit(): Promise<void> {
    await this.$connect()
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect()
  }
}
