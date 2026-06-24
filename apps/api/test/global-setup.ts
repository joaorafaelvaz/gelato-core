import { config } from 'dotenv'
import { PrismaClient } from '@prisma/client'
import { runSeed } from '../prisma/seed'

config({ path: '.env' })

/** Semeia o banco UMA vez antes de toda a suíte (evita corrida entre arquivos e2e). */
export async function setup(): Promise<void> {
  const prisma = new PrismaClient()
  try {
    await runSeed(prisma)
  } finally {
    await prisma.$disconnect()
  }
}
