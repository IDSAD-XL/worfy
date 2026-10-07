// worfy-harness ticket 13: worfy installs the Harness of its build as the Claude Code plugin `worfy`
// (ADR-0040, ADR-0048). Every case runs in a sandbox: HOME, CLAUDE_CONFIG_DIR and the Claude home
// worfy reads (WORFY_CLAUDE_HOME) all point into a temporary folder, never at the real ~/.claude.
// `claude` is a stub that logs its arguments and environment and keeps its own state outside the
// sandbox; the last case runs the Claude Code binary of the SDK on macOS.
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, relative, sep } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { bundledClaudeBinary, claudeExecutablePath } from '../../src/main/agent/options'
import {
  confirmationText,
  HARNESS_MARKETPLACE,
  HARNESS_PLUGIN_ID,
  HarnessInstaller,
  installOffered,
  type InstallerOptions,
  type InstallPlan,
} from '../../src/main/harness/install'
import { harnessHome } from '../../src/main/storage/paths'

const REPO = join(__dirname, '..', '..')
const V1 = '0.2.0+aaaaaaa'
const V2 = '0.2.0+bbbbbbb'

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
function makeBundle(target: string, version: string): string {
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
  writeFileSync(manifestPath, `${JSON.stringify({ name, version, ...rest }, null, 2)}\n`)
  return target
}

// The stub keeps Claude Code's side (known marketplace, installed version) in STUB_CLAUDE_STATE,
// outside the sandbox, so the sandbox shows only what worfy itself wrote.
const STUB = `
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
const args = process.argv.slice(2)
appendFileSync(process.env.STUB_CLAUDE_LOG, JSON.stringify({ args, HOME: process.env.HOME, CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR }) + '\\n')
const command = args.slice(0, args[1] === 'marketplace' ? 3 : 2).join(' ')
if (process.env.STUB_CLAUDE_FAIL === command) {
  process.stderr.write('first line of noise\\nsecond line\\n' + command + ' failed: stub error\\n')
  process.exit(3)
}
const statePath = process.env.STUB_CLAUDE_STATE
const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : { marketplace: null, installed: null }
const folderVersion = () => JSON.parse(readFileSync(join(state.marketplace, '.claude-plugin', 'plugin.json'), 'utf8')).version
if (command === 'plugin marketplace add') state.marketplace = args[3]
else if (command === 'plugin install' || command === 'plugin update') {
  if (state.marketplace === null) { process.stderr.write('marketplace not found\\n'); process.exit(1) }
  state.installed = folderVersion()
} else if (command === 'plugin list') {
  const errors = process.env.STUB_CLAUDE_ERRORS ? [process.env.STUB_CLAUDE_ERRORS] : []
  const list = state.installed === null ? [] : [{ id: '${HARNESS_PLUGIN_ID}', version: state.installed, scope: 'user', enabled: true, folderVersion: folderVersion(), errors }]
  process.stdout.write(JSON.stringify(list, null, 2) + '\\n')
}
writeFileSync(statePath, JSON.stringify(state))
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
  const stub = join(stubDir, 'claude')
  writeFileSync(stub, `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec "${process.execPath}" "${join(stubDir, 'claude-stub.mjs')}" "$@"\n`)
  chmodSync(stub, 0o755)
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
  rmSync(sb.root, { recursive: true, force: true })
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

function installer(bundle: string, options: Partial<InstallerOptions> = {}): HarnessInstaller {
  return new HarnessInstaller({ bundledDir: bundle, harnessHome: sb.harnessHome, claude: sb.stub, env: sb.env, canInstall: true, ...options })
}

const yes = (): Promise<boolean> => Promise.resolve(true)

describe('the state', () => {
  it('without <harnessHome>/plugin is "not installed", and reading it writes no file and runs no claude', async () => {
    const bundle = makeBundle(join(sb.root, 'bundle-v1'), V1)
    const before = filesWithTimes(sb.root)
    const status = await installer(bundle).status()
    expect(status).toEqual({ state: { kind: 'not-installed' }, bundledVersion: V1, canInstall: true, pluginDir: sb.pluginDir })
    expect(filesWithTimes(sb.root)).toEqual(before)
    expect(existsSync(sb.harnessHome)).toBe(false)
    expect(calls()).toEqual([])
  })
})

describe('installing', () => {
  it('copies the Harness of the build byte for byte, then registers the marketplace and installs worfy in the user scope', async () => {
    const bundle = makeBundle(join(sb.root, 'bundle-v1'), V1)
    const plans: InstallPlan[] = []
    const result = await installer(bundle).install((plan) => {
      plans.push(plan)
      return Promise.resolve(true)
    })
    expect(plans).toEqual([
      {
        pluginDir: sb.pluginDir,
        from: null,
        to: V1,
        copy: true,
        commands: [
          ['plugin', 'marketplace', 'add', sb.pluginDir],
          ['plugin', 'install', HARNESS_PLUGIN_ID, '--scope', 'user'],
        ],
        dependencies: ['mattpocock-skills@claude-plugins-official'],
      },
    ])
    expect(result).toEqual({ outcome: 'done', status: { state: { kind: 'installed', version: V1, enabled: true }, bundledVersion: V1, canInstall: true, pluginDir: sb.pluginDir } })

    expect(treeOf(sb.pluginDir)).toEqual(treeOf(bundle))
    expect(Object.keys(treeOf(sb.pluginDir))).toContain(join('.claude-plugin', 'marketplace.json'))
    expect(JSON.parse(readFileSync(join(sb.pluginDir, '.claude-plugin', 'plugin.json'), 'utf8'))).toMatchObject({ name: 'worfy', version: V1 })
    // The copy is the marketplace and the plugin at once (ADR-0048): the name the commands use.
    expect(JSON.parse(readFileSync(join(sb.pluginDir, '.claude-plugin', 'marketplace.json'), 'utf8'))).toMatchObject({
      name: HARNESS_MARKETPLACE,
      plugins: [{ name: 'worfy', source: './' }],
    })

    expect(commands()).toEqual([`plugin marketplace add ${sb.pluginDir}`, `plugin install ${HARNESS_PLUGIN_ID} --scope user`, 'plugin list --json'])
    for (const call of calls()) expect({ HOME: call.HOME, CLAUDE_CONFIG_DIR: call.CLAUDE_CONFIG_DIR }).toEqual({ HOME: sb.home, CLAUDE_CONFIG_DIR: sb.claudeHome })
    expect(HARNESS_PLUGIN_ID).toBe(`worfy@${HARNESS_MARKETPLACE}`)
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
    expect(commands().every((command) => command === 'plugin list --json')).toBe(true)
    expect(commands().length).toBeGreaterThan(0)
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

    expect((await installer(v2).status()).state).toEqual({ kind: 'outdated', from: V1, to: V2 })
    const plans: InstallPlan[] = []
    const result = await installer(v2).install((plan) => {
      plans.push(plan)
      return Promise.resolve(true)
    })
    expect(plans.map(({ from, to, copy, commands: planned }) => ({ from, to, copy, planned }))).toEqual([
      { from: V1, to: V2, copy: true, planned: [['plugin', 'update', HARNESS_PLUGIN_ID, '--scope', 'user']] },
    ])
    expect(confirmationText(plans[0]!).message).toContain(`${V1} → ${V2}`)
    expect(result).toMatchObject({ outcome: 'done', status: { state: { kind: 'installed', version: V2, enabled: true } } })
    expect(existsSync(join(sb.pluginDir, dropped))).toBe(false)
    expect(treeOf(sb.pluginDir)).toEqual(treeOf(v2))
    expect(commands()).toEqual(['plugin list --json', 'plugin list --json', `plugin update ${HARNESS_PLUGIN_ID} --scope user`, 'plugin list --json'])
    expect(readdirSync(sb.harnessHome)).toEqual(['plugin'])
  })

  it('declined in the dialog: nothing is written and claude does not run', async () => {
    const bundle = makeBundle(join(sb.root, 'bundle-v1'), V1)
    const before = filesWithTimes(sb.root)
    const result = await installer(bundle).install(() => Promise.resolve(false))
    expect(result).toEqual({ outcome: 'declined', status: { state: { kind: 'not-installed' }, bundledVersion: V1, canInstall: true, pluginDir: sb.pluginDir } })
    expect(filesWithTimes(sb.root)).toEqual(before)
    expect(existsSync(sb.harnessHome)).toBe(false)
    expect(calls()).toEqual([])
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
    expect(commands().filter((command) => command.startsWith('plugin install'))).toHaveLength(1)
  })
})

describe('errors', () => {
  const tail = (reason: string): void => {
    // The last lines of stderr, not the first.
    expect(reason).toContain('failed: stub error')
    expect(reason).toContain('second line')
  }

  it.each([
    ['marketplace add', 'plugin marketplace add'],
    ['install', 'plugin install'],
  ] as const)('a non-zero exit of `claude %s` on a first install is an error naming that step, with the tail of stderr', async (step, command) => {
    const bundle = makeBundle(join(sb.root, 'bundle-v1'), V1)
    const result = await installer(bundle, { env: { ...sb.env, STUB_CLAUDE_FAIL: command } }).install(yes)
    expect(result.outcome).toBe('done')
    expect(result.status.state).toMatchObject({ kind: 'error', step })
    if (result.status.state.kind === 'error') tail(result.status.state.reason)
  })

  it('a non-zero exit of `claude plugin update` is an error naming `update`', async () => {
    await installer(makeBundle(join(sb.root, 'bundle-v1'), V1)).install(yes)
    const v2 = makeBundle(join(sb.root, 'bundle-v2'), V2)
    const result = await installer(v2, { env: { ...sb.env, STUB_CLAUDE_FAIL: 'plugin update' } }).install(yes)
    expect(result.status.state).toMatchObject({ kind: 'error', step: 'update' })
    if (result.status.state.kind === 'error') tail(result.status.state.reason)
    // The copy is the new one; the next try only has to run `update`.
    expect(treeOf(sb.pluginDir)).toEqual(treeOf(v2))
    const retry = await installer(v2).install(yes)
    expect(retry.status.state).toEqual({ kind: 'installed', version: V2, enabled: true })
  })

  it('a non-zero exit of `claude plugin list` is an error naming `plugin list`, in the state and in the action', async () => {
    const bundle = makeBundle(join(sb.root, 'bundle-v1'), V1)
    await installer(bundle).install(yes)
    const failing = installer(bundle, { env: { ...sb.env, STUB_CLAUDE_FAIL: 'plugin list' } })
    const status = await failing.status()
    expect(status.state).toMatchObject({ kind: 'error', step: 'plugin list' })
    if (status.state.kind === 'error') tail(status.state.reason)
    let asked = false
    const result = await failing.install(() => {
      asked = true
      return Promise.resolve(true)
    })
    expect(asked).toBe(false)
    expect(result.status.state).toMatchObject({ kind: 'error', step: 'plugin list' })
  })

  it('no Claude Code binary is an error naming the step that needed it', async () => {
    const bundle = makeBundle(join(sb.root, 'bundle-v1'), V1)
    const missing = join(sb.root, 'nowhere', 'claude')
    const result = await installer(bundle, { claude: missing }).install(yes)
    expect(result.status.state).toMatchObject({ kind: 'error', step: 'marketplace add' })
    if (result.status.state.kind === 'error') expect(result.status.state.reason).toContain(missing)
    const none = await installer(bundle, { claude: undefined }).install(yes)
    expect(none.status.state).toMatchObject({ kind: 'error', step: 'plugin list' })
  })

  it('a plugin Claude Code reports broken (a missing dependency) is an error with its reason, not a quiet success', async () => {
    const bundle = makeBundle(join(sb.root, 'bundle-v1'), V1)
    const reason = 'Dependency "mattpocock-skills@claude-plugins-official" is not installed'
    const result = await installer(bundle, { env: { ...sb.env, STUB_CLAUDE_ERRORS: reason } }).install(yes)
    expect(result.status.state).toEqual({ kind: 'error', step: 'install', reason })
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
    expect(commands().filter((command) => command !== 'plugin list --json')).toEqual([])
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
    expect(await subject.status()).toEqual({ state: { kind: 'not-installed' }, bundledVersion: V1, canInstall: false, pluginDir: sb.pluginDir })
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

describe('the dialog', () => {
  it('names the folder, the commands, the versions and the dependency', () => {
    const plan: InstallPlan = {
      pluginDir: '/Users/me/.claude/worfy-harness/plugin',
      from: null,
      to: V1,
      copy: true,
      commands: [
        ['plugin', 'marketplace', 'add', '/Users/me/.claude/worfy-harness/plugin'],
        ['plugin', 'install', HARNESS_PLUGIN_ID, '--scope', 'user'],
      ],
      dependencies: ['mattpocock-skills@claude-plugins-official'],
    }
    const text = confirmationText(plan)
    expect(text.button).toBe('Install')
    expect(text.message).toContain(V1)
    expect(text.detail).toContain('/Users/me/.claude/worfy-harness/plugin')
    expect(text.detail).toContain('claude plugin marketplace add /Users/me/.claude/worfy-harness/plugin')
    expect(text.detail).toContain(`claude plugin install ${HARNESS_PLUGIN_ID} --scope user`)
    expect(text.detail).toContain('mattpocock-skills@claude-plugins-official')
    const update = confirmationText({ ...plan, from: V1, to: V2, commands: [['plugin', 'update', HARNESS_PLUGIN_ID, '--scope', 'user']] })
    expect(update.button).toBe('Update')
    expect(update.message).toContain(`${V1} → ${V2}`)
  })
})

/** The Claude Code binary of the SDK's platform package, the one the app runs. */
function sdkClaude(): string {
  const sdk = realpathSync(join(REPO, 'node_modules', '@anthropic-ai', 'claude-agent-sdk', 'package.json'))
  return join(dirname(createRequire(sdk).resolve(`@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/package.json`)), 'claude')
}

describe('the Claude Code binary the installer runs', () => {
  it("is the packaged app's own in the packaged app", () => {
    const packaged = { packaged: true, resourcesPath: '/R', platform: 'darwin' as const, arch: 'arm64' }
    expect(bundledClaudeBinary(packaged)).toBe(claudeExecutablePath(packaged))
  })

  it.skipIf(process.platform !== 'darwin')("is the SDK's platform package in a dev run (macOS)", () => {
    const dev = { packaged: false, resourcesPath: '/R', platform: process.platform, arch: process.arch }
    expect(bundledClaudeBinary(dev)).toBe(sdkClaude())
    expect(existsSync(bundledClaudeBinary(dev) ?? '')).toBe(true)
    expect(bundledClaudeBinary({ ...dev, arch: 'no-such-arch' })).toBeUndefined()
  })
})

describe.skipIf(process.platform !== 'darwin')('with the Claude Code binary of the SDK (macOS, local)', () => {
  it('installs worfy enabled with the build version, keeps the keys of settings.json, and the same commands again exit 0', async () => {
    const claude = sdkClaude()
    // A bare environment: no variables of a parent Claude Code session, no network (closed proxy port).
    const env = { PATH: '/usr/bin:/bin', HOME: sb.home, CLAUDE_CONFIG_DIR: sb.claudeHome, HTTPS_PROXY: 'http://127.0.0.1:9', HTTP_PROXY: 'http://127.0.0.1:9' }
    const bundle = makeBundle(join(sb.root, 'bundle-v1'), V1)
    const plans: InstallPlan[] = []
    const result = await installer(bundle, { claude, env }).install((plan) => {
      plans.push(plan)
      return Promise.resolve(true)
    })
    const run = (args: string[]): ReturnType<typeof spawnSync> => spawnSync(claude, args, { env, cwd: sb.root, encoding: 'utf8', timeout: 60_000 })

    const list = run(['plugin', 'list', '--json'])
    expect(list.status).toBe(0)
    const entry = (JSON.parse(String(list.stdout)) as { id: string; version: string; enabled: boolean; errors?: string[] }[]).find(({ id }) => id === HARNESS_PLUGIN_ID)
    expect(entry).toMatchObject({ id: HARNESS_PLUGIN_ID, version: V1, enabled: true })

    // Claude Code does not install the dependency from a marketplace it does not know (ADR-0048
    // does not cover it; the ticket's summary): worfy reports that, not a quiet success.
    if (entry?.errors !== undefined && entry.errors.length > 0) {
      expect(result.status.state).toMatchObject({ kind: 'error', step: 'install' })
      if (result.status.state.kind === 'error') expect(result.status.state.reason).toContain('mattpocock-skills@claude-plugins-official')
    } else {
      expect(result.status.state).toEqual({ kind: 'installed', version: V1, enabled: true })
    }

    const settings = JSON.parse(readFileSync(join(sb.claudeHome, 'settings.json'), 'utf8')) as Record<string, unknown>
    expect(settings).toMatchObject({ theme: 'dark', model: expect.any(String) as unknown })
    expect(settings.enabledPlugins).toMatchObject({ [HARNESS_PLUGIN_ID]: true })

    for (const command of plans[0]!.commands) expect(run(command).status).toBe(0)
  }, 120_000)
})
