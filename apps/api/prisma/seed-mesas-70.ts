import { config } from 'dotenv'
config()
import { PrismaClient } from '@prisma/client'

const BS_ID = 'demo-bs'
const TOTAL = 70
const COLS = 10
const STEP = 140

async function main(): Promise<void> {
  const prisma = new PrismaClient()
  let created = 0
  let already = 0
  for (let n = 1; n <= TOTAL; n++) {
    const id = `tisch-${n}`
    const col = (n - 1) % COLS
    const row = Math.floor((n - 1) / COLS)
    const existing = await prisma.tisch.findUnique({ where: { id } })
    if (existing) {
      already++
      continue
    }
    await prisma.tisch.create({
      data: {
        id,
        betriebsstaetteId: BS_ID,
        name: `Tisch ${n}`,
        seats: 4,
        posX: 40 + col * STEP,
        posY: 40 + row * STEP,
      },
    })
    created++
  }
  console.log(`Mesas: ${created} criadas, ${already} já existiam (total ${TOTAL}).`)
  await prisma.$disconnect()
}

void main()
