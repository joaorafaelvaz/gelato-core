import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  // Catalog of permissions
  const permissions = [
    { key: 'pos.sale.create', name: 'Create sale', category: 'pos' },
    { key: 'pos.sale.void', name: 'Void sale', category: 'pos' },
    { key: 'pos.discount.apply', name: 'Apply discount', category: 'pos' },
    { key: 'pos.drawer.open', name: 'Open drawer', category: 'pos' },
    { key: 'pos.shift.open', name: 'Open shift', category: 'pos' },
    { key: 'pos.shift.close', name: 'Close shift', category: 'pos' },
    { key: 'pos.report.x', name: 'X report', category: 'pos' },
    { key: 'pos.report.z', name: 'Z report', category: 'pos' },
    { key: 'product.view', name: 'View products', category: 'product' },
    { key: 'product.manage', name: 'Manage products', category: 'product' },
    { key: 'recipe.view', name: 'View recipes', category: 'product' },
    { key: 'recipe.manage', name: 'Manage recipes', category: 'product' },
    { key: 'stock.view', name: 'View stock', category: 'stock' },
    { key: 'stock.manage', name: 'Manage stock items', category: 'stock' },
    { key: 'stock.adjust', name: 'Adjust stock', category: 'stock' },
    { key: 'stock.receive', name: 'Receive stock', category: 'stock' },
    { key: 'stock.count', name: 'Stock count', category: 'stock' },
    { key: 'checklist.view', name: 'View checklists', category: 'checklist' },
    { key: 'checklist.execute', name: 'Execute checklist', category: 'checklist' },
    { key: 'checklist.manage', name: 'Manage checklists', category: 'checklist' },
    { key: 'marketing.view', name: 'View marketing', category: 'marketing' },
    { key: 'marketing.manage', name: 'Manage marketing', category: 'marketing' },
    { key: 'customer.manage', name: 'Manage customers', category: 'marketing' },
    { key: 'admin.users', name: 'Manage users', category: 'admin' },
    { key: 'admin.settings', name: 'System settings', category: 'admin' },
    { key: 'admin.tse', name: 'Manage TSE', category: 'admin' },
    { key: 'admin.export.dsfinvk', name: 'Export DSFinV-K', category: 'admin' },
    { key: 'admin.kassenmeldung', name: 'Kassenmeldung', category: 'admin' },
  ];

  for (const p of permissions) {
    await prisma.permission.upsert({
      where: { key: p.key },
      update: {},
      create: p,
    });
  }

  // Seed a default tenant
  const tenant = await prisma.tenant.upsert({
    where: { slug: 'demo' },
    update: {},
    create: {
      name: 'Demo Gelateria',
      slug: 'demo',
      legalName: 'Demo Gelateria GmbH',
      country: 'DE',
    },
  });

  // Seed default roles per tenant
  const roleDefinitions = [
    {
      key: 'operator',
      name: 'Kassenoperator',
      permissionKeys: [
        'pos.sale.create',
        'pos.shift.open',
        'pos.shift.close',
        'pos.drawer.open',
        'pos.report.x',
        'product.view',
      ],
    },
    {
      key: 'lagerist',
      name: 'Lagerist',
      permissionKeys: [
        'stock.view',
        'stock.adjust',
        'stock.receive',
        'stock.count',
        'recipe.view',
        'product.view',
      ],
    },
    {
      key: 'admin',
      name: 'Administrator',
      permissionKeys: permissions.map((p) => p.key),
    },
  ];

  for (const def of roleDefinitions) {
    const role = await prisma.role.upsert({
      where: { tenantId_key: { tenantId: tenant.id, key: def.key } },
      update: {},
      create: {
        tenantId: tenant.id,
        key: def.key,
        name: def.name,
      },
    });

    const perms = await prisma.permission.findMany({
      where: { key: { in: def.permissionKeys } },
    });

    await prisma.rolePermission.deleteMany({
      where: { roleId: role.id },
    });

    await prisma.rolePermission.createMany({
      data: perms.map((p) => ({ roleId: role.id, permissionId: p.id })),
      skipDuplicates: true,
    });
  }

  // Seed a default admin user
  const passwordHash = await bcrypt.hash('admin123', 12);
  const adminRole = await prisma.role.findFirstOrThrow({
    where: { tenantId: tenant.id, key: 'admin' },
  });

  const user = await prisma.user.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email: 'admin@demo.de' } },
    update: {},
    create: {
      tenantId: tenant.id,
      email: 'admin@demo.de',
      name: 'System Administrator',
      passwordHash,
      isActive: true,
      userRoles: {
        create: { roleId: adminRole.id },
      },
    },
  });

  console.log(`Seeded tenant ${tenant.slug} and user ${user.email}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
