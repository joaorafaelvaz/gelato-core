import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = dirname(fileURLToPath(import.meta.url))

// Testes resolvem os pacotes do workspace pelo SRC (sem precisar buildar).
// O runtime (Node/Nest) usa o dist via package.json#exports.
const alias = {
  '@gelato/domain': resolve(root, 'packages/domain/src/index.ts'),
  '@gelato/compliance': resolve(root, 'packages/compliance/src/index.ts'),
  '@gelato/sync': resolve(root, 'packages/sync/src/index.ts'),
}

export default defineConfig({
  resolve: { alias },
  test: {
    include: ['packages/*/{src,test}/**/*.{test,spec}.ts'],
    passWithNoTests: true,
  },
})
