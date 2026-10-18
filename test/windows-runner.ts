// The skip of the Terminal tests whose shell is Windows PowerShell 5.1 on the clean GitHub Windows runner
// (worfy-windows ticket 41). Split out of test/contract/terminal-harness.ts so test/unit can pin the
// condition without loading the harness: GITHUB_ACTIONS is true in the Linux batch CI as well, so a
// condition without the system check would skip these tests there and the run would still exit 0.

/**
 * Why the tests on Windows PowerShell 5.1 are skipped on the GitHub runner: there every fresh process
 * answers its first command after 24-32 s, and neither a warm-up nor a shared LOCALAPPDATA made the next
 * process faster (runs 39090844904 and 39093912268).
 */
export const NO_WINDOWS_POWERSHELL_ON_RUNNER = "worfy-windows ticket 41: on the clean GitHub Windows runner the first command of a fresh Windows PowerShell 5.1 answers after ~25 s; runs on the PC and owners' machines"

/** True on Windows under GitHub Actions. The system and the environment are read at the call, so a test can pass others. */
export function windowsPowerShellOffRunner(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): boolean {
  return platform === 'win32' && env['GITHUB_ACTIONS'] === 'true'
}

/**
 * Skips a vitest test whose shell is Windows PowerShell 5.1 on the GitHub Windows runner, with the
 * reason: `needsWindowsPowerShellOffRunner(context)` first in the test. On macOS, Linux and a Windows
 * PC the test runs.
 */
export function needsWindowsPowerShellOffRunner(context: { skip: (condition: boolean, note?: string) => void }): void {
  context.skip(windowsPowerShellOffRunner(), NO_WINDOWS_POWERSHELL_ON_RUNNER)
}
