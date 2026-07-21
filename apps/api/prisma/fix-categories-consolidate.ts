import { config } from 'dotenv'
config()
import { PrismaClient } from '@prisma/client'

const TENANT_ID = 'demo-tenant'

// Simples renomeações (1 categoria antiga -> 1 nova, mesmo id).
const RENAMES: Record<string, string> = {
  'Eisbecher (Taças)': 'Eis im Becher',
  'Café': 'Warme Getränke',
}

// Fusões: várias categorias antigas -> uma categoria alvo (nova ou já existente).
// Se o alvo já existir, reaproveita o id (é o caso de "Extras").
const MERGES: { target: string; sources: string[] }[] = [
  { target: 'Eis', sources: ['Sabores Clássicos', 'Sabores de Frutas', 'Sabores Premium'] },
  { target: 'Kalte Getränke', sources: ['Refrigerantes', 'Bebidas Especiais'] },
  { target: 'Waffeln und Crêpe', sources: ['Waffles', 'Crepes'] },
  { target: 'Extras', sources: ['Toppings', 'Frutas'] },
]

// Categorias novas, vazias (produtos reais entram depois pelo backoffice).
const CREATE_EMPTY = ['Kuchen und Torte', 'Snacks']

// Removida por completo (categoria + produtos).
const DELETE_ENTIRELY = ['Para Viagem']

async function main(): Promise<void> {
  const prisma = new PrismaClient()

  const allCats = await prisma.productCategory.findMany({ where: { tenantId: TENANT_ID } })
  let nextSort = allCats.reduce((m, c) => Math.max(m, c.sortOrder), 0) + 1
  const byName = (name: string) => allCats.find((c) => c.name === name)

  // 1) Renomeações
  for (const [oldName, newName] of Object.entries(RENAMES)) {
    const cat = byName(oldName)
    if (!cat) {
      console.log(`[skip] renomear "${oldName}" -> "${newName}": categoria não encontrada`)
      continue
    }
    if (byName(newName)) {
      console.log(`[skip] renomear "${oldName}" -> "${newName}": já existe uma categoria "${newName}"`)
      continue
    }
    await prisma.productCategory.update({ where: { id: cat.id }, data: { name: newName } })
    cat.name = newName
    console.log(`[ok] renomeado "${oldName}" -> "${newName}"`)
  }

  // 2) Fusões
  for (const { target, sources } of MERGES) {
    let targetCat = byName(target)
    if (!targetCat) {
      targetCat = await prisma.productCategory.create({
        data: { tenantId: TENANT_ID, name: target, sortOrder: nextSort++ },
      })
      allCats.push(targetCat)
      console.log(`[ok] categoria criada: "${target}"`)
    }
    for (const sourceName of sources) {
      if (sourceName === target) continue
      const source = byName(sourceName)
      if (!source) {
        console.log(`[skip] fundir "${sourceName}" -> "${target}": origem não encontrada`)
        continue
      }
      const moved = await prisma.product.updateMany({
        where: { tenantId: TENANT_ID, categoryId: source.id },
        data: { categoryId: targetCat.id },
      })
      await prisma.productCategory.delete({ where: { id: source.id } })
      console.log(`[ok] fundido "${sourceName}" -> "${target}" (${moved.count} produtos movidos)`)
    }
  }

  // 3) Categorias novas vazias
  for (const name of CREATE_EMPTY) {
    if (byName(name)) {
      console.log(`[skip] criar "${name}": já existe`)
      continue
    }
    await prisma.productCategory.create({ data: { tenantId: TENANT_ID, name, sortOrder: nextSort++ } })
    console.log(`[ok] categoria criada (vazia): "${name}"`)
  }

  // 4) Remoção completa (categoria + produtos, limpando filhos com FK RESTRICT antes)
  for (const name of DELETE_ENTIRELY) {
    const cat = byName(name)
    if (!cat) {
      console.log(`[skip] apagar "${name}": categoria não encontrada`)
      continue
    }
    const products = await prisma.product.findMany({ where: { tenantId: TENANT_ID, categoryId: cat.id } })
    for (const p of products) {
      const [variants, modifiers, recipes] = await Promise.all([
        prisma.productVariant.deleteMany({ where: { productId: p.id } }),
        prisma.productModifier.deleteMany({ where: { productId: p.id } }),
        prisma.recipe.deleteMany({ where: { productId: p.id } }),
      ])
      if (variants.count || modifiers.count || recipes.count) {
        console.log(`  [info] "${p.name}": removidas ${variants.count} variantes, ${modifiers.count} modificadores, ${recipes.count} receitas antes de apagar o produto`)
      }
    }
    const delProducts = await prisma.product.deleteMany({ where: { tenantId: TENANT_ID, categoryId: cat.id } })
    await prisma.productCategory.delete({ where: { id: cat.id } })
    console.log(`[ok] apagado "${name}" (${delProducts.count} produtos)`)
  }

  const final = await prisma.productCategory.findMany({
    where: { tenantId: TENANT_ID },
    orderBy: { sortOrder: 'asc' },
    include: { _count: { select: { products: true } } },
  })
  console.log('\nCategorias finais:')
  for (const c of final) console.log(`  - ${c.name} (${c._count.products} produtos)`)

  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
