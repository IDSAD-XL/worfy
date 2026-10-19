// The bash a test starts a `.sh` script with. On macOS and Linux it is `bash` from the PATH. On
// Windows the first `bash.exe` on the PATH may be the WSL launcher (C:\Windows\System32\bash.exe),
// which runs the script in a Linux distribution, not in Git Bash; so the tests take Git Bash
// explicitly: CLAUDE_CODE_GIT_BASH_PATH when it is set (as Claude Code does), else the Git Bash that
// worfy itself finds for the agent (src/main/agent/env.ts, findGitBash; worfy-windows ticket 09).
// Looked up on the first call, not when a file loads (test/unit/e2e-no-spawn-on-load.test.ts).
import { findGitBash, fileOrAlias } from '../src/main/agent/env'

let found: string | undefined

/** `bash` on macOS and Linux; the full path of Git Bash on Windows. Throws on Windows without Git Bash. */
export function gitBash(): string {
  if (process.platform !== 'win32') return 'bash'
  if (found !== undefined) return found
  const own = process.env['CLAUDE_CODE_GIT_BASH_PATH']
  const bash = own !== undefined && own !== '' && fileOrAlias(own) ? own : findGitBash(process.env)
  if (bash === null) throw new Error('no Git Bash: set CLAUDE_CODE_GIT_BASH_PATH or install Git for Windows')
  found = bash
  return found
}
