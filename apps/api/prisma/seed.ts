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

  // Mesas demo (Tisch — operacional) com posições iniciais p/ o Tischplan (1a-4).
  for (const [id, name, posX, posY] of [
    ['tisch-1', 'Tisch 1', 40, 40],
    ['tisch-2', 'Tisch 2', 220, 40],
    ['tisch-3', 'Tisch 3', 40, 180],
    ['tisch-4', 'Tisch 4', 220, 180],
  ] as const) {
    await prisma.tisch.upsert({
      where: { id },
      update: { posX, posY },
      create: { id, betriebsstaetteId: BS_ID, name, posX, posY },
    })
  }

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

  const lagerist = await prisma.user.upsert({
    where: { email: 'lager@demo.test' },
    update: {},
    create: {
      tenantId: TENANT_ID,
      name: 'Lagerist',
      email: 'lager@demo.test',
      passwordHash: await hashSecret('lager123'),
    },
  })
  await linkRole(prisma, lagerist.id, roleId.get('lagerist'))

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

  // Catálogo com categoria + variantes + modifier (fatia 1a-3).
  const eis = await prisma.productCategory.upsert({
    where: { id: 'cat-eis' },
    update: {},
    create: { id: 'cat-eis', tenantId: TENANT_ID, name: 'Eis' },
  })
  const becher = await prisma.product.upsert({
    where: { id: 'prod-eisbecher' },
    update: {},
    create: {
      id: 'prod-eisbecher',
      tenantId: TENANT_ID,
      categoryId: eis.id,
      name: 'Eisbecher',
      netCents: 450,
      mwstCodeImHaus: 'standard_19',
      mwstCodeAusserHaus: 'reduced_7',
    },
  })
  for (const [id, name, netCents, sortOrder] of [
    ['var-s', 'S', 300, 1],
    ['var-m', 'M', 450, 2],
    ['var-l', 'L', 600, 3],
  ] as const) {
    await prisma.productVariant.upsert({
      where: { id },
      update: {},
      create: { id, productId: becher.id, name, netCents, sortOrder },
    })
  }
  await prisma.productModifier.upsert({
    where: { id: 'mod-sahne' },
    update: {},
    create: { id: 'mod-sahne', productId: becher.id, name: 'extra Sahne', netCents: 50 },
  })

  // Estoque (Ciclo 2a): 2 insumos demo + entrada inicial. Movimentos são
  // append-only → inserir só uma vez (id fixo, create se ausente; nunca update).
  await prisma.stockItem.upsert({
    where: { id: 'stock-milch' },
    update: {},
    create: { id: 'stock-milch', tenantId: TENANT_ID, name: 'Milch', unit: 'ml', minStock: 2000 },
  })
  await prisma.stockItem.upsert({
    where: { id: 'stock-zucker' },
    update: {},
    create: { id: 'stock-zucker', tenantId: TENANT_ID, name: 'Zucker', unit: 'g', minStock: 1000 },
  })
  for (const [id, stockItemId, qtyDelta] of [
    ['mov-milch-init', 'stock-milch', 10000],
    ['mov-zucker-init', 'stock-zucker', 5000],
  ] as const) {
    const seen = await prisma.stockMovement.findUnique({ where: { id } })
    if (!seen) {
      await prisma.stockMovement.create({ data: { id, tenantId: TENANT_ID, stockItemId, type: 'receive', qtyDelta } })
    }
  }

  // Receitas/BOM (Ciclo 2b): Eisbecher S/M/L consumindo Milch (ml) + Zucker (g).
  for (const [id, variantId, milch, zucker] of [
    ['rec-becher-s', 'var-s', 100, 40],
    ['rec-becher-m', 'var-m', 150, 60],
    ['rec-becher-l', 'var-l', 200, 80],
  ] as const) {
    await prisma.recipe.upsert({
      where: { id },
      update: {},
      create: { id, tenantId: TENANT_ID, productId: 'prod-eisbecher', variantId },
    })
    for (const [ingId, stockItemId, qty] of [
      [`${id}-milch`, 'stock-milch', milch],
      [`${id}-zucker`, 'stock-zucker', zucker],
    ] as const) {
      await prisma.recipeIngredient.upsert({
        where: { id: ingId },
        update: { qty },
        create: { id: ingId, recipeId: id, stockItemId, qty },
      })
    }
  }

  // Checklist/HACCP (Ciclo 3a): template diário demo (higiene + temperatura).
  await prisma.checklistTemplate.upsert({
    where: { id: 'tpl-haccp-daily' },
    update: {},
    create: { id: 'tpl-haccp-daily', tenantId: TENANT_ID, name: 'Tägliche Hygiene & Temperatur', recurrence: 'daily' },
  })
  const checklistTasks: [string, string, string, number | null, number | null, number][] = [
    ['task-hands', 'Hände gewaschen?', 'boolean', null, null, 1],
    ['task-vitrine', 'Vitrine gereinigt?', 'boolean', null, null, 2],
    ['task-tk', 'Tiefkühltruhe', 'temperature', -2200, -1800, 3],
    ['task-kv', 'Kühlvitrine', 'temperature', 200, 700, 4],
    ['task-notes', 'Bemerkungen', 'text', null, null, 5],
  ]
  for (const [id, label, type, validMin, validMax, sortOrder] of checklistTasks) {
    await prisma.checklistTask.upsert({
      where: { id },
      update: { label, type, validMin, validMax, sortOrder },
      create: { id, templateId: 'tpl-haccp-daily', label, type, validMin, validMax, sortOrder },
    })
  }

  // CRM/DSGVO (Ciclo 4a): termo de consentimento demo (email_marketing v1).
  await prisma.consentVersion.upsert({
    where: { tenantId_purpose_version: { tenantId: TENANT_ID, purpose: 'email_marketing', version: 1 } },
    update: {},
    create: { tenantId: TENANT_ID, purpose: 'email_marketing', version: 1, text: 'Ich willige in den Erhalt von E-Mail-Werbung ein. Widerruf jederzeit möglich.', active: true },
  })

  // Loyalty (Ciclo 4b): programa demo (1 ponto/€, 1 carimbo/item).
  await prisma.loyaltyProgram.upsert({
    where: { tenantId: TENANT_ID },
    update: {},
    create: { tenantId: TENANT_ID, pointsPerEuro: 1, stampsPerItem: 1, active: true },
  })
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
