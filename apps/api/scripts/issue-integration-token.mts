/**
 * Emite um JWT de longa duração para o service user da integração Skyview.
 * Uso: corepack pnpm --filter @gelato/api issue:integration-token [email] [expiresIn]
 * Padrões: skyview@integration.local, 365d. Imprime o token no stdout.
 *
 * Revogação: NÃO existe revogação por token (as permissões vão embutidas no JWT
 * e o PermissionsGuard não reconsulta o banco). Revogar = rotacionar JWT_SECRET,
 * o que invalida TODAS as sessões (operadores/admin inclusive).
 */
import { config } from 'dotenv'
config()
import { PrismaClient } from '@prisma/client'
import { JwtService } from '@nestjs/jwt'

const email = process.argv[2] ?? 'skyview@integration.local'
const expiresIn = process.argv[3] ?? '365d'

const prisma = new PrismaClient()
try {
  const user = await prisma.user.findUniqueOrThrow({
    where: { email },
    include: { roles: { include: { role: true } } },
  })
  // Só assina para contas que realmente têm a role integration_reader no banco —
  // impede emitir um token de integração "fantasma" para admin/operador que não
  // apareceria numa auditoria de roles.
  if (!user.roles.some((ur) => ur.role.key === 'integration_reader')) {
    console.error(`Usuário ${email} não tem a role integration_reader — token não emitido.`)
    process.exit(1)
  }
  const jwt = new JwtService({ secret: process.env.JWT_SECRET ?? 'dev-secret-change-me' })
  const token = jwt.sign(
    { sub: user.id, tenant_id: user.tenantId, permissions: ['integration.read'], escalated: false },
    { expiresIn },
  )
  console.log(token)
} finally {
  await prisma.$disconnect()
}
