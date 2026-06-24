/** Catálogo global de permissões (chaves). Seed cria todas; roles recebem subconjuntos. */
export const PERMISSIONS = [
  // PDV
  'pos.sale.create',
  'pos.sale.void',
  'pos.discount.apply',
  'pos.drawer.open',
  'pos.shift.open',
  'pos.shift.close',
  'pos.report.x',
  'pos.report.z',
  // Produtos & receitas
  'product.view',
  'product.manage',
  'recipe.view',
  'recipe.manage',
  // Estoque
  'stock.view',
  'stock.adjust',
  'stock.receive',
  'stock.count',
  // Checklist
  'checklist.view',
  'checklist.execute',
  'checklist.manage',
  // Marketing
  'marketing.view',
  'marketing.manage',
  'customer.manage',
  // Admin / fiscal
  'admin.users',
  'admin.settings',
  'admin.tse',
  'admin.export.dsfinvk',
  'admin.kassenmeldung',
] as const

export type Permission = (typeof PERMISSIONS)[number]

/** Permissões por role padrão (seed). */
export const ROLE_PERMISSIONS: Record<string, Permission[]> = {
  operator: [
    'pos.sale.create',
    'pos.drawer.open',
    'pos.shift.open',
    'pos.shift.close',
    'pos.report.x',
    'product.view',
  ],
  lagerist: [
    'product.view',
    'recipe.view',
    'stock.view',
    'stock.adjust',
    'stock.receive',
    'stock.count',
  ],
  admin: [...PERMISSIONS],
}
