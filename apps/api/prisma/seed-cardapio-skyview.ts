import { config } from 'dotenv'
config()
import { PrismaClient } from '@prisma/client'

const TENANT_ID = 'demo-tenant'
const PLACEHOLDER_NET_CENTS = 100 // €1,00 — preço temporário, ajustar no backoffice

const CATALOGO: Record<string, string[]> = {
  'Para Viagem': [
    'Copo Pequeno', 'Copo Médio', 'Copo Grande', 'Caixa 500 ml', 'Caixa 750 ml',
    'Caixa 1 L', 'Caixa 1,5 L', 'Caixa 2 L', 'Bolsa Térmica',
  ],
  'Extras': [
    'Bola Extra', 'Chantilly', 'Cobertura Extra', 'Fruta Extra', 'Wafer Extra',
    'Casquinha Extra', 'Topping Extra', 'Calda Extra',
  ],
  'Refrigerantes': [
    'Coca-Cola', 'Coca Zero', 'Fanta', 'Sprite', 'Mezzo Mix', 'Spezi',
    'Apfelschorle', 'Wasser', 'Mineralwasser', 'Säfte',
  ],
  'Bebidas Especiais': [
    'Eiskaffee', 'Eisschokolade', 'Ice Latte', 'Ice Cappuccino', 'Frappé',
    'Smoothie', 'Milkshake', 'Limonada', 'Ice Tea',
  ],
  'Café': [
    'Espresso', 'Doppio', 'Cappuccino', 'Latte Macchiato', 'Milchkaffee',
    'Café Creme', 'Americano', 'Flat White', 'Mocha', 'Affogato',
  ],
  'Waffles': [
    'Tradicional', 'Nutella', 'Pistache', 'Oreo', 'Kinder', 'Ferrero',
    'Morango', 'Banana', 'Frutas Vermelhas', 'Sorvete + Waffle',
  ],
  'Crepes': [
    'Nutella', 'Nutella + Banana', 'Nutella + Morango', 'Pistache', 'Oreo',
    'Ferrero', 'Kinder Bueno', 'Lotus', 'Doce de Leite',
  ],
  'Toppings': [
    'Pistache Triturado', 'Avelã', 'Amendoim', 'Castanha', 'Nozes', 'Amêndoas',
    'Coco Ralado', 'Granulado', "M&M's", 'Oreo', 'Kinder Bueno', 'KitKat',
    'Smarties', 'Biscoito', 'Crocante', 'Wafer',
  ],
  'Frutas': [
    'Morango', 'Banana', 'Kiwi', 'Manga', 'Framboesa', 'Mirtilo', 'Amora',
    'Uva', 'Abacaxi', 'Laranja', 'Maçã', 'Cereja', 'Pêssego',
  ],
  'Eisbecher (Taças)': [
    'Spaghetti Eis', 'Banana Split', 'Erdbeer Becher', 'Schoko Becher',
    'Nuss Becher', 'Krokant Becher', 'Amarena Becher', 'Früchte Becher',
    'Joghurt Becher', 'Tartufo Becher', 'Coppa Italia', 'Coppa Venezia',
    'Coppa Amarena', 'Coppa Pistacchio', 'Coppa Oreo', 'Kinder Becher',
    'Exotik Becher', 'Tropical Becher', 'Kiwi Becher', 'Waldfrucht Becher',
  ],
  'Sabores Clássicos': [
    'Vanille', 'Schokolade', 'Stracciatella', 'Haselnuss', 'Pistazie',
    'Fior di Latte', 'Amarena', 'Joghurt', 'Kaffee', 'Tiramisu', 'Malaga',
    'Rum Rosinen', 'Nougat', 'Zabaione', 'Mokka',
  ],
  'Sabores de Frutas': [
    'Erdbeere', 'Himbeere', 'Heidelbeere', 'Mango', 'Zitrone', 'Limette',
    'Maracuja', 'Orange', 'Banane', 'Kiwi', 'Ananas', 'Wassermelone',
    'Apfel', 'Birne', 'Kirsche',
  ],
  'Sabores Premium': [
    'Bueno', 'Kinder', 'Oreo', 'Nutella', 'Ferrero', 'Lotus Biscoff',
    'Raffaello', 'Snickers', 'Toffifee', 'Cookies',
  ],
}

async function main(): Promise<void> {
  const prisma = new PrismaClient()
  let sortOrder = 0
  let createdCategories = 0
  let createdProducts = 0
  let skippedProducts = 0

  for (const [categoryName, items] of Object.entries(CATALOGO)) {
    let category = await prisma.productCategory.findFirst({
      where: { tenantId: TENANT_ID, name: categoryName },
    })
    if (!category) {
      category = await prisma.productCategory.create({
        data: { tenantId: TENANT_ID, name: categoryName, sortOrder: sortOrder++ },
      })
      createdCategories++
    }

    for (const name of items) {
      const existing = await prisma.product.findFirst({
        where: { tenantId: TENANT_ID, categoryId: category.id, name },
      })
      if (existing) {
        skippedProducts++
        continue
      }
      await prisma.product.create({
        data: {
          tenantId: TENANT_ID,
          categoryId: category.id,
          name,
          netCents: PLACEHOLDER_NET_CENTS,
          mwstCodeImHaus: 'standard_19',
          mwstCodeAusserHaus: 'reduced_7',
        },
      })
      createdProducts++
    }
  }

  console.log(`Categorias: ${createdCategories} · Produtos criados: ${createdProducts} · já existiam: ${skippedProducts}`)
  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
