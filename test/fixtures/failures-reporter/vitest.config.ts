// The config of test/contract/failures-reporter-rerun.test.ts: it runs rerun.fixture.test.ts alone, with
// the reporter of failure records (test/failures-reporter.ts). The fixture lies outside the `include`
// of every project of the main vitest.config.ts, so `pnpm test` never runs its failing tests.
//
// The root is the repository, as in a run of the main config, so the file of a record and its rerun
// argv are the same as there. The reporters are named here: the default list would add vitest's
// github-actions reporter in GitHub Actions, and its annotations of these failures on the PR.
import { join } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  root: join(import.meta.dirname, '..', '..', '..'),
  test: {
    include: ['test/fixtures/failures-reporter/rerun.fixture.test.ts'],
    reporters: ['default', './test/failures-reporter.ts'],
    includeTaskLocation: true,
    retry: 0,
  },
})
