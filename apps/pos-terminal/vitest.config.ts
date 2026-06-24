import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = dirname(fileURLToPath(import.meta.url))
const alias = {
  '@gelato/domain': resolve(root, '../../packages/domain/src/index.ts'),
  '@gelato/compliance': resolve(root, '../../packages/compliance/src/index.ts'),
  '@gelato/sync': resolve(root, '../../packages/sync/src/index.ts'),
}

export default defineConfig({
  resolve: { alias },
  test: {
    environment: 'node',
    include: ['{src,test}/**/*.{test,spec}.ts'],
    server: { deps: { external: ['better-sqlite3'] } },
  },
})
