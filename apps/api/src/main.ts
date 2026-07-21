import 'reflect-metadata'
import { NestExpressApplication } from '@nestjs/platform-express'
import { NestFactory } from '@nestjs/core'
import { join } from 'node:path'
import { AppModule } from './app.module'

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule)
  app.enableCors() // backoffice (Vite) chama a API de outra origem em dev
  // Fotos de produto enviadas pelo backoffice — servidas como estáticas em /uploads/*
  app.useStaticAssets(join(process.cwd(), 'uploads'), { prefix: '/uploads/' })
  const port = process.env.PORT ? Number(process.env.PORT) : 3000
  await app.listen(port)
  // eslint-disable-next-line no-console
  console.log(`gelato-core API listening on http://localhost:${port}`)
}

void bootstrap()
