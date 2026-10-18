import { describe, expect, it } from 'vitest'
import { needsWindowsPowerShellOffRunner, NO_WINDOWS_POWERSHELL_ON_RUNNER, windowsPowerShellOffRunner } from '../windows-runner'

// The skip of the Windows PowerShell 5.1 Terminal tests (worfy-windows ticket 41) fires on the GitHub
// Windows runner only. GITHUB_ACTIONS is true in the Linux batch CI too: without the system check the
// condition would skip 10 tests of test/contract/terminal.test.ts there and the run would still exit 0.

describe('the skip of the Windows PowerShell 5.1 tests on the GitHub runner', () => {
  it.each([
    ['win32', { GITHUB_ACTIONS: 'true' }, true],
    ['win32', {}, false],
    ['win32', { GITHUB_ACTIONS: 'false' }, false],
    ['linux', { GITHUB_ACTIONS: 'true' }, false],
    ['darwin', { GITHUB_ACTIONS: 'true' }, false],
    ['linux', {}, false],
  ] as const)('on %s with %o it skips: %s', (platform, env, skips) => {
    expect(windowsPowerShellOffRunner(platform, env)).toBe(skips)
  })

  it('needsWindowsPowerShellOffRunner passes the condition of this machine and the reason that names ticket 41', () => {
    let call: [boolean, string | undefined] | undefined
    needsWindowsPowerShellOffRunner({
      skip: (condition, note) => {
        call = [condition, note]
      },
    })
    expect(call).toEqual([process.platform === 'win32' && process.env['GITHUB_ACTIONS'] === 'true', NO_WINDOWS_POWERSHELL_ON_RUNNER])
    expect(NO_WINDOWS_POWERSHELL_ON_RUNNER).toMatch(/ticket 41/)
  })
})
