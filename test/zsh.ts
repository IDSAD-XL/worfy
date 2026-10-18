import { execFileSync } from 'node:child_process'

// The zsh of the machine, for the tests that start shells in zsh: the e2e tests of test/e2e and the
// contract tests of test/contract (Terminal AI and the shell integration work in zsh; Settings →
// Sessions reads the environment of a zsh login shell). It is looked up when a test asks for it, not
// when a file is loaded: on Windows, which has no /bin/sh, one lookup at load stopped the whole
// Playwright run (worfy-windows ticket 53) and failed each contract file that did it, with not one of
// its tests run (ticket 54). test/unit/e2e-no-spawn-on-load.test.ts keeps it that way.

/** Why the tests that need zsh are skipped on Windows. */
export const NO_ZSH_ON_WINDOWS = 'Terminal AI, the shell integration and the login-shell environment of these tests work in zsh; Windows has no zsh'

/** True where these tests cannot get a zsh. */
export const NO_ZSH = process.platform === 'win32'

let found: string | undefined

/** The path of zsh: /bin/zsh on macOS, /usr/bin/zsh on Linux CI. Asked of /bin/sh once, on the first call. */
export function zshPath(): string {
  found ??= execFileSync('/bin/sh', ['-c', 'command -v zsh'], { encoding: 'utf8' }).trim()
  return found
}

/**
 * Skips a vitest test that needs zsh where there is none, with the reason: `beforeEach(needsZsh)` in
 * a describe whose tests all need it, or `needsZsh(context)` first in one test.
 */
export function needsZsh(context: { skip: (condition: boolean, note?: string) => void }): void {
  context.skip(NO_ZSH, NO_ZSH_ON_WINDOWS)
}

/** Why a test that starts /bin/sh, or expects the folder /tmp, is skipped on Windows. */
export const NO_POSIX_ON_WINDOWS = 'the test starts /bin/sh or expects the folder /tmp; Windows has neither'

/** Skips a vitest test that needs /bin/sh or /tmp on Windows, with the reason: `needsPosix(context)` first in the test. */
export function needsPosix(context: { skip: (condition: boolean, note?: string) => void }): void {
  context.skip(process.platform === 'win32', NO_POSIX_ON_WINDOWS)
}
