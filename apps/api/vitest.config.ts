import { defineConfig } from 'vitest/config'
import swc from 'unplugin-swc'
import { config } from 'dotenv'

// Carrega apps/api/.env para os testes (vitest não carrega .env sozinho).
config({ path: '.env' })

export default defineConfig({
  // SWC transforma o código do Nest emitindo metadata de decorators (a DI do Nest
  // depende disso). Forçamos module ES6 aqui (o .swcrc usa commonjs para o build do
  // Nest, mas o vitest precisa de ESM).
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
  test: {
    include: ['{src,test}/**/*.{test,spec}.ts'],
    environment: 'node',
    globals: false,
    hookTimeout: 30000,
  },
})
