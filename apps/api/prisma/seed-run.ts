import { PrismaClient } from '@prisma/client'
import { runSeed } from './seed'

const prisma = new PrismaClient()
runSeed(prisma)
  .then(async () => {
    // eslint-disable-next-line no-console
    console.log('seed done')
    await prisma.$disconnect()
  })
  .catch(async (e) => {
    // eslint-disable-next-line no-console
    console.error(e)
    await prisma.$disconnect()
    process.exit(1)
  })
