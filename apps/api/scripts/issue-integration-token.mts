/**
 * Emite um JWT de longa duração para o service user da integração Skyview.
 * Uso: corepack pnpm --filter @gelato/api issue:integration-token [email] [expiresIn]
 * Padrões: skyview@integration.local, 365d. Imprime o token no stdout.
 */
import { config } from 'dotenv'
config()
import { PrismaClient } from '@prisma/client'
import { JwtService } from '@nestjs/jwt'

const email = process.argv[2] ?? 'skyview@integration.local'
const expiresIn = process.argv[3] ?? '365d'

const prisma = new PrismaClient()
const user = await prisma.user.findUniqueOrThrow({ where: { email } })
const jwt = new JwtService({ secret: process.env.JWT_SECRET ?? 'dev-secret-change-me' })
const token = jwt.sign(
  { sub: user.id, tenant_id: user.tenantId, permissions: ['integration.read'], escalated: false },
  { expiresIn },
)
console.log(token)
await prisma.$disconnect()
