import { join } from 'node:path'
import { defineConfig } from '@playwright/test'
import { ms } from './test/time-scale'

// The acceptance run of the worfy-harness Epic: test/acceptance/e3.spec.ts drives the packaged
// worfy.app (dist/mac*/worfy.app of `pnpm package`, or WORFY_PACKAGED_APP) with the real agent in
// the sandbox of scripts/e3-sandbox.sh. `pnpm test:acceptance` runs it under the shared Electron
// lock. It is not part of `pnpm test:e2e`, `pnpm test:package`, `gate full` or CI: it needs the
// owner's sign-in in the sandbox, spends the subscription's Limits and runs up to 90 minutes.
//
// No retries: a second try of a Wave with a real agent would spend the Limits again and hide why
// the first one failed.
//
// What a failed test keeps goes to test-results-acceptance/<start time>/, a folder of its own per
// run: Playwright empties an output folder when a run starts, so inside test-results/ the next
// `pnpm test:e2e` (a gate full) would delete the only record of a failed 90-minute run, and so
// would the next acceptance run. The start time is set once, in the process that starts the run;
// its workers read the same value from the environment.
const startedAt = (process.env.E3_RESULTS_RUN ??= new Date().toISOString().replace(/[:.]/g, '-'))

export default defineConfig({
  testDir: 'test/acceptance',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  // Times the run's multiplier (test/time-scale.ts), like every other limit of the test run.
  timeout: ms(15 * 60_000),
  reporter: [['list']],
  outputDir: join('test-results-acceptance', startedAt),
  use: {
    trace: 'retain-on-failure',
  },
})
