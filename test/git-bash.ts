// The bash a test starts a `.sh` script with. On macOS and Linux it is `bash` from the PATH. On
// Windows the first `bash.exe` on the PATH may be the WSL launcher (C:\Windows\System32\bash.exe),
// which runs the script in a Linux distribution, not in Git Bash; so the tests take Git Bash
// explicitly: CLAUDE_CODE_GIT_BASH_PATH when it is set (as Claude Code does), else the Git Bash that
// worfy itself finds for the agent (src/main/agent/env.ts, findGitBash; worfy-windows ticket 09).
// Looked up on the first call, not when a file loads (test/unit/e2e-no-spawn-on-load.test.ts).
import { findGitBash, fileOrAlias } from '../src/main/agent/env'

let found: string | undefined

/**
 * The Git Bash of a Windows environment: CLAUDE_CODE_GIT_BASH_PATH when it names a file, else
 * findGitBash. A CLAUDE_CODE_GIT_BASH_PATH under %SystemRoot% is the WSL launcher: findGitBash
 * skips such a candidate silently, but here it is the tester's own setting, so it throws with the
 * reason instead of falling through to another bash. Throws when there is no Git Bash.
 */
export function windowsGitBash(env: NodeJS.ProcessEnv, exists: (path: string) => boolean = fileOrAlias): string {
  const own = env['CLAUDE_CODE_GIT_BASH_PATH']
  if (own !== undefined && own !== '') {
    const systemRoot = (env['SystemRoot'] ?? env['SYSTEMROOT'] ?? 'C:\\Windows').toLowerCase()
    if (own.replaceAll('/', '\\').toLowerCase().startsWith(`${systemRoot}\\`)) {
      throw new Error(`CLAUDE_CODE_GIT_BASH_PATH is ${own}, under ${systemRoot}: that bash.exe is the WSL launcher, not Git Bash`)
    }
    if (exists(own)) return own
  }
  const bash = findGitBash(env, exists)
  if (bash === null) throw new Error('no Git Bash: set CLAUDE_CODE_GIT_BASH_PATH or install Git for Windows')
  return bash
}

/** `bash` on macOS and Linux; the full path of Git Bash on Windows. Throws on Windows without Git Bash. */
export function gitBash(): string {
  if (process.platform !== 'win32') return 'bash'
  found ??= windowsGitBash(process.env)
  return found
}
