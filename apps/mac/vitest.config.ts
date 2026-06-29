import { defineConfig } from 'vitest/config'

/**
 * Vitest config for `@alejandria/mac`.
 *
 * Uses the `node` environment because the Electron main process
 * runs in Node — no DOM, no React. The test files live under
 * `__tests__/` (sibling to `src/`) following the convention used
 * in `services/nas-backend/`.
 */
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['__tests__/**/*.test.ts'],
  },
})
