import { defineConfig } from '@playwright/test'

// e2e tests drive the built app (out/) through Playwright's _electron; `pnpm test:e2e`
// rebuilds it first, so a run never sees a stale build.
//
// No retries, on purpose: a test that passes only on a second try is unstable, and a retry would
// hide that. A failing test keeps, in its folder under test-results/, Playwright's trace of the
// test's steps and (from test/e2e/helpers.ts) the app's own trace and a screenshot of its window.
export default defineConfig({
  testDir: 'test/e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  reporter: [['list'], ['./test/e2e/helpers.ts']],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
})
