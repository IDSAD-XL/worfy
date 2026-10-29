import { defineConfig } from '@playwright/test'
import { CI_RETRIES } from './test/flaky'
import { ms } from './test/time-scale'

// Quiet windows (src/main/quiet-windows.ts): every worfy an e2e test starts shows its window without
// taking the focus, without a Dock icon, transparent and letting the mouse through, so a run does
// not get in the way of whoever uses the Mac meanwhile. launchApp (test/e2e/helpers.ts) passes the
// whole environment to the app. A test that needs the real window focus starts worfy with
// WORFY_QUIET_WINDOWS=0; a run started with the variable already set keeps its value.
process.env.WORFY_QUIET_WINDOWS ??= '1'
// Every e2e start is also kept painting (WORFY_KEEP_PAINTING, src/main/quiet-windows.ts), the specs
// that turn quiet windows off included: Chromium otherwise stops painting a window it counts as
// covered, and several Electron starts at once left a loaded page without 'ready-to-show'.
process.env.WORFY_KEEP_PAINTING ??= '1'

// e2e tests drive the built app (out/) through Playwright's _electron; `pnpm test:e2e`
// rebuilds it first, so a run never sees a stale build.
//
// Retries: none locally. In CI one (CI_RETRIES, test/flaky.ts), because a flake of the runner would
// otherwise block every PR. A test that passed only on the retry is not hidden: test/e2e/flaky-reporter.ts
// prints it as FLAKY in the log and on the job's summary page, and it still counts for the quarantine
// rules (test/quarantine.ts). A failing attempt keeps, in its folder under the output folder,
// Playwright's trace of the test's steps and (from test/e2e/helpers.ts) the app's own trace and a
// screenshot of its window; the retry gets a folder of its own (…-retry1), so a retry that passes
// leaves the first attempt's traces in place ('retain-on-failure' keeps a failed run's trace even
// when a later retry passes).
//
// The output folder is test-results/e2e. `pnpm test:package` runs the @packaged tests with
// `--output test-results/package`: Playwright empties the output folder when a run starts, and with
// one folder for both the packaged run, which follows the e2e run in a full gate, deleted the
// error context and the traces of a failed e2e test. A command-line flag, not an environment
// variable in the script, because package.json scripts run through cmd.exe on Windows.
//
// A JSON report of the run, with the duration of every test, goes next to the output folder and is
// named after it: test-results/e2e-report.json, and test-results/package-report.json for
// `pnpm test:package` (scripts/test-timings.mjs reads both). One file for both runs would let the
// packaged run of a full gate overwrite the report of the e2e run. The output folder is read from
// the command line here because the config does not know --output otherwise.
const OUTPUT_DIR = 'test-results/e2e'
const outputFlag = process.argv.findIndex((arg) => arg === '--output' || arg.startsWith('--output='))
const outputDir =
  outputFlag < 0 ? OUTPUT_DIR : process.argv[outputFlag]!.startsWith('--output=') ? process.argv[outputFlag]!.slice('--output='.length) : (process.argv[outputFlag + 1] ?? OUTPUT_DIR)
const jsonReport = `${outputDir.replace(/[\\/]+$/, '')}-report.json`

// Spec files may run in several workers (`pnpm test:e2e --workers=N`): every launchApp gets its own
// temporary WORFY_DATA_DIR (Electron's userData, and with it the single-instance lock of
// src/main/index.ts), WORFY_CLAUDE_HOME and shell folder; the link server and the specs' own servers
// take a port the OS picks; specs keep their files in mkdtemp folders. Tests of one file stay in one
// worker, in order (fullyParallel: false), because specs keep state between their tests.
//
// Three workers on macOS outside CI, by measurement on the owner's Mac only (2026-10-21, 287
// tests): one worker 565 s, two 292 s, three 207 s, then three runs in a row at three 202–203 s,
// all green with no retries. One worker everywhere else: the Windows PC and the GitHub macOS runner
// (the manual job full-macos, CI set) were not measured and stay at one until they are; several
// Electron starts at once slow every start, and some specs time a reaction in milliseconds.
// `--workers=N` on the command line overrides either; `pnpm test:package` passes --workers=1, since
// the packaged run was not measured in several workers.
// At three, 2 of 4 gate full runs went red on "the window was not shown within 30 s" (2026-10-21);
// since the fallback show of the window and the start diagnosis (src/main/window-show.ts,
// test/e2e/start-diagnosis.ts), three runs at three took 204–227 s, 289 passed, none flaky. If
// that failure comes back, the start-diagnostics-… folder in test-results says why.
const E2E_WORKERS = process.platform === 'darwin' && !process.env.CI ? 3 : 1
export default defineConfig({
  testDir: 'test/e2e',
  testMatch: '**/*.spec.ts',
  outputDir: OUTPUT_DIR,
  fullyParallel: false,
  workers: E2E_WORKERS,
  // Both limits times the run's multiplier (test/time-scale.ts, WORFY_TEST_TIMEOUT_SCALE), like every
  // limit a spec sets for itself through ms. 5 s is Playwright's own default of expect.
  timeout: ms(60_000),
  expect: { timeout: ms(5_000) },
  retries: CI_RETRIES,
  reporter: [['list'], ['./test/e2e/helpers.ts'], ['./test/e2e/flaky-reporter.ts'], ['json', { outputFile: jsonReport }]],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
})
