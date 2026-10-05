import react from '@vitejs/plugin-react'
import { configDefaults, defineConfig } from 'vitest/config'

// Worktrees of other tickets live under .claude/worktrees/ inside this checkout;
// their tests must never be picked up by a run here.
const exclude = [...configDefaults.exclude, '.claude/worktrees/**', 'out/**', 'test/e2e/**']

export default defineConfig({
  test: {
    exclude,
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          include: ['test/unit/**/*.test.ts', 'test/contract/**/*.test.ts'],
        },
      },
      {
        extends: true,
        plugins: [react()],
        test: {
          name: 'jsdom',
          environment: 'jsdom',
          include: ['test/unit/**/*.test.tsx', 'test/contract/**/*.test.tsx'],
          setupFiles: ['test/setup-dom.ts'],
        },
      },
    ],
  },
})
