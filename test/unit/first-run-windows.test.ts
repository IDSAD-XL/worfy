// The first-run checks on Windows (worfy-windows ticket 13; owner's answers Q18, Q20, Q24): the system,
// os.release(), the architecture and the answers of the tools are handed to runChecks, so these
// cases run on any machine, Linux CI included. The same checks with `darwin` keep the Mac list and
// its `brew install` commands. Then the status line command of the Limits bridge for both systems,
// the "Limits from terminal" row and its action. No real tool runs, except one .cmd on Windows.
import { execFileSync, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FirstRunActions, type Confirmation } from '../../src/main/first-run/actions'
import { ghOverride, killTool, runChecks, runTool, toolStart, windowsNativeArch, windowsProgram, type CheckDeps, type Probes, type ToolRun } from '../../src/main/first-run/checks'
import { writeAtomically, writeStatusLine } from '../../src/main/harness/migrate/apply'
import { otherBuildBridge } from '../../src/main/harness/migrate/plan'
import { bridgeCommand, bridgeFile, bridgeOf, limitsBridgeState, splitCommand, statusLineCommandOf, withBridge } from '../../src/main/harness/status-line'
import type { Check, CheckId, FirstRunReport } from '../../src/shared/ipc/first-run'
import type { HarnessStatus } from '../../src/shared/ipc/harness'
import { removeTestTree } from '../remove'

// qmd's own state runs `qmd --version` and `node --version`: its rows are not what this file checks.
vi.mock('../../src/main/harness/qmd', async (original) => {
  const real = await original<typeof import('../../src/main/harness/qmd')>()
  return {
    ...real,
    qmdState: () =>
      Promise.resolve({ qmd: null, version: 'missing', warning: null, node: { version: '22.13.0', ok: true }, models: { models: [], bytes: 0, russian: false, present: [] }, answer: null }),
  }
})

const GIT_CMD = 'C:\\Program Files\\Git\\cmd'
const GIT_BASH = 'C:\\Program Files\\Git\\bin\\bash.exe'
const WSL_BASH = 'C:\\Windows\\System32\\bash.exe'
const PWSH_DIR = 'C:\\Program Files\\PowerShell\\7'
const PWSH = `${PWSH_DIR}\\pwsh.exe`
const WINDOWS_ENV = {
  PATH: `${GIT_CMD};${PWSH_DIR};C:\\Windows\\System32`,
  SystemRoot: 'C:\\Windows',
  ProgramFiles: 'C:\\Program Files',
  LOCALAPPDATA: 'C:\\Users\\alice\\AppData\\Local',
  USERPROFILE: 'C:\\Users\\alice',
}
const BUNDLED = '2.1.289'

/** What each tool answers to `--version` (and gh to `auth status`); a tool left out is not installed. */
type Answers = Partial<Record<'git' | 'gh' | 'node' | 'jq' | 'claude', string>>
const ALL: Answers = { git: 'git version 2.45.1.windows.1', gh: 'gh version 2.60.0 (2024-10-15)', node: 'v22.13.0', jq: 'jq-1.7.1', claude: `${BUNDLED} (Claude Code)` }
/** Every tool but `name`. */
const without = (name: keyof Answers): Answers => Object.fromEntries(Object.entries(ALL).filter(([key]) => key !== name))

let root: string
let claudeHome: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'worfy-first-run-windows-'))
  claudeHome = join(root, '.claude')
  mkdirSync(claudeHome, { recursive: true })
})

afterEach(() => {
  removeTestTree(root)
})

function probes(answers: Answers, files: readonly string[]): Probes {
  const run = (name: string, args: readonly string[]): Promise<ToolRun> => {
    const answer = answers[name as keyof Answers]
    if (answer === undefined) return Promise.resolve({ code: null, stdout: '', stderr: '', missing: true })
    if (name === 'gh' && args[0] === 'auth') return Promise.resolve({ code: 0, stdout: 'github.com\n  ✓ Logged in to github.com account alice (keyring)\n', stderr: '', missing: false })
    return Promise.resolve({ code: 0, stdout: `${answer}\n`, stderr: '', missing: false })
  }
  // The listed files, and the temporary folder of the test (settings.json, the bridge); nothing else of the real disk.
  const exists = (path: string): boolean => files.includes(path) || (path.startsWith(root) && existsSync(path))
  return { run, exists }
}

const installed: HarnessStatus = { state: { kind: 'installed', version: '1.2.0', enabled: true }, bundledVersion: '1.2.0', canInstall: true, pluginDir: 'x', dependencies: [] }

function deps(system: CheckDeps['system'], answers: Answers = ALL, files: readonly string[] = [`${GIT_CMD}\\git.exe`, GIT_BASH, PWSH], overrides: Partial<CheckDeps> = {}): CheckDeps {
  return {
    env: system?.platform === 'win32' ? WINDOWS_ENV : { PATH: '/usr/bin:/bin', HOME: root },
    scriptEnv: () => Promise.resolve({}),
    bundledClaudeCodeVersion: BUNDLED,
    accountInfo: () => Promise.resolve({ email: 'alice@example.com', subscriptionType: 'max', tokenSource: 'claude.ai' }),
    harness: () => Promise.resolve(installed),
    legacyHarness: () => false,
    homes: { harnessHome: join(claudeHome, 'worfy-harness'), claudeHome },
    projects: () => Promise.resolve([]),
    system,
    probes: probes(answers, files),
    limitsBridge: null,
    ...overrides,
  }
}

const WIN11 = { platform: 'win32' as const, release: '10.0.22631', arch: 'x64' }
const MAC = { platform: 'darwin' as const, release: '24.6.0', arch: 'arm64' }

const checkOf = (report: FirstRunReport, id: CheckId): Check => {
  const found = report.checks.find((check) => check.id === id)
  if (found === undefined) throw new Error(`no check ${id}: ${report.checks.map((check) => check.id).join(', ')}`)
  return found
}

describe('first-run checks on Windows', () => {
  it('lists Git Bash, the Windows build, the architecture, PowerShell and the Limits row next to the Mac checks', async () => {
    const report = await runChecks(deps(WIN11))
    expect(report.checks.map((check) => [check.group, check.id, check.title])).toEqual([
      ['Claude Code', 'claude-login', 'Sign-in'],
      ['Claude Code', 'claude-version', 'Claude Code in the terminal'],
      ['Claude Code', 'limits', 'Limits from terminal'],
      ['Windows', 'windows', 'Windows version'],
      ['Windows', 'arch', 'Architecture'],
      ['Windows', 'powershell', 'PowerShell'],
      ['Command-line tools', 'git', 'git'],
      ['Command-line tools', 'git-identity', 'git identity'],
      ['Command-line tools', 'git-bash', 'Git Bash'],
      ['Command-line tools', 'gh', 'gh'],
      ['Command-line tools', 'node', 'node'],
      ['Command-line tools', 'jq', 'jq'],
      ['GitHub', 'gh-auth', 'GitHub accounts'],
      ['Harness', 'harness', 'Harness plugin'],
      ['Harness', 'harness-dependencies', 'Plugin dependencies'],
      ['Harness', 'harness-scripts', 'Harness scripts'],
      ['Harness', 'legacy-harness', 'Old Harness in ~/.claude'],
      ['qmd', 'qmd', 'qmd'],
      ['qmd', 'qmd-models', 'qmd models'],
      ['qmd', 'qmd-collections', 'qmd collections'],
    ])
    for (const id of ['git', 'git-bash', 'gh', 'node', 'jq', 'windows', 'arch', 'powershell', 'claude-version'] as const) expect(checkOf(report, id).status, id).toBe('ok')
    expect(checkOf(report, 'git-bash').detail).toBe(GIT_BASH)
    expect(checkOf(report, 'powershell').detail).toBe(PWSH)
    expect(checkOf(report, 'windows').detail).toBe('Windows 11, build 22631')
  })

  it('no Git Bash: Failed with winget install Git.Git', async () => {
    const report = await runChecks(deps(WIN11, ALL, [`${GIT_CMD}\\git.exe`, PWSH]))
    expect(checkOf(report, 'git-bash')).toMatchObject({ status: 'fail', command: 'winget install Git.Git' })
  })

  it('only C:\\Windows\\System32\\bash.exe (the WSL launcher): Failed', async () => {
    const report = await runChecks(deps(WIN11, ALL, [WSL_BASH, PWSH]))
    expect(checkOf(report, 'git-bash')).toMatchObject({ status: 'fail', command: 'winget install Git.Git' })
    expect(checkOf(report, 'git-bash').hint).toContain('System32\\bash.exe')
  })

  it('node v20: Failed with winget install OpenJS.NodeJS.LTS', async () => {
    const report = await runChecks(deps(WIN11, { ...ALL, node: 'v20.18.0' }))
    expect(checkOf(report, 'node')).toMatchObject({ status: 'fail', detail: '20.18.0, needs 22 or newer', command: 'winget install OpenJS.NodeJS.LTS' })
  })

  it('no node: Failed with the same command, found missing on the PATH worfy builds (not a login shell)', async () => {
    const rest = without('node')
    const report = await runChecks(deps(WIN11, rest))
    expect(checkOf(report, 'node')).toMatchObject({ status: 'fail', detail: 'not found on the PATH', command: 'winget install OpenJS.NodeJS.LTS' })
  })

  it('no gh: Failed with winget install GitHub.cli; GitHub accounts names the same command', async () => {
    const rest = without('gh')
    const report = await runChecks(deps(WIN11, rest))
    expect(checkOf(report, 'gh')).toMatchObject({ status: 'fail', command: 'winget install GitHub.cli' })
    expect(checkOf(report, 'gh-auth').hint).toContain('winget install GitHub.cli')
    expect(checkOf(report, 'gh-auth').hint).not.toContain('brew')
  })

  it('no git: Failed with winget install Git.Git', async () => {
    const rest = without('git')
    const report = await runChecks(deps(WIN11, rest))
    expect(checkOf(report, 'git')).toMatchObject({ status: 'fail', command: 'winget install Git.Git' })
  })

  it('no jq: a Warning, not Failed, with winget install jqlang.jq and what does not work without it', async () => {
    const rest = without('jq')
    const report = await runChecks(deps(WIN11, rest))
    expect(checkOf(report, 'jq')).toMatchObject({ status: 'warn', command: 'winget install jqlang.jq' })
    expect(checkOf(report, 'jq').hint).toContain('jq')
  })

  it('no pwsh.exe, only Windows PowerShell: a Warning with winget install Microsoft.PowerShell', async () => {
    const report = await runChecks(deps(WIN11, ALL, [`${GIT_CMD}\\git.exe`, GIT_BASH]))
    expect(checkOf(report, 'powershell')).toMatchObject({ status: 'warn', detail: 'Terminal uses Windows PowerShell', command: 'winget install Microsoft.PowerShell' })
  })

  it.each([
    ['10.0.19043', 'fail'],
    ['10.0.19044', 'ok'],
    ['10.0.22631', 'ok'],
  ] as const)('os.release() %s: %s', async (release, status) => {
    const report = await runChecks(deps({ ...WIN11, release }))
    expect(checkOf(report, 'windows').status).toBe(status)
    if (status === 'fail') expect(checkOf(report, 'windows').hint).toContain('Windows 10 21H2 or newer is required')
  })

  it('architecture arm64: a Warning; x64: OK', async () => {
    expect(checkOf(await runChecks(deps({ ...WIN11, arch: 'arm64' })), 'arch')).toMatchObject({ status: 'warn', detail: 'arm64' })
    expect(checkOf(await runChecks(deps(WIN11)), 'arch')).toMatchObject({ status: 'ok', detail: 'x64' })
  })

  it('no claude: a Warning that it is not on the PATH', async () => {
    const rest = without('claude')
    expect(checkOf(await runChecks(deps(WIN11, rest)), 'claude-version')).toMatchObject({ status: 'warn', detail: 'not found on the PATH' })
  })

  it('says nothing of brew anywhere', async () => {
    const report = await runChecks(deps(WIN11, {}, []))
    expect(JSON.stringify(report)).not.toContain('brew')
  })

  it('a git.exe under C:\\Windows: the bash.exe next to it is refused, as findGitBash refuses the Windows folder', async () => {
    // git.exe in C:\Windows\cmd makes C:\Windows the root of Git for Windows, and C:\Windows\bin\bash.exe its Git Bash.
    const env = { ...WINDOWS_ENV, PATH: 'C:\\Windows\\cmd;C:\\Windows\\System32' }
    const report = await runChecks(deps(WIN11, ALL, ['C:\\Windows\\cmd\\git.exe', 'C:\\Windows\\bin\\bash.exe'], { env }))
    expect(checkOf(report, 'git-bash')).toMatchObject({ status: 'fail', detail: 'not found', command: 'winget install Git.Git' })
  })

  it('CLAUDE_CODE_GIT_BASH_PATH, which the Session keeps: a portable Git there is OK, System32\\bash.exe fails, a missing file fails', async () => {
    const portable = 'D:\\tools\\PortableGit\\bin\\bash.exe'
    const withVariable = (value: string, files: string[]) => runChecks(deps(WIN11, ALL, files, { env: { ...WINDOWS_ENV, CLAUDE_CODE_GIT_BASH_PATH: value } }))
    // The variable wins over the Git Bash findGitBash would find.
    expect(checkOf(await withVariable(portable, [portable, GIT_BASH]), 'git-bash')).toMatchObject({ status: 'ok', detail: portable })
    const wsl = checkOf(await withVariable(WSL_BASH, [WSL_BASH, GIT_BASH]), 'git-bash')
    expect(wsl).toMatchObject({ status: 'fail', detail: `CLAUDE_CODE_GIT_BASH_PATH is ${WSL_BASH}`, command: 'winget install Git.Git' })
    expect(checkOf(await withVariable('c:\\windows\\system32\\bash.exe', [GIT_BASH]), 'git-bash').status).toBe('fail')
    expect(checkOf(await withVariable(portable, [GIT_BASH]), 'git-bash')).toMatchObject({ status: 'fail', detail: `CLAUDE_CODE_GIT_BASH_PATH names a missing file: ${portable}` })
  })

  it('jq there but `jq --version` failing: a Warning, not Failed, with the same command', async () => {
    const base = probes(ALL, [`${GIT_CMD}\\git.exe`, GIT_BASH, PWSH])
    const run: Probes['run'] = (name, args, env, ms) =>
      name === 'jq' ? Promise.resolve({ code: 2, stdout: '', stderr: 'jq: error while loading shared libraries\n', missing: false }) : base.run(name, args, env, ms)
    const report = await runChecks(deps(WIN11, ALL, undefined, { probes: { ...base, run } }))
    expect(checkOf(report, 'jq')).toMatchObject({ status: 'warn', detail: 'jq --version failed: jq: error while loading shared libraries', command: 'winget install jqlang.jq' })
  })

  it('the architecture is the machine\'s: PROCESSOR_ARCHITEW6432, else PROCESSOR_ARCHITECTURE of the Session environment', async () => {
    expect(windowsNativeArch({ PROCESSOR_ARCHITECTURE: 'AMD64' })).toBe('x64')
    expect(windowsNativeArch({ PROCESSOR_ARCHITECTURE: 'ARM64' })).toBe('arm64')
    expect(windowsNativeArch({ PROCESSOR_ARCHITECTURE: 'x86', PROCESSOR_ARCHITEW6432: 'AMD64' })).toBe('x64')
    expect(windowsNativeArch({})).toBeNull()
    // Without an architecture given, the row names the machine's from the environment, not the process's.
    // x86 (ia32) is the architecture of no test host, so the answer cannot come from os.arch() by chance.
    const report = await runChecks(deps({ platform: 'win32', release: '10.0.22631' }, ALL, undefined, { env: { ...WINDOWS_ENV, PROCESSOR_ARCHITECTURE: 'x86' } }))
    expect(checkOf(report, 'arch')).toMatchObject({ status: 'warn', detail: 'ia32' })
  })

  it.skipIf(process.platform !== 'win32')('pwsh as an app execution alias (MSIX in WindowsApps): the row finds it as Terminal does (Windows with that alias only)', async () => {
    const windowsApps = join(process.env.LOCALAPPDATA ?? '', 'Microsoft', 'WindowsApps')
    // existsSync does not see the alias; the row must not fall back to Windows PowerShell for it.
    if (existsSync(join(windowsApps, 'pwsh.exe')) || !isAlias(join(windowsApps, 'pwsh.exe'))) return
    const env = { ...WINDOWS_ENV, PATH: windowsApps }
    const report = await runChecks(deps(WIN11, ALL, undefined, { env, probes: { run: probes(ALL, []).run } }))
    expect(checkOf(report, 'powershell')).toMatchObject({ status: 'ok', detail: join(windowsApps, 'pwsh.exe') })
  })

  it.skipIf(process.platform !== 'win32')('a folder named pwsh.exe is no pwsh: the row looks for a file, as Terminal does (Windows only)', async () => {
    const dir = join(root, 'not pwsh')
    mkdirSync(join(dir, 'pwsh.exe'), { recursive: true })
    const env = { ...WINDOWS_ENV, PATH: dir }
    const report = await runChecks(deps(WIN11, ALL, undefined, { env, probes: { run: probes(ALL, []).run } }))
    expect(checkOf(report, 'powershell')).toMatchObject({ status: 'warn', detail: 'Terminal uses Windows PowerShell' })
  })
})

/** Whether `path` is a link that cannot be opened as a file but names one that exists (an app execution alias). */
function isAlias(path: string): boolean {
  try {
    return existsSync(readlinkSync(path))
  } catch {
    return false
  }
}

describe('a tool that does not answer', () => {
  let hanging: { dir: string; pidFile: string } | null = null
  // A test that fails before the kill leaves hang.js running: it is stopped here by the pid in its pid file,
  // only when that pid's command line is hang.js of this test's folder (Windows reuses pids).
  afterEach(async () => {
    if (hanging === null) return
    const { dir, pidFile } = hanging
    hanging = null
    await until(() => existsSync(pidFile), 3000)
    if (!existsSync(pidFile)) return
    const pid = Number(readFileSync(pidFile, 'utf8'))
    if (Number.isInteger(pid) && pid > 0 && alive(pid) && commandLineOf(pid).toLowerCase().includes(join(dir, 'hang.js').toLowerCase())) process.kill(pid, 'SIGKILL')
    rmSync(pidFile, { force: true })
  })

  it('the check answers at the time limit without waiting for the pipes, and the tool is ended with its tree', async () => {
    const dir = join(root, 'hanging tool')
    mkdirSync(dir)
    const pidFile = join(dir, 'pid')
    hanging = { dir, pidFile }
    // A node that keeps its pipes open, started the way claude.cmd starts node on Windows (cmd.exe → node.exe).
    writeFileSync(join(dir, 'hang.js'), `require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => {}, 1000)\n`)
    writeFileSync(join(dir, 'hang.cmd'), '@node "%~dp0hang.js"\r\n')
    writeFileSync(join(dir, 'hang'), `#!/bin/sh\nexec node "$(dirname "$0")/hang.js"\n`, { mode: 0o755 })
    // The PATH of this process (Path on Windows) with the tool's folder first, under one key.
    const env: Record<string, string | undefined> = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toUpperCase() !== 'PATH'))
    env.PATH = `${dir}${delimiter}${process.env.PATH ?? process.env.Path ?? ''}`
    env.PATHEXT = '.CMD;.EXE'
    const killed: { child: ChildProcess; platform: NodeJS.Platform }[] = []
    const started = Date.now()
    // The kill is held back: the answer must come while the tool still runs.
    const run = await runTool('hang', ['--version'], env, 1500, {
      kill: (child, platform) => {
        killed.push({ child, platform })
      },
    })
    try {
      expect(run).toEqual({ code: null, stdout: '', stderr: 'hang did not answer within 2 s', missing: false })
      expect(Date.now() - started).toBeLessThan(5000)
      expect(killed).toHaveLength(1)
      await until(() => existsSync(pidFile))
      const pid = Number(readFileSync(pidFile, 'utf8'))
      expect(alive(pid)).toBe(true)
    } finally {
      // The real kill, which must end node.exe under cmd.exe too.
      for (const { child, platform } of killed) killTool(child, platform, env)
    }
    const pid = Number(readFileSync(pidFile, 'utf8'))
    await until(() => !alive(pid))
    expect(alive(pid)).toBe(false)
  })
})

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** The command line of a running process, '' when it cannot be read. */
function commandLineOf(pid: number): string {
  try {
    if (process.platform !== 'win32') return execFileSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8' })
    const powershell = join(process.env.SystemRoot ?? 'C:/Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    return execFileSync(powershell, ['-NoProfile', '-NonInteractive', '-Command', `(Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}').CommandLine`], { encoding: 'utf8', windowsHide: true })
  } catch {
    return ''
  }
}

async function until(condition: () => boolean, ms = 10_000): Promise<void> {
  const started = Date.now()
  while (!condition() && Date.now() - started < ms) await new Promise((resolve) => setTimeout(resolve, 50))
}

describe('first-run checks on macOS: as before this ticket', () => {
  it('the Mac list, no Windows row, and brew install for each missing tool', async () => {
    const report = await runChecks(deps(MAC, {}, []))
    expect(report.checks.map((check) => check.id)).toEqual([
      'claude-login',
      'claude-version',
      'git',
      'git-identity',
      'gh',
      'node',
      'jq',
      'gh-auth',
      'harness',
      'harness-dependencies',
      'harness-scripts',
      'legacy-harness',
      'qmd',
      'qmd-models',
      'qmd-collections',
    ])
    for (const name of ['git', 'gh', 'jq'] as const) {
      expect(checkOf(report, name)).toMatchObject({
        status: 'fail',
        detail: 'not found on the PATH of the login shell',
        hint: 'worfy does not install it: run the command in a terminal',
        command: `brew install ${name}`,
      })
    }
    expect(checkOf(report, 'node').hint).toBe('The Harness scripts need node 22 or newer')
    expect(checkOf(report, 'node')).toMatchObject({ status: 'fail', detail: 'not found on the PATH of the login shell', command: 'brew install node' })
    expect(checkOf(report, 'gh-auth').hint).toBe('Install gh first (brew install gh), then sign in')
    expect(checkOf(report, 'claude-version').detail).toBe('not found on the PATH of the login shell')
    expect(JSON.stringify(report)).not.toContain('winget')
    expect(report.checks.map((check) => check.group)).not.toContain('Windows')
  })

  it('node v20 and an old claude read as before', async () => {
    const report = await runChecks(deps(MAC, { ...ALL, node: 'v20.18.0', claude: '2.1.100 (Claude Code)' }))
    expect(checkOf(report, 'node')).toMatchObject({ status: 'fail', command: 'brew install node' })
    expect(checkOf(report, 'claude-version')).toMatchObject({ status: 'warn', detail: `2.1.100, older than ${BUNDLED} in worfy`, command: 'claude update' })
    expect(checkOf(report, 'jq').status).toBe('ok')
  })

  it('a tool whose --version fails: Failed with "Reinstall it", jq too', async () => {
    const base = probes(ALL, [])
    const run: Probes['run'] = (name, args, env, ms) =>
      name === 'git' || name === 'jq' ? Promise.resolve({ code: 1, stdout: '', stderr: 'broken\n', missing: false }) : base.run(name, args, env, ms)
    const report = await runChecks(deps(MAC, ALL, [], { probes: { ...base, run } }))
    for (const name of ['git', 'jq'] as const) {
      expect(checkOf(report, name)).toMatchObject({ status: 'fail', detail: `${name} --version failed: broken`, hint: 'Reinstall it', command: `brew install ${name}` })
    }
  })
})

describe('claude on Windows: claude.exe or npm\'s claude.cmd', () => {
  const npm = 'C:\\Users\\alice\\AppData\\Roaming\\npm'
  const local = 'C:\\Users\\alice\\.local\\bin'
  const env = { PATH: `${local};${npm}`, SystemRoot: 'D:\\Windows' }

  it('finds claude.exe first, else claude.cmd', () => {
    expect(windowsProgram('claude', env, (path) => path === `${local}\\claude.exe` || path === `${npm}\\claude.cmd`)).toEqual({ file: `${local}\\claude.exe`, cmd: false })
    expect(windowsProgram('claude', env, (path) => path === `${npm}\\claude.cmd`)).toEqual({ file: `${npm}\\claude.cmd`, cmd: true })
    expect(windowsProgram('claude', env, () => false)).toBeNull()
  })

  it('goes folder by folder, as the command line does: claude.cmd in an earlier folder wins over claude.exe in a later one', () => {
    const cmdFirst = { PATH: `${npm};${local}` }
    expect(windowsProgram('claude', cmdFirst, (path) => path === `${local}\\claude.exe` || path === `${npm}\\claude.cmd`)).toEqual({ file: `${npm}\\claude.cmd`, cmd: true })
    // In one folder PATHEXT decides: .EXE before .CMD by default, .CMD first when PATHEXT says so.
    const both = (path: string): boolean => path === `${npm}\\claude.exe` || path === `${npm}\\claude.cmd`
    expect(windowsProgram('claude', { PATH: npm }, both)).toEqual({ file: `${npm}\\claude.exe`, cmd: false })
    expect(windowsProgram('claude', { PATH: npm, PATHEXT: '.CMD;.EXE' }, both)).toEqual({ file: `${npm}\\claude.cmd`, cmd: true })
  })

  it('starts claude.exe itself and claude.cmd through cmd.exe of %SystemRoot%, so Node does not refuse it with EINVAL', () => {
    expect(toolStart('claude', ['--version'], env, 'win32', (path) => path === `${local}\\claude.exe`)).toEqual({ file: `${local}\\claude.exe`, args: ['--version'], shell: false })
    expect(toolStart('claude', ['--version'], env, 'win32', (path) => path === `${npm}\\claude.cmd`)).toEqual({ file: `"${npm}\\claude.cmd" --version`, args: [], shell: 'D:\\Windows\\System32\\cmd.exe' })
    expect(toolStart('claude', ['--version'], env, 'darwin')).toEqual({ file: 'claude', args: ['--version'], shell: false })
  })

  it.skipIf(process.platform !== 'win32')('a real claude.cmd answers the check (Windows only)', async () => {
    const npmDir = join(root, 'npm global')
    mkdirSync(npmDir)
    writeFileSync(join(npmDir, 'claude.cmd'), `@echo off\r\necho ${BUNDLED} (Claude Code)\r\n`)
    const env = { PATH: npmDir, SystemRoot: process.env.SystemRoot ?? 'C:\\Windows' }
    const report = await runChecks(deps(WIN11, ALL, [], { env, probes: { exists: () => false } }))
    expect(checkOf(report, 'claude-version')).toMatchObject({ status: 'ok', detail: BUNDLED })
  })
})

describe('the status line command of the Limits bridge', () => {
  const resources = 'C:\\Program Files\\worfy\\resources'
  const winBridge = `${resources}\\statusline-bridge.mjs`

  it("win32: node '<resources>/statusline-bridge.mjs' with forward slashes, the previous command as its argument", () => {
    expect(bridgeFile('win32', resources)).toBe(winBridge)
    expect(withBridge('win32', winBridge, 'bash ~/.claude/statusline.sh')).toBe(`node 'C:/Program Files/worfy/resources/statusline-bridge.mjs' 'bash ~/.claude/statusline.sh'`)
    expect(withBridge('win32', winBridge, "echo 'it''s'")).toBe(`node 'C:/Program Files/worfy/resources/statusline-bridge.mjs' 'echo '\\''it'\\'''\\''s'\\'''`)
    expect(withBridge('win32', winBridge, null)).toBe("node 'C:/Program Files/worfy/resources/statusline-bridge.mjs'")
    // The bridge of another build, in the double quotes earlier builds wrote: replaced, its argument kept as written.
    expect(withBridge('win32', winBridge, `node "D:/old/resources/statusline-bridge.mjs" 'bash x.sh'`)).toBe(`node 'C:/Program Files/worfy/resources/statusline-bridge.mjs' 'bash x.sh'`)
    expect(bridgeCommand('win32', winBridge, " 'a'")).toBe(`node 'C:/Program Files/worfy/resources/statusline-bridge.mjs' 'a'`)
  })

  it('win32: a $, $(…) or backtick in the install folder stays text in single quotes, where Git Bash expands nothing', () => {
    const odd = 'C:\\Users\\a$HOME\\x $(touch pwned)`id`\\resources\\statusline-bridge.mjs'
    const command = bridgeCommand('win32', odd, " 'a'")
    expect(command).toBe("node 'C:/Users/a$HOME/x $(touch pwned)`id`/resources/statusline-bridge.mjs' 'a'")
    // The row reads the path back as written, so it compares the real folder.
    expect(bridgeOf(command)).toEqual({ bridge: 'C:/Users/a$HOME/x $(touch pwned)`id`/resources/statusline-bridge.mjs', rest: " 'a'" })
  })

  it('darwin: the sh entry, as the move form wrote it before this ticket', () => {
    const macBridge = '/Applications/worfy.app/Contents/Resources/statusline-bridge.sh'
    expect(bridgeFile('darwin', '/Applications/worfy.app/Contents/Resources')).toBe(macBridge)
    expect(withBridge('darwin', macBridge, `/Volumes/old/worfy.app/Contents/Resources/statusline-bridge.sh 'bash ~/.claude/statusline.sh'`)).toBe(`${macBridge} 'bash ~/.claude/statusline.sh'`)
    expect(bridgeCommand('darwin', '/Users/a b/statusline-bridge.sh', " 'x'")).toBe(`'/Users/a b/statusline-bridge.sh' 'x'`)
  })

  it('reads both forms as a bridge, and nothing else', () => {
    expect(bridgeOf(`node "C:/x/statusline-bridge.mjs" 'a'`)).toEqual({ bridge: 'C:/x/statusline-bridge.mjs', rest: " 'a'" })
    expect(bridgeOf(`/R/statusline-bridge.sh 'a'`)).toEqual({ bridge: '/R/statusline-bridge.sh', rest: " 'a'" })
    expect(bridgeOf('bash ~/.claude/statusline.sh')).toBeNull()
    expect(bridgeOf('node other.mjs')).toBeNull()
  })

  // A ' in the install folder (C:\Users\O'Brien, /Users/o'brien): shellWord writes it as '…'\''…', one shell word.
  const winOdd = "C:\\Users\\O'Brien\\worfy\\resources\\statusline-bridge.mjs"
  const macOdd = "/Users/o'brien/Applications/worfy.app/Contents/Resources/statusline-bridge.sh"

  it("a ' in the bridge path, Windows and macOS: the command reads back to the same bridge, and a second set-up does not wrap it again", () => {
    const win = withBridge('win32', winOdd, 'bash ~/.claude/statusline.sh')
    expect(win).toBe(`node 'C:/Users/O'\\''Brien/worfy/resources/statusline-bridge.mjs' 'bash ~/.claude/statusline.sh'`)
    expect(bridgeOf(win)).toEqual({ bridge: "C:/Users/O'Brien/worfy/resources/statusline-bridge.mjs", rest: " 'bash ~/.claude/statusline.sh'" })
    expect(withBridge('win32', winOdd, win)).toBe(win)
    const mac = withBridge('darwin', macOdd, 'bash ~/.claude/statusline.sh')
    expect(mac).toBe(`'/Users/o'\\''brien/Applications/worfy.app/Contents/Resources/statusline-bridge.sh' 'bash ~/.claude/statusline.sh'`)
    expect(bridgeOf(mac)).toEqual({ bridge: macOdd, rest: " 'bash ~/.claude/statusline.sh'" })
    expect(withBridge('darwin', macOdd, mac)).toBe(mac)
  })

  it('round trip: the previous command, with quotes of any kind, comes back unchanged from the command built around it', () => {
    const previous = ["echo 'it''s'", 'printf "%s\\n" "$HOME"', "a\\ b 'c' \"d\"", `O'Brien's "x" \`id\` $(date)`, 'bash ~/.claude/statusline.sh']
    for (const [platform, bridge, read] of [
      ['win32', winOdd, "C:/Users/O'Brien/worfy/resources/statusline-bridge.mjs"],
      ['darwin', macOdd, macOdd],
    ] as const) {
      for (const command of previous) {
        const built = withBridge(platform, bridge, command)
        const found = bridgeOf(built)
        expect(found?.bridge).toBe(read)
        expect(splitCommand(found?.rest ?? '')).toEqual({ head: command, rest: '' })
        expect(withBridge(platform, bridge, built)).toBe(built)
      }
    }
  })

  it('splitCommand reads one POSIX shell word: quoted parts joined, escapes in double quotes and outside quotes; a Windows path stays as written', () => {
    expect(splitCommand(`'a'\\''b'"c d"e f`)).toEqual({ head: "a'bc de", rest: ' f' })
    expect(splitCommand(`"a\\"b\\\\c\\$d\\x" rest`)).toEqual({ head: 'a"b\\c$d\\x', rest: ' rest' })
    expect(splitCommand(`a\\ b\\'c rest`)).toEqual({ head: "a b'c", rest: ' rest' })
    expect(splitCommand(`  C:\\Users\\me\\statusline.sh --x`)).toEqual({ head: 'C:\\Users\\me\\statusline.sh', rest: ' --x' })
    expect(splitCommand(`"C:\\Program Files\\x.exe" y`)).toEqual({ head: 'C:\\Program Files\\x.exe', rest: ' y' })
    expect(splitCommand(`'unclosed rest`)).toEqual({ head: "'unclosed", rest: ' rest' })
    expect(splitCommand('')).toEqual({ head: '', rest: '' })
  })
})

describe('the status line row of the move form', () => {
  const home = '/Users/alice'
  it('macOS as before: only the sh entry, none for a relative bridge in a development build, none for the Windows form', () => {
    const darwin = (command: string, bridgeScript: string | null) => otherBuildBridge(command, { platform: 'darwin', bridgeScript, userHome: home })
    expect(darwin("statusline-bridge.sh 'bash x.sh'", null)).toBeNull()
    expect(darwin(`node "/Volumes/old/statusline-bridge.mjs" 'bash x.sh'`, '/R/statusline-bridge.sh')).toBeNull()
    expect(darwin(`node "/Volumes/old/statusline-bridge.mjs" 'bash x.sh'`, null)).toBeNull()
    expect(darwin("/Volumes/old/statusline-bridge.sh 'bash x.sh'", '/R/statusline-bridge.sh')).toEqual({ bridge: '/Volumes/old/statusline-bridge.sh', rest: " 'bash x.sh'" })
    // An absolute bridge of another build in a development build: the row is there (with its note), as on main.
    expect(darwin("/Volumes/old/statusline-bridge.sh 'bash x.sh'", null)).not.toBeNull()
    // This build's own bridge: no row (resolve() gives the bridge the same form on any host).
    const own = resolve('/R/statusline-bridge.sh')
    expect(darwin("/R/statusline-bridge.sh 'bash x.sh'", own)).toBeNull()
  })

  it('Windows: either form, this build\'s bridge compared without case and separators', () => {
    const win = (command: string) => otherBuildBridge(command, { platform: 'win32', bridgeScript: 'C:\\Program Files\\worfy\\resources\\statusline-bridge.mjs', userHome: home })
    expect(win(`node "C:/program files/worfy/resources/statusline-bridge.mjs" 'x'`)).toBeNull()
    expect(win(`node "D:/old/resources/statusline-bridge.mjs" 'x'`)).toEqual({ bridge: 'D:/old/resources/statusline-bridge.mjs', rest: " 'x'" })
  })
})

describe('Limits from terminal (Windows)', () => {
  let bridge: string
  let settingsFile: string
  beforeEach(() => {
    // A space in the folder: the bridge path is quoted on every host.
    const resources = join(root, 'worfy resources')
    mkdirSync(resources)
    bridge = join(resources, 'statusline-bridge.mjs')
    writeFileSync(bridge, '// bridge\n')
    settingsFile = join(claudeHome, 'settings.json')
  })
  const settings = (statusLine?: unknown): void => writeFileSync(settingsFile, `${JSON.stringify({ theme: 'dark', ...(statusLine === undefined ? {} : { statusLine }), model: 'opus' }, null, 2)}\n`)

  it('no statusLine: a Warning with "Set up…"; a statusLine that runs this bridge: OK; not on macOS', async () => {
    settings()
    const warn = checkOf(await runChecks(deps(WIN11, ALL, undefined, { limitsBridge: bridge })), 'limits')
    expect(warn).toMatchObject({ status: 'warn', detail: 'no statusLine in settings.json', actions: [{ id: 'limits-bridge', label: 'Set up…' }] })
    settings({ type: 'command', command: `node '${bridge.replace(/\\/g, '/')}' 'bash x.sh'` })
    expect(checkOf(await runChecks(deps(WIN11, ALL, undefined, { limitsBridge: bridge })), 'limits').status).toBe('ok')
    // The double quotes of earlier builds read the same.
    settings({ type: 'command', command: `node "${bridge.replace(/\\/g, '/')}" 'bash x.sh'` })
    expect(checkOf(await runChecks(deps(WIN11, ALL, undefined, { limitsBridge: bridge })), 'limits').status).toBe('ok')
    expect((await runChecks(deps(MAC, ALL, [], { limitsBridge: bridge }))).checks.map((check) => check.id)).not.toContain('limits')
  })

  it('a development build: a Warning without an action', async () => {
    settings({ type: 'command', command: 'bash x.sh' })
    expect(checkOf(await runChecks(deps(WIN11)), 'limits')).toMatchObject({ status: 'warn', detail: 'statusLine does not run the worfy bridge', actions: [] })
  })

  it("a ' in this build's folder: Confirm once, the row is OK, and a second set-up finds it done instead of wrapping the bridge again", async () => {
    const odd = join(root, "O'Brien", 'resources')
    mkdirSync(odd, { recursive: true })
    bridge = join(odd, 'statusline-bridge.mjs')
    writeFileSync(bridge, '// bridge\n')
    settings({ type: 'command', command: 'bash ~/.claude/statusline.sh' })
    const first = await actions(() => Promise.resolve(true)).run('limits-bridge')
    expect(first.outcome).toBe('done')
    expect(checkOf(first.report, 'limits').status).toBe('ok')
    const written = readFileSync(settingsFile, 'utf8')
    const second = await actions(() => Promise.resolve(true)).run('limits-bridge')
    expect(second).toMatchObject({ outcome: 'done', message: 'The status line already runs the bridge of this build' })
    expect(readFileSync(settingsFile, 'utf8')).toBe(written)
    expect(bridgeOf(statusLineCommandOf(written) ?? '')?.rest).toBe(" 'bash ~/.claude/statusline.sh'")
  })

  it('the bridge of another build is not OK: a Warning with "Set up…", whose command points at this build', async () => {
    settings({ type: 'command', command: `node 'D:/old worfy/resources/statusline-bridge.mjs' 'bash x.sh'` })
    const row = checkOf(await runChecks(deps(WIN11, ALL, undefined, { limitsBridge: bridge })), 'limits')
    expect(row).toMatchObject({ status: 'warn', detail: 'statusLine runs the bridge of another build', actions: [{ id: 'limits-bridge', label: 'Set up…' }] })
    const state = limitsBridgeState({ platform: 'win32', settingsFile, bridge, exists: existsSync })
    expect(state).toMatchObject({ kind: 'offer', command: `node '${bridge.replace(/\\/g, '/')}' 'bash x.sh'` })
  })

  it('this build without its bridge file: a Warning without "Set up…", nothing offered that points at a missing file', async () => {
    settings({ type: 'command', command: 'bash x.sh' })
    rmSync(bridge)
    const row = checkOf(await runChecks(deps(WIN11, ALL, undefined, { limitsBridge: bridge })), 'limits')
    expect(row).toMatchObject({ status: 'warn', detail: 'statusLine does not run the worfy bridge', hint: `This build has no ${bridge}`, actions: [] })
    expect(limitsBridgeState({ platform: 'win32', settingsFile, bridge, exists: existsSync }).kind).toBe('unavailable')
  })

  function actions(confirm: (confirmation: Confirmation) => Promise<boolean>): FirstRunActions {
    return new FirstRunActions({
      checks: () => runChecks(deps(WIN11, ALL, undefined, { limitsBridge: bridge })),
      confirm,
      env: () => Promise.resolve({}),
      homes: { harnessHome: join(claudeHome, 'worfy-harness'), claudeHome },
      installHarness: () => Promise.reject(new Error('not in this test')),
      projects: () => Promise.resolve([]),
      binDir: join(root, 'bin'),
      limits: { settingsFile, bridge, platform: 'win32' },
    })
  }

  it('"Cancel" leaves settings.json byte for byte; "Confirm" changes only statusLine.command, and the row is OK', async () => {
    settings({ type: 'command', command: 'bash ~/.claude/statusline.sh', padding: 0 })
    const before = readFileSync(settingsFile, 'utf8')
    const asked: Confirmation[] = []
    const declined = await actions((confirmation) => {
      asked.push(confirmation)
      return Promise.resolve(false)
    }).run('limits-bridge')
    expect(declined.outcome).toBe('declined')
    expect(readFileSync(settingsFile, 'utf8')).toBe(before)
    const command = `node '${bridge.replace(/\\/g, '/')}' 'bash ~/.claude/statusline.sh'`
    expect(asked[0]?.detail).toContain(settingsFile)
    expect(asked[0]?.detail).toContain('now: bash ~/.claude/statusline.sh')
    expect(asked[0]?.detail).toContain(`new: ${command}`)

    const done = await actions(() => Promise.resolve(true)).run('limits-bridge')
    expect(done.outcome).toBe('done')
    const written = JSON.parse(readFileSync(settingsFile, 'utf8')) as Record<string, unknown>
    expect(written).toEqual({ theme: 'dark', statusLine: { type: 'command', command, padding: 0 }, model: 'opus' })
    expect(checkOf(done.report, 'limits').status).toBe('ok')
    expect(limitsBridgeState({ platform: 'win32', settingsFile, bridge, exists: existsSync }).kind).toBe('bridged')
  })

  it('settings.json changed while the dialog was open: refused, the new text left byte for byte', async () => {
    settings({ type: 'command', command: 'bash ~/.claude/statusline.sh' })
    let edited = ''
    const result = await actions(() => {
      // The user (or Claude Code) edits the file before Confirm.
      settings({ type: 'command', command: 'bash ~/.claude/other.sh' })
      edited = readFileSync(settingsFile, 'utf8')
      return Promise.resolve(true)
    }).run('limits-bridge')
    expect(result.outcome).toBe('failed')
    expect(result.message).toContain('settings.json changed since the dialog')
    expect(readFileSync(settingsFile, 'utf8')).toBe(edited)
  })

  it('with nothing to offer (no bridge file, a development build, unreadable JSON) the action asks nothing and writes nothing', async () => {
    settings({ type: 'command', command: 'bash ~/.claude/statusline.sh', padding: 0 })
    const before = readFileSync(settingsFile, 'utf8')
    const asked: Confirmation[] = []
    const confirm = (confirmation: Confirmation): Promise<boolean> => {
      asked.push(confirmation)
      return Promise.resolve(true)
    }
    const run = (limits: { settingsFile: string; bridge: string | null; platform: NodeJS.Platform }) =>
      new FirstRunActions({
        checks: () => runChecks(deps(WIN11, ALL, undefined, { limitsBridge: limits.bridge })),
        confirm,
        env: () => Promise.resolve({}),
        homes: { harnessHome: join(claudeHome, 'worfy-harness'), claudeHome },
        installHarness: () => Promise.reject(new Error('not in this test')),
        projects: () => Promise.resolve([]),
        binDir: join(root, 'bin'),
        limits,
      }).run('limits-bridge')
    const development = await run({ settingsFile, bridge: null, platform: 'win32' })
    expect(development.outcome).toBe('failed')
    rmSync(bridge)
    const noBridge = await run({ settingsFile, bridge, platform: 'win32' })
    expect(noBridge).toMatchObject({ outcome: 'failed', message: `This build has no ${bridge}` })
    expect(asked).toEqual([])
    expect(readFileSync(settingsFile, 'utf8')).toBe(before)
  })

  it('no statusLine, or no settings.json at all: Confirm writes a new statusLine of type command', async () => {
    settings()
    const command = `node '${bridge.replace(/\\/g, '/')}'`
    expect((await actions(() => Promise.resolve(true)).run('limits-bridge')).outcome).toBe('done')
    expect(JSON.parse(readFileSync(settingsFile, 'utf8'))).toEqual({ theme: 'dark', model: 'opus', statusLine: { type: 'command', command } })
    rmSync(settingsFile)
    expect((await actions(() => Promise.resolve(true)).run('limits-bridge')).outcome).toBe('done')
    expect(JSON.parse(readFileSync(settingsFile, 'utf8'))).toEqual({ statusLine: { type: 'command', command } })
    // writeStatusLine itself, for a file that is not there yet in a folder that is not there yet.
    const fresh = join(root, 'new home', 'settings.json')
    writeStatusLine(fresh, null, 'x')
    expect(JSON.parse(readFileSync(fresh, 'utf8'))).toEqual({ statusLine: { type: 'command', command: 'x' } })
  })

  it('a write whose rename is refused leaves no temporary file next to the target', () => {
    // A folder where the file should be: the rename over it fails on every system (EPERM on Windows, EISDIR elsewhere).
    const target = join(root, 'settings.json')
    mkdirSync(target)
    expect(() => writeAtomically(target, '{}\n')).toThrow()
    expect(readdirSync(root).filter((name) => name.includes('.worfy-move-'))).toEqual([])
  })
})

// worfy-windows ticket 80: the gh rows run WORFY_GH when worfy has it, as the PR badges and the
// GitHub accounts do. Without it an e2e run on Windows reached the machine's own gh.exe, since there
// the checks find gh by the Path from the registry, not by the sandbox's login shell.
describe('the gh rows and WORFY_GH', () => {
  /** Every run the checks ask for: the program and its arguments. */
  function recording(): { probes: Probes; runs: string[][] } {
    const runs: string[][] = []
    const run = (name: string, args: readonly string[]): Promise<ToolRun> => {
      runs.push([name, ...args])
      if (args.includes('auth')) return Promise.resolve({ code: 0, stdout: 'github.com\n  ✓ Logged in to github.com account alice (keyring)\n', stderr: '', missing: false })
      return Promise.resolve({ code: 0, stdout: 'gh version 2.60.0 (2024-10-15)\n', stderr: '', missing: false })
    }
    return { probes: { run, exists: () => false }, runs }
  }
  const ghRuns = (runs: string[][]): string[][] => runs.filter((run) => run.includes('--version') ? run.join(' ').includes('gh') : run.includes('auth'))

  /** Every run the checks ask for, with the environment it gets. */
  function recordingEnv(): { probes: Probes; runs: { name: string; args: readonly string[]; env: Record<string, string | undefined> }[] } {
    const runs: { name: string; args: readonly string[]; env: Record<string, string | undefined> }[] = []
    const run = (name: string, args: readonly string[], env: Record<string, string | undefined>): Promise<ToolRun> => {
      runs.push({ name, args, env })
      return Promise.resolve({ code: 0, stdout: '', stderr: '', missing: false })
    }
    return { probes: { run, exists: () => false }, runs }
  }
  const OWN_ENV = { WORFY_GH: 'C:\\stand-in\\gh.exe', GH_STUB_LOG: 'C:\\log.jsonl', Path: 'C:\\worfy-own' }

  it('without it: gh from the Path, with the login shell environment, as before', async () => {
    const { probes, runs } = recording()
    await runChecks(deps(WIN11, ALL, [], { probes }))
    expect(ghRuns(runs)).toEqual([
      ['gh', '--version'],
      ['gh', 'auth', 'status'],
    ])
    const withEnv = recordingEnv()
    await runChecks(deps(WIN11, ALL, [], { probes: withEnv.probes }))
    const gh = withEnv.runs.filter((each) => each.name === 'gh')
    expect(gh).toHaveLength(2)
    for (const each of gh) expect(each.env).toEqual(WINDOWS_ENV)
  })

  it('ghOverride: WORFY_GH with worfy\'s own environment; unset or empty, none', () => {
    expect(ghOverride(OWN_ENV)).toEqual({ command: 'C:\\stand-in\\gh.exe', env: OWN_ENV })
    expect(ghOverride({ ...OWN_ENV, WORFY_GH: '' })).toBeUndefined()
    expect(ghOverride({ Path: 'C:\\worfy-own' })).toBeUndefined()
  })

  it.each([WIN11, MAC])('with a program by its path on $platform: that program with its environment, never gh from the Path', async (system) => {
    const { probes, runs } = recordingEnv()
    const stand = system.platform === 'win32' ? 'C:\\stand-in\\gh.exe' : '/stand-in/gh'
    // The login shell sets a stand-in's setting of its own, as the e2e sandbox's .profile does.
    const login = { ...deps(system).env, FAKE_GH_ACCOUNT: 'alice' }
    await runChecks(deps(system, ALL, [], { probes, env: login, gh: { command: stand, env: OWN_ENV } }))
    expect(runs.some(({ name }) => name === 'gh')).toBe(false)
    const viaStand = runs.filter(({ name }) => name === stand)
    expect(viaStand.map((each) => [each.name, ...each.args])).toEqual([
      [stand, '--version'],
      [stand, 'auth', 'status'],
    ])
    // worfy's own environment under the login shell's: what only worfy has (GH_STUB_LOG) and what
    // only the shell sets (FAKE_GH_ACCOUNT) both reach it. worfy's `Path` gives way to the shell's
    // `PATH`: Windows reads the two as one variable.
    for (const each of viaStand) expect(each.env).toEqual({ WORFY_GH: OWN_ENV.WORFY_GH, GH_STUB_LOG: OWN_ENV.GH_STUB_LOG, ...login })
  })

  it('with a .mjs stand-in: worfy\'s own Node runs it, with ELECTRON_RUN_AS_NODE', async () => {
    const { probes, runs } = recordingEnv()
    const stub = 'C:\\fixtures\\gh\\gh-stub.mjs'
    await runChecks(deps(WIN11, ALL, [], { probes, gh: { command: stub, env: OWN_ENV } }))
    const viaStub = runs.filter((each) => each.args[0] === stub)
    expect(viaStub.map((each) => [each.name, ...each.args])).toEqual([
      [process.execPath, stub, '--version'],
      [process.execPath, stub, 'auth', 'status'],
    ])
    for (const each of viaStub) expect(each.env).toEqual({ WORFY_GH: OWN_ENV.WORFY_GH, GH_STUB_LOG: OWN_ENV.GH_STUB_LOG, ...WINDOWS_ENV, ELECTRON_RUN_AS_NODE: '1' })
    expect(runs.some((each) => each.name === 'gh')).toBe(false)
  })

  it('toolStart on Windows starts a full path as that file, without looking on the Path', () => {
    const looked: string[] = []
    const exists = (path: string): boolean => {
      looked.push(path)
      return path.startsWith('C:\\stand-in\\')
    }
    expect(toolStart('C:\\stand-in\\gh.exe', ['--version'], WINDOWS_ENV, 'win32', exists)).toEqual({ file: 'C:\\stand-in\\gh.exe', args: ['--version'], shell: false })
    // Any case of the extension.
    expect(toolStart('C:\\stand-in\\GH.EXE', ['--version'], WINDOWS_ENV, 'win32', exists)).toEqual({ file: 'C:\\stand-in\\GH.EXE', args: ['--version'], shell: false })
    expect(looked).toEqual(['C:\\stand-in\\gh.exe', 'C:\\stand-in\\GH.EXE'])
    // Not there: the row says gh is missing, and the Path is not searched for another gh.
    expect(toolStart('C:\\elsewhere\\gh.exe', ['--version'], WINDOWS_ENV, 'win32', exists)).toBeNull()
    expect(looked).toEqual(['C:\\stand-in\\gh.exe', 'C:\\stand-in\\GH.EXE', 'C:\\elsewhere\\gh.exe'])
    // A bare name is still looked for folder by folder.
    expect(toolStart('gh', ['--version'], WINDOWS_ENV, 'win32', exists)).toBeNull()
    expect(looked.length).toBeGreaterThan(3)
  })

  it('toolStart on Windows adds .exe to a full path without an extension, as the sign-in command does', () => {
    const exists = (path: string): boolean => path === 'C:\\stand-in\\gh.exe'
    expect(toolStart('C:\\stand-in\\gh', ['--version'], WINDOWS_ENV, 'win32', exists)).toEqual({ file: 'C:\\stand-in\\gh.exe', args: ['--version'], shell: false })
    expect(toolStart('C:\\elsewhere\\gh', ['--version'], WINDOWS_ENV, 'win32', exists)).toBeNull()
    // Forward slashes come out as backslashes, as a lookup on the Path gives them.
    expect(toolStart('C:/stand-in/gh', ['--version'], WINDOWS_ENV, 'win32', exists)).toEqual({ file: 'C:\\stand-in\\gh.exe', args: ['--version'], shell: false })
  })

  it('toolStart on Windows: a full-path .cmd through cmd.exe; a path that is not a full one is refused', () => {
    const exists = (): boolean => true
    expect(toolStart('C:\\stand-in\\gh.cmd', ['--version'], WINDOWS_ENV, 'win32', exists)).toEqual({ file: '"C:\\stand-in\\gh.cmd" --version', args: [], shell: 'C:\\Windows\\System32\\cmd.exe' })
    // No drive letter or share: refused rather than looked for in every folder of the Path.
    expect(toolStart('\\opt\\gh.exe', ['--version'], WINDOWS_ENV, 'win32', exists)).toBeNull()
    expect(toolStart('tools\\gh.exe', ['--version'], WINDOWS_ENV, 'win32', exists)).toBeNull()
  })
})
