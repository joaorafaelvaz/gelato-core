import { defineConfig } from 'vitest/config'

// Apenas os pacotes puros. apps/* têm suas próprias configs (ex.: apps/api usa SWC
// para a metadata de decorators do Nest). Suíte completa: `pnpm -r test`.
export default defineConfig({
  test: {
    include: ['packages/*/{src,test}/**/*.{test,spec}.ts'],
    passWithNoTests: true,
  },
})
