import js from '@eslint/js'
import { defineConfig } from 'eslint/config'
import reactHooks from 'eslint-plugin-react-hooks'
import { reactRefresh } from 'eslint-plugin-react-refresh'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default defineConfig(
  {
    // .claude/worktrees/ holds other tickets' checkouts: never lint them from here.
    ignores: ['node_modules/**', 'out/**', 'dist/**', 'test-results/**', 'playwright-report/**', '.claude/worktrees/**'],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['src/main/**/*.ts', 'src/preload/**/*.ts', 'test/**/*.ts', '*.config.{js,ts}', 'electron.vite.config.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}', 'test/**/*.tsx'],
    languageOptions: { globals: globals.browser },
    extends: [reactHooks.configs.flat.recommended],
  },
  {
    files: ['src/renderer/**/*.tsx'],
    extends: [reactRefresh.configs.vite()],
  },
)
