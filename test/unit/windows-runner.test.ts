import { describe, expect, it, vi } from 'vitest'
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

  // Review of PR #478 (worfy-windows ticket 59): the expected value was the formula of the code on
  // this machine, false off Windows, so a helper that always passed false stayed green there. The
  // system and the environment are set for each case instead.
  it.each([
    ['win32', 'true', true],
    ['win32', undefined, false],
    ['darwin', 'true', false],
    ['linux', 'true', false],
  ] as const)('needsWindowsPowerShellOffRunner on %s with GITHUB_ACTIONS=%s passes skip(%s) and the reason that names ticket 41', (platform, actions, skips) => {
    const real = Object.getOwnPropertyDescriptor(process, 'platform')!
    Object.defineProperty(process, 'platform', { ...real, value: platform })
    vi.stubEnv('GITHUB_ACTIONS', actions)
    const calls: [boolean, string | undefined][] = []
    try {
      needsWindowsPowerShellOffRunner({ skip: (condition, note) => void calls.push([condition, note]) })
    } finally {
      Object.defineProperty(process, 'platform', real)
      vi.unstubAllEnvs()
    }
    expect(calls).toEqual([[skips, NO_WINDOWS_POWERSHELL_ON_RUNNER]])
    expect(NO_WINDOWS_POWERSHELL_ON_RUNNER).toMatch(/ticket 41/)
  })
})
