// The first-run checks on Windows (worfy-windows ticket 13; owner's answers Q18, Q20, Q24): the system,
// os.release(), the architecture and the answers of the tools are handed to runChecks, so these
// cases run on any machine, Linux CI included. The same checks with `darwin` keep the Mac list and
// its `brew install` commands. Then the status line command of the Limits bridge for both systems,
// the "Limits from terminal" row and its action. No real tool runs, except one .cmd on Windows.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FirstRunActions, type Confirmation } from '../../src/main/first-run/actions'
import { runChecks, toolStart, windowsProgram, type CheckDeps, type Probes, type ToolRun } from '../../src/main/first-run/checks'
import { bridgeCommand, bridgeFile, bridgeOf, limitsBridgeState, withBridge } from '../../src/main/harness/status-line'
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
})

describe('first-run checks on macOS: as before this ticket', () => {
  it('the Mac list, no Windows row, and brew install for each missing tool', async () => {
    const report = await runChecks(deps(MAC, {}, []))
    expect(report.checks.map((check) => check.id)).toEqual([
      'claude-login',
      'claude-version',
      'git',
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
      expect(checkOf(report, name)).toMatchObject({ status: 'fail', detail: 'not found on the PATH of the login shell', command: `brew install ${name}` })
    }
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

  it('win32: node "<resources>/statusline-bridge.mjs" with forward slashes, the previous command as its argument', () => {
    expect(bridgeFile('win32', resources)).toBe(winBridge)
    expect(withBridge('win32', winBridge, 'bash ~/.claude/statusline.sh')).toBe(`node "C:/Program Files/worfy/resources/statusline-bridge.mjs" 'bash ~/.claude/statusline.sh'`)
    expect(withBridge('win32', winBridge, "echo 'it''s'")).toBe(`node "C:/Program Files/worfy/resources/statusline-bridge.mjs" 'echo '\\''it'\\'''\\''s'\\'''`)
    expect(withBridge('win32', winBridge, null)).toBe('node "C:/Program Files/worfy/resources/statusline-bridge.mjs"')
    // The bridge of another build: replaced, its argument kept as written.
    expect(withBridge('win32', winBridge, `node "D:/old/resources/statusline-bridge.mjs" 'bash x.sh'`)).toBe(`node "C:/Program Files/worfy/resources/statusline-bridge.mjs" 'bash x.sh'`)
    expect(bridgeCommand('win32', winBridge, " 'a'")).toBe(`node "C:/Program Files/worfy/resources/statusline-bridge.mjs" 'a'`)
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
})

describe('Limits from terminal (Windows)', () => {
  let bridge: string
  let settingsFile: string
  beforeEach(() => {
    const resources = join(root, 'resources')
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
    settings({ type: 'command', command: `node "${bridge.replace(/\\/g, '/')}" 'bash x.sh'` })
    expect(checkOf(await runChecks(deps(WIN11, ALL, undefined, { limitsBridge: bridge })), 'limits').status).toBe('ok')
    expect((await runChecks(deps(MAC, ALL, [], { limitsBridge: bridge }))).checks.map((check) => check.id)).not.toContain('limits')
  })

  it('a development build: a Warning without an action', async () => {
    settings({ type: 'command', command: 'bash x.sh' })
    expect(checkOf(await runChecks(deps(WIN11)), 'limits')).toMatchObject({ status: 'warn', detail: 'statusLine does not run the worfy bridge', actions: [] })
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
    const command = `node "${bridge.replace(/\\/g, '/')}" 'bash ~/.claude/statusline.sh'`
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
})
