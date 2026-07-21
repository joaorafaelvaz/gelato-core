import { config } from 'dotenv'
config()
import { PrismaClient } from '@prisma/client'
import { hashSecret } from '../src/auth/hash'

const TENANT_ID = 'demo-tenant'

/** Cada garçom loga na Kasse com seu próprio PIN — "a máquina do garçom" é essa
 * identidade de login (mesmo terminal físico, sessão pessoal via PIN). */
const GARCONS = [
  { nome: 'Lubi', email: 'lubi@demo.test', pin: '1101' },
  { nome: 'Adriano', email: 'adriano@demo.test', pin: '1102' },
  { nome: 'Ebra', email: 'ebra@demo.test', pin: '1103' },
  { nome: 'Bedi', email: 'bedi@demo.test', pin: '1104' },
]

async function main(): Promise<void> {
  const prisma = new PrismaClient()
  const operatorRole = await prisma.role.findUnique({ where: { tenantId_key: { tenantId: TENANT_ID, key: 'operator' } } })
  if (!operatorRole) throw new Error('role "operator" não encontrada — rode o seed principal primeiro (pnpm --filter @gelato/api run seed).')

  for (const g of GARCONS) {
    const user = await prisma.user.upsert({
      where: { email: g.email },
      update: {},
      create: {
        tenantId: TENANT_ID,
        name: g.nome,
        email: g.email,
        passwordHash: await hashSecret(`${g.nome.toLowerCase()}123`),
        pinHash: await hashSecret(g.pin),
      },
    })
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: operatorRole.id } },
      update: {},
      create: { userId: user.id, roleId: operatorRole.id },
    })
    console.log(`Garçom pronto: ${g.nome} — PIN ${g.pin} (kasse demo-kasse)`)
  }
  await prisma.$disconnect()
}

void main()
