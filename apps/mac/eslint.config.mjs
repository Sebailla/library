import tseslint from 'typescript-eslint'

/**
 * Flat ESLint config for `@alejandria/mac` (PR-4C).
 *
 * The Electron main process and preload script run in Node, so we
 * scope the rules to the `src/` tree and keep the test files
 * unlinted here — `apps/web` uses `next lint` for similar reasons.
 */
export default tseslint.config(
  {
    ignores: ['dist/**', 'out/**', 'node_modules/**'],
  },
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        // Electron main process globals
        app: 'readonly',
        BrowserWindow: 'readonly',
        ipcMain: 'readonly',
        contextBridge: 'readonly',
        dialog: 'readonly',
        process: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        module: 'readonly',
        require: 'readonly',
        exports: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
)
