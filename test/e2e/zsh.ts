import { execFileSync } from 'node:child_process'

// The zsh of the machine, for the e2e tests that start the app's shells in zsh (Terminal AI works
// in zsh; Settings → Sessions reads the environment of a zsh login shell). It is looked up when a
// test asks for it, not when a file is loaded: Playwright loads every spec before it runs any, and
// on Windows, which has no /bin/sh, one lookup at load stopped the whole run (worfy-windows
// ticket 53).

/** Why the tests that need zsh are skipped on Windows. */
export const NO_ZSH_ON_WINDOWS = 'Terminal AI and the login-shell environment of these tests work in zsh; Windows has no zsh'

/** True where these tests cannot get a zsh. */
export const NO_ZSH = process.platform === 'win32'

let found: string | undefined

/** The path of zsh: /bin/zsh on macOS. Asked of /bin/sh once, on the first call. */
export function zshPath(): string {
  found ??= execFileSync('/bin/sh', ['-c', 'command -v zsh'], { encoding: 'utf8' }).trim()
  return found
}
