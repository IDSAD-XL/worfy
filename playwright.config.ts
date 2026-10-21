import { defineConfig } from '@playwright/test'

// Quiet windows (src/main/quiet-windows.ts): every worfy an e2e test starts shows its window without
// taking the focus, without a Dock icon, transparent and letting the mouse through, so a run does
// not get in the way of whoever uses the Mac meanwhile. launchApp (test/e2e/helpers.ts) passes the
// whole environment to the app. A test that needs the real window focus starts worfy with
// WORFY_QUIET_WINDOWS=0; a run started with the variable already set keeps its value.
process.env.WORFY_QUIET_WINDOWS ??= '1'

// e2e tests drive the built app (out/) through Playwright's _electron; `pnpm test:e2e`
// rebuilds it first, so a run never sees a stale build.
//
// No retries, on purpose: a test that passes only on a second try is unstable, and a retry would
// hide that. A failing test keeps, in its folder under the output folder, Playwright's trace of the
// test's steps and (from test/e2e/helpers.ts) the app's own trace and a screenshot of its window.
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
// worker, in order (fullyParallel: false), because specs keep state between their tests. The
// default stays one worker until a measured run on the Mac picks the number: several Electron
// starts at once slow every start, and some specs time a reaction in milliseconds.
export default defineConfig({
  testDir: 'test/e2e',
  testMatch: '**/*.spec.ts',
  outputDir: OUTPUT_DIR,
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  reporter: [['list'], ['./test/e2e/helpers.ts'], ['json', { outputFile: jsonReport }]],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
})
