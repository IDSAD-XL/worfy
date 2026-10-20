// The first-run screen's checks and actions (src/main/first-run/, worfy-harness ticket 19). The tools
// are the stand-ins of test/fixtures/first-run-tools/, linked into a temporary folder that is the only
// one on the PATH of the "login shell" environment handed to the checks: a tool left out is not
// installed. HOME, the Claude home, the Harness home and the Project folder are temporary too, and
// the tools log their calls outside them, so a test can tell that the checks wrote nothing.
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FirstRunActions, type Confirmation } from '../../src/main/first-run/actions'
import { askAccount, HARNESS_SCRIPT_HINTS, oldHarnessPresent, runChecks, runTool, type AccountQuery, type CheckDeps, type ProjectProfile } from '../../src/main/first-run/checks'
import { HarnessInstaller } from '../../src/main/harness/install'
import { MODELS_ANSWER_FILE } from '../../src/main/harness/qmd'
import type { Check, CheckId, CheckStatus, FirstRunReport } from '../../src/shared/ipc/first-run'
import { NODE, nodeScript, OUT_OF_MEMORY, scriptsEnv } from '../harness-node'
import { removeTestTree } from '../remove'

// The real runner of the Harness scripts, with the time limit each call asked for recorded: the
// limit of the Harness scripts row is otherwise seen only after a 15 s wait.
const runnerLimits = vi.hoisted(() => [] as (number | undefined)[])
vi.mock('../../src/main/workflow/profile', async (original) => {
  const real = await original<typeof import('../../src/main/workflow/profile')>()
  return {
    ...real,
    harnessScriptRunner: (...args: Parameters<typeof real.harnessScriptRunner>) => {
      runnerLimits.push(args[3])
      return real.harnessScriptRunner(...args)
    },
  }
})

const REPO = join(import.meta.dirname, '..', '..')
const TOOLS = join(REPO, 'test', 'fixtures', 'first-run-tools')
const WINDOWS = process.platform === 'win32'
/**
 * The Claude Code stand-in the installer runs by its path. On Windows the Node port: the installer
 * starts a `.mjs` under worfy's own Node (src/main/program.ts), and Windows cannot start the `#!/bin/sh` one.
 */
const CLAUDE = join(TOOLS, WINDOWS ? 'claude.mjs' : 'claude')
/**
 * The cases that need qmd's rows and actions to find node, npm and qmd: not on Windows yet. qmd.ts
 * starts `npm` and `node` by their bare names without a shell and looks for a file named `qmd` on the
 * PATH, so it finds neither npm's npm.cmd and qmd.cmd nor these `.cmd` stand-ins; the
 * qmd-collections stand-in below is a `#!/bin/sh` script, which worfy does not run on Windows either.
 * worfy-windows ticket 15 (qmd on Windows) lifts this.
 */
const itWithQmd = it.skipIf(WINDOWS)
/** The Claude Code version "this build" carries, as the checks are told. */
const BUNDLED = '2.1.289'
const BUNDLED_HARNESS = '1.2.0+abc1234'
/** The dependency the Harness copy of the build declares, as harness/.claude-plugin/plugin.json does. */
const DEP = 'mattpocock-skills@claude-plugins-official'

let root: string
let bin: string
let home: string
let claudeHome: string
let harnessHome: string
let project: string
let bundle: string
let state: string
let log: string

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-first-run-')))
  bin = join(root, 'bin')
  home = join(root, 'home')
  claudeHome = join(home, '.claude')
  harnessHome = join(claudeHome, 'worfy-harness')
  project = join(root, 'alpha')
  bundle = join(root, 'bundle')
  state = join(root, 'state')
  log = join(root, 'calls.log')
  for (const dir of [bin, claudeHome, project, join(bundle, '.claude-plugin'), state]) mkdirSync(dir, { recursive: true })
  writeFileSync(join(bundle, '.claude-plugin', 'plugin.json'), `{\n  "name": "worfy",\n  "version": "${BUNDLED_HARNESS}",\n  "dependencies": ["${DEP}"]\n}\n`)
  writeFileSync(join(project, 'README.md'), 'alpha\n')
})

afterEach(() => {
  removeTestTree(root)
})

/**
 * Puts the stand-in `name` into the folder `dir`. On macOS and Linux a link to the `#!/bin/sh` one.
 * On Windows a `<name>.cmd` that runs its Node port with the tests' node: the checks find a `.cmd` on
 * the PATH and start it through cmd.exe, as they do npm's claude.cmd (checks.ts, toolStart).
 */
function putTool(name: string, dir: string): void {
  if (WINDOWS) writeFileSync(join(dir, `${name}.cmd`), `@"${NODE}" "${join(TOOLS, `${name}.mjs`)}" %*\r\n`)
  else symlinkSync(join(TOOLS, name), join(dir, name))
}

/** Puts these stand-ins on the PATH. */
function tools(...names: string[]): void {
  for (const name of names) putTool(name, bin)
}
const ALL_TOOLS = ['claude', 'gh', 'node', 'jq', 'git', 'npm']

function loginEnv(extra: Record<string, string> = {}): Record<string, string> {
  return {
    // A login shell's environment on Windows has SystemRoot: node, cmd.exe and the Electron run as
    // node of the installer need it to start.
    ...(WINDOWS && process.env.SystemRoot !== undefined ? { SystemRoot: process.env.SystemRoot } : {}),
    PATH: bin,
    HOME: home,
    FIRST_RUN_TOOLS_LOG: log,
    FIRST_RUN_TOOLS_DIR: TOOLS,
    FIRST_RUN_TOOLS_STATE: state,
    FAKE_GH_ACCOUNT: 'alice',
    FAKE_CLAUDE_VERSION: BUNDLED,
    FAKE_NPM_BIN: bin,
    FAKE_NPM_PREFIX: join(root, 'npm-prefix'),
    ...extra,
  }
}

const installer = (env: Record<string, string>): HarnessInstaller =>
  new HarnessInstaller({ bundledDir: bundle, harnessHome, claude: CLAUDE, env: { ...env, CLAUDE_CONFIG_DIR: claudeHome }, canInstall: true, claudeHome })

function deps(env: Record<string, string>, overrides: Partial<CheckDeps> = {}): CheckDeps {
  return {
    env,
    scriptEnv: () => Promise.resolve(env),
    bundledClaudeCodeVersion: BUNDLED,
    accountInfo: () => Promise.resolve({ email: 'alice@example.com', subscriptionType: 'max', tokenSource: 'claude.ai' }),
    harness: () => installer(env).status(),
    legacyHarness: () =>
      oldHarnessPresent({ claudeHome, harnessHome, claudeJson: join(claudeHome, '.claude.json'), userHome: home, bridgeScript: null, offered: true, env }),
    homes: { harnessHome, claudeHome },
    projects: () => Promise.resolve([{ name: 'alpha', profile: null, collections: [] }]),
    // The Mac list and its `brew install` commands on any machine; the Windows rows are
    // test/unit/first-run-windows.test.ts (worfy-windows ticket 13).
    system: { platform: 'darwin', release: '24.6.0', arch: 'arm64' },
    // The tools still start as on this machine: on Windows a `.cmd` stand-in is found and run the
    // way toolStart does it there, not by its bare name as on the Mac the rows describe.
    ...(WINDOWS ? { probes: { run: (name: string, args: readonly string[], env: Record<string, string | undefined>, ms: number) => runTool(name, args, env, ms) } } : {}),
    ...overrides,
  }
}

const statuses = (report: { checks: readonly { id: CheckId; status: CheckStatus }[] }): Record<string, CheckStatus> =>
  Object.fromEntries(report.checks.map((check) => [check.id, check.status]))
const checkOf = (report: FirstRunReport, id: CheckId) => {
  const found = report.checks.find((check) => check.id === id)
  if (found === undefined) throw new Error(`no check ${id}`)
  return found
}
const calls = (): string[] => {
  try {
    return readFileSync(log, 'utf8').trim().split('\n').filter(Boolean)
  } catch {
    return []
  }
}

/** The report of a run with every tool present and signed in: what each case below differs from. */
async function baseline(): Promise<Record<string, CheckStatus>> {
  const scratch = join(root, 'baseline-bin')
  mkdirSync(scratch)
  for (const name of ALL_TOOLS) putTool(name, scratch)
  const report = await runChecks(deps(loginEnv({ PATH: scratch, FIRST_RUN_TOOLS_LOG: join(root, 'baseline.log') })))
  return statuses(report)
}

describe('first-run checks', () => {
  it('lists every check of Q22 in its group', async () => {
    tools(...ALL_TOOLS)
    const report = await runChecks(deps(loginEnv()))
    expect(report.checks.map((check) => [check.group, check.id])).toEqual([
      ['Claude Code', 'claude-login'],
      ['Claude Code', 'claude-version'],
      ['Command-line tools', 'git'],
      ['Command-line tools', 'gh'],
      ['Command-line tools', 'node'],
      ['Command-line tools', 'jq'],
      ['GitHub', 'gh-auth'],
      ['Harness', 'harness'],
      ['Harness', 'harness-dependencies'],
      ['Harness', 'harness-scripts'],
      ['Harness', 'legacy-harness'],
      ['qmd', 'qmd'],
      ['qmd', 'qmd-models'],
      ['qmd', 'qmd-collections'],
    ])
    expect(statuses(report)).toMatchObject({ 'claude-login': 'ok', 'claude-version': 'ok', git: 'ok', gh: 'ok', node: 'ok', jq: 'ok', 'gh-auth': 'ok', 'legacy-harness': 'ok' })
    expect(checkOf(report, 'gh-auth').detail).toContain('alice')
  })

  it('without jq: jq fails with `brew install jq`, nothing else changes', async () => {
    const before = await baseline()
    tools('claude', 'gh', 'node', 'git', 'npm')
    const report = await runChecks(deps(loginEnv()))
    const jq = checkOf(report, 'jq')
    expect(jq.status).toBe('fail')
    expect(jq.command).toBe('brew install jq')
    expect(statuses(report)).toEqual({ ...before, jq: 'fail' })
  })

  it('with node 20: node fails with `brew install node`, nothing else changes', async () => {
    const before = await baseline()
    tools(...ALL_TOOLS)
    const report = await runChecks(deps(loginEnv({ FAKE_NODE_VERSION: '20.11.1' })))
    const node = checkOf(report, 'node')
    expect(node.status).toBe('fail')
    expect(node.detail).toContain('20.11.1')
    expect(node.command).toBe('brew install node')
    expect(statuses(report)).toEqual({ ...before, node: 'fail' })
  })

  it('with node 22 or newer: node is ok', async () => {
    tools(...ALL_TOOLS)
    for (const version of ['22.0.0', '24.3.1']) {
      const report = await runChecks(deps(loginEnv({ FAKE_NODE_VERSION: version })))
      expect(checkOf(report, 'node').status).toBe('ok')
    }
  })

  it('with `claude --version` older than the bundled one: a warning with `claude update`, nothing else changes', async () => {
    const before = await baseline()
    tools(...ALL_TOOLS)
    const report = await runChecks(deps(loginEnv({ FAKE_CLAUDE_VERSION: '2.1.100' })))
    const version = checkOf(report, 'claude-version')
    expect(version.status).toBe('warn')
    expect(version.command).toBe('claude update')
    expect(version.detail).toContain('2.1.100')
    expect(version.detail).toContain(BUNDLED)
    expect(statuses(report)).toEqual({ ...before, 'claude-version': 'warn' })
  })

  it('with the same or a newer `claude --version`: ok', async () => {
    tools(...ALL_TOOLS)
    for (const version of [BUNDLED, '2.1.290', '2.2.0', '3.0.0']) {
      const report = await runChecks(deps(loginEnv({ FAKE_CLAUDE_VERSION: version })))
      expect(checkOf(report, 'claude-version'), version).toMatchObject({ status: 'ok', command: null })
    }
  })

  it('without `claude` on the PATH: a warning, nothing else changes', async () => {
    const before = await baseline()
    tools('gh', 'node', 'jq', 'git', 'npm')
    const report = await runChecks(deps(loginEnv()))
    expect(checkOf(report, 'claude-version').status).toBe('warn')
    expect(statuses(report)).toEqual({ ...before, 'claude-version': 'warn' })
  })

  it('with gh signed in nowhere: GitHub accounts fails with the `gh auth login` action, nothing else changes', async () => {
    const before = await baseline()
    tools(...ALL_TOOLS)
    const report = await runChecks(deps(loginEnv({ FAKE_GH_ACCOUNT: '' })))
    const accounts = checkOf(report, 'gh-auth')
    expect(accounts.status).toBe('fail')
    expect(accounts.command).toBe('gh auth login')
    expect(accounts.actions.map((action) => action.id)).toEqual(['gh-login'])
    expect(statuses(report)).toEqual({ ...before, 'gh-auth': 'fail' })
  })

  it('without git or gh: each fails with its own `brew install`', async () => {
    tools('claude', 'node', 'jq', 'npm')
    const report = await runChecks(deps(loginEnv()))
    expect(checkOf(report, 'git')).toMatchObject({ status: 'fail', command: 'brew install git' })
    expect(checkOf(report, 'gh')).toMatchObject({ status: 'fail', command: 'brew install gh' })
  })

  it('without a Claude login: sign-in fails and says to run claude, then /login', async () => {
    tools(...ALL_TOOLS)
    const report = await runChecks(deps(loginEnv(), { accountInfo: () => Promise.resolve({ apiProvider: 'firstParty', tokenSource: 'none' }) }))
    const login = checkOf(report, 'claude-login')
    expect(login.status).toBe('fail')
    expect(login.hint).toContain('/login')
    expect(login.command).toBe('claude')
  })

  it('when Claude Code does not answer: sign-in fails with the error', async () => {
    tools(...ALL_TOOLS)
    const report = await runChecks(deps(loginEnv(), { accountInfo: () => Promise.reject(new Error('Claude Code exited with code 1')) }))
    expect(checkOf(report, 'claude-login')).toMatchObject({ status: 'fail' })
    expect(checkOf(report, 'claude-login').hint).toContain('Claude Code exited with code 1')
  })

  it('the Harness: not installed fails with Install, an older version warns with Update, this build is ok', async () => {
    tools(...ALL_TOOLS)
    const env = loginEnv()
    let report = await runChecks(deps(env))
    expect(checkOf(report, 'harness')).toMatchObject({ status: 'fail', actions: [{ id: 'harness-install', label: 'Install' }] })

    mkdirSync(join(harnessHome, 'plugin', '.claude-plugin'), { recursive: true })
    writeFileSync(join(harnessHome, 'plugin', '.claude-plugin', 'plugin.json'), '{ "name": "worfy", "version": "1.0.0+0000000" }\n')
    writeFileSync(join(state, 'marketplace'), `${join(harnessHome, 'plugin')}\n`)
    writeFileSync(join(state, 'plugin-version'), '1.0.0+0000000\n')
    report = await runChecks(deps(env))
    expect(checkOf(report, 'harness')).toMatchObject({ status: 'warn', actions: [{ id: 'harness-install', label: 'Update' }] })
    expect(checkOf(report, 'harness').detail).toContain(BUNDLED_HARNESS)

    writeFileSync(join(harnessHome, 'plugin', '.claude-plugin', 'plugin.json'), `{ "name": "worfy", "version": "${BUNDLED_HARNESS}" }\n`)
    writeFileSync(join(state, 'plugin-version'), `${BUNDLED_HARNESS}\n`)
    writeFileSync(join(state, 'plugins'), `${DEP}\n`)
    report = await runChecks(deps(env))
    expect(checkOf(report, 'harness')).toMatchObject({ status: 'ok', actions: [] })
  })

  it('the plugin dependencies: not checked without the Harness plugin, failed with Install… when worfy is installed without one, ok with its version when it is there', async () => {
    tools(...ALL_TOOLS)
    const env = loginEnv()
    let report = await runChecks(deps(env))
    // No plugin folder: `claude plugin list` did not run, so nothing is known — a warning without a button.
    expect(checkOf(report, 'harness-dependencies')).toMatchObject({ title: 'Plugin dependencies', status: 'warn', detail: 'checked when the Harness plugin is installed', command: null, actions: [] })
    expect(calls().filter((line) => line.startsWith('claude plugin'))).toEqual([])

    mkdirSync(join(harnessHome, 'plugin', '.claude-plugin'), { recursive: true })
    writeFileSync(join(harnessHome, 'plugin', '.claude-plugin', 'plugin.json'), `{ "name": "worfy", "version": "${BUNDLED_HARNESS}" }\n`)
    writeFileSync(join(state, 'marketplace'), `${join(harnessHome, 'plugin')}\n`)
    writeFileSync(join(state, 'plugin-version'), `${BUNDLED_HARNESS}\n`)
    report = await runChecks(deps(env))
    const missing = checkOf(report, 'harness-dependencies')
    expect(missing).toMatchObject({ status: 'fail', detail: 'not installed', command: null, actions: [{ id: 'harness-install', label: 'Install…' }] })
    expect(missing.hint).toContain(DEP)
    expect(missing.hint).toContain('anthropics/claude-plugins-official')
    // The plugin's own row says the same thing as an error of the install, with Retry.
    expect(checkOf(report, 'harness')).toMatchObject({ status: 'fail', detail: 'error at dependency install', actions: [{ id: 'harness-install', label: 'Retry' }] })
    // Both rows come from one `claude plugin list`.
    expect(calls().filter((line) => line.startsWith('claude plugin'))).toEqual(['claude plugin list --json'])

    writeFileSync(join(state, 'plugins'), `${DEP}\n`)
    report = await runChecks(deps(env))
    expect(checkOf(report, 'harness-dependencies')).toMatchObject({ status: 'ok', detail: `${DEP} 1.0.0`, hint: '', actions: [] })
    expect(checkOf(report, 'harness').status).toBe('ok')
    expect(report.checks.filter((check) => check.group === 'Harness').map((check) => check.id)).toEqual(['harness', 'harness-dependencies', 'harness-scripts', 'legacy-harness'])
  })

  // worfy-harness ticket 37: the row runs `profile --help` the way the Epics read runs the Harness
  // scripts — its runner and the scripts' environment (`scriptEnv`), not the screen's (`env`).
  describe('the Harness scripts row', () => {
    /** The Harness of this repository as the installed plugin: its real `profile`. */
    const installPlugin = (): void => {
      mkdirSync(harnessHome, { recursive: true })
      symlinkSync(join(REPO, 'harness'), join(harnessHome, 'plugin'))
    }
    /**
     * A folder whose only entry is the real node, found on this process's PATH (NODE): `node`, or on
     * Windows `node.exe`, the only name worfy takes for the node of a Harness script there (nodeOnPath).
     */
    const realNode = (): string => {
      const dir = join(root, 'node-bin')
      if (!existsSync(dir)) {
        mkdirSync(dir)
        symlinkSync(NODE, join(dir, WINDOWS ? 'node.exe' : 'node'))
      }
      return dir
    }

    it('without a Harness: not red, checked once it is installed, nothing run', async () => {
      tools(...ALL_TOOLS)
      let asked = 0
      const report = await runChecks(deps(loginEnv(), { scriptEnv: () => ((asked += 1), Promise.resolve(loginEnv())) }))
      expect(checkOf(report, 'harness-scripts')).toMatchObject({ group: 'Harness', title: 'Harness scripts', status: 'warn', detail: 'checked when the Harness plugin is installed', command: null, actions: [] })
      expect(asked).toBe(0)
    })

    it("the screen's PATH has no node, the scripts' environment has: ok", async () => {
      tools('claude', 'gh', 'jq', 'git', 'npm')
      installPlugin()
      const scripts = scriptsEnv([realNode(), '/usr/bin', '/bin'], { HOME: home })
      const report = await runChecks(deps(loginEnv(), { scriptEnv: () => Promise.resolve(scripts) }))
      expect(checkOf(report, 'node').status).toBe('fail')
      expect(checkOf(report, 'harness-scripts')).toMatchObject({ status: 'ok', detail: 'profile --help answered', hint: '', actions: [] })
    })

    it("the scripts' environment has no node: failed with that reason and what it means", async () => {
      tools(...ALL_TOOLS)
      installPlugin()
      const empty = join(root, 'empty-bin')
      mkdirSync(empty)
      const report = await runChecks(deps(loginEnv(), { scriptEnv: () => Promise.resolve({ PATH: empty, HOME: home }) }))
      const scripts = checkOf(report, 'harness-scripts')
      expect(scripts.status).toBe('fail')
      // worfy runs the script as `node <script>` and looks for node first (worfy-windows ticket 05).
      expect(scripts.detail).toBe('profile --help: node not found in PATH')
      expect(scripts.hint).toBe(HARNESS_SCRIPT_HINTS.node)
      expect(scripts.hint).toBe('worfy cannot run the Harness scripts, so it reads no Epics: they need node on the PATH of your login shell')
      expect(scripts.actions).toEqual([])
    })

    /**
     * The screen's environment, whose node stand-in passes every call but --version to the real node:
     * worfy runs the Harness scripts as `node <script>`, with the node on that PATH. On Windows worfy
     * takes only a node.exe for that, never the node.cmd stand-in, so the real node's folder follows
     * the stand-ins there: the screen's node row still finds the stand-in first.
     */
    // On Windows worfy starts a Harness script only with a node.exe, never the node.cmd stand-in, so
    // the stand-in needs no real node to hand calls to: the real node.exe comes after it on the PATH.
    const withNode = (): Record<string, string> => loginEnv(WINDOWS ? { PATH: `${bin};${realNode()}` } : { FAKE_NODE_REAL: NODE })

    /** The old Harness in <claude home>/bin: its epic-status and, when given, a `profile` with this text. */
    const oldHarness = (profile?: string, mode = 0o755): string => {
      const dir = join(claudeHome, 'bin')
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'epic-status'), '#!/bin/sh\nexit 0\n')
      chmodSync(join(dir, 'epic-status'), 0o755)
      if (profile !== undefined) {
        writeFileSync(join(dir, 'profile'), profile)
        chmodSync(join(dir, 'profile'), mode)
      }
      return dir
    }

    it('an old Harness without a profile script: a warning naming its folder, nothing run', async () => {
      tools(...ALL_TOOLS)
      const dir = oldHarness()
      let asked = 0
      const report = await runChecks(deps(loginEnv(), { scriptEnv: () => ((asked += 1), Promise.resolve(loginEnv())) }))
      expect(checkOf(report, 'harness-scripts')).toMatchObject({ status: 'warn', detail: `no profile script in ${dir}`, hint: 'worfy runs the Harness scripts to read the Epics of a Project' })
      expect(asked).toBe(0)
    })

    it('a timeout: failed with its limit, and the hint says the machine is slow, not that node is missing', async () => {
      tools(...ALL_TOOLS)
      oldHarness(nodeScript('setTimeout(() => undefined, 5000)'))
      const report = await runChecks(deps(withNode(), { harnessScriptTimeoutMs: 300 }))
      expect(checkOf(report, 'harness-scripts')).toMatchObject({ status: 'fail', detail: 'profile --help did not answer within 0.3 s', hint: HARNESS_SCRIPT_HINTS.timeout })
    })

    it('node that cannot be run (exit code 126): the hint is about node on the PATH, as for 127', async () => {
      tools(...ALL_TOOLS)
      oldHarness(nodeScript("process.stderr.write('env: node: Permission denied\\n')\nprocess.exitCode = 126"))
      const report = await runChecks(deps(withNode()))
      expect(checkOf(report, 'harness-scripts')).toMatchObject({ status: 'fail', detail: 'profile --help: exit code 126: env: node: Permission denied', hint: HARNESS_SCRIPT_HINTS.node })
    })

    it('the time limit is 15 s, the Epics read\'s, unless the checks are given another', async () => {
      tools(...ALL_TOOLS)
      oldHarness(nodeScript('process.exitCode = 0'))
      runnerLimits.length = 0
      expect(checkOf(await runChecks(deps(withNode())), 'harness-scripts').status).toBe('ok')
      // A limit a cold start of node keeps within: on a fresh Windows runner the first node.exe
      // through a new link can take longer than the 0.3 s this case once gave.
      expect(checkOf(await runChecks(deps(withNode(), { harnessScriptTimeoutMs: 10_000 })), 'harness-scripts').status).toBe('ok')
      expect(runnerLimits).toEqual([15_000, 10_000])
    })

    // A crash by a signal was read as a timeout before review round 2 of PR #311.
    // Not on Windows, lifted by none: it has no signals to end a process by (process.kill with
    // SIGSEGV throws ENOSYS there), and a crash ends it with an exit code instead.
    it.skipIf(WINDOWS)('a script ended by a signal the runner did not send: the signal and the crash hint, not the time limit', async () => {
      tools(...ALL_TOOLS)
      // writeSync: a write to the stderr pipe is asynchronous on macOS, and the kill would come first.
      oldHarness(nodeScript("fs.writeSync(2, 'Segmentation fault\\n')\nprocess.kill(process.pid, 'SIGSEGV')"))
      const report = await runChecks(deps(withNode()))
      expect(checkOf(report, 'harness-scripts')).toMatchObject({ status: 'fail', detail: 'profile --help was ended by the signal SIGSEGV: Segmentation fault', hint: HARNESS_SCRIPT_HINTS.signal })
    })

    // Review round 3 of PR #311: node's crash report reached the row with the stack's addresses,
    // and the hint sent the user to install the plugin again for a script the system ended.
    it.skipIf(WINDOWS)('a real process.abort(), and one after an out-of-memory report: the signal and the FATAL ERROR line, no frame; the hint is not to install the plugin again', async () => {
      tools(...ALL_TOOLS)
      oldHarness(nodeScript('process.abort()'))
      expect(checkOf(await runChecks(deps(withNode())), 'harness-scripts')).toMatchObject({ status: 'fail', detail: 'profile --help was ended by the signal SIGABRT', hint: HARNESS_SCRIPT_HINTS.signal })
      oldHarness(nodeScript(`fs.writeSync(2, ${JSON.stringify(OUT_OF_MEMORY)})\nprocess.abort()`))
      const row = checkOf(await runChecks(deps(withNode())), 'harness-scripts')
      expect(row).toMatchObject({ status: 'fail', detail: 'profile --help was ended by the signal SIGABRT: FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory', hint: HARNESS_SCRIPT_HINTS.signal })
      expect(row.hint).not.toMatch(/install the Harness plugin again/)
    })

    it("a crash of the script: its Error line, not node's version line; the hint is not about node", async () => {
      tools(...ALL_TOOLS)
      const crash = "/h/bin/profile.js:12\n    throw new TypeError('boom')\n    ^\n\nTypeError: boom\n    at main (/h/bin/profile.js:12:11) {\n  code: 'ERR_BOOM'\n}\n\nNode.js v24.19.0\n"
      oldHarness(nodeScript(`process.stderr.write(${JSON.stringify(crash)})\nprocess.exitCode = 1`))
      const report = await runChecks(deps(withNode()))
      expect(checkOf(report, 'harness-scripts')).toMatchObject({ status: 'fail', detail: 'profile --help: exit code 1: TypeError: boom', hint: HARNESS_SCRIPT_HINTS.crash })
    })

    // worfy-windows ticket 05: a Node script runs as `node <script>`, so its execute bit does not stop it any more.
    it('a Node script without the execute bit: answered', async () => {
      tools(...ALL_TOOLS)
      oldHarness(nodeScript('process.exitCode = 0'), 0o644)
      const scripts = checkOf(await runChecks(deps(withNode())), 'harness-scripts')
      expect(scripts).toMatchObject({ status: 'ok', detail: 'profile --help answered' })
    })

    // A `#!` line that names no node is an older Harness's script: on macOS and Linux started by
    // itself, as before; on Windows, which starts no such script, refused as not a Node script.
    it('a script that is there but cannot be started (its interpreter line names no file): failed, not "no profile script"', async () => {
      tools(...ALL_TOOLS)
      oldHarness('#!/nonexistent/interpreter\n')
      const scripts = checkOf(await runChecks(deps(withNode())), 'harness-scripts')
      expect(scripts).toMatchObject({ status: 'fail', hint: HARNESS_SCRIPT_HINTS.start })
      expect(scripts.detail).toMatch(/^profile could not be started: /)
      if (WINDOWS) expect(scripts.detail).toMatch(/is not a Node script/)
    })
  })

  it('the plugin dependencies in a run that may not install: failed without a button', async () => {
    tools(...ALL_TOOLS)
    const env = loginEnv()
    mkdirSync(join(harnessHome, 'plugin', '.claude-plugin'), { recursive: true })
    writeFileSync(join(harnessHome, 'plugin', '.claude-plugin', 'plugin.json'), `{ "name": "worfy", "version": "${BUNDLED_HARNESS}" }\n`)
    writeFileSync(join(state, 'plugin-version'), `${BUNDLED_HARNESS}\n`)
    const devRun = new HarnessInstaller({ bundledDir: bundle, harnessHome, claude: CLAUDE, env: { ...env, CLAUDE_CONFIG_DIR: claudeHome }, canInstall: false, claudeHome })
    const report = await runChecks(deps(env, { harness: () => devRun.status() }))
    expect(checkOf(report, 'harness-dependencies')).toMatchObject({ status: 'fail', actions: [] })
    expect(checkOf(report, 'harness-dependencies').hint).toContain('dev run')
  })

  it('the plugin dependencies when `claude plugin list` fails: not checked, and the error stays on the Harness plugin row', async () => {
    tools(...ALL_TOOLS)
    mkdirSync(join(harnessHome, 'plugin', '.claude-plugin'), { recursive: true })
    writeFileSync(join(harnessHome, 'plugin', '.claude-plugin', 'plugin.json'), `{ "name": "worfy", "version": "${BUNDLED_HARNESS}" }\n`)
    const report = await runChecks(deps(loginEnv({ FAKE_CLAUDE_FAIL: 'plugin list' })))
    expect(checkOf(report, 'harness')).toMatchObject({ status: 'fail', detail: 'error at plugin list' })
    expect(checkOf(report, 'harness-dependencies')).toMatchObject({ status: 'warn', detail: 'not checked', actions: [] })
  })

  it('the old Harness in ~/.claude: a warning with the move form', async () => {
    tools(...ALL_TOOLS)
    mkdirSync(join(claudeHome, 'bin'), { recursive: true })
    writeFileSync(join(claudeHome, 'bin', 'epic-status'), '#!/bin/sh\n')
    const report = await runChecks(deps(loginEnv()))
    expect(checkOf(report, 'legacy-harness')).toMatchObject({ status: 'warn', actions: [{ id: 'migration-form' }] })
  })

  itWithQmd('qmd: missing warns with Install; the models wait for an answer with Download and Skip, and name the size', async () => {
    tools(...ALL_TOOLS)
    let report = await runChecks(deps(loginEnv()))
    expect(checkOf(report, 'qmd')).toMatchObject({ status: 'warn', actions: [{ id: 'qmd-install' }] })
    expect(checkOf(report, 'qmd-models')).toMatchObject({ status: 'warn', actions: [{ id: 'qmd-models-skip' }] })
    expect(checkOf(report, 'qmd-models').detail).toContain('2.4 GiB')

    tools('qmd')
    report = await runChecks(deps(loginEnv()))
    expect(checkOf(report, 'qmd')).toMatchObject({ status: 'ok' })
    expect(checkOf(report, 'qmd-models').actions.map((action) => action.id)).toEqual(['qmd-models-download', 'qmd-models-skip'])

    mkdirSync(harnessHome, { recursive: true })
    writeFileSync(join(harnessHome, MODELS_ANSWER_FILE), 'skipped\n')
    report = await runChecks(deps(loginEnv()))
    expect(checkOf(report, 'qmd-models')).toMatchObject({ status: 'ok', detail: 'skipped' })
  })

  itWithQmd('qmd collections: a Project whose Profile names none warns with Set up; none connected is ok', async () => {
    tools(...ALL_TOOLS, 'qmd')
    mkdirSync(join(harnessHome, 'plugin', 'bin'), { recursive: true })
    writeFileSync(join(harnessHome, 'plugin', 'bin', 'qmd-collections'), '#!/bin/sh\n')
    let report = await runChecks(deps(loginEnv(), { projects: () => Promise.resolve([{ name: 'alpha', profile: 'alpha', collections: [] }]) }))
    expect(checkOf(report, 'qmd-collections')).toMatchObject({ status: 'warn', actions: [{ id: 'qmd-collections' }] })
    expect(checkOf(report, 'qmd-collections').detail).toContain('alpha')
    report = await runChecks(deps(loginEnv(), { projects: () => Promise.resolve([{ name: 'alpha', profile: 'alpha', collections: ['alpha-docs'] }]) }))
    expect(checkOf(report, 'qmd-collections').status).toBe('ok')
    report = await runChecks(deps(loginEnv(), { projects: () => Promise.resolve([]) }))
    expect(checkOf(report, 'qmd-collections').status).toBe('ok')
  })

  it('write nothing: every file in HOME, the Claude home and the Project keeps its mtime, and no file comes or goes', async () => {
    tools(...ALL_TOOLS, 'qmd')
    // A plugin folder, so the Harness check runs `claude plugin list` too.
    mkdirSync(join(harnessHome, 'plugin', '.claude-plugin'), { recursive: true })
    writeFileSync(join(harnessHome, 'plugin', '.claude-plugin', 'plugin.json'), `{ "name": "worfy", "version": "${BUNDLED_HARNESS}" }\n`)
    writeFileSync(join(claudeHome, 'settings.json'), '{}\n')
    const snapshot = (): Record<string, number> => {
      const out: Record<string, number> = {}
      const walk = (dir: string): void => {
        out[dir] = statSync(dir).mtimeMs
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const path = join(dir, entry.name)
          if (entry.isDirectory()) walk(path)
          else out[path] = statSync(path).mtimeMs
        }
      }
      walk(home)
      walk(project)
      return out
    }
    const before = snapshot()
    const env = loginEnv({ CLAUDE_CONFIG_DIR: claudeHome })
    await runChecks(deps(env))
    expect(snapshot()).toEqual(before)
    // The checks did run the tools, and `claude plugin list` among them.
    // Not `qmd --version` on Windows: qmd.ts does not find a qmd.cmd yet (itWithQmd above, ticket 15).
    const qmd = WINDOWS ? [] : ['qmd --version']
    expect(calls()).toEqual(expect.arrayContaining(['claude --version', 'claude plugin list --json', 'gh auth status', 'node --version', 'jq --version', 'git --version', ...qmd]))
  })
})

describe('first-run actions', () => {
  function actions(env: Record<string, string>, answers: boolean[], shown: Confirmation[] = [], projects: ProjectProfile[] = []): FirstRunActions {
    return new FirstRunActions({
      // The checks see the same Projects as the action, as in the app.
      checks: () => runChecks(deps(env, { projects: () => Promise.resolve(projects) })),
      confirm: (confirmation) => {
        shown.push(confirmation)
        return Promise.resolve(answers.shift() ?? false)
      },
      env: () => Promise.resolve(env),
      homes: { harnessHome, claudeHome },
      installHarness: (confirm) => installer(env).install(confirm),
      projects: () => Promise.resolve(projects),
      binDir: join(harnessHome, 'plugin', 'bin'),
    })
  }

  /** A stand-in for the Harness script bin/qmd-collections: logs its call and HARNESS_HOME; FAKE_COLLECTIONS_FAIL makes it fail. */
  function collectionsScript(): string {
    const dir = join(harnessHome, 'plugin', 'bin')
    mkdirSync(dir, { recursive: true })
    const script = join(dir, 'qmd-collections')
    writeFileSync(
      script,
      [
        '#!/bin/sh',
        'printf \'qmd-collections %s home=%s\\n\' "$*" "$HARNESS_HOME" >>"$FIRST_RUN_TOOLS_LOG"',
        'if [ -n "$FAKE_COLLECTIONS_FAIL" ]; then printf \'%s\\n\' "$FAKE_COLLECTIONS_FAIL" >&2; exit 1; fi',
        "printf 'qmd-collections: alpha-docs, alpha-tickets, alpha-memory\\n'",
        '',
      ].join('\n'),
    )
    chmodSync(script, 0o755)
    return script
  }
  const ALPHA: ProjectProfile = { name: 'alpha', profile: 'alpha', collections: [] }

  it('qmd collections: Cancel does not run the script; the dialog names it, the Project and the index', async () => {
    tools(...ALL_TOOLS, 'qmd')
    const script = collectionsScript()
    const shown: Confirmation[] = []
    const result = await actions(loginEnv(), [false], shown, [ALPHA]).run('qmd-collections')
    expect(result.outcome).toBe('declined')
    expect(shown).toHaveLength(1)
    expect(shown[0]?.message).toContain('alpha')
    expect(shown[0]?.detail).toContain(`${script} alpha`)
    expect(shown[0]?.detail).toContain('index.yml')
    expect(calls().filter((line) => line.startsWith('qmd-collections'))).toEqual([])
  })

  itWithQmd('qmd collections: Confirm runs the script for each Project without collections, then the checks run again', async () => {
    tools(...ALL_TOOLS, 'qmd')
    collectionsScript()
    const result = await actions(loginEnv(), [true], [], [ALPHA, { name: 'beta', profile: 'beta', collections: ['beta-docs'] }]).run('qmd-collections')
    expect(result.outcome).toBe('done')
    const log = calls()
    const ran = log.filter((line) => line.startsWith('qmd-collections'))
    expect(ran).toEqual([`qmd-collections alpha home=${harnessHome}`])
    // The checks ran again after the script.
    expect(log.slice(log.indexOf(ran[0] ?? '') + 1)).toEqual(expect.arrayContaining(['node --version', 'qmd --version']))
  })

  itWithQmd('qmd collections: a failing script makes the row fail with its output', async () => {
    tools(...ALL_TOOLS, 'qmd')
    collectionsScript()
    const result = await actions(loginEnv({ FAKE_COLLECTIONS_FAIL: 'qmd-collections: index.yml is not writable' }), [true], [], [ALPHA]).run('qmd-collections')
    expect(result.outcome).toBe('failed')
    expect(checkOf(result.report, 'qmd-collections').status).toBe('fail')
    expect(checkOf(result.report, 'qmd-collections').hint).toContain('index.yml is not writable')
  })

  it('runs nothing without "Confirm": a declined qmd install does not call npm', async () => {
    tools(...ALL_TOOLS)
    const shown: Confirmation[] = []
    const result = await actions(loginEnv(), [false], shown).run('qmd-install')
    expect(result.outcome).toBe('declined')
    expect(shown).toHaveLength(1)
    expect(calls().filter((line) => line.startsWith('npm install'))).toEqual([])
    expect(checkOf(result.report, 'qmd').status).toBe('warn')
  })

  itWithQmd('names the command, the folder and the download before it runs, and runs the checks again after it', async () => {
    tools(...ALL_TOOLS)
    const shown: Confirmation[] = []
    const result = await actions(loginEnv(), [true], shown).run('qmd-install')
    expect(shown[0]?.detail).toContain('npm install -g @tobilu/qmd@2.8.3')
    expect(shown[0]?.detail).toContain(join(root, 'npm-prefix'))
    expect(shown[0]?.detail).toMatch(/download/i)
    expect(result.outcome).toBe('done')
    const log = calls()
    const installed = log.indexOf('npm install -g @tobilu/qmd@2.8.3')
    expect(installed).toBeGreaterThanOrEqual(0)
    // The checks ran again after npm: qmd is found now.
    expect(log.slice(installed + 1)).toContain('qmd --version')
    expect(checkOf(result.report, 'qmd').status).toBe('ok')
  })

  itWithQmd('a failed action makes its row fail with the error, until the next attempt', async () => {
    tools(...ALL_TOOLS)
    const env = loginEnv({ FAKE_NPM_FAIL: 'code EACCES: permission denied' })
    const runner = actions(env, [true, true])
    const result = await runner.run('qmd-install')
    expect(result.outcome).toBe('failed')
    expect(result.message).toContain('EACCES: permission denied')
    expect(checkOf(result.report, 'qmd')).toMatchObject({ status: 'fail' })
    expect(checkOf(result.report, 'qmd').hint).toContain('EACCES: permission denied')
    // Checking again keeps the failure in sight.
    expect(checkOf(await runner.report(), 'qmd').status).toBe('fail')
    // The next attempt replaces it: with npm working again the row is ok.
    delete env.FAKE_NPM_FAIL
    const retried = await runner.run('qmd-install')
    expect(retried.outcome).toBe('done')
    expect(checkOf(retried.report, 'qmd').status).toBe('ok')
  })

  it('the models: the dialog names the size, the folder and `qmd pull`; Skip writes "skipped" only after Confirm', async () => {
    tools(...ALL_TOOLS, 'qmd')
    const shown: Confirmation[] = []
    const runner = actions(loginEnv(), [false, false, true], shown)
    expect((await runner.run('qmd-models-download')).outcome).toBe('declined')
    expect(shown[0]?.message).toContain('2.4 GiB')
    expect(shown[0]?.detail).toContain('qmd pull')
    expect(shown[0]?.detail).toContain(join(home, '.cache', 'qmd', 'models'))
    expect(calls().filter((line) => line.startsWith('qmd pull'))).toEqual([])

    expect((await runner.run('qmd-models-skip')).outcome).toBe('declined')
    expect(() => readFileSync(join(harnessHome, MODELS_ANSWER_FILE))).toThrow()
    const skipped = await runner.run('qmd-models-skip')
    expect(skipped.outcome).toBe('done')
    expect(readFileSync(join(harnessHome, MODELS_ANSWER_FILE), 'utf8')).toBe('skipped\n')
    expect(checkOf(skipped.report, 'qmd-models')).toMatchObject({ status: 'ok', detail: 'skipped' })
  })

  itWithQmd('a failed `qmd pull` makes the models row fail with its stderr', async () => {
    tools(...ALL_TOOLS, 'qmd')
    const result = await actions(loginEnv({ FAKE_QMD_PULL_FAIL: 'pull: network down' }), [true]).run('qmd-models-download')
    expect(result.outcome).toBe('failed')
    expect(checkOf(result.report, 'qmd-models')).toMatchObject({ status: 'fail' })
    expect(checkOf(result.report, 'qmd-models').hint).toContain('pull: network down')
  })

  it('the Harness: Install shows one dialog with the installer plan — the dependency commands and the download, then the Harness commands — and after Confirm both rows are ok', async () => {
    tools(...ALL_TOOLS)
    const shown: Confirmation[] = []
    const result = await actions(loginEnv(), [true], shown).run('harness-install')
    expect(shown).toHaveLength(1)
    expect(shown[0]?.message).toBe(`Install the worfy Harness ${BUNDLED_HARNESS}?`)
    expect(shown[0]?.detail).toContain(join(harnessHome, 'plugin'))
    expect(shown[0]?.detail).toContain('claude plugin marketplace add anthropics/claude-plugins-official')
    expect(shown[0]?.detail).toContain(`claude plugin install ${DEP} --scope user`)
    expect(shown[0]?.detail).toContain('claude plugin install worfy@worfy-harness --scope user')
    expect(shown[0]?.detail).toContain('downloads it from GitHub (anthropics/claude-plugins-official)')
    // A dependency is downloaded: the line that nothing is does not belong here.
    expect(shown[0]?.detail).not.toContain('Nothing is downloaded')
    expect(result.outcome).toBe('done')
    expect(checkOf(result.report, 'harness').status).toBe('ok')
    expect(checkOf(result.report, 'harness-dependencies')).toMatchObject({ status: 'ok', detail: `${DEP} 1.0.0` })
    expect(calls().filter((line) => line.startsWith('claude plugin') && !line.endsWith('list --json'))).toEqual([
      'claude plugin marketplace add anthropics/claude-plugins-official',
      `claude plugin install ${DEP} --scope user`,
      `claude plugin marketplace add ${join(harnessHome, 'plugin')}`,
      'claude plugin install worfy@worfy-harness --scope user',
    ])
  })

  it('the Harness with its dependency already installed: the dialog names no dependency and keeps "Nothing is downloaded"', async () => {
    tools(...ALL_TOOLS)
    writeFileSync(join(state, 'marketplaces'), 'claude-plugins-official\n')
    writeFileSync(join(state, 'plugins'), `${DEP}\n`)
    const shown: Confirmation[] = []
    const result = await actions(loginEnv(), [true], shown).run('harness-install')
    expect(shown[0]?.detail).toContain('Nothing is downloaded: the copy comes from this build.')
    expect(shown[0]?.detail).not.toContain('claude-plugins-official')
    expect(result.outcome).toBe('done')
    expect(checkOf(result.report, 'harness-dependencies').status).toBe('ok')
  })

  it('Install… on the dependencies row (worfy installed without its dependency) asks with the dependency commands alone and makes both rows ok', async () => {
    tools(...ALL_TOOLS)
    mkdirSync(join(harnessHome, 'plugin', '.claude-plugin'), { recursive: true })
    writeFileSync(join(harnessHome, 'plugin', '.claude-plugin', 'plugin.json'), `{ "name": "worfy", "version": "${BUNDLED_HARNESS}" }\n`)
    writeFileSync(join(state, 'marketplace'), `${join(harnessHome, 'plugin')}\n`)
    writeFileSync(join(state, 'plugin-version'), `${BUNDLED_HARNESS}\n`)
    const shown: Confirmation[] = []
    const result = await actions(loginEnv(), [true], shown).run('harness-install')
    expect(shown).toHaveLength(1)
    expect(shown[0]?.message).toBe(`Install ${DEP} for the worfy Harness?`)
    expect(shown[0]?.detail).toContain(`claude plugin install ${DEP} --scope user`)
    expect(shown[0]?.detail).not.toContain('worfy@worfy-harness')
    expect(shown[0]?.detail).not.toContain('Nothing is downloaded')
    expect(result.outcome).toBe('done')
    expect(checkOf(result.report, 'harness').status).toBe('ok')
    expect(checkOf(result.report, 'harness-dependencies').status).toBe('ok')
  })

  it('a failed dependency install shows on the dependencies row, leaves no Harness copy, and the next attempt that works clears it', async () => {
    tools(...ALL_TOOLS)
    const failing = await actions(loginEnv({ FAKE_CLAUDE_FAIL: `plugin install ${DEP}` }), [true]).run('harness-install')
    expect(failing.outcome).toBe('failed')
    expect(failing.message).toContain('dependency install')
    const row = checkOf(failing.report, 'harness-dependencies')
    expect(row.status).toBe('fail')
    expect(row.hint).toContain('The last attempt failed: dependency install')
    expect(row.hint).toContain(`plugin install ${DEP} --scope user failed`)
    // The plugin's own row is as it was: not installed, with Install — nothing is half way.
    expect(checkOf(failing.report, 'harness')).toMatchObject({ status: 'fail', detail: 'not installed', actions: [{ id: 'harness-install', label: 'Install' }] })
    expect(checkOf(failing.report, 'harness').hint).not.toContain('The last attempt failed')
    expect(existsSync(join(harnessHome, 'plugin'))).toBe(false)
    expect(calls()).not.toContain('claude plugin install worfy@worfy-harness --scope user')

    // One runner keeps the failure until its next attempt.
    const answers = [true, true]
    let env = loginEnv({ FAKE_CLAUDE_FAIL: `plugin install ${DEP}` })
    const runner = new FirstRunActions({
      checks: () => runChecks(deps(env)),
      confirm: () => Promise.resolve(answers.shift() ?? false),
      env: () => Promise.resolve(env),
      homes: { harnessHome, claudeHome },
      installHarness: (confirm) => installer(env).install(confirm),
      projects: () => Promise.resolve([]),
      binDir: join(harnessHome, 'plugin', 'bin'),
    })
    expect(checkOf((await runner.run('harness-install')).report, 'harness-dependencies').status).toBe('fail')
    env = loginEnv()
    const retried = await runner.run('harness-install')
    expect(retried.outcome).toBe('done')
    expect(checkOf(retried.report, 'harness-dependencies')).toMatchObject({ status: 'ok', hint: '' })
    expect(checkOf(retried.report, 'harness').status).toBe('ok')
  })

  it('a declined Harness install writes nothing: claude ran only its two reads', async () => {
    tools(...ALL_TOOLS)
    const result = await actions(loginEnv(), [false]).run('harness-install')
    expect(result.outcome).toBe('declined')
    expect(readdirSync(claudeHome)).toEqual([])
    expect(readdirSync(state)).toEqual([])
    expect(calls().filter((line) => line.startsWith('claude plugin'))).toEqual(['claude plugin list --json', 'claude plugin marketplace list --json'])
  })

  it('gh-login: only confirmed by main, which names the Project and the command', async () => {
    tools(...ALL_TOOLS)
    const shown: Confirmation[] = []
    const runner = actions(loginEnv({ FAKE_GH_ACCOUNT: '' }), [false, true], shown)
    expect((await runner.run('gh-login', { projectName: 'alpha' })).outcome).toBe('declined')
    const confirmed = await runner.run('gh-login', { projectName: 'alpha' })
    expect(confirmed.outcome).toBe('confirmed')
    expect(shown[1]?.detail).toContain('gh auth login')
    expect(shown[1]?.detail).toContain('alpha')
    // main itself never runs gh auth login: the Terminal Node does, in front of the user.
    expect(calls().filter((line) => line.startsWith('gh auth login'))).toEqual([])
  })

  it('refuses a second action while one runs', async () => {
    tools(...ALL_TOOLS)
    let release: (answer: boolean) => void = () => undefined
    const runner = new FirstRunActions({
      checks: () => runChecks(deps(loginEnv())),
      confirm: () => new Promise((resolve) => (release = resolve)),
      env: () => Promise.resolve(loginEnv()),
      homes: { harnessHome, claudeHome },
      installHarness: (confirm) => installer(loginEnv()).install(confirm),
      projects: () => Promise.resolve([]),
      binDir: join(harnessHome, 'plugin', 'bin'),
    })
    const first = runner.run('qmd-models-skip')
    await expect(runner.run('qmd-install')).rejects.toThrow(/another action/)
    release(false)
    expect((await first).outcome).toBe('declined')
  })

  itWithQmd('a failed action stays on its row only while the check of the row does not pass; once it passes, the failure is dropped', async () => {
    tools(...ALL_TOOLS, 'qmd')
    collectionsScript()
    let projects: ProjectProfile[] = [ALPHA]
    const env = loginEnv({ FAKE_COLLECTIONS_FAIL: 'qmd-collections: qmd-sync-main: No such file' })
    const runner = new FirstRunActions({
      checks: () => runChecks(deps(env, { projects: () => Promise.resolve(projects) })),
      confirm: () => Promise.resolve(true),
      env: () => Promise.resolve(env),
      homes: { harnessHome, claudeHome },
      installHarness: (confirm) => installer(env).install(confirm),
      projects: () => Promise.resolve(projects),
      binDir: join(harnessHome, 'plugin', 'bin'),
    })
    const failing = await runner.run('qmd-collections')
    expect(failing.outcome).toBe('failed')
    // The check does not pass yet (alpha names no collections): the row shows the action's error.
    expect(checkOf(failing.report, 'qmd-collections').status).toBe('fail')
    expect(checkOf(failing.report, 'qmd-collections').hint).toContain('The last attempt failed: ')
    expect(checkOf(failing.report, 'qmd-collections').hint).toContain('qmd-sync-main: No such file')
    // "Check again" while the check still does not pass: the same.
    const still = checkOf(await runner.report(), 'qmd-collections')
    expect(still.status).toBe('fail')
    expect(still.hint).toContain('qmd-sync-main: No such file')

    // The cause is fixed outside worfy: the Profile names its collections now, and the check passes.
    projects = [{ ...ALPHA, collections: ['alpha-docs'] }]
    const fixed = checkOf(await runner.report(), 'qmd-collections')
    expect(fixed.status).toBe('ok')
    expect(fixed.hint).not.toContain('The last attempt failed')

    // Dropped, not hidden: when the check stops passing again, the row shows the check's own result.
    projects = [ALPHA]
    const again = checkOf(await runner.report(), 'qmd-collections')
    expect(again).toMatchObject({ status: 'warn', actions: [{ id: 'qmd-collections' }] })
    expect(again.hint).not.toContain('The last attempt failed')
    expect(again.detail).toContain('alpha')
  })

  it('an action that fails while its check already passes still answers with its error; the row stays as the check found it', async () => {
    const harness: Check = { id: 'harness', group: 'Harness', title: 'Harness', status: 'ok', detail: BUNDLED_HARNESS, hint: '', command: null, actions: [] }
    const runner = new FirstRunActions({
      checks: () => Promise.resolve({ checks: [harness], checkedAt: new Date(0).toISOString() }),
      confirm: () => Promise.resolve(true),
      env: () => Promise.resolve(loginEnv()),
      homes: { harnessHome, claudeHome },
      installHarness: () => Promise.reject(new Error('no network')),
      projects: () => Promise.resolve([]),
      binDir: join(harnessHome, 'plugin', 'bin'),
    })
    const result = await runner.run('harness-install')
    expect(result.outcome).toBe('failed')
    expect(result.message).toBe('no network')
    expect(checkOf(result.report, 'harness')).toEqual(harness)
  })
})

describe('the first-run screen at start (src/main/ipc/first-run.ts)', () => {
  const MOCKED = ['electron', '../../src/main/agent/env', '../../src/main/ipc/harness', '../../src/main/ipc/workflow', '../../src/main/first-run/checks']
  let data: string

  beforeEach(() => {
    vi.resetModules()
    data = join(root, 'data')
    mkdirSync(data)
    vi.stubEnv('WORFY_DATA_DIR', data)
    vi.stubEnv('WORFY_CLAUDE_HOME', claudeHome)
    vi.stubEnv('WORFY_HARNESS_HOME', harnessHome)
    vi.stubEnv('WORFY_FIRST_RUN_AUTO', '1')
  })

  afterEach(() => {
    for (const path of MOCKED) vi.doUnmock(path)
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  /**
   * The module's handlers, with the checks answering one Harness row of `harness()` status and the
   * Harness install failing with "no network".
   */
  async function handlers(harness: () => CheckStatus): Promise<{ startup: () => Promise<unknown>; run: (input: unknown) => Promise<unknown> }> {
    vi.doMock('electron', () => ({
      app: { isPackaged: false, getAppPath: () => '/nowhere', on: () => undefined, quit: () => undefined },
      BrowserWindow: { getAllWindows: () => [], fromWebContents: () => null },
      dialog: { showMessageBox: () => Promise.reject(new Error('no dialog in this test')) },
      powerSaveBlocker: { start: () => 0, stop: () => undefined, isStarted: () => false },
    }))
    vi.doMock('../../src/main/agent/env', async (original) => ({
      ...(await original<object>()),
      agentEnv: () => Promise.resolve({ env: loginEnv(), from: 'login-shell', error: null }),
    }))
    vi.doMock('../../src/main/ipc/harness', async (original) => ({
      ...(await original<object>()),
      appInstaller: () => ({ install: () => Promise.reject(new Error('no network')), status: () => Promise.reject(new Error('not read in this test')) }),
    }))
    vi.doMock('../../src/main/ipc/workflow', () => ({ workflowHub: { retryFailedLayouts: () => Promise.resolve(0) } }))
    vi.doMock('../../src/main/first-run/checks', async (original) => ({
      ...(await original<object>()),
      runChecks: (): Promise<FirstRunReport> =>
        Promise.resolve({
          checks: [{ id: 'harness', group: 'Harness', title: 'Harness', status: harness(), detail: '', hint: '', command: null, actions: [] }],
          checkedAt: new Date(0).toISOString(),
        }),
    }))
    const module = (await import('../../src/main/ipc/first-run')).default as unknown as { channel: unknown; handle: (input: unknown, context: unknown) => Promise<unknown> }[]
    // The channels of this module load: the modules were loaded again after vi.resetModules().
    const { firstRunRun, firstRunStartup } = await import('../../src/shared/ipc/first-run')
    const handle = (channel: unknown) => {
      const found = module.find((handler) => handler.channel === channel)
      if (found === undefined) throw new Error('no handler of the channel')
      return (input?: unknown) => found.handle(input, { event: { sender: {} } })
    }
    return { startup: handle(firstRunStartup), run: handle(firstRunRun) }
  }

  it('a failed action whose check passes now does not open the screen by itself', async () => {
    // The screen was closed once with nothing failing.
    writeFileSync(join(data, 'first-run.json'), `${JSON.stringify({ closedAt: new Date(0).toISOString(), failing: [] })}\n`)
    let status: CheckStatus = 'warn'
    const app = await handlers(() => status)
    expect(await app.run({ action: 'harness-install' })).toMatchObject({ outcome: 'failed', message: 'no network' })

    // While the check does not pass, the failure is new since the screen was closed: it opens.
    const failing = (await app.startup()) as { show: boolean; report: FirstRunReport }
    expect(failing.show).toBe(true)
    expect(checkOf(failing.report, 'harness').hint).toContain('The last attempt failed: no network')

    // The cause is fixed outside worfy: nothing to fix, the screen stays closed.
    status = 'ok'
    const fixed = (await app.startup()) as { show: boolean; report: FirstRunReport }
    expect(fixed.show).toBe(false)
    expect(checkOf(fixed.report, 'harness')).toMatchObject({ status: 'ok', hint: '' })
  })
})

describe('askAccount: the Claude Code query of the sign-in check', () => {
  const SIGNED_IN = { subscriptionType: 'max', email: 'alice@example.com' }
  /** A query whose answer the test gives when it wants; counts its closes. */
  function query(): AccountQuery & { closes: number; answer: (info: typeof SIGNED_IN) => void; fail: (error: Error) => void } {
    let resolve: (info: typeof SIGNED_IN) => void = () => undefined
    let reject: (error: Error) => void = () => undefined
    const answered = new Promise<typeof SIGNED_IN>((yes, no) => {
      resolve = yes
      reject = no
    })
    const handle = {
      closes: 0,
      accountInfo: () => answered,
      close: () => {
        handle.closes += 1
      },
      answer: (info: typeof SIGNED_IN) => resolve(info),
      fail: (error: Error) => reject(error),
    }
    return handle
  }
  const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

  it('answers and closes the query once', async () => {
    const q = query()
    const asked = askAccount(() => Promise.resolve(q), 1000)
    q.answer(SIGNED_IN)
    expect(await asked).toEqual(SIGNED_IN)
    expect(q.closes).toBe(1)
  })

  it('a query that never answers is closed at the timeout, once; its late answer changes nothing', async () => {
    const q = query()
    await expect(askAccount(() => Promise.resolve(q), 30)).rejects.toThrow(/did not answer within/)
    expect(q.closes).toBe(1)
    q.answer(SIGNED_IN)
    await tick(10)
    expect(q.closes).toBe(1)
  })

  it('a late error after the timeout goes nowhere, and the query is not closed twice', async () => {
    const q = query()
    await expect(askAccount(() => Promise.resolve(q), 30)).rejects.toThrow(/did not answer within/)
    q.fail(new Error('Claude Code exited'))
    await tick(10)
    expect(q.closes).toBe(1)
  })

  it('an error of accountInfo() rejects with it and closes the query once', async () => {
    const q = query()
    const asked = askAccount(() => Promise.resolve(q), 1000)
    q.fail(new Error('Claude Code exited with code 1'))
    await expect(asked).rejects.toThrow('Claude Code exited with code 1')
    expect(q.closes).toBe(1)
  })

  it('a query that starts only after the timeout is closed as soon as it is there', async () => {
    const q = query()
    let started: (handle: AccountQuery) => void = () => undefined
    const asked = askAccount(() => new Promise<AccountQuery>((resolve) => (started = resolve)), 30)
    await expect(asked).rejects.toThrow(/did not answer within/)
    expect(q.closes).toBe(0)
    started(q)
    await tick(10)
    expect(q.closes).toBe(1)
  })
})
