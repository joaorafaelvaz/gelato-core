import { config } from 'dotenv'
config()
import { PrismaClient } from '@prisma/client'
import { PERMISSIONS, ROLE_PERMISSIONS } from '../src/rbac/permissions'
import { hashSecret } from '../src/auth/hash'

const TENANT_ID = 'demo-tenant'
const BS_ID = 'demo-bs'
const KASSE_ID = 'demo-kasse'

/** Seed idempotente do Ciclo 0. Usa o cliente OWNER (datasource do schema). */
export async function runSeed(prisma: PrismaClient = new PrismaClient()): Promise<void> {
  // Permissões (catálogo global)
  for (const key of PERMISSIONS) {
    await prisma.permission.upsert({ where: { key }, update: {}, create: { key } })
  }
  const perms = await prisma.permission.findMany()
  const permId = new Map(perms.map((p) => [p.key, p.id]))

  // Tenant + estrutura
  await prisma.tenant.upsert({
    where: { id: TENANT_ID },
    update: {},
    create: { id: TENANT_ID, name: 'Demo Gelateria' },
  })
  await prisma.betriebsstaette.upsert({
    where: { id: BS_ID },
    update: {},
    create: { id: BS_ID, tenantId: TENANT_ID, name: 'Filiale Zentrum' },
  })
  await prisma.kasse.upsert({
    where: { id: KASSE_ID },
    update: {},
    create: { id: KASSE_ID, betriebsstaetteId: BS_ID, name: 'Kasse 1' },
  })
  await prisma.tseClient.upsert({
    where: { kasseId: KASSE_ID },
    update: {},
    create: { kasseId: KASSE_ID, provider: 'fiskaly', serialNr: 'SANDBOX' },
  })

  // Roles + role_permissions
  for (const [key, permKeys] of Object.entries(ROLE_PERMISSIONS)) {
    const role = await prisma.role.upsert({
      where: { tenantId_key: { tenantId: TENANT_ID, key } },
      update: {},
      create: { tenantId: TENANT_ID, key, name: key },
    })
    for (const pk of permKeys) {
      const permissionId = permId.get(pk)
      if (!permissionId) continue
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId } },
        update: {},
        create: { roleId: role.id, permissionId },
      })
    }
  }
  const roles = await prisma.role.findMany({ where: { tenantId: TENANT_ID } })
  const roleId = new Map(roles.map((r) => [r.key, r.id]))

  // Usuários: admin (senha) e operator (senha + PIN)
  const admin = await prisma.user.upsert({
    where: { email: 'admin@demo.test' },
    update: {},
    create: {
      tenantId: TENANT_ID,
      name: 'Admin',
      email: 'admin@demo.test',
      passwordHash: await hashSecret('admin123'),
    },
  })
  await linkRole(prisma, admin.id, roleId.get('admin'))

  const operator = await prisma.user.upsert({
    where: { email: 'operator@demo.test' },
    update: {},
    create: {
      tenantId: TENANT_ID,
      name: 'Operator',
      email: 'operator@demo.test',
      passwordHash: await hashSecret('op123'),
      pinHash: await hashSecret('1234'),
    },
  })
  await linkRole(prisma, operator.id, roleId.get('operator'))

  // Alíquotas (seed conservador — CONFIRMAR COM STEUERBERATER)
  await ensureTaxRate(prisma, 'standard_19', '0.19')
  await ensureTaxRate(prisma, 'reduced_7', '0.07')

  // Produto demo: gelato im_haus 19% vs ausser_haus 7% (parametrizável, a confirmar)
  const existing = await prisma.product.findFirst({ where: { tenantId: TENANT_ID, name: 'Eiskugel' } })
  if (!existing) {
    await prisma.product.create({
      data: {
        tenantId: TENANT_ID,
        name: 'Eiskugel',
        netCents: 150,
        mwstCodeImHaus: 'standard_19',
        mwstCodeAusserHaus: 'reduced_7',
      },
    })
  }
}

async function linkRole(prisma: PrismaClient, userId: string, roleId?: string): Promise<void> {
  if (!roleId) return
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId, roleId } },
    update: {},
    create: { userId, roleId },
  })
}

async function ensureTaxRate(prisma: PrismaClient, code: string, rate: string): Promise<void> {
  const existing = await prisma.taxRate.findFirst({ where: { tenantId: TENANT_ID, code } })
  if (!existing) {
    await prisma.taxRate.create({
      data: { tenantId: TENANT_ID, code, rate, validFrom: new Date('2020-01-01') },
    })
  }
}
