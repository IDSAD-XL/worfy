// worfy-harness tickets 13 and 30: worfy installs the Harness of its build as the Claude Code plugin
// `worfy` (ADR-0040, ADR-0048), and the plugins it depends on before it (ADR-0059). Every case runs
// in a sandbox: HOME, CLAUDE_CONFIG_DIR and the Claude home worfy reads (WORFY_CLAUDE_HOME) all point
// into a temporary folder, never at the real ~/.claude. `claude` is a stub that logs its arguments
// and environment and keeps its own state outside the sandbox; it never reaches the network. The
// last case runs the Claude Code binary of the SDK on macOS and on Windows (claude.exe, worfy-windows
// ticket 13), on a Harness copy without dependencies, so that binary runs only local commands.
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { bundledClaudeBinary, claudeExecutablePath } from '../../src/main/agent/options'
import {
  claudeCommandEnv,
  compareHarnessVersions,
  confirmationText,
  DEPENDENCY_MARKETPLACE,
  DEPENDENCY_MARKETPLACE_SOURCE,
  HARNESS_MARKETPLACE,
  HARNESS_PLUGIN_ID,
  HarnessInstaller,
  installOffered,
  RENAME_RETRY_MS,
  ROLLBACK_RETRY_MS,
  type InstallerOptions,
  type InstallPlan,
} from '../../src/main/harness/install'
import { harnessHome } from '../../src/main/storage/paths'
import { accessOf, LINKED_MACHINE_ACCESS } from '../../src/shared/ipc/channels'
import { firstRunRun } from '../../src/shared/ipc/first-run'
import { removeTestTree } from '../remove'
import { scriptNode } from '../script-node'
import { shellStub } from '../shell-stub'
import { harnessInstall, type HarnessStatus } from '../../src/shared/ipc/harness'

const REPO = join(__dirname, '..', '..')
const V1 = '0.2.0+aaaaaaa'
const V2 = '0.3.0+bbbbbbb'
/** The dependency harness/.claude-plugin/plugin.json declares, and the version the stub gives it. */
const DEP = 'mattpocock-skills@claude-plugins-official'
const DEP_VERSION = '1.4.0'
const LIST = 'plugin list --json'
const MARKETPLACES = 'plugin marketplace list --json'
const ADD_OFFICIAL = `plugin marketplace add ${DEPENDENCY_MARKETPLACE_SOURCE}`
const INSTALL_DEP = `plugin install ${DEP} --scope user`
const INSTALL_WORFY = `plugin install ${HARNESS_PLUGIN_ID} --scope user`
const UNINSTALL_WORFY = `plugin uninstall ${HARNESS_PLUGIN_ID} --scope user`
const UPDATE_WORFY = `plugin update ${HARNESS_PLUGIN_ID} --scope user`

/** Files of a tree with their bytes' hash and mode: equal maps mean byte-equal trees. */
function treeOf(dir: string): Record<string, string> {
  const out: Record<string, string> = {}
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name)
      if (entry.isDirectory()) walk(path)
      else out[relative(dir, path)] = `${createHash('sha256').update(readFileSync(path)).digest('hex')} ${(statSync(path).mode & 0o777).toString(8)}`
    }
  }
  if (existsSync(dir)) walk(dir)
  return out
}

/** Every file under `dir` with its modification time: what was written, and where. */
function filesWithTimes(dir: string): Record<string, number> {
  const out: Record<string, number> = {}
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name)
      if (entry.isDirectory()) walk(path)
      else out[relative(dir, path)] = statSync(path).mtimeMs
    }
  }
  if (existsSync(dir)) walk(dir)
  return out
}

/** The Harness copy a build makes (electron.vite.config.ts): harness/ without its tests, with `version`. */
function makeBundle(target: string, version: string, dependencies?: string[]): string {
  const source = join(REPO, 'harness')
  const tests = [join('bin', 'tests'), join('hooks', 'tests')]
  cpSync(source, target, {
    recursive: true,
    filter: (path) => {
      const inside = relative(source, path)
      return !path.endsWith(`${sep}.DS_Store`) && !tests.some((dir) => inside === dir || inside.startsWith(`${dir}${sep}`))
    },
  })
  const manifestPath = join(target, '.claude-plugin', 'plugin.json')
  const { name, ...rest } = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>
  writeFileSync(manifestPath, `${JSON.stringify({ name, version, ...rest, ...(dependencies === undefined ? {} : { dependencies }) }, null, 2)}\n`)
  return target
}

// The stub keeps Claude Code's side (the marketplaces it knows, the plugins it has installed) in
// STUB_CLAUDE_STATE, outside the sandbox, so the sandbox shows only what worfy itself wrote. A
// marketplace is a folder (the Harness copy: its name comes from marketplace.json) or `owner/repo`
// (its name is the repository's). What a test can ask of it, each by the start of the command line,
// several joined with `|`:
//   STUB_CLAUDE_RUNTIME     a file: each call appends how it runs, {"runAsNode", "type"} (ELECTRON_RUN_AS_NODE
//                           and Electron's process.type, null when unset)
//   STUB_CLAUDE_FAIL        exit 3 before anything is recorded
//   STUB_CLAUDE_FAIL_AFTER  record what the command asked, then exit 1 (an install that refuses but leaves its record)
//   STUB_CLAUDE_NO_MARKETPLACE_LIST  `plugin marketplace list` is an unknown command
//   STUB_CLAUDE_ADD_TWICE_FAILS      `plugin marketplace add` of a known marketplace exits 1 with "already"
//   STUB_CLAUDE_ERRORS      an error `plugin list` reports for the plugin `worfy`
const STUB = `
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, isAbsolute, join } from 'node:path'
const args = process.argv.slice(2)
const line = args.join(' ')
appendFileSync(process.env.STUB_CLAUDE_LOG, JSON.stringify({ args, HOME: process.env.HOME, CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR }) + '\\n')
if (process.env.STUB_CLAUDE_RUNTIME) appendFileSync(process.env.STUB_CLAUDE_RUNTIME, JSON.stringify({ runAsNode: process.env.ELECTRON_RUN_AS_NODE ?? null, type: process.type ?? null }) + '\\n')
const asked = (name) => (process.env[name] ?? '').split('|').some((prefix) => prefix !== '' && line.startsWith(prefix))
const fail = (code) => {
  process.stderr.write('first line of noise\\nsecond line\\n' + line + ' failed: stub error\\n')
  process.exit(code)
}
if (asked('STUB_CLAUDE_FAIL')) fail(3)
const statePath = process.env.STUB_CLAUDE_STATE
const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : { marketplaces: {}, plugins: {} }
const manifest = (dir, file) => JSON.parse(readFileSync(join(dir, '.claude-plugin', file), 'utf8'))
const command = args.slice(0, args[1] === 'marketplace' ? 3 : 2).join(' ')
if (command === 'plugin marketplace list') {
  if (process.env.STUB_CLAUDE_NO_MARKETPLACE_LIST) {
    process.stderr.write("error: unknown command 'list'\\n")
    process.exit(1)
  }
  process.stdout.write(JSON.stringify(Object.entries(state.marketplaces).map(([name, source]) => ({ name, source })), null, 2) + '\\n')
} else if (command === 'plugin marketplace add') {
  const source = args[3]
  const name = isAbsolute(source) ? manifest(source, 'marketplace.json').name : basename(source)
  if (name in state.marketplaces && process.env.STUB_CLAUDE_ADD_TWICE_FAILS) {
    process.stderr.write("Marketplace '" + name + "' is already added\\n")
    process.exit(1)
  }
  state.marketplaces[name] = source
} else if (command === 'plugin install' || command === 'plugin update') {
  const source = state.marketplaces[args[2].split('@')[1]]
  if (source === undefined) {
    process.stderr.write('marketplace of ' + args[2] + ' not found\\n')
    process.exit(1)
  }
  state.plugins[args[2]] = isAbsolute(source) ? manifest(source, 'plugin.json').version : '${DEP_VERSION}'
} else if (command === 'plugin uninstall') {
  delete state.plugins[args[2]]
} else if (command === 'plugin list') {
  // As Claude Code does (ticket 13): a plugin whose dependency is not installed is listed with an error.
  const list = Object.entries(state.plugins).map(([id, version]) => {
    const source = state.marketplaces[id.split('@')[1]] ?? ''
    // A marketplace folder that is gone (a copy interrupted between its renames) still leaves the plugin listed.
    const needs = isAbsolute(source) && existsSync(source) ? (manifest(source, 'plugin.json').dependencies ?? []) : []
    const errors = needs.filter((dep) => !(dep in state.plugins)).map((dep) => 'Dependency "' + dep + '" is not installed')
    if (id === '${HARNESS_PLUGIN_ID}' && process.env.STUB_CLAUDE_ERRORS) errors.push(process.env.STUB_CLAUDE_ERRORS)
    return { id, version, scope: 'user', enabled: true, errors }
  })
  process.stdout.write(JSON.stringify(list, null, 2) + '\\n')
}
writeFileSync(statePath, JSON.stringify(state))
if (asked('STUB_CLAUDE_FAIL_AFTER')) fail(1)
`

interface Sandbox {
  root: string
  home: string
  claudeHome: string
  harnessHome: string
  pluginDir: string
  stub: string
  log: string
  state: string
  env: Record<string, string | undefined>
}

let sb: Sandbox

beforeEach(() => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-harness-install-')))
  const home = join(root, 'home')
  const claudeHome = join(home, '.claude')
  mkdirSync(claudeHome, { recursive: true })
  writeFileSync(join(claudeHome, 'settings.json'), '{\n  "theme": "dark",\n  "model": "opus"\n}\n')
  const stubDir = join(root, 'stub')
  mkdirSync(stubDir)
  writeFileSync(join(stubDir, 'claude-stub.mjs'), STUB)
  // Windows cannot start a `#!/bin/sh` script as a program: there the stand-in is the Node script
  // itself, which the installer starts under worfy's own Node (src/main/program.ts).
  const stub = process.platform === 'win32' ? join(stubDir, 'claude-stub.mjs') : join(stubDir, 'claude')
  if (process.platform !== 'win32') shellStub(stub, [`exec "${scriptNode()}" "${join(stubDir, 'claude-stub.mjs')}" "$@"`])
  const hHome = harnessHome({ WORFY_CLAUDE_HOME: claudeHome })
  sb = {
    root,
    home,
    claudeHome,
    harnessHome: hHome,
    pluginDir: join(hHome, 'plugin'),
    stub,
    log: join(stubDir, 'calls.jsonl'),
    state: join(stubDir, 'state.json'),
    env: { PATH: process.env.PATH, HOME: home, CLAUDE_CONFIG_DIR: claudeHome },
  }
  sb.env.STUB_CLAUDE_LOG = sb.log
  sb.env.STUB_CLAUDE_STATE = sb.state
})

afterEach(() => {
  removeTestTree(sb.root)
})

const calls = (): { args: string[]; HOME: string; CLAUDE_CONFIG_DIR: string }[] =>
  existsSync(sb.log)
    ? readFileSync(sb.log, 'utf8')
        .trim()
        .split('\n')
        .filter((line) => line !== '')
        .map((line) => JSON.parse(line) as { args: string[]; HOME: string; CLAUDE_CONFIG_DIR: string })
    : []
const commands = (): string[] => calls().map((call) => call.args.join(' '))
const clearCalls = (): void => rmSync(sb.log, { force: true })

/**
 * A stub in front of the stub, as a Node script, so the installer starts it on every system
 * (src/main/program.ts): `body` sees `args` and may answer and exit; anything else goes on to the
 * stub with the same arguments.
 */
function frontStub(name: string, body: string): string {
  const front = join(sb.root, 'stub', name)
  const stub = pathToFileURL(join(sb.root, 'stub', 'claude-stub.mjs')).href
  writeFileSync(front, `import { existsSync, writeFileSync } from 'node:fs'\nconst args = process.argv.slice(2)\n${body}\nawait import(${JSON.stringify(stub)})\n`)
  return front
}

function installer(bundle: string, options: Partial<InstallerOptions> = {}): HarnessInstaller {
  return new HarnessInstaller({ bundledDir: bundle, harnessHome: sb.harnessHome, claude: sb.stub, env: sb.env, canInstall: true, claudeHome: sb.claudeHome, ...options })
}

const yes = (): Promise<boolean> => Promise.resolve(true)

interface StubState {
  marketplaces: Record<string, string>
  plugins: Record<string, string>
}
/** Claude Code's side as the stub keeps it. */
const stubState = (): StubState => (existsSync(sb.state) ? (JSON.parse(readFileSync(sb.state, 'utf8')) as StubState) : { marketplaces: {}, plugins: {} })
const setStubState = (change: (state: StubState) => void): void => {
  const state = stubState()
  change(state)
  writeFileSync(sb.state, JSON.stringify(state))
}
/** The dependency is installed before the test starts, as on a machine that already uses it. */
const dependencyInstalled = (): void =>
  setStubState((state) => {
    state.marketplaces[DEPENDENCY_MARKETPLACE] = DEPENDENCY_MARKETPLACE_SOURCE
    state.plugins[DEP] = DEP_VERSION
  })

const dep = (status: 'installed' | 'missing' | 'unchecked'): HarnessStatus['dependencies'] => [{ id: DEP, status, version: status === 'installed' ? DEP_VERSION : null }]
/** Commands that write: everything but the two reads. */
const writes = (): string[] => commands().filter((command) => command !== LIST && command !== MARKETPLACES)

describe('the state', () => {
  it('without <harnessHome>/plugin is "not installed" with the dependency not checked, and reading it writes no file and runs no claude', async () => {
    const bundle = makeBundle(join(sb.root, 'bundle-v1'), V1)
    const before = filesWithTimes(sb.root)
    const status = await installer(bundle).status()
    expect(status).toEqual({ state: { kind: 'not-installed' }, bundledVersion: V1, canInstall: true, pluginDir: sb.pluginDir, dependencies: dep('unchecked') })
    expect(filesWithTimes(sb.root)).toEqual(before)
    expect(existsSync(sb.harnessHome)).toBe(false)
    expect(calls()).toEqual([])
  })

  it('with the plugin folder reads `plugin list` once, and takes the dependency from the same list', async () => {
    const bundle = makeBundle(join(sb.root, 'bundle-v1'), V1)
    await installer(bundle).install(yes)
    clearCalls()
    const status = await installer(bundle).status()
    expect(status.state).toEqual({ kind: 'installed', version: V1, enabled: true })
    expect(status.dependencies).toEqual(dep('installed'))
    expect(commands()).toEqual([LIST])
  })

  it('a build whose Harness names no dependency has none to report', async () => {
    const bundle = makeBundle(join(sb.root, 'bundle-v1'), V1, [])
    expect((await installer(bundle).status()).dependencies).toEqual([])
    const result = await installer(bundle).install(yes)
    expect(result.status).toMatchObject({ state: { kind: 'installed', version: V1 }, dependencies: [] })
    expect(commands()).toEqual([LIST, `plugin marketplace add ${sb.pluginDir}`, INSTALL_WORFY, LIST])
  })
})

describe('installing', () => {
  it('an empty sandbox: the dependency is installed before worfy — the official marketplace, the dependency, then the copy byte for byte, its marketplace and worfy in the user scope', async () => {
    const bundle = makeBundle(join(sb.root, 'bundle-v1'), V1)
    const plans: InstallPlan[] = []
    const result = await installer(bundle).install((plan) => {
      plans.push(plan)
      // The dialog is up: both reads are done, nothing is written yet.
      expect(commands()).toEqual([LIST, MARKETPLACES])
      expect(existsSync(sb.harnessHome)).toBe(false)
      return Promise.resolve(true)
    })
    expect(plans).toEqual([
      {
        pluginDir: sb.pluginDir,
        from: null,
        folder: null,
        to: V1,
        copy: true,
        dependencies: [DEP],
        dependencyCommands: [
          ['plugin', 'marketplace', 'add', DEPENDENCY_MARKETPLACE_SOURCE],
          ['plugin', 'install', DEP, '--scope', 'user'],
        ],
        commands: [
          ['plugin', 'marketplace', 'add', sb.pluginDir],
          ['plugin', 'install', HARNESS_PLUGIN_ID, '--scope', 'user'],
        ],
        legacyHarness: null,
      },
    ])
    expect(result).toEqual({
      outcome: 'done',
      status: { state: { kind: 'installed', version: V1, enabled: true }, bundledVersion: V1, canInstall: true, pluginDir: sb.pluginDir, dependencies: dep('installed') },
    })

    expect(treeOf(sb.pluginDir)).toEqual(treeOf(bundle))
    expect(Object.keys(treeOf(sb.pluginDir))).toContain(join('.claude-plugin', 'marketplace.json'))
    expect(JSON.parse(readFileSync(join(sb.pluginDir, '.claude-plugin', 'plugin.json'), 'utf8'))).toMatchObject({ name: 'worfy', version: V1 })
    // The copy is the marketplace and the plugin at once (ADR-0048): the name the commands use.
    expect(JSON.parse(readFileSync(join(sb.pluginDir, '.claude-plugin', 'marketplace.json'), 'utf8'))).toMatchObject({
      name: HARNESS_MARKETPLACE,
      plugins: [{ name: 'worfy', source: './' }],
    })

    expect(commands()).toEqual([LIST, MARKETPLACES, ADD_OFFICIAL, INSTALL_DEP, `plugin marketplace add ${sb.pluginDir}`, INSTALL_WORFY, LIST])
    for (const call of calls()) expect({ HOME: call.HOME, CLAUDE_CONFIG_DIR: call.CLAUDE_CONFIG_DIR }).toEqual({ HOME: sb.home, CLAUDE_CONFIG_DIR: sb.claudeHome })
    expect(HARNESS_PLUGIN_ID).toBe(`worfy@${HARNESS_MARKETPLACE}`)
    expect(stubState()).toEqual({
      marketplaces: { [DEPENDENCY_MARKETPLACE]: DEPENDENCY_MARKETPLACE_SOURCE, [HARNESS_MARKETPLACE]: sb.pluginDir },
      plugins: { [DEP]: DEP_VERSION, [HARNESS_PLUGIN_ID]: V1 },
    })
  })

  it('the dependency already installed: no command for it in the plan or in the log, and the dialog does not name it', async () => {
    dependencyInstalled()
    const bundle = makeBundle(join(sb.root, 'bundle-v1'), V1)
    const plans: InstallPlan[] = []
    const result = await installer(bundle).install((plan) => {
      plans.push(plan)
      return Promise.resolve(true)
    })
    expect(plans.map(({ dependencies, dependencyCommands }) => ({ dependencies, dependencyCommands }))).toEqual([{ dependencies: [], dependencyCommands: [] }])
    const text = confirmationText(plans[0]!)
    expect(text.detail).not.toContain(DEPENDENCY_MARKETPLACE)
    expect(text.detail).not.toContain('mattpocock-skills')
    expect(result.status).toMatchObject({ state: { kind: 'installed', version: V1 }, dependencies: dep('installed') })
    // Nothing asks which marketplaces are known: there is nothing to add one for.
    expect(commands()).toEqual([LIST, `plugin marketplace add ${sb.pluginDir}`, INSTALL_WORFY, LIST])
  })

  it('the official marketplace already known: only the dependency is installed from it', async () => {
    setStubState((state) => {
      state.marketplaces[DEPENDENCY_MARKETPLACE] = DEPENDENCY_MARKETPLACE_SOURCE
    })
    const bundle = makeBundle(join(sb.root, 'bundle-v1'), V1)
    const plans: InstallPlan[] = []
    const result = await installer(bundle).install((plan) => {
      plans.push(plan)
      return Promise.resolve(true)
    })
    expect(plans[0]?.dependencyCommands).toEqual([['plugin', 'install', DEP, '--scope', 'user']])
    expect(result.status.state).toEqual({ kind: 'installed', version: V1, enabled: true })
    expect(commands()).not.toContain(ADD_OFFICIAL)
  })

  it('writes nothing in the sandbox but <harnessHome>/plugin, and leaves settings.json byte for byte', async () => {
    const bundle = makeBundle(join(sb.root, 'bundle-v1'), V1)
    const settings = readFileSync(join(sb.claudeHome, 'settings.json'))
    const before = filesWithTimes(sb.home)
    await installer(bundle).install(yes)
    const after = filesWithTimes(sb.home)
    const written = Object.keys(after).filter((path) => before[path] !== after[path])
    const pluginPrefix = `${relative(sb.home, sb.pluginDir)}${sep}`
    expect(written.length).toBeGreaterThan(0)
    expect(written.filter((path) => !path.startsWith(pluginPrefix))).toEqual([])
    expect(readdirSync(sb.harnessHome)).toEqual(['plugin'])
    expect(readFileSync(join(sb.claudeHome, 'settings.json')).equals(settings)).toBe(true)
  })

  it('with the same version again: no copy and no dialog; claude runs only `plugin list`', async () => {
    const bundle = makeBundle(join(sb.root, 'bundle-v1'), V1)
    await installer(bundle).install(yes)
    clearCalls()
    const before = filesWithTimes(sb.root)

    const status = await installer(bundle).status()
    expect(status.state).toEqual({ kind: 'installed', version: V1, enabled: true })
    let asked = false
    const result = await installer(bundle).install(() => {
      asked = true
      return Promise.resolve(true)
    })
    expect(asked).toBe(false)
    expect(result.outcome).toBe('nothing-to-do')
    expect(result.status.state).toEqual({ kind: 'installed', version: V1, enabled: true })
    expect(commands()).toEqual([LIST, LIST])
    const after = filesWithTimes(sb.root)
    const written = Object.keys(after).filter((path) => before[path] !== after[path])
    // Only the stub's own log and state changed: the stub ran, worfy wrote nothing.
    expect(written.map((path) => relative(join(sb.root, 'stub'), join(sb.root, path))).sort()).toEqual(['calls.jsonl', 'state.json'])
  })

  it('with another version: the dialog names "from → to", the copy loses the files the new version dropped, and `plugin update` runs', async () => {
    const v1 = makeBundle(join(sb.root, 'bundle-v1'), V1)
    await installer(v1).install(yes)
    const v2 = makeBundle(join(sb.root, 'bundle-v2'), V2)
    const dropped = join('bin', 'epic-board')
    expect(existsSync(join(v2, dropped))).toBe(true)
    rmSync(join(v2, 'bin', 'epic-board'))
    writeFileSync(join(v2, 'bin', 'new-script'), '#!/bin/sh\necho new\n', { mode: 0o755 })
    clearCalls()

    expect((await installer(v2).status()).state).toEqual({ kind: 'outdated', from: V1, to: V2, sameVersion: false })
    const plans: InstallPlan[] = []
    const result = await installer(v2).install((plan) => {
      plans.push(plan)
      return Promise.resolve(true)
    })
    expect(plans.map(({ from, to, copy, commands: planned, dependencyCommands }) => ({ from, to, copy, planned, dependencyCommands }))).toEqual([
      { from: V1, to: V2, copy: true, planned: [['plugin', 'update', HARNESS_PLUGIN_ID, '--scope', 'user']], dependencyCommands: [] },
    ])
    expect(confirmationText(plans[0]!).message).toContain(`${V1} → ${V2}`)
    expect(result).toMatchObject({ outcome: 'done', status: { state: { kind: 'installed', version: V2, enabled: true } } })
    expect(existsSync(join(sb.pluginDir, dropped))).toBe(false)
    expect(treeOf(sb.pluginDir)).toEqual(treeOf(v2))
    expect(commands()).toEqual([LIST, LIST, UPDATE_WORFY, LIST])
    expect(readdirSync(sb.harnessHome)).toEqual(['plugin'])
  })

  it('declined in the dialog: claude ran only the two reads, no file appeared in the sandbox, and the outcome is `declined`', async () => {
    const bundle = makeBundle(join(sb.root, 'bundle-v1'), V1)
    const before = filesWithTimes(sb.home)
    const result = await installer(bundle).install(() => Promise.resolve(false))
    // The list was read for the dialog, so the answer knows the dependency is missing.
    expect(result).toEqual({ outcome: 'declined', status: { state: { kind: 'not-installed' }, bundledVersion: V1, canInstall: true, pluginDir: sb.pluginDir, dependencies: dep('missing') } })
    expect(filesWithTimes(sb.home)).toEqual(before)
    expect(existsSync(sb.harnessHome)).toBe(false)
    expect(commands()).toEqual([LIST, MARKETPLACES])
    expect(stubState()).toEqual({ marketplaces: {}, plugins: {} })
  })

  it('two clicks at once run one install', async () => {
    const bundle = makeBundle(join(sb.root, 'bundle-v1'), V1)
    const subject = installer(bundle)
    let asked = 0
    const confirm = (): Promise<boolean> => {
      asked += 1
      return Promise.resolve(true)
    }
    const [first, second] = await Promise.all([subject.install(confirm), subject.install(confirm)])
    expect(asked).toBe(1)
    expect(second).toEqual(first)
    expect(commands().filter((command) => command === INSTALL_WORFY)).toHaveLength(1)
    expect(commands().filter((command) => command === INSTALL_DEP)).toHaveLength(1)
  })
})

// worfy-harness ticket 67: an older build opened after a newer one must not put its older Harness
// over the newer one. The version is `<semver>+<short SHA>[.dirty]` (scripts/build-version.ts).
describe('a Harness newer than the build, or one worfy cannot compare', () => {
  const NEWER = '0.3.0+ddddddd'
  const OLDER = '0.2.0+aaaaaaa'
  let warn: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })
  afterEach(() => {
    warn.mockRestore()
  })

  /** Installs `version` with a build of it, then sets the installed copy's manifest to `installed` when given (an unparseable version). */
  async function installedAs(version: string, installed?: string): Promise<void> {
    await installer(makeBundle(join(sb.root, `bundle-${version}`), version)).install(yes)
    if (installed !== undefined) {
      const manifest = join(sb.pluginDir, '.claude-plugin', 'plugin.json')
      writeFileSync(manifest, JSON.stringify({ ...(JSON.parse(readFileSync(manifest, 'utf8')) as object), version: installed }))
      setStubState((state) => {
        state.plugins[HARNESS_PLUGIN_ID] = installed
      })
    }
    clearCalls()
  }
  /** The version of the copy in the plugin folder alone, as a copy whose `plugin update` then failed leaves it. */
  const setFolderVersion = (version: string): void => {
    const manifest = join(sb.pluginDir, '.claude-plugin', 'plugin.json')
    writeFileSync(manifest, JSON.stringify({ ...(JSON.parse(readFileSync(manifest, 'utf8')) as object), version }))
  }
  /** The version Claude Code lists alone. */
  const setListedVersion = (version: string): void =>
    setStubState((state) => {
      state.plugins[HARNESS_PLUGIN_ID] = version
    })
  /** An install that records each plan it was shown and answers `answer`. */
  const recording = (plans: InstallPlan[], answer: boolean) => (plan: InstallPlan): Promise<boolean> => {
    plans.push(plan)
    return Promise.resolve(answer)
  }

  it.each([
    ['newer semver', '0.3.0+aaaaaaa', '0.2.0+bbbbbbb', 'newer'],
    ['newer major', '1.0.0+aaaaaaa', '0.9.9+bbbbbbb', 'newer'],
    ['numbers, not text', '0.10.0+aaaaaaa', '0.9.0+bbbbbbb', 'newer'],
    ['older semver', '0.2.0+aaaaaaa', '0.3.0+bbbbbbb', 'older'],
    ['older patch', '0.3.0+aaaaaaa', '0.3.1+bbbbbbb', 'older'],
    ['the same string', '0.3.0+aaaaaaa', '0.3.0+aaaaaaa', 'same'],
    ['the same semver, another commit', '0.3.0+aaaaaaa', '0.3.0+bbbbbbb', 'unordered'],
    ['the same commit, one of them dirty', '0.3.0+aaaaaaa.dirty', '0.3.0+aaaaaaa', 'unordered'],
    ['a plain semver installed', '0.3.0+aaaaaaa', '0.2.0', 'newer'],
    ['not a version', '0.3.0+aaaaaaa', 'banana', 'unknown'],
    ['a pre-release tag', '0.3.0+aaaaaaa', '0.4.0-beta+bbbbbbb', 'unknown'],
    ['an empty build version', '', '0.3.0+aaaaaaa', 'unknown'],
  ])('compareHarnessVersions: %s', (_name, build, installed, order) => {
    expect(compareHarnessVersions(build, installed)).toBe(order)
  })

  it('a newer Harness installed: no dialog, no copy, no `plugin update`; the state and the log say why', async () => {
    await installedAs(NEWER)
    const before = treeOf(sb.pluginDir)
    const older = makeBundle(join(sb.root, 'bundle-older'), OLDER)

    const status = await installer(older).status()
    expect(status.state).toMatchObject({ kind: 'error', step: 'copy' })
    const reason = (status.state as { reason: string }).reason
    expect(reason).toContain(`the installed Harness ${NEWER} is newer than this build's ${OLDER}`)
    expect(reason).toContain(`remove ${sb.pluginDir}, then Install`)
    // One line: Health shows the last line of the reason.
    expect(reason).not.toContain('\n')

    let asked = false
    const result = await installer(older).install(() => {
      asked = true
      return Promise.resolve(true)
    })
    expect(asked).toBe(false)
    expect(result).toMatchObject({ outcome: 'done', status: { state: { kind: 'error', step: 'copy', reason } } })
    expect(writes()).toEqual([])
    expect(commands()).not.toContain(UPDATE_WORFY)
    expect(treeOf(sb.pluginDir)).toEqual(before)
    expect(readdirSync(sb.harnessHome)).toEqual(['plugin'])
    expect(stubState().plugins[HARNESS_PLUGIN_ID]).toBe(NEWER)
    expect(warn).toHaveBeenCalledWith(`[harness] ${reason}`)
  })

  it('reading the state again does not log the same refusal again; an install does', async () => {
    await installedAs(NEWER)
    const subject = installer(makeBundle(join(sb.root, 'bundle-older'), OLDER))
    await subject.status()
    await subject.status()
    expect(warn).toHaveBeenCalledTimes(1)
    await subject.install(yes)
    expect(warn).toHaveBeenCalledTimes(2)
  })

  it('an installed version worfy cannot read as a build version is refused the same way, naming it', async () => {
    await installedAs(OLDER, 'banana')
    const before = treeOf(sb.pluginDir)
    const subject = installer(makeBundle(join(sb.root, 'bundle-newer'), NEWER))
    const result = await subject.install(yes)
    expect(result.status.state).toMatchObject({ kind: 'error', step: 'copy' })
    expect((result.status.state as { reason: string }).reason).toContain(`worfy cannot compare the installed Harness version "banana" with this build's ${NEWER}`)
    expect(writes()).toEqual([])
    expect(treeOf(sb.pluginDir)).toEqual(before)
  })

  it.each([
    ['the folder newer than the version Claude Code lists', (): void => setFolderVersion(NEWER)],
    ['the version Claude Code lists newer than the folder', (): void => setListedVersion(NEWER)],
  ])('%s: refused, no dialog and no writes', async (_name, newer) => {
    await installedAs(OLDER)
    newer()
    const before = treeOf(sb.pluginDir)
    const older = makeBundle(join(sb.root, 'bundle-older-again'), OLDER)
    expect((await installer(older).status()).state).toMatchObject({ kind: 'error', step: 'copy' })
    const plans: InstallPlan[] = []
    const result = await installer(older).install(recording(plans, true))
    expect(plans).toEqual([])
    expect(result.status.state).toMatchObject({ kind: 'error', step: 'copy' })
    expect((result.status.state as { reason: string }).reason).toContain(`the installed Harness ${NEWER} is newer than this build's ${OLDER}`)
    expect(writes()).toEqual([])
    expect(treeOf(sb.pluginDir)).toEqual(before)
  })

  it('a newer Harness installed and its dependency missing: no dependency install either, only the refusal', async () => {
    await installedAs(NEWER)
    setStubState((state) => {
      delete state.plugins[DEP]
    })
    const before = treeOf(sb.pluginDir)
    const older = makeBundle(join(sb.root, 'bundle-older'), OLDER, [DEP])
    expect((await installer(older).status()).state).toMatchObject({ kind: 'error', step: 'copy' })
    const plans: InstallPlan[] = []
    const result = await installer(older).install(recording(plans, true))
    expect(plans).toEqual([])
    expect((result.status.state as { reason: string }).reason).toContain(`the installed Harness ${NEWER} is newer than this build's ${OLDER}`)
    expect(commands()).not.toContain(INSTALL_DEP)
    expect(writes()).toEqual([])
    expect(treeOf(sb.pluginDir)).toEqual(before)
  })

  it('the way out the reason names: with the folder removed by hand, the dialog asks to install this older Harness in place of the newer one', async () => {
    await installedAs(NEWER)
    const older = makeBundle(join(sb.root, 'bundle-older'), OLDER)
    removeTestTree(sb.pluginDir)
    const plans: InstallPlan[] = []
    const result = await installer(older).install(recording(plans, true))
    expect(plans).toHaveLength(1)
    const text = confirmationText(plans[0]!)
    expect(text.message).toBe(`Install this build's older Harness ${OLDER} in place of ${NEWER}?`)
    expect(text.button).toBe('Install')
    expect(result.status.state).toEqual({ kind: 'installed', version: OLDER, enabled: true })
    expect(treeOf(sb.pluginDir)).toEqual(treeOf(older))
    expect(commands()).toContain(UPDATE_WORFY)
  })

  it('a newer copy an interrupted swap set aside (no plugin/, a .plugin-old-* folder) is refused too, naming that folder', async () => {
    await installedAs(NEWER)
    const aside = join(sb.harnessHome, '.plugin-old-interrupted')
    renameSync(sb.pluginDir, aside)
    const before = treeOf(aside)
    const older = makeBundle(join(sb.root, 'bundle-older'), OLDER)
    const status = await installer(older).status()
    expect(status.state).toMatchObject({ kind: 'error', step: 'copy' })
    expect((status.state as { reason: string }).reason).toContain(`remove ${aside}, then Install`)
    const plans: InstallPlan[] = []
    await installer(older).install(recording(plans, true))
    expect(plans).toEqual([])
    expect(writes()).toEqual([])
    expect(treeOf(aside)).toEqual(before)
    expect(existsSync(sb.pluginDir)).toBe(false)
  })

  it('a newer copy set aside after the plan was made is checked again once the copy puts it back: refused, the newer copy in place', async () => {
    await installedAs(NEWER)
    const newer = treeOf(sb.pluginDir)
    const kept = join(sb.root, 'kept-newer')
    renameSync(sb.pluginDir, kept)
    const older = makeBundle(join(sb.root, 'bundle-older'), OLDER)
    const result = await installer(older).install((): Promise<boolean> => {
      // Between the dialog and the copy, a swap of another run is left half way.
      renameSync(kept, join(sb.harnessHome, '.plugin-old-race'))
      return Promise.resolve(true)
    })
    expect(result.status.state).toMatchObject({ kind: 'error', step: 'copy' })
    expect((result.status.state as { reason: string }).reason).toContain(`the installed Harness ${NEWER} is newer than this build's ${OLDER}`)
    expect(treeOf(sb.pluginDir)).toEqual(newer)
    expect(commands()).not.toContain(UPDATE_WORFY)
  })

  it('the folder carries another commit of the same version and Claude Code has no record: the dialog asks to Replace, not to Install', async () => {
    const ours = '0.3.0+aaaaaaa'
    await installedAs(NEWER)
    setStubState((state) => {
      delete state.plugins[HARNESS_PLUGIN_ID]
    })
    const plans: InstallPlan[] = []
    await installer(makeBundle(join(sb.root, 'bundle-ours'), ours)).install(recording(plans, false))
    expect(plans.map(({ from, folder, copy }) => ({ from, folder, copy }))).toEqual([{ from: null, folder: NEWER, copy: true }])
    const text = confirmationText(plans[0]!)
    expect(text.button).toBe('Replace')
    expect(text.message).toBe(`Replace the worfy Harness ${NEWER} with ${ours}?`)
    expect(writes()).toEqual([])
  })

  it('a copy whose `plugin update` failed (the folder another commit, Claude Code still listing this build): the state and the dialog name the folder and say Replace', async () => {
    const ours = '0.3.0+aaaaaaa'
    await installedAs(ours)
    setFolderVersion(NEWER)
    const bundle = makeBundle(join(sb.root, 'bundle-ours-again'), ours)
    expect((await installer(bundle).status()).state).toEqual({ kind: 'outdated', from: NEWER, to: ours, sameVersion: true })
    const plans: InstallPlan[] = []
    await installer(bundle).install(recording(plans, false))
    expect(plans.map(({ from, folder, copy }) => ({ from, folder, copy }))).toEqual([{ from: ours, folder: NEWER, copy: true }])
    const text = confirmationText(plans[0]!)
    expect(text.message).toBe(`Replace the worfy Harness ${NEWER} with ${ours}?`)
    expect(text.message).not.toContain('→')
    expect(writes()).toEqual([])
  })

  it('the same semver from another commit: only through the dialog, which says worfy cannot tell which is newer; Cancel writes nothing', async () => {
    const other = '0.3.0+eeeeeee'
    await installedAs(NEWER)
    const before = treeOf(sb.pluginDir)
    const bundle = makeBundle(join(sb.root, 'bundle-other'), other)
    expect((await installer(bundle).status()).state).toEqual({ kind: 'outdated', from: NEWER, to: other, sameVersion: true })

    const plans: InstallPlan[] = []
    const declined = await installer(bundle).install((plan) => {
      plans.push(plan)
      return Promise.resolve(false)
    })
    expect(declined.outcome).toBe('declined')
    expect(writes()).toEqual([])
    expect(treeOf(sb.pluginDir)).toEqual(before)
    expect(plans).toHaveLength(1)
    const text = confirmationText(plans[0]!)
    expect(text.button).toBe('Replace')
    expect(text.message).toBe(`Replace the worfy Harness ${NEWER} with ${other}?`)
    expect(text.detail).toContain('Both carry version 0.3.0')
    expect(text.detail).toContain('worfy cannot tell which of them is newer')
    expect(text.message).not.toContain('Update')

    const accepted = await installer(bundle).install(yes)
    expect(accepted.status.state).toEqual({ kind: 'installed', version: other, enabled: true })
    expect(warn).not.toHaveBeenCalled()
  })
})

describe('a dependency that is missing', () => {
  it('worfy installed with the build version but its dependency not: the state is an error of `dependency install`, and install() asks with the dependency commands alone and brings it to installed', async () => {
    const bundle = makeBundle(join(sb.root, 'bundle-v1'), V1)
    await installer(bundle).install(yes)
    // Someone removed the dependency later; its marketplace is still known.
    setStubState((state) => {
      delete state.plugins[DEP]
    })
    clearCalls()

    const status = await installer(bundle).status()
    expect(status.state).toMatchObject({ kind: 'error', step: 'dependency install' })
    if (status.state.kind === 'error') expect(status.state.reason).toContain(DEP)
    expect(status.dependencies).toEqual(dep('missing'))
    expect(commands()).toEqual([LIST])
    clearCalls()

    const plans: InstallPlan[] = []
    const result = await installer(bundle).install((plan) => {
      plans.push(plan)
      return Promise.resolve(true)
    })
    expect(plans).toEqual([
      { pluginDir: sb.pluginDir, from: V1, folder: V1, to: V1, copy: false, dependencies: [DEP], dependencyCommands: [['plugin', 'install', DEP, '--scope', 'user']], commands: [], legacyHarness: null },
    ])
    const text = confirmationText(plans[0]!)
    expect(text.button).toBe('Install')
    expect(text.message).toContain(DEP)
    expect(text.detail).toContain(`claude ${INSTALL_DEP}`)
    expect(text.detail).not.toContain(HARNESS_PLUGIN_ID)
    expect(text.detail).not.toContain('copies the Harness')
    expect(result).toMatchObject({ outcome: 'done', status: { state: { kind: 'installed', version: V1, enabled: true }, dependencies: dep('installed') } })
    expect(commands()).toEqual([LIST, MARKETPLACES, INSTALL_DEP, LIST])
  })

  it('worfy installed by the installer of ticket 13 (no marketplace, no dependency): the plan adds the official marketplace and the dependency, nothing of worfy', async () => {
    const bundle = makeBundle(join(sb.root, 'bundle-v1'), V1)
    // What ticket 13 left: the copy, its marketplace and worfy, listed with "Dependency … is not installed".
    cpSync(bundle, sb.pluginDir, { recursive: true })
    setStubState((state) => {
      state.marketplaces[HARNESS_MARKETPLACE] = sb.pluginDir
      state.plugins[HARNESS_PLUGIN_ID] = V1
    })
    expect((await installer(bundle).status()).state).toMatchObject({ kind: 'error', step: 'dependency install' })
    clearCalls()
    const result = await installer(bundle).install(yes)
    expect(result.status.state).toEqual({ kind: 'installed', version: V1, enabled: true })
    expect(commands()).toEqual([LIST, MARKETPLACES, ADD_OFFICIAL, INSTALL_DEP, LIST])
  })

  it('together with another version: one dialog, the dependency first, then the copy and `plugin update`', async () => {
    await installer(makeBundle(join(sb.root, 'bundle-v1'), V1)).install(yes)
    setStubState((state) => {
      delete state.plugins[DEP]
    })
    const v2 = makeBundle(join(sb.root, 'bundle-v2'), V2)
    clearCalls()
    let asked = 0
    const result = await installer(v2).install(() => {
      asked += 1
      return Promise.resolve(true)
    })
    expect(asked).toBe(1)
    expect(result.status).toMatchObject({ state: { kind: 'installed', version: V2 }, dependencies: dep('installed') })
    expect(commands()).toEqual([LIST, MARKETPLACES, INSTALL_DEP, UPDATE_WORFY, LIST])
  })

  it.each([
    ['of another marketplace', 'x@someone-elses-marketplace'],
    ['without a marketplace in its name', 'x'],
  ])('a dependency %s is not installed by worfy: an error naming it, no dialog and no command that writes', async (_what, id) => {
    const bundle = makeBundle(join(sb.root, 'bundle-v1'), V1, [DEP, id])
    const before = filesWithTimes(sb.home)
    let asked = false
    const result = await installer(bundle).install(() => {
      asked = true
      return Promise.resolve(true)
    })
    expect(asked).toBe(false)
    expect(result.outcome).toBe('done')
    expect(result.status.state).toMatchObject({ kind: 'error', step: 'dependency install' })
    if (result.status.state.kind === 'error') {
      expect(result.status.state.reason).toContain(id)
      expect(result.status.state.reason).toContain(DEPENDENCY_MARKETPLACE)
    }
    expect(writes()).toEqual([])
    expect(filesWithTimes(sb.home)).toEqual(before)
    expect(stubState()).toEqual({ marketplaces: {}, plugins: {} })
  })

  it('a dependency of another marketplace that is already installed stops nothing', async () => {
    const other = 'x@someone-elses-marketplace'
    dependencyInstalled()
    setStubState((state) => {
      state.marketplaces['someone-elses-marketplace'] = 'someone/elses-marketplace'
      state.plugins[other] = '2.0.0'
    })
    const result = await installer(makeBundle(join(sb.root, 'bundle-v1'), V1, [DEP, other])).install(yes)
    expect(result.status.state).toEqual({ kind: 'installed', version: V1, enabled: true })
    expect(result.status.dependencies).toEqual([...dep('installed'), { id: other, status: 'installed', version: '2.0.0' }])
  })
})

describe('which marketplaces Claude Code knows', () => {
  it('a Claude Code without `plugin marketplace list`: the official marketplace is added every time', async () => {
    const env = { ...sb.env, STUB_CLAUDE_NO_MARKETPLACE_LIST: '1' }
    setStubState((state) => {
      state.marketplaces[DEPENDENCY_MARKETPLACE] = DEPENDENCY_MARKETPLACE_SOURCE
    })
    const bundle = makeBundle(join(sb.root, 'bundle-v1'), V1)
    const result = await installer(bundle, { env }).install(yes)
    expect(result.status.state).toEqual({ kind: 'installed', version: V1, enabled: true })
    expect(commands()).toEqual([LIST, MARKETPLACES, ADD_OFFICIAL, INSTALL_DEP, `plugin marketplace add ${sb.pluginDir}`, INSTALL_WORFY, LIST])
  })

  it('`marketplace add` answering "already added" with a non-zero exit is not an error', async () => {
    const env = { ...sb.env, STUB_CLAUDE_NO_MARKETPLACE_LIST: '1', STUB_CLAUDE_ADD_TWICE_FAILS: '1' }
    setStubState((state) => {
      state.marketplaces[DEPENDENCY_MARKETPLACE] = DEPENDENCY_MARKETPLACE_SOURCE
    })
    const result = await installer(makeBundle(join(sb.root, 'bundle-v1'), V1), { env }).install(yes)
    expect(result.status).toMatchObject({ state: { kind: 'installed', version: V1 }, dependencies: dep('installed') })
    expect(commands()).toContain(ADD_OFFICIAL)
  })

  it('`plugin marketplace list` printing something else than a list of names: the marketplace is added, and a failure of that says the list could not be read', async () => {
    // A stub in front of the stub: `marketplace list` prints an object, everything else goes through.
    const front = frontStub('claude-odd-list.mjs', `if (args.join(' ') === ${JSON.stringify(MARKETPLACES)}) {
  process.stdout.write('{"marketplaces":{}}\\n')
  process.exit(0)
}`)
    const bundle = makeBundle(join(sb.root, 'bundle-v1'), V1)
    const failing = await installer(bundle, { claude: front, env: { ...sb.env, STUB_CLAUDE_FAIL: ADD_OFFICIAL } }).install(yes)
    expect(failing.status.state).toMatchObject({ kind: 'error', step: 'dependency marketplace add' })
    if (failing.status.state.kind === 'error') {
      expect(failing.status.state.reason).toContain('failed: stub error')
      expect(failing.status.state.reason).toContain(`claude ${MARKETPLACES}`)
    }
    const result = await installer(bundle, { claude: front }).install(yes)
    expect(result.status.state).toEqual({ kind: 'installed', version: V1, enabled: true })
  })
})

describe('errors', () => {
  const tail = (reason: string): void => {
    // The last lines of stderr, not the first.
    expect(reason).toContain('failed: stub error')
    expect(reason).toContain('second line')
  }

  it('`marketplace add` of the official marketplace fails: an error of `dependency marketplace add` with the tail of stderr; no Harness copy, no command for worfy', async () => {
    const bundle = makeBundle(join(sb.root, 'bundle-v1'), V1)
    const result = await installer(bundle, { env: { ...sb.env, STUB_CLAUDE_FAIL: ADD_OFFICIAL } }).install(yes)
    expect(result.outcome).toBe('done')
    expect(result.status.state).toMatchObject({ kind: 'error', step: 'dependency marketplace add' })
    if (result.status.state.kind === 'error') tail(result.status.state.reason)
    expect(result.status.dependencies).toEqual(dep('missing'))
    expect(existsSync(sb.pluginDir)).toBe(false)
    expect(existsSync(sb.harnessHome)).toBe(false)
    expect(commands()).toEqual([LIST, MARKETPLACES, ADD_OFFICIAL])
    expect(stubState().plugins).toEqual({})
  })

  it('`install` of the dependency fails: an error of `dependency install`; no Harness copy, no command for worfy; the next try with a working claude installs everything and does not add the marketplace again', async () => {
    const bundle = makeBundle(join(sb.root, 'bundle-v1'), V1)
    const result = await installer(bundle, { env: { ...sb.env, STUB_CLAUDE_FAIL: INSTALL_DEP } }).install(yes)
    expect(result.status.state).toMatchObject({ kind: 'error', step: 'dependency install' })
    if (result.status.state.kind === 'error') tail(result.status.state.reason)
    expect(existsSync(sb.pluginDir)).toBe(false)
    expect(commands()).toEqual([LIST, MARKETPLACES, ADD_OFFICIAL, INSTALL_DEP])
    expect(stubState().plugins).toEqual({})
    clearCalls()

    const retry = await installer(bundle).install(yes)
    expect(retry.status).toMatchObject({ state: { kind: 'installed', version: V1, enabled: true }, dependencies: dep('installed') })
    expect(commands()).toEqual([LIST, MARKETPLACES, INSTALL_DEP, `plugin marketplace add ${sb.pluginDir}`, INSTALL_WORFY, LIST])
  })

  it('`marketplace add` of the Harness copy fails on a first install: an error naming `marketplace add`, and Claude Code lists no worfy', async () => {
    const bundle = makeBundle(join(sb.root, 'bundle-v1'), V1)
    const result = await installer(bundle, { env: { ...sb.env, STUB_CLAUDE_FAIL: `plugin marketplace add ${sb.pluginDir}` } }).install(yes)
    expect(result.status.state).toMatchObject({ kind: 'error', step: 'marketplace add' })
    if (result.status.state.kind === 'error') tail(result.status.state.reason)
    // The dependency went in before the failure; its version is read with the next `plugin list`.
    expect(result.status.dependencies).toEqual([{ id: DEP, status: 'installed', version: null }])
    expect(stubState().plugins).toEqual({ [DEP]: DEP_VERSION })
    expect(commands()).not.toContain(UNINSTALL_WORFY)
  })

  it('a first `install` of worfy that fails and records nothing: an error naming `install`; the list is read again and nothing is uninstalled', async () => {
    const bundle = makeBundle(join(sb.root, 'bundle-v1'), V1)
    const result = await installer(bundle, { env: { ...sb.env, STUB_CLAUDE_FAIL: INSTALL_WORFY } }).install(yes)
    expect(result.status.state).toMatchObject({ kind: 'error', step: 'install' })
    if (result.status.state.kind === 'error') {
      tail(result.status.state.reason)
      expect(result.status.state.reason).not.toContain('uninstall')
    }
    expect(commands().slice(-2)).toEqual([INSTALL_WORFY, LIST])
    expect(commands()).not.toContain(UNINSTALL_WORFY)
  })

  it('a first `install` of worfy that records the plugin and exits non-zero: worfy is uninstalled, Claude Code lists it no more, and the error names `install` and the removal', async () => {
    const bundle = makeBundle(join(sb.root, 'bundle-v1'), V1)
    const result = await installer(bundle, { env: { ...sb.env, STUB_CLAUDE_FAIL_AFTER: INSTALL_WORFY } }).install(yes)
    expect(result.outcome).toBe('done')
    expect(result.status.state).toMatchObject({ kind: 'error', step: 'install' })
    if (result.status.state.kind === 'error') {
      tail(result.status.state.reason)
      expect(result.status.state.reason).toContain(`claude ${UNINSTALL_WORFY}`)
      expect(result.status.state.reason).toContain('removed')
    }
    expect(commands().slice(-3)).toEqual([INSTALL_WORFY, LIST, UNINSTALL_WORFY])
    expect(stubState().plugins).toEqual({ [DEP]: DEP_VERSION })
    // Not half installed: the state read afresh is "not installed", and the next try installs.
    expect((await installer(bundle).status()).state).toEqual({ kind: 'not-installed' })
    expect((await installer(bundle).install(yes)).status.state).toEqual({ kind: 'installed', version: V1, enabled: true })
  })

  it('the same with `uninstall` failing too: an error naming `uninstall`, with the tails of both commands', async () => {
    const bundle = makeBundle(join(sb.root, 'bundle-v1'), V1)
    const result = await installer(bundle, { env: { ...sb.env, STUB_CLAUDE_FAIL_AFTER: INSTALL_WORFY, STUB_CLAUDE_FAIL: UNINSTALL_WORFY } }).install(yes)
    expect(result.status.state).toMatchObject({ kind: 'error', step: 'uninstall' })
    if (result.status.state.kind === 'error') {
      expect(result.status.state.reason).toContain(`${INSTALL_WORFY} failed: stub error`)
      expect(result.status.state.reason).toContain(`${UNINSTALL_WORFY} failed: stub error`)
    }
    expect(stubState().plugins).toMatchObject({ [HARNESS_PLUGIN_ID]: V1 })
  })

  it('the list cannot be read after a failed first `install`: the error names `install` and says the record was not checked', async () => {
    const bundle = makeBundle(join(sb.root, 'bundle-v1'), V1, [])
    // The first `plugin list` (before the dialog) answers; the one after the failed install does not.
    const mark = join(sb.root, 'stub', 'listed-once')
    const front = frontStub('claude-list-once.mjs', `if (args.join(' ') === ${JSON.stringify(LIST)}) {
  if (existsSync(${JSON.stringify(mark)})) {
    process.stderr.write('list broke\\n')
    process.exit(4)
  }
  writeFileSync(${JSON.stringify(mark)}, '')
}`)
    const result = await installer(bundle, { claude: front, env: { ...sb.env, STUB_CLAUDE_FAIL_AFTER: INSTALL_WORFY } }).install(yes)
    expect(result.status.state).toMatchObject({ kind: 'error', step: 'install' })
    if (result.status.state.kind === 'error') {
      expect(result.status.state.reason).toContain(`${INSTALL_WORFY} failed: stub error`)
      expect(result.status.state.reason).toContain('list broke')
    }
    expect(commands()).not.toContain(UNINSTALL_WORFY)
  })

  it('a non-zero exit of `claude plugin update` is an error naming `update`; the installed version is not uninstalled', async () => {
    await installer(makeBundle(join(sb.root, 'bundle-v1'), V1)).install(yes)
    const v2 = makeBundle(join(sb.root, 'bundle-v2'), V2)
    clearCalls()
    const result = await installer(v2, { env: { ...sb.env, STUB_CLAUDE_FAIL: 'plugin update' } }).install(yes)
    expect(result.status.state).toMatchObject({ kind: 'error', step: 'update' })
    if (result.status.state.kind === 'error') tail(result.status.state.reason)
    expect(commands()).toEqual([LIST, UPDATE_WORFY])
    expect(stubState().plugins).toEqual({ [DEP]: DEP_VERSION, [HARNESS_PLUGIN_ID]: V1 })
    // The copy is the new one; the next try only has to run `update`.
    expect(treeOf(sb.pluginDir)).toEqual(treeOf(v2))
    const retry = await installer(v2).install(yes)
    expect(retry.status.state).toEqual({ kind: 'installed', version: V2, enabled: true })
  })

  it('an `update` that records the new version and exits non-zero uninstalls nothing either', async () => {
    await installer(makeBundle(join(sb.root, 'bundle-v1'), V1)).install(yes)
    const v2 = makeBundle(join(sb.root, 'bundle-v2'), V2)
    const result = await installer(v2, { env: { ...sb.env, STUB_CLAUDE_FAIL_AFTER: 'plugin update' } }).install(yes)
    expect(result.status.state).toMatchObject({ kind: 'error', step: 'update' })
    expect(commands()).not.toContain(UNINSTALL_WORFY)
    expect(stubState().plugins).toMatchObject({ [HARNESS_PLUGIN_ID]: V2 })
  })

  it('a non-zero exit of `claude plugin list` is an error naming `plugin list`, in the state and in the action', async () => {
    const bundle = makeBundle(join(sb.root, 'bundle-v1'), V1)
    await installer(bundle).install(yes)
    const failing = installer(bundle, { env: { ...sb.env, STUB_CLAUDE_FAIL: 'plugin list' } })
    const status = await failing.status()
    expect(status.state).toMatchObject({ kind: 'error', step: 'plugin list' })
    if (status.state.kind === 'error') tail(status.state.reason)
    expect(status.dependencies).toEqual(dep('unchecked'))
    let asked = false
    const result = await failing.install(() => {
      asked = true
      return Promise.resolve(true)
    })
    expect(asked).toBe(false)
    expect(result.status.state).toMatchObject({ kind: 'error', step: 'plugin list' })
  })

  it('no Claude Code binary is an error of `plugin list` before the dialog, and nothing is written', async () => {
    const bundle = makeBundle(join(sb.root, 'bundle-v1'), V1)
    const missing = join(sb.root, 'nowhere', 'claude')
    let asked = false
    const confirm = (): Promise<boolean> => {
      asked = true
      return Promise.resolve(true)
    }
    const result = await installer(bundle, { claude: missing }).install(confirm)
    expect(result.status.state).toMatchObject({ kind: 'error', step: 'plugin list' })
    if (result.status.state.kind === 'error') expect(result.status.state.reason).toContain(missing)
    const none = await installer(bundle, { claude: undefined }).install(confirm)
    expect(none.status.state).toMatchObject({ kind: 'error', step: 'plugin list' })
    expect(asked).toBe(false)
    expect(existsSync(sb.harnessHome)).toBe(false)
  })

  it('a .mjs stand-in that is not there is "Claude Code not found" with its path, not the error of the Node that would run it', async () => {
    const missing = join(sb.root, 'nowhere', 'claude.mjs')
    const result = await installer(makeBundle(join(sb.root, 'bundle-v1'), V1), { claude: missing }).install(yes)
    expect(result.status.state).toMatchObject({ kind: 'error', step: 'plugin list' })
    if (result.status.state.kind === 'error') expect(result.status.state.reason).toContain(`Claude Code not found at ${missing} (ENOENT)`)
  })

  it('a plugin Claude Code reports broken for another reason is an error of `install` with that reason, not a quiet success', async () => {
    const bundle = makeBundle(join(sb.root, 'bundle-v1'), V1)
    const reason = 'hooks/hooks.json: unexpected token'
    const result = await installer(bundle, { env: { ...sb.env, STUB_CLAUDE_ERRORS: reason } }).install(yes)
    expect(result.status.state).toEqual({ kind: 'error', step: 'install', reason })
    expect(result.status.dependencies).toEqual(dep('installed'))
  })

  it('a copy that fails half way leaves the previous plugin folder byte for byte, and no staging folder behind', async () => {
    const v1 = makeBundle(join(sb.root, 'bundle-v1'), V1)
    await installer(v1).install(yes)
    const before = treeOf(sb.pluginDir)
    const v2 = makeBundle(join(sb.root, 'bundle-v2'), V2)
    clearCalls()
    const halfCopy = (from: string, to: string): Promise<void> => {
      mkdirSync(join(to, '.claude-plugin'), { recursive: true })
      cpSync(join(from, '.claude-plugin'), join(to, '.claude-plugin'), { recursive: true })
      return Promise.reject(new Error('disk full (injected)'))
    }
    const result = await installer(v2, { copyTree: halfCopy }).install(yes)
    expect(result.status.state).toMatchObject({ kind: 'error', step: 'copy' })
    if (result.status.state.kind === 'error') expect(result.status.state.reason).toContain('disk full (injected)')
    expect(treeOf(sb.pluginDir)).toEqual(before)
    expect(readdirSync(sb.harnessHome)).toEqual(['plugin'])
    expect(writes()).toEqual([])
  })

  it('a copy interrupted between its two renames (the old folder set aside, the new one not in place) gets the old folder back before the next copy', async () => {
    const v1 = makeBundle(join(sb.root, 'bundle-v1'), V1)
    await installer(v1).install(yes)
    const before = treeOf(sb.pluginDir)
    // What a crash after `rename(plugin, .plugin-old-X)` leaves: no plugin/, the previous copy aside, a staging folder.
    renameSync(sb.pluginDir, join(sb.harnessHome, '.plugin-old-crash'))
    mkdirSync(join(sb.harnessHome, '.plugin-new-crash'))
    const v2 = makeBundle(join(sb.root, 'bundle-v2'), V2)
    const failing = (): Promise<void> => Promise.reject(new Error('disk full (injected)'))
    const result = await installer(v2, { copyTree: failing }).install(yes)
    expect(result.status.state).toMatchObject({ kind: 'error', step: 'copy' })
    expect(treeOf(sb.pluginDir)).toEqual(before)
    expect(readdirSync(sb.harnessHome)).toEqual(['plugin'])
  })
})

// worfy-windows ticket 13: on Windows a rename of the plugin folder can fail with EPERM or EBUSY
// while an antivirus or another process holds a file in it. The renames are injected, so these run
// on any system with the platform given as win32.
describe('a rename refused by a held-open file (Windows)', () => {
  const heldOpen = (code: string): NodeJS.ErrnoException => Object.assign(new Error(`${code}: resource busy or locked, rename (injected)`), { code })
  /** A rename that refuses to put the new copy into place `times` times (every time with Infinity), then renames. */
  const refusingStaging = (code: string, times: number) => {
    const tries: string[] = []
    const renameDir = (from: string, to: string): Promise<void> => {
      const name = (path: string): string => path.slice(sb.harnessHome.length + 1).replace(/^(\.plugin-(?:new|old))-.*/, '$1-*')
      tries.push(`${name(from)} -> ${name(to)}`)
      if (from.includes('.plugin-new-') && tries.filter((each) => each.startsWith('.plugin-new-')).length <= times) return Promise.reject(heldOpen(code))
      renameSync(from, to)
      return Promise.resolve()
    }
    return { tries, renameDir }
  }

  it('EBUSY twice, then free: the rename is tried again and the new version is installed', async () => {
    await installer(makeBundle(join(sb.root, 'bundle-v1'), V1)).install(yes)
    const { tries, renameDir } = refusingStaging('EBUSY', 2)
    const result = await installer(makeBundle(join(sb.root, 'bundle-v2'), V2), { platform: 'win32', renameDir }).install(yes)
    expect(result.status.state).toMatchObject({ kind: 'installed', version: V2 })
    expect(tries).toEqual(['plugin -> .plugin-old-*', '.plugin-new-* -> plugin', '.plugin-new-* -> plugin', '.plugin-new-* -> plugin'])
    expect(readdirSync(sb.harnessHome)).toEqual(['plugin'])
  })

  it('EPERM until the retry time is over: an error of `copy` naming EPERM, the previous copy back in place byte for byte, no command for worfy', async () => {
    await installer(makeBundle(join(sb.root, 'bundle-v1'), V1)).install(yes)
    const before = treeOf(sb.pluginDir)
    clearCalls()
    const { tries, renameDir } = refusingStaging('EPERM', Infinity)
    const result = await installer(makeBundle(join(sb.root, 'bundle-v2'), V2), { platform: 'win32', renameDir, renameRetryMs: 50 }).install(yes)
    expect(result.status.state).toMatchObject({ kind: 'error', step: 'copy' })
    if (result.status.state.kind === 'error') expect(result.status.state.reason).toContain('EPERM')
    expect(tries.filter((each) => each === '.plugin-new-* -> plugin').length).toBeGreaterThan(1)
    expect(tries.at(-1)).toBe('.plugin-old-* -> plugin')
    expect(treeOf(sb.pluginDir)).toEqual(before)
    expect(readdirSync(sb.harnessHome)).toEqual(['plugin'])
    expect(writes()).toEqual([])
  })

  it('off Windows the same error is not tried again', async () => {
    await installer(makeBundle(join(sb.root, 'bundle-v1'), V1)).install(yes)
    const { tries, renameDir } = refusingStaging('EPERM', Infinity)
    const result = await installer(makeBundle(join(sb.root, 'bundle-v2'), V2), { platform: 'darwin', renameDir }).install(yes)
    expect(result.status.state).toMatchObject({ kind: 'error', step: 'copy' })
    expect(tries.filter((each) => each === '.plugin-new-* -> plugin')).toHaveLength(1)
  })

  const leftovers = (): string[] => readdirSync(sb.harnessHome).filter((name) => name !== 'plugin')
  /** A removal that a held-open file refuses for the folders `refused` names; others are removed. */
  const refusingRemove = (refused: (path: string) => boolean) => (path: string): Promise<void> => {
    if (refused(path)) return Promise.reject(heldOpen('EBUSY'))
    removeTestTree(path)
    return Promise.resolve()
  }

  it('the new copy in place but the previous one cannot be removed: installed all the same, the folder left for the next install to remove', async () => {
    await installer(makeBundle(join(sb.root, 'bundle-v1'), V1)).install(yes)
    const removeDir = refusingRemove((path) => path.includes('.plugin-old-'))
    const result = await installer(makeBundle(join(sb.root, 'bundle-v2'), V2), { platform: 'win32', removeDir, renameRetryMs: 50 }).install(yes)
    expect(result.status.state).toMatchObject({ kind: 'installed', version: V2 })
    expect(JSON.parse(readFileSync(join(sb.pluginDir, '.claude-plugin', 'plugin.json'), 'utf8'))).toMatchObject({ version: V2 })
    expect(leftovers()).toHaveLength(1)
    expect(leftovers()[0]).toMatch(/^\.plugin-old-/)
    // A newer build again: an older one would be refused before it looked at the leftovers (ticket 67).
    const v3 = '0.4.0+ccccccc'
    const next = await installer(makeBundle(join(sb.root, 'bundle-v3'), v3)).install(yes)
    expect(next.status.state).toMatchObject({ kind: 'installed', version: v3 })
    expect(leftovers()).toEqual([])
  })

  it('a leftover folder that cannot be removed is skipped: the install goes on and the folder stays', async () => {
    await installer(makeBundle(join(sb.root, 'bundle-v1'), V1)).install(yes)
    mkdirSync(join(sb.harnessHome, '.plugin-new-stuck'))
    const removeDir = refusingRemove((path) => path.endsWith('.plugin-new-stuck'))
    const result = await installer(makeBundle(join(sb.root, 'bundle-v2'), V2), { platform: 'win32', removeDir, renameRetryMs: 50 }).install(yes)
    expect(result.status.state).toMatchObject({ kind: 'installed', version: V2 })
    expect(leftovers()).toEqual(['.plugin-new-stuck'])
  })

  it('the new copy refused and the previous copy refused on its way back: the first error is reported with the second, no staging folder, the previous copy kept aside and put back by the next install', async () => {
    await installer(makeBundle(join(sb.root, 'bundle-v1'), V1)).install(yes)
    const before = treeOf(sb.pluginDir)
    clearCalls()
    let settingAside = true
    const renameDir = (from: string, to: string): Promise<void> => {
      // The first rename (plugin/ set aside) works; both renames into plugin/ are refused.
      if (settingAside) {
        settingAside = false
        renameSync(from, to)
        return Promise.resolve()
      }
      return Promise.reject(heldOpen(from.includes('.plugin-new-') ? 'EPERM' : 'EBUSY'))
    }
    const started = Date.now()
    const result = await installer(makeBundle(join(sb.root, 'bundle-v2'), V2), { platform: 'win32', renameDir, renameRetryMs: 50 }).install(yes)
    expect(Date.now() - started).toBeLessThan(10_000)
    expect(result.status.state).toMatchObject({ kind: 'error', step: 'copy' })
    if (result.status.state.kind === 'error') {
      expect(result.status.state.reason).toMatch(/failed: EPERM: .*; putting the previous copy back failed too \(EBUSY: /)
      expect(result.status.state.reason).toContain('the next install puts it back first')
    }
    expect(existsSync(sb.pluginDir)).toBe(false)
    expect(leftovers()).toHaveLength(1)
    expect(leftovers()[0]).toMatch(/^\.plugin-old-/)
    expect(treeOf(join(sb.harnessHome, leftovers()[0]!))).toEqual(before)
    expect(writes()).toEqual([])
    // The next install, with renames that work, puts the previous copy back before it copies.
    const failing = (): Promise<void> => Promise.reject(new Error('disk full (injected)'))
    await installer(makeBundle(join(sb.root, 'bundle-v2b'), V2), { copyTree: failing }).install(yes)
    expect(treeOf(sb.pluginDir)).toEqual(before)
    expect(leftovers()).toEqual([])
  })

  /** The renames and removals of one install, in order, with the folders named as `refusingStaging` names them. */
  const recorder = (refuse: (step: string) => string | null) => {
    const steps: string[] = []
    const name = (path: string): string => path.slice(sb.harnessHome.length + 1).replace(/^(\.plugin-(?:new|old))-.*/, '$1-*')
    const attempt = (step: string, operation: () => void): Promise<void> => {
      steps.push(step)
      const code = refuse(step)
      if (code !== null) return Promise.reject(heldOpen(code))
      operation()
      return Promise.resolve()
    }
    return {
      steps,
      renameDir: (from: string, to: string) => attempt(`rename ${name(from)} -> ${name(to)}`, () => renameSync(from, to)),
      removeDir: (path: string) => attempt(`remove ${name(path)}`, () => removeTestTree(path)),
    }
  }

  it('the new copy refused: the previous copy goes back into plugin/ before the staging folder is removed, as on main', async () => {
    await installer(makeBundle(join(sb.root, 'bundle-v1'), V1)).install(yes)
    const before = treeOf(sb.pluginDir)
    const { steps, renameDir, removeDir } = recorder((step) => (step === 'rename .plugin-new-* -> plugin' ? 'EPERM' : null))
    const result = await installer(makeBundle(join(sb.root, 'bundle-v2'), V2), { platform: 'win32', renameDir, removeDir, renameRetryMs: 50 }).install(yes)
    expect(result.status.state).toMatchObject({ kind: 'error', step: 'copy' })
    const back = steps.indexOf('rename .plugin-old-* -> plugin')
    const staging = steps.indexOf('remove .plugin-new-*')
    expect(back).toBeGreaterThan(-1)
    expect(staging).toBeGreaterThan(back)
    expect(treeOf(sb.pluginDir)).toEqual(before)
    expect(leftovers()).toEqual([])
  })

  it('the previous copy cannot be set aside: the step `copy` fails, plugin/ untouched, the staging folder removed', async () => {
    await installer(makeBundle(join(sb.root, 'bundle-v1'), V1)).install(yes)
    const before = treeOf(sb.pluginDir)
    clearCalls()
    const { steps, renameDir, removeDir } = recorder((step) => (step === 'rename plugin -> .plugin-old-*' ? 'EBUSY' : null))
    const result = await installer(makeBundle(join(sb.root, 'bundle-v2'), V2), { platform: 'win32', renameDir, removeDir, renameRetryMs: 50 }).install(yes)
    expect(result.status.state).toMatchObject({ kind: 'error', step: 'copy' })
    if (result.status.state.kind === 'error') expect(result.status.state.reason).toContain('EBUSY')
    expect(steps.filter((step) => step.startsWith('rename .plugin-new-*'))).toEqual([])
    expect(steps.at(-1)).toBe('remove .plugin-new-*')
    expect(treeOf(sb.pluginDir)).toEqual(before)
    expect(leftovers()).toEqual([])
    expect(writes()).toEqual([])
  })

  it('a first install whose new copy is refused: the step `copy` fails, no plugin/, the staging folder removed', async () => {
    const { steps, renameDir, removeDir } = recorder((step) => (step === 'rename .plugin-new-* -> plugin' ? 'EPERM' : null))
    const result = await installer(makeBundle(join(sb.root, 'bundle-v2'), V2), { platform: 'win32', renameDir, removeDir, renameRetryMs: 50 }).install(yes)
    expect(result.status.state).toMatchObject({ kind: 'error', step: 'copy' })
    expect(steps.filter((step) => step.includes('.plugin-old-'))).toEqual([])
    expect(steps.at(-1)).toBe('remove .plugin-new-*')
    expect(existsSync(sb.pluginDir)).toBe(false)
    expect(leftovers()).toEqual([])
  })

  it('an interrupted install left the only copy aside and it cannot be put back: removeLeftovers keeps it, never removes it', async () => {
    await installer(makeBundle(join(sb.root, 'bundle-v1'), V1)).install(yes)
    const before = treeOf(sb.pluginDir)
    // A crash between the two renames: no plugin/, the previous copy in .plugin-old-crash.
    renameSync(sb.pluginDir, join(sb.harnessHome, '.plugin-old-crash'))
    const { steps, renameDir, removeDir } = recorder((step) => (step === 'rename .plugin-old-* -> plugin' ? 'EBUSY' : null))
    await installer(makeBundle(join(sb.root, 'bundle-v2'), V2), { platform: 'win32', renameDir, removeDir, renameRetryMs: 50 }).install(yes)
    expect(steps).not.toContain('remove .plugin-old-*')
    expect(treeOf(join(sb.harnessHome, '.plugin-old-crash'))).toEqual(before)
  })

  it('the worst failure is bounded: the rename back and every staging removal stop after ROLLBACK_RETRY_MS, about 80 s in all', async () => {
    await installer(makeBundle(join(sb.root, 'bundle-v1'), V1)).install(yes)
    // A clock that moves 5 s at each attempt, so the 60 s and 10 s limits pass in a few real milliseconds.
    let offset = 0
    const realNow = Date.now.bind(Date)
    const { steps, renameDir, removeDir } = recorder((step) => {
      offset += 5000
      return step === 'rename plugin -> .plugin-old-*' ? null : 'EBUSY'
    })
    const spy = vi.spyOn(Date, 'now').mockImplementation(() => realNow() + offset)
    const result = await installer(makeBundle(join(sb.root, 'bundle-v2'), V2), { platform: 'win32', renameDir, removeDir })
      .install(yes)
      .finally(() => spy.mockRestore())
    expect(result.status.state).toMatchObject({ kind: 'error', step: 'copy' })
    const count = (step: string): number => steps.filter((each) => each === step).length
    // 60 s for the refused new copy (RENAME_RETRY_MS), then at most 10 s each for the rename back and the staging folder.
    expect(count('rename .plugin-new-* -> plugin')).toBeGreaterThanOrEqual(RENAME_RETRY_MS / 5000)
    expect(count('rename .plugin-old-* -> plugin')).toBeLessThanOrEqual(ROLLBACK_RETRY_MS / 5000 + 1)
    expect(count('remove .plugin-new-*')).toBeLessThanOrEqual(ROLLBACK_RETRY_MS / 5000 + 1)
    expect(offset).toBeLessThanOrEqual(RENAME_RETRY_MS + 2 * ROLLBACK_RETRY_MS + 4 * 5000)
  })
})

describe('the dev build', () => {
  it('offers the install only when packaged or with WORFY_CLAUDE_HOME', () => {
    expect(installOffered({ packaged: false, env: {} })).toBe(false)
    expect(installOffered({ packaged: false, env: { WORFY_CLAUDE_HOME: '' } })).toBe(false)
    expect(installOffered({ packaged: false, env: { WORFY_CLAUDE_HOME: '/tmp/sandbox' } })).toBe(true)
    expect(installOffered({ packaged: true, env: {} })).toBe(true)
  })

  it('without the offer shows the state and refuses the action before the dialog', async () => {
    const bundle = makeBundle(join(sb.root, 'bundle-v1'), V1)
    const subject = installer(bundle, { canInstall: false })
    expect(await subject.status()).toEqual({ state: { kind: 'not-installed' }, bundledVersion: V1, canInstall: false, pluginDir: sb.pluginDir, dependencies: dep('unchecked') })
    let asked = false
    await expect(
      subject.install(() => {
        asked = true
        return Promise.resolve(true)
      }),
    ).rejects.toThrow(/dev run/)
    expect(asked).toBe(false)
    expect(existsSync(sb.harnessHome)).toBe(false)
    expect(calls()).toEqual([])
  })
})

describe('the old Harness', () => {
  it('still in the Claude home: the plan names its epic-status, so the dialog warns that hooks run twice', async () => {
    mkdirSync(join(sb.claudeHome, 'bin'))
    writeFileSync(join(sb.claudeHome, 'bin', 'epic-status'), '#!/bin/sh\n', { mode: 0o755 })
    const plans: InstallPlan[] = []
    await installer(makeBundle(join(sb.root, 'bundle-v1'), V1)).install((plan) => {
      plans.push(plan)
      return Promise.resolve(false)
    })
    expect(plans.map((plan) => plan.legacyHarness)).toEqual([join(sb.claudeHome, 'bin', 'epic-status')])
    expect(confirmationText(plans[0]!).detail).toContain('run its hooks and the plugin')
  })
})

describe('the environment of the claude commands', () => {
  it('with WORFY_CLAUDE_HOME puts CLAUDE_CONFIG_DIR and HOME into the sandbox; without it leaves the environment as it is', () => {
    // The Claude home is resolved: `/tmp/…` stays as it is on macOS and Linux, and is `C:\tmp\…` on Windows.
    expect(claudeCommandEnv({ WORFY_CLAUDE_HOME: '/tmp/sb/home/.claude', HOME: '/Users/me', PATH: '/bin' })).toEqual({
      WORFY_CLAUDE_HOME: '/tmp/sb/home/.claude',
      HOME: resolve('/tmp/sb/home'),
      CLAUDE_CONFIG_DIR: resolve('/tmp/sb/home/.claude'),
      PATH: '/bin',
    })
    expect(claudeCommandEnv({ WORFY_CLAUDE_HOME: '/tmp/worfy-claude-x', HOME: '/Users/me' })).toMatchObject({ HOME: resolve('/tmp/worfy-claude-x'), CLAUDE_CONFIG_DIR: resolve('/tmp/worfy-claude-x') })
    const real = { HOME: '/Users/me', PATH: '/bin' }
    expect(claudeCommandEnv(real)).toBe(real)
  })
})

describe('the dialog', () => {
  const plan: InstallPlan = {
    pluginDir: '/Users/me/.claude/worfy-harness/plugin',
    from: null,
    folder: null,
    to: V1,
    copy: true,
    dependencies: [],
    dependencyCommands: [],
    commands: [
      ['plugin', 'marketplace', 'add', '/Users/me/.claude/worfy-harness/plugin'],
      ['plugin', 'install', HARNESS_PLUGIN_ID, '--scope', 'user'],
    ],
    legacyHarness: null,
  }
  const withDependency: InstallPlan = {
    ...plan,
    dependencies: [DEP],
    dependencyCommands: [
      ['plugin', 'marketplace', 'add', DEPENDENCY_MARKETPLACE_SOURCE],
      ['plugin', 'install', DEP, '--scope', 'user'],
    ],
  }

  it('names the folder, the commands and the versions', () => {
    const text = confirmationText(plan)
    // The plugin loads in place (ADR-0048): Sessions running in a terminal see the copy change.
    expect(text.detail).toContain('Restart them')
    expect(text.detail).not.toContain('old Harness')
    expect(confirmationText({ ...plan, copy: false }).detail).not.toContain('Restart them')
    const legacy = confirmationText({ ...plan, legacyHarness: '/Users/me/.claude/bin/epic-status' })
    expect(legacy.detail).toContain('The old Harness is still in ~/.claude (/Users/me/.claude/bin/epic-status')
    expect(text.button).toBe('Install')
    expect(text.message).toContain(V1)
    expect(text.detail).toContain('/Users/me/.claude/worfy-harness/plugin')
    expect(text.detail).toContain('claude plugin marketplace add /Users/me/.claude/worfy-harness/plugin')
    expect(text.detail).toContain(`claude plugin install ${HARNESS_PLUGIN_ID} --scope user`)
    const update = confirmationText({ ...plan, from: V1, to: V2, commands: [['plugin', 'update', HARNESS_PLUGIN_ID, '--scope', 'user']] })
    expect(update.button).toBe('Update')
    expect(update.message).toContain(`${V1} → ${V2}`)
  })

  it('without dependency commands says nothing of a dependency, a download or the official marketplace', () => {
    const text = confirmationText(plan)
    expect(text.detail).not.toContain('mattpocock-skills')
    expect(text.detail).not.toContain(DEPENDENCY_MARKETPLACE)
    expect(text.detail).not.toMatch(/download/i)
    expect(text.detail).toContain('Nothing else in ~/.claude changes.')
  })

  it('with dependency commands names them before the Harness commands, the download from GitHub and what Claude Code records; it does not tell the user to install anything by hand', () => {
    const text = confirmationText(withDependency)
    expect(text.message).toBe(`Install the worfy Harness ${V1}?`)
    const add = text.detail.indexOf(`claude ${ADD_OFFICIAL}`)
    const install = text.detail.indexOf(`claude ${INSTALL_DEP}`)
    const copy = text.detail.indexOf('copies the Harness')
    const worfy = text.detail.indexOf(`claude ${INSTALL_WORFY}`)
    expect(add).toBeGreaterThanOrEqual(0)
    expect(install).toBeGreaterThan(add)
    expect(copy).toBeGreaterThan(install)
    expect(worfy).toBeGreaterThan(copy)
    expect(text.detail).toContain(`downloads it from GitHub (${DEPENDENCY_MARKETPLACE_SOURCE})`)
    expect(text.detail).toContain('records the marketplace')
    expect(text.detail).not.toContain('Nothing is downloaded')
    expect(text.detail).not.toContain('install it with')
    // Only the commands worfy runs itself are in the text: each line starting with `claude` is one of the plan's.
    const lines = text.detail.split('\n').filter((line) => line.trim().startsWith('claude '))
    expect(lines.map((line) => line.trim())).toEqual([...withDependency.dependencyCommands, ...withDependency.commands].map((args) => `claude ${args.join(' ')}`))
  })

  it('with the marketplace already known says only that the plugin is recorded', () => {
    const text = confirmationText({ ...withDependency, dependencyCommands: [['plugin', 'install', DEP, '--scope', 'user']] })
    expect(text.detail).not.toContain('records the marketplace')
    expect(text.detail).toContain(`downloads it from GitHub (${DEPENDENCY_MARKETPLACE_SOURCE})`)
  })
})

describe('a Linked machine', () => {
  it('cannot start the install: `harness.install` and `firstRun.run` are local channels', () => {
    for (const channel of [harnessInstall, firstRunRun]) {
      expect(channel.access).toBe('local')
      expect(accessOf(channel.name)).toBe('local')
      expect(LINKED_MACHINE_ACCESS).not.toContain(accessOf(channel.name))
    }
    expect([harnessInstall.name, firstRunRun.name]).toEqual(['harness.install', 'firstRun.run'])
  })
})

/** The Claude Code binary of the SDK's platform package, the one the app runs: claude.exe on Windows. */
function sdkClaude(): string {
  const sdk = realpathSync(join(REPO, 'node_modules', '@anthropic-ai', 'claude-agent-sdk', 'package.json'))
  const dir = dirname(createRequire(sdk).resolve(`@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/package.json`))
  return join(dir, process.platform === 'win32' ? 'claude.exe' : 'claude')
}

describe('the Claude Code binary the installer runs', () => {
  it("is the packaged app's own in the packaged app", () => {
    const packaged = { packaged: true, resourcesPath: '/R', platform: 'darwin' as const, arch: 'arm64' }
    expect(bundledClaudeBinary(packaged)).toBe(claudeExecutablePath(packaged))
  })

  it.skipIf(process.platform !== 'darwin' && process.platform !== 'win32')("is the SDK's platform package in a dev run (macOS and Windows)", () => {
    const dev = { packaged: false, resourcesPath: '/R', platform: process.platform, arch: process.arch }
    expect(bundledClaudeBinary(dev)).toBe(sdkClaude())
    expect(existsSync(bundledClaudeBinary(dev) ?? '')).toBe(true)
    expect(bundledClaudeBinary({ ...dev, arch: 'no-such-arch' })).toBeUndefined()
  })
})

// The Harness copy here names no dependency: that binary must not reach for a remote marketplace
// from a test, so it runs the commands of the plugin `worfy` alone, all of them local. The
// dependency with that binary is checked by the acceptance run in a sandbox (worfy-harness ticket 26).
// On Windows (worfy-windows ticket 13) claude.exe gets every home-like folder inside the sandbox as
// well — USERPROFILE (what the home folder is there), APPDATA, LOCALAPPDATA, TEMP — so it cannot reach
// the real %USERPROFILE%\.claude; the plugin folder it is given is a C:\… path.
/** A bare environment for that binary: no variables of a parent Claude Code session, no network (closed proxy port). */
function sandboxClaudeEnv(): Record<string, string> {
  const offline = { HTTPS_PROXY: 'http://127.0.0.1:9', HTTP_PROXY: 'http://127.0.0.1:9', DISABLE_AUTOUPDATER: '1' }
  if (process.platform !== 'win32') return { PATH: '/usr/bin:/bin', HOME: sb.home, CLAUDE_CONFIG_DIR: sb.claudeHome, ...offline }
  const systemRoot = process.env.SystemRoot ?? 'C:\\Windows'
  const temp = join(sb.root, 'temp')
  for (const dir of [temp, join(sb.home, 'AppData', 'Roaming'), join(sb.home, 'AppData', 'Local')]) mkdirSync(dir, { recursive: true })
  return {
    SystemRoot: systemRoot,
    PATH: join(systemRoot, 'System32'),
    USERPROFILE: sb.home,
    HOME: sb.home,
    APPDATA: join(sb.home, 'AppData', 'Roaming'),
    LOCALAPPDATA: join(sb.home, 'AppData', 'Local'),
    TEMP: temp,
    TMP: temp,
    CLAUDE_CONFIG_DIR: sb.claudeHome,
    ...offline,
  }
}

describe.skipIf(process.platform !== 'darwin' && process.platform !== 'win32')('with the Claude Code binary of the SDK (macOS and Windows, local, a Harness copy without dependencies)', () => {
  it('installs worfy enabled with the build version, keeps the keys of settings.json, and the same commands again exit 0', async () => {
    const claude = sdkClaude()
    const env = sandboxClaudeEnv()
    const bundle = makeBundle(join(sb.root, 'bundle-v1'), V1, [])
    const plans: InstallPlan[] = []
    const result = await installer(bundle, { claude, env }).install((plan) => {
      plans.push(plan)
      return Promise.resolve(true)
    })
    expect(plans.map(({ dependencyCommands, commands: planned }) => ({ dependencyCommands, planned }))).toEqual([
      {
        dependencyCommands: [],
        planned: [
          ['plugin', 'marketplace', 'add', sb.pluginDir],
          ['plugin', 'install', HARNESS_PLUGIN_ID, '--scope', 'user'],
        ],
      },
    ])
    const run = (args: string[]): ReturnType<typeof spawnSync> => spawnSync(claude, args, { env, cwd: sb.root, encoding: 'utf8', timeout: 60_000 })

    const list = run(['plugin', 'list', '--json'])
    expect(list.status).toBe(0)
    const entry = (JSON.parse(String(list.stdout)) as { id: string; version: string; enabled: boolean; errors?: string[] }[]).find(({ id }) => id === HARNESS_PLUGIN_ID)
    expect(entry).toMatchObject({ id: HARNESS_PLUGIN_ID, version: V1, enabled: true })
    expect(result.status).toMatchObject({ state: { kind: 'installed', version: V1, enabled: true }, dependencies: [] })

    const settings = JSON.parse(readFileSync(join(sb.claudeHome, 'settings.json'), 'utf8')) as Record<string, unknown>
    expect(settings).toMatchObject({ theme: 'dark', model: expect.any(String) as unknown })
    expect(settings.enabledPlugins).toMatchObject({ [HARNESS_PLUGIN_ID]: true })

    for (const command of plans[0]!.commands) expect(run(command).status).toBe(0)
  }, 120_000)
})

describe('a .mjs Claude Code (WORFY_CLAUDE in tests)', () => {
  it('runs under worfy\'s own Node on every system: ELECTRON_RUN_AS_NODE reaches it, and Electron starts no second app', async () => {
    // sb.env has no ELECTRON_RUN_AS_NODE, so only the installer can have set it. Without it Electron
    // would still run the script, as the main script of a second app (process.type "browser").
    // `pnpm test` runs vitest in Electron (scripts/vitest-electron.mjs), so process.execPath, the
    // file the stub starts from, is Electron there; under plain Node the `type` check cannot fail.
    const runtime = join(sb.root, 'stub', 'runtime.jsonl')
    const result = await installer(makeBundle(join(sb.root, 'bundle-v1'), V1), { claude: join(sb.root, 'stub', 'claude-stub.mjs'), env: { ...sb.env, STUB_CLAUDE_RUNTIME: runtime } }).install(yes)
    expect(result.status.state).toMatchObject({ kind: 'installed', version: V1 })
    const lines = readFileSync(runtime, 'utf8').split('\n').filter((line) => line !== '')
    expect(lines.length).toBeGreaterThan(0)
    expect(new Set(lines)).toEqual(new Set([JSON.stringify({ runAsNode: '1', type: null })]))
  })
})
