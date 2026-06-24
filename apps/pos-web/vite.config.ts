import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = dirname(fileURLToPath(import.meta.url))
const alias = {
  '@gelato/domain': resolve(root, '../../packages/domain/src/index.ts'),
  '@gelato/compliance': resolve(root, '../../packages/compliance/src/index.ts'),
  '@gelato/sync': resolve(root, '../../packages/sync/src/index.ts'),
  '@gelato/i18n': resolve(root, '../../packages/i18n/src/index.ts'),
}

export default defineConfig({
  resolve: { alias },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'gelato-core Kasse',
        short_name: 'Kasse',
        start_url: '/',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#0a7',
      },
    }),
  ],
  server: { port: 5174 },
})
