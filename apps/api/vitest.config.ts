import { defineConfig } from 'vitest/config'
import swc from 'unplugin-swc'
import { config } from 'dotenv'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

// Carrega apps/api/.env para os testes (vitest não carrega .env sozinho).
config({ path: '.env' })

const root = dirname(fileURLToPath(import.meta.url))
const alias = {
  '@gelato/domain': resolve(root, '../../packages/domain/src/index.ts'),
  '@gelato/compliance': resolve(root, '../../packages/compliance/src/index.ts'),
  '@gelato/sync': resolve(root, '../../packages/sync/src/index.ts'),
}

export default defineConfig({
  // SWC transforma o código do Nest emitindo metadata de decorators (a DI do Nest
  // depende disso). Forçamos module ES6 aqui (o .swcrc usa commonjs para o build do Nest).
  plugins: [
    swc.vite({
      jsc: {
        target: 'es2021',
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
        keepClassNames: true,
      },
      module: { type: 'es6' },
    }),
  ],
  resolve: { alias },
  test: {
    include: ['{src,test}/**/*.{test,spec}.ts'],
    environment: 'node',
    globals: false,
    hookTimeout: 30000,
    globalSetup: ['./test/global-setup.ts'],
  },
})
