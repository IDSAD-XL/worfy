// The synthetic Claude home of test/fixtures/claude-home for the tests that look Sessions up in it
// (worfy-windows ticket 14). The fixture is written for macOS and Linux: its Projects lie under
// /Users/test/, and each folder under projects/ is named after such a path
// (`-Users-test-projects-demo`). The registry resolves the Project root it is given
// (src/main/claude-home/registry.ts, roots()) and names the folder after the result. On Windows
// `/Users/test/projects/demo` resolves to `C:\Users\test\projects\demo` and its folder is
// `C--Users-test-projects-demo`, so no Session of the fixture was found there. A test therefore
// reads a copy whose folders carry the names the registry looks for on this system, and names a
// folder through projectDir(). On macOS and Linux the copy has the names of the fixture.
//
// Not a test file: the contract tests of the Claude home import it.
import { execFileSync } from 'node:child_process'
import { cp, mkdir, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { projectDirName } from '../../src/main/claude-home/registry'

/** The fixture itself. Only read; its folders under projects/ have the names of macOS and Linux. */
const CLAUDE_HOME_FIXTURE =join(import.meta.dirname, '..', 'fixtures', 'claude-home')

/** The folder each Session of the fixture was started in: one per folder under projects/. */
const FIXTURE_CWDS = [
  '/Users/test/projects/demo',
  '/Users/test/projects/demo/.claude/worktrees/07',
  '/Users/test/My Projects/demo.app',
  '/Users/test/проект',
  '/Users/test/projects/agents',
  '/Users/test/projects/stale',
  '/Users/test/projects/workflow',
]

/**
 * The name of the folder under projects/ for the Sessions started in `cwd`, as the registry looks
 * for it on this system: the name of the resolved path. `/Users/test/projects/demo` gives
 * `-Users-test-projects-demo` on macOS and Linux and `C--Users-test-projects-demo` on Windows.
 */
export const projectDir = (cwd: string): string => projectDirName(resolve(cwd))

/**
 * Copies the fixture to `home` (which must not exist) and returns `home`. Each folder under
 * projects/ gets the name projectDir() gives for the folder its Sessions were started in; the
 * files are copied as they are. Fails on a fixture folder FIXTURE_CWDS does not know.
 */
export async function copyClaudeHome(home: string): Promise<string> {
  const names = new Map(FIXTURE_CWDS.map((cwd) => [projectDirName(cwd), projectDir(cwd)]))
  await mkdir(join(home, 'projects'), { recursive: true })
  for (const entry of await readdir(CLAUDE_HOME_FIXTURE)) {
    if (entry !== 'projects') await cp(join(CLAUDE_HOME_FIXTURE, entry), join(home, entry), { recursive: true })
  }
  for (const name of await readdir(join(CLAUDE_HOME_FIXTURE, 'projects'))) {
    const copy = names.get(name)
    if (copy === undefined) throw new Error(`test/contract/claude-home-fixture.ts: no cwd in FIXTURE_CWDS for the fixture folder projects/${name}`)
    await cp(join(CLAUDE_HOME_FIXTURE, 'projects', name), join(home, 'projects', copy), { recursive: true })
  }
  return home
}

/**
 * The start of process `pid` on Windows as Claude Code records it in `procStart` there: its
 * FILETIME in decimal (evidence of worfy-windows ticket 01, section 23). Git Bash has a `ps`, but
 * without `-o`, and Claude Code does not write `ps` output on Windows. The test asks with a
 * command of its own, not with the script or the parser of registry.ts; both read the same
 * property of .NET, `Process.StartTime`.
 */
export function windowsProcStart(pid: number): string {
  const powershell = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  const command = `[System.Diagnostics.Process]::GetProcessById(${String(pid)}).StartTime.ToFileTimeUtc()`
  return execFileSync(powershell, ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', windowsHide: true }).trim()
}
