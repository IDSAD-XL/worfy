// The sandbox of the first-run checks in e2e (first-run.spec.ts, settings-health.spec.ts): a
// temporary HOME whose login shell puts the stand-in tools of test/fixtures/first-run-tools/ first
// on the PATH. On Windows the checks do not use a login shell: they run with the environment worfy
// reads from the registry (src/main/agent/env.ts). So there the stand-ins are never called and the
// rows are those of the machine's own tools; only gh comes from WORFY_GH, as everywhere since
// worfy-windows ticket 80. These specs do not run there until the checks can be pointed at the
// stand-ins on Windows (worfy-windows ticket 81). The Windows checks against stand-ins are
// test/unit/first-run-windows.test.ts (answers handed to runChecks) and
// test/contract/first-run-checks.test.ts (the stand-in tools themselves, through `.cmd` files).

/** Whether the first-run checks of the app under test miss the stand-in tools: on Windows. */
export const NO_STAND_INS = process.platform === 'win32'

export const NO_STAND_INS_ON_WINDOWS =
  'on Windows the checks read the registry environment, so they reach the machine\'s own tools, not the stand-ins (worfy-windows ticket 81)'
