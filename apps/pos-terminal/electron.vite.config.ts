import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = dirname(fileURLToPath(import.meta.url))
const alias = {
  '@gelato/domain': resolve(root, '../../packages/domain/src/index.ts'),
  '@gelato/compliance': resolve(root, '../../packages/compliance/src/index.ts'),
  '@gelato/sync': resolve(root, '../../packages/sync/src/index.ts'),
}

export default defineConfig({
  main: {
    // Bundla os pacotes do workspace a partir do src; mantém better-sqlite3 externo (nativo).
    plugins: [
      externalizeDepsPlugin({ exclude: ['@gelato/domain', '@gelato/compliance', '@gelato/sync'] }),
    ],
    resolve: { alias },
    build: { rollupOptions: { external: ['better-sqlite3'] } },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    root: resolve(root, 'src/renderer'),
    resolve: { alias },
    plugins: [react()],
    build: {
      outDir: resolve(root, 'out/renderer'),
      rollupOptions: { input: resolve(root, 'src/renderer/index.html') },
    },
  },
})
