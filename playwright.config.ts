import { defineConfig } from '@playwright/test'

// e2e tests drive the built app (out/) through Playwright's _electron; `pnpm test:e2e`
// rebuilds it first, so a run never sees a stale build.
export default defineConfig({
  testDir: 'test/e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  reporter: 'list',
})
