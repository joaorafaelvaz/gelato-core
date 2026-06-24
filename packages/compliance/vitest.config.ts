import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  resolve: { alias: { '@gelato/domain': resolve(root, '../domain/src/index.ts') } },
  test: { include: ['{src,test}/**/*.{test,spec}.ts'] },
})
