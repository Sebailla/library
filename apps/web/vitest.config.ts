import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

/**
 * Vitest config for `@alejandria/web`.
 *
 * Uses jsdom so React Testing Library can mount RSC-compatible
 * components that consume plain objects as props (no fetch / IO).
 * Coverage threshold intentionally omitted for the scaffold slice.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['**/__tests__/**/*.{test,spec}.{ts,tsx}'],
    setupFiles: ['./vitest.setup.ts'],
  },
})