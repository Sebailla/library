import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

/**
 * Vitest config for `@alejandria/web`.
 *
 * Uses jsdom so React Testing Library can mount RSC-compatible
 * components that consume plain objects as props (no fetch / IO).
 * Coverage threshold intentionally omitted for the scaffold slice.
 *
 * The `resolve.alias` entry mirrors the tsconfig `paths.@/*`
 * mapping so test files can import from `@/lib/...` the same
 * way the production source does.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['**/__tests__/**/*.{test,spec}.{ts,tsx}'],
    setupFiles: ['./vitest.setup.ts'],
  },
})
