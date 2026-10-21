// The sandbox of the first-run checks in e2e (first-run.spec.ts, settings-health.spec.ts): a
// temporary HOME whose login shell puts the stand-in tools of test/fixtures/first-run-tools/ first
// on the PATH. On Windows the checks do not use a login shell: they run with the environment worfy
// reads from the registry (src/main/agent/env.ts), and they find gh by that PATH, not by WORFY_GH.
// So there the stand-ins are never called, the rows are those of the machine, and the checks start
// the machine's real gh (`gh --version`, `gh auth status`), which no test may do. Until the checks
// can be pointed at the stand-ins on Windows, these specs do not run there (worfy-windows ticket 79);
// the Windows checks against the stand-ins are test/contract/first-run-checks.test.ts.

/** Whether the first-run checks of the app under test reach the stand-in tools. */
export const STAND_INS_REACHED = process.platform !== 'win32'

export const NO_STAND_INS_ON_WINDOWS =
  'on Windows the checks read the registry environment, so they reach the real tools, gh among them, not the stand-ins'
