import { config } from 'dotenv'
config()
import { PrismaClient } from '@prisma/client'

const TENANT_ID = 'demo-tenant'

// 1-5 bolas: produto "genérico" de gelato por nº de bolas (sabor vai na
// observação do item, não é uma variante por sabor). Preço sobe ~4,50€/bola.
const BOLAS: { name: string; netCents: number }[] = [
  { name: '1 Bola', netCents: 350 },
  { name: '2 Bolas', netCents: 650 },
  { name: '3 Bolas', netCents: 900 },
  { name: '4 Bolas', netCents: 1100 },
  { name: '5 Bolas', netCents: 1300 },
]

// Extras já cadastrados que viram atalho na aba Favoritos (Sahne/Soße/Streusel).
const EXTRAS_FAVORITOS = ['Chantilly', 'Calda Extra', 'Crocante']

async function main(): Promise<void> {
  const prisma = new PrismaClient()

  const eis = await prisma.productCategory.findFirst({ where: { tenantId: TENANT_ID, name: 'Eis' } })
  if (!eis) throw new Error('Categoria "Eis" não encontrada — rode a consolidação de categorias primeiro.')

  for (const b of BOLAS) {
    const existing = await prisma.product.findFirst({ where: { tenantId: TENANT_ID, categoryId: eis.id, name: b.name } })
    if (existing) {
      await prisma.product.update({ where: { id: existing.id }, data: { featured: true } })
      console.log(`[ok] "${b.name}" já existia — marcado como favorito`)
      continue
    }
    await prisma.product.create({
      data: {
        tenantId: TENANT_ID,
        categoryId: eis.id,
        name: b.name,
        netCents: b.netCents,
        mwstCodeImHaus: 'standard_19',
        mwstCodeAusserHaus: 'reduced_7',
        featured: true,
      },
    })
    console.log(`[ok] criado "${b.name}" em Eis, favorito`)
  }

  for (const name of EXTRAS_FAVORITOS) {
    const p = await prisma.product.findFirst({ where: { tenantId: TENANT_ID, name } })
    if (!p) {
      console.log(`[skip] "${name}" não encontrado`)
      continue
    }
    await prisma.product.update({ where: { id: p.id }, data: { featured: true } })
    console.log(`[ok] "${name}" marcado como favorito`)
  }

  const total = await prisma.product.count({ where: { tenantId: TENANT_ID, featured: true } })
  console.log(`\nTotal de favoritos: ${total}`)
  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
