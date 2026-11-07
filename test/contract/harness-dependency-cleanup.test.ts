// worfy-skills ticket 03: an update of the Harness removes a plugin an older Harness had worfy install
// as its dependency (mattpocock-skills@claude-plugins-official) — only when worfy installed it, by
// worfy's own record or by the window of 10 minutes before `worfy@worfy-harness` — and never a
// plugin the user installed (src/main/harness/dependency-cleanup.ts).
//
// Every case runs in a sandbox: the Claude home, the Harness home, CODEX_HOME and worfy's data folder
// are temporary folders. `claude` and `codex` are stand-ins (Node scripts the installer starts under
// worfy's own Node, src/main/program.ts) that log their arguments and keep their state, with each
// plugin's install time, outside the sandbox. The real Claude Code and the real Codex never run.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, sep } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CodexHarness } from '../../src/main/harness/codex-install'
import {
  claudeInstallsOf,
  DEPENDENCY_RECORD_FILE,
  INSTALL_WINDOW_MS,
  installedByWorfy,
  installTimeOf,
  readDependencyInstalls,
  RETIRED_DEPENDENCIES,
} from '../../src/main/harness/dependency-cleanup'
import { HARNESS_PLUGIN_ID, HarnessInstaller } from '../../src/main/harness/install'
import { harnessHome } from '../../src/main/storage/paths'
import { writeJsonFile } from '../../src/main/storage/json-file'
import { installHarnessAfterUpdate } from '../../src/main/update/harness-after-update'
import { restartFile, restartRecordSchema } from '../../src/main/update/restart'
import { updateStateFile } from '../../src/main/update/state'
import { accessOf, LINKED_MACHINE_ACCESS } from '../../src/shared/ipc/channels'
import { firstRunRun } from '../../src/shared/ipc/first-run'
import { harnessInstall, harnessStatusSchema } from '../../src/shared/ipc/harness'
import { removeTestTree } from '../remove'

const REPO = join(__dirname, '..', '..')
const V1 = '0.2.0+aaaaaaa'
const V2 = '0.3.0+bbbbbbb'
const V3 = '0.4.0+ccccccc'
/** The plugin an older Harness declared. */
const MP = 'mattpocock-skills@claude-plugins-official'
/** A dependency of a fixture copy: what the mechanism of ADR-0059 installs today. */
const EXAMPLE = 'example-skills@claude-plugins-official'
/** When `worfy` was first installed on the machine of a case. */
const WORFY_AT = Date.parse('2026-09-01T10:00:00.000Z')
const minutes = (n: number): number => n * 60_000
const iso = (time: number): string => new Date(time).toISOString()
const UNINSTALL_MP = `claude plugin uninstall ${MP} --scope user`
const UPDATE_WORFY = `claude plugin update ${HARNESS_PLUGIN_ID} --scope user`

// Claude Code 2.1.289: `plugin list --json` lists { id, version, scope, enabled, installedAt, lastUpdated, errors }
// (the SDK's binary); `plugin install` sets installedAt, `plugin update` keeps it. STUB_CLAUDE_FAIL: a
// command line prefix that exits 1 with an error on stderr.
const CLAUDE_STUB = `
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, isAbsolute, join } from 'node:path'
const args = process.argv.slice(2)
appendFileSync(process.env.STUB_LOG, ['claude', ...args].join(' ') + '\\n')
if ((process.env.STUB_CLAUDE_FAIL ?? '') !== '' && args.join(' ').startsWith(process.env.STUB_CLAUDE_FAIL)) {
  process.stderr.write('noise\\n' + args.join(' ') + ' failed: stub error\\n')
  process.exit(1)
}
const path = process.env.STUB_CLAUDE_STATE
const state = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : { marketplaces: {}, plugins: {} }
const manifest = (dir, file) => JSON.parse(readFileSync(join(dir, '.claude-plugin', file), 'utf8'))
const command = args.slice(0, args[1] === 'marketplace' ? 3 : 2).join(' ')
if (command === 'plugin marketplace list') process.stdout.write(JSON.stringify(Object.keys(state.marketplaces).map((name) => ({ name }))))
else if (command === 'plugin marketplace add') state.marketplaces[isAbsolute(args[3]) ? manifest(args[3], 'marketplace.json').name : basename(args[3])] = args[3]
else if (command === 'plugin install' || command === 'plugin update') {
  const source = state.marketplaces[args[2].split('@')[1]]
  const version = isAbsolute(source) ? manifest(source, 'plugin.json').version : '1.4.0'
  const now = new Date().toISOString()
  const before = state.plugins[args[2]]
  state.plugins[args[2]] = command === 'plugin update' && before ? { ...before, version, lastUpdated: now } : { version, installedAt: now, lastUpdated: now }
} else if (command === 'plugin uninstall') delete state.plugins[args[2]]
else if (command === 'plugin list') {
  process.stdout.write(JSON.stringify(Object.entries(state.plugins).map(([id, p]) => ({ id, version: p.version, scope: p.scope ?? 'user', enabled: true, errors: [], ...(p.installedAt === undefined ? {} : { installedAt: p.installedAt }) }))))
}
if (!command.endsWith(' list')) writeFileSync(path, JSON.stringify(state))
`

// Codex 0.166.0: \`plugin list --json\` prints { installed, available } (test/fixtures/codex-cli/), with no
// install time for a plugin of a local marketplace; a plugin given \`installedAt\` (Unix seconds) in the
// state is listed with it, as the app-server's PluginSummary has one for a remote plugin.
// \`plugin remove <id>\` uninstalls a plugin (its help text in the pinned binary). STUB_CODEX_FAIL as above.
const CODEX_STUB = `
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, isAbsolute, join } from 'node:path'
const args = process.argv.slice(2)
appendFileSync(process.env.STUB_LOG, ['codex', ...args].join(' ') + '\\n')
if ((process.env.STUB_CODEX_FAIL ?? '') !== '' && args.join(' ').startsWith(process.env.STUB_CODEX_FAIL)) {
  process.stderr.write(args.join(' ') + ' failed: stub error\\n')
  process.exit(3)
}
const path = process.env.STUB_CODEX_STATE
const state = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : { marketplaces: {}, plugins: {} }
const manifest = (dir, file) => JSON.parse(readFileSync(join(dir, file === 'plugin.json' && existsSync(join(dir, '.codex-plugin', file)) ? '.codex-plugin' : '.claude-plugin', file), 'utf8'))
const command = args.slice(0, args[1] === 'marketplace' ? 3 : 2).join(' ')
if (command === 'plugin marketplace list') process.stdout.write(JSON.stringify({ marketplaces: Object.entries(state.marketplaces).map(([name, root]) => ({ name, root })) }))
else if (command === 'plugin marketplace add') state.marketplaces[isAbsolute(args[3]) ? manifest(args[3], 'marketplace.json').name : basename(args[3])] = args[3]
else if (command === 'plugin add') {
  const source = state.marketplaces[args[2].split('@')[1]]
  const before = state.plugins[args[2]] ?? {}
  state.plugins[args[2]] = { ...before, version: isAbsolute(source) ? manifest(source, 'plugin.json').version : '1.4.0' }
} else if (command === 'plugin remove') delete state.plugins[args[2]]
else if (command === 'plugin list') {
  const installed = Object.entries(state.plugins).map(([pluginId, p]) => {
    const [name, marketplaceName] = pluginId.split('@')
    return { pluginId, name, marketplaceName, version: p.version, installed: true, enabled: true, ...(p.installedAt === undefined ? {} : { installedAt: p.installedAt }) }
  })
  process.stdout.write(JSON.stringify({ installed, available: [] }))
}
if (!command.endsWith(' list')) writeFileSync(path, JSON.stringify(state))
`

interface Plugin {
  version: string
  installedAt?: string | number
  scope?: string
}
interface StubState {
  marketplaces: Record<string, string>
  plugins: Record<string, Plugin>
}

let sb: {
  root: string
  claudeHome: string
  harnessHome: string
  pluginDir: string
  codexHome: string
  dataDir: string
  recordFile: string
  stubs: string
  log: string
  claudeState: string
  codexState: string
  env: Record<string, string | undefined>
}

beforeEach(() => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-dependency-cleanup-')))
  const claudeHome = join(root, 'home', '.claude')
  mkdirSync(claudeHome, { recursive: true })
  const codexHome = join(root, 'home', '.codex')
  mkdirSync(codexHome)
  const stubs = join(root, 'stubs')
  mkdirSync(stubs)
  writeFileSync(join(stubs, 'claude.mjs'), CLAUDE_STUB)
  writeFileSync(join(stubs, 'codex.mjs'), CODEX_STUB)
  const hHome = harnessHome({ WORFY_CLAUDE_HOME: claudeHome })
  const dataDir = join(root, 'data')
  sb = {
    root,
    claudeHome,
    harnessHome: hHome,
    pluginDir: join(hHome, 'plugin'),
    codexHome,
    dataDir,
    recordFile: join(dataDir, DEPENDENCY_RECORD_FILE),
    stubs,
    log: join(stubs, 'calls.log'),
    claudeState: join(stubs, 'claude-state.json'),
    codexState: join(stubs, 'codex-state.json'),
    env: { PATH: process.env.PATH, HOME: join(root, 'home'), CODEX_HOME: codexHome, STUB_LOG: join(stubs, 'calls.log'), STUB_CLAUDE_STATE: join(stubs, 'claude-state.json'), STUB_CODEX_STATE: join(stubs, 'codex-state.json') },
  }
})

afterEach(() => {
  removeTestTree(sb.root)
})

/** A Harness copy of `version` from harness/ (without its tests), declaring `dependencies`. */
function makeBundle(version: string, dependencies: string[] = []): string {
  const source = join(REPO, 'harness')
  const target = join(sb.root, `bundle-${version}-${dependencies.length}`)
  const tests = [join('bin', 'tests'), join('hooks', 'tests')]
  cpSync(source, target, {
    recursive: true,
    filter: (path) => {
      const inside = relative(source, path)
      return !path.endsWith(`${sep}.DS_Store`) && !tests.some((dir) => inside === dir || inside.startsWith(`${dir}${sep}`))
    },
  })
  const manifestPath = join(target, '.claude-plugin', 'plugin.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>
  writeFileSync(manifestPath, `${JSON.stringify({ ...manifest, version, dependencies }, null, 2)}\n`)
  return target
}

const codexHarness = (bundle: string): CodexHarness =>
  new CodexHarness({ bundledDir: bundle, pluginDir: sb.pluginDir, codex: join(sb.stubs, 'codex.mjs'), env: sb.env, codexHome: sb.codexHome, recordFile: join(sb.dataDir, 'harness-codex.json'), dependencyRecordFile: sb.recordFile })

function installer(bundle: string, { codex = false }: { codex?: boolean } = {}): HarnessInstaller {
  return new HarnessInstaller({
    bundledDir: bundle,
    harnessHome: sb.harnessHome,
    claude: join(sb.stubs, 'claude.mjs'),
    env: sb.env,
    canInstall: true,
    claudeHome: sb.claudeHome,
    dependencyRecordFile: sb.recordFile,
    ...(codex ? { codex: codexHarness(bundle) } : {}),
  })
}

const yes = (): Promise<boolean> => Promise.resolve(true)
const calls = (): string[] => (existsSync(sb.log) ? readFileSync(sb.log, 'utf8').split('\n').filter((line) => line !== '') : [])
const removals = (): string[] => calls().filter((line) => / plugin (uninstall|remove) /.test(line))
const readState = (file: string): StubState => JSON.parse(readFileSync(file, 'utf8')) as StubState
const writeState = (file: string, state: StubState): void => writeFileSync(file, JSON.stringify(state))

/**
 * A machine where `worfy` V1 was installed at WORFY_AT, and MP as `mp` says (undefined: not listed).
 * In Codex too when `codex` is given: worfy V1 there and MP as it says.
 */
function machine(mp: Plugin | undefined, codex?: { mp: Plugin | undefined; worfyAt?: number }): void {
  cpSync(makeBundle(V1), sb.pluginDir, { recursive: true })
  writeState(sb.claudeState, {
    marketplaces: { 'worfy-harness': sb.pluginDir, 'claude-plugins-official': 'anthropics/claude-plugins-official' },
    plugins: { [HARNESS_PLUGIN_ID]: { version: V1, installedAt: iso(WORFY_AT) }, ...(mp === undefined ? {} : { [MP]: mp }) },
  })
  if (codex === undefined) return
  writeState(sb.codexState, {
    marketplaces: { 'worfy-harness': sb.pluginDir, 'claude-plugins-official': 'anthropics/claude-plugins-official' },
    plugins: { [HARNESS_PLUGIN_ID]: { version: V1, ...(codex.worfyAt === undefined ? {} : { installedAt: codex.worfyAt }) }, ...(codex.mp === undefined ? {} : { [MP]: codex.mp }) },
  })
}

/** worfy's record, as an install of an older build with the record would have left it. */
function recorded(...installs: { id: string; vendor: 'claude' | 'codex' }[]): void {
  mkdirSync(sb.dataDir, { recursive: true })
  writeFileSync(sb.recordFile, JSON.stringify({ installs: installs.map((each) => ({ ...each, at: iso(WORFY_AT) })) }))
}

describe('the rule: did worfy install it', () => {
  const listed = (mp: number | null, worfy: number | null = WORFY_AT) =>
    new Map([
      [HARNESS_PLUGIN_ID, { installedAt: worfy }],
      [MP, { installedAt: mp }],
    ])

  it('only the plugin of the older Harness is retired', () => {
    expect(RETIRED_DEPENDENCIES).toEqual([MP])
    expect(INSTALL_WINDOW_MS).toBe(minutes(10))
  })

  it('the window: up to 10 minutes before worfy, and strictly before it', () => {
    expect(installedByWorfy(MP, 'claude', listed(WORFY_AT - minutes(2)), [], HARNESS_PLUGIN_ID)).toBe('window')
    expect(installedByWorfy(MP, 'claude', listed(WORFY_AT - minutes(10)), [], HARNESS_PLUGIN_ID)).toBe('window')
    expect(installedByWorfy(MP, 'claude', listed(WORFY_AT - minutes(10) - 1), [], HARNESS_PLUGIN_ID)).toBeNull()
    expect(installedByWorfy(MP, 'claude', listed(WORFY_AT), [], HARNESS_PLUGIN_ID)).toBeNull()
    expect(installedByWorfy(MP, 'claude', listed(WORFY_AT + minutes(1)), [], HARNESS_PLUGIN_ID)).toBeNull()
    expect(installedByWorfy(MP, 'claude', listed(null), [], HARNESS_PLUGIN_ID)).toBeNull()
    expect(installedByWorfy(MP, 'claude', listed(WORFY_AT - minutes(2), null), [], HARNESS_PLUGIN_ID)).toBeNull()
  })

  it("worfy's record of the same Vendor decides without the window; a record of the other Vendor does not count; nothing without the plugin listed", () => {
    const record = [{ id: MP, vendor: 'claude' as const, at: iso(WORFY_AT) }]
    expect(installedByWorfy(MP, 'claude', listed(null), record, HARNESS_PLUGIN_ID)).toBe('record')
    expect(installedByWorfy(MP, 'codex', listed(null), record, HARNESS_PLUGIN_ID)).toBeNull()
    expect(installedByWorfy(MP, 'claude', new Map([[HARNESS_PLUGIN_ID, { installedAt: WORFY_AT }]]), record, HARNESS_PLUGIN_ID)).toBeNull()
  })

  it('reads ISO times and Unix seconds; anything else is no time', () => {
    expect(installTimeOf('2026-09-01T10:00:00.000Z')).toBe(WORFY_AT)
    expect(installTimeOf(WORFY_AT / 1000)).toBe(WORFY_AT)
    for (const value of ['yesterday', '2026-13-45T99:00:00Z', '', null, undefined, 0, -5, Number.NaN, {}]) expect(installTimeOf(value)).toBeNull()
  })

  it("Claude Code's list: user scope only, and an id listed twice there has no time", () => {
    const at = iso(WORFY_AT)
    expect(claudeInstallsOf({})).toBeNull()
    expect(
      claudeInstallsOf([
        { id: 'a@m', scope: 'user', installedAt: at },
        { id: 'b@m', scope: 'project', installedAt: at },
        { id: 'c@m', scope: 'user', installedAt: at },
        { id: 'c@m', scope: 'user', installedAt: at },
      ]),
    ).toEqual(
      new Map([
        ['a@m', { installedAt: WORFY_AT }],
        ['c@m', { installedAt: null }],
      ]),
    )
  })
})

describe('Update Harness in Claude Code', () => {
  it('a dependency installed 2 minutes before worfy: exactly one `plugin uninstall … --scope user`, after the update of worfy; the marketplace stays; the result names the plugin and the command that puts it back', async () => {
    machine({ version: '1.4.0', installedAt: iso(WORFY_AT - minutes(2)) })
    const result = await installer(makeBundle(V2)).install(yes)
    expect(removals()).toEqual([UNINSTALL_MP])
    expect(calls().indexOf(UNINSTALL_MP)).toBeGreaterThan(calls().indexOf(UPDATE_WORFY))
    expect(calls().indexOf(UPDATE_WORFY)).toBeGreaterThan(-1)
    expect(calls().some((line) => line.includes('marketplace remove'))).toBe(false)
    expect(readState(sb.claudeState).plugins[MP]).toBeUndefined()
    expect(readState(sb.claudeState).marketplaces['claude-plugins-official']).toBe('anthropics/claude-plugins-official')
    expect(result.status.state).toEqual({ kind: 'installed', version: V2, enabled: true })
    expect(result.status.cleanup).toEqual([{ vendor: 'claude', id: MP, outcome: 'removed', text: expect.stringContaining(`To get it back: claude plugin install ${MP} --scope user`) as string }])
    expect(harnessStatusSchema.parse(result.status)).toEqual(result.status)
  })

  it('the install after an Update (no dialog) removes it the same way, after the update of worfy', async () => {
    machine({ version: '1.4.0', installedAt: iso(WORFY_AT - minutes(2)) })
    const dir = join(sb.dataDir, 'update')
    writeJsonFile(restartFile(dir), restartRecordSchema, { action: 'install', version: V2, sha: 'bbbbbbb', from: { sha: 'aaaaaaa', version: V1 }, harness: true, at: '2026-10-31T10:00:00.000Z' })
    const outcome = await installHarnessAfterUpdate({ dir, stateFile: updateStateFile(sb.dataDir), bundled: V2, installer: installer(makeBundle(V2)) })
    expect(outcome).toBe('installed')
    expect(removals()).toEqual([UNINSTALL_MP])
    expect(calls().indexOf(UNINSTALL_MP)).toBeGreaterThan(calls().indexOf(UPDATE_WORFY))
  })

  it.each([
    ['installed before the window (11 minutes before worfy)', { version: '1.4.0', installedAt: iso(WORFY_AT - minutes(11)) }],
    ['installed two months before worfy, as on the owner’s Mac', { version: '1.4.0', installedAt: iso(WORFY_AT - minutes(60 * 24 * 60)) }],
    ['installed after worfy', { version: '1.4.0', installedAt: iso(WORFY_AT + minutes(1)) }],
    ['installed at the same moment as worfy', { version: '1.4.0', installedAt: iso(WORFY_AT) }],
    ['listed without a date', { version: '1.4.0' }],
    ['with a date that does not read', { version: '1.4.0', installedAt: 'last Tuesday' }],
    ['in another scope only', { version: '1.4.0', installedAt: iso(WORFY_AT - minutes(2)), scope: 'project' }],
    ['not listed', undefined],
  ])('a dependency %s: no command removes anything, and the result names nothing', async (_name, mp) => {
    machine(mp)
    const result = await installer(makeBundle(V2)).install(yes)
    expect(result.status.state).toEqual({ kind: 'installed', version: V2, enabled: true })
    expect(removals()).toEqual([])
    expect(result.status.cleanup).toBeUndefined()
    if (mp !== undefined) expect(readState(sb.claudeState).plugins[MP]).toEqual(mp)
  })

  it('a first install (worfy not installed yet) never removes it, even installed by the user a minute before', async () => {
    writeState(sb.claudeState, { marketplaces: { 'claude-plugins-official': 'anthropics/claude-plugins-official' }, plugins: { [MP]: { version: '1.4.0', installedAt: iso(Date.now() - minutes(1)) } } })
    const result = await installer(makeBundle(V1)).install(yes)
    expect(result.status.state).toEqual({ kind: 'installed', version: V1, enabled: true })
    expect(removals()).toEqual([])
    expect(readState(sb.claudeState).plugins[MP]).toBeDefined()
  })

  it('an update of worfy that fails removes nothing: the plugin is never removed before worfy of this build is in place', async () => {
    machine({ version: '1.4.0', installedAt: iso(WORFY_AT - minutes(2)) })
    sb.env.STUB_CLAUDE_FAIL = 'plugin update'
    const result = await installer(makeBundle(V2)).install(yes)
    expect(result.status.state).toMatchObject({ kind: 'error', step: 'update' })
    expect(removals()).toEqual([])
  })

  it('a build that declares the plugin again never removes it', async () => {
    machine({ version: '1.4.0', installedAt: iso(WORFY_AT - minutes(2)) })
    await installer(makeBundle(V2, [MP])).install(yes)
    expect(removals()).toEqual([])
  })

  it('a failed `plugin uninstall`: the Harness is installed, the result has a line with the tail of stderr, and the next Update tries again', async () => {
    machine({ version: '1.4.0', installedAt: iso(WORFY_AT - minutes(2)) })
    sb.env.STUB_CLAUDE_FAIL = 'plugin uninstall'
    const first = await installer(makeBundle(V2)).install(yes)
    expect(first.outcome).toBe('done')
    expect(first.status.state).toEqual({ kind: 'installed', version: V2, enabled: true })
    expect(first.status.cleanup).toHaveLength(1)
    expect(first.status.cleanup?.[0]).toMatchObject({ vendor: 'claude', id: MP, outcome: 'failed' })
    expect(first.status.cleanup?.[0]?.text).toContain('the next Update tries again')
    expect(first.status.cleanup?.[0]?.text).toContain(`plugin uninstall ${MP} --scope user failed: stub error`)
    expect(readState(sb.claudeState).plugins[MP]).toBeDefined()

    delete sb.env.STUB_CLAUDE_FAIL
    const second = await installer(makeBundle(V3)).install(yes)
    expect(removals()).toEqual([UNINSTALL_MP, UNINSTALL_MP])
    expect(second.status.cleanup).toMatchObject([{ id: MP, outcome: 'removed' }])
    expect(readState(sb.claudeState).plugins[MP]).toBeUndefined()
  })

  it('is idempotent: the Update after a removal runs no removal and reads no list beyond its own', async () => {
    machine({ version: '1.4.0', installedAt: iso(WORFY_AT - minutes(2)) })
    await installer(makeBundle(V2)).install(yes)
    const before = calls().length
    const again = await installer(makeBundle(V3)).install(yes)
    expect(removals()).toEqual([UNINSTALL_MP])
    expect(again.status.cleanup).toBeUndefined()
    expect(calls().slice(before)).toEqual(['claude plugin list --json', UPDATE_WORFY, 'claude plugin list --json'])
  })
})

describe("worfy's record of its own dependency installs", () => {
  it('an install of a dependency from a fixture copy records it, in Claude Code and in Codex', async () => {
    const before = Date.now()
    await installer(makeBundle(V1, [EXAMPLE]), { codex: true }).install(yes)
    expect(calls()).toContain(`claude plugin install ${EXAMPLE} --scope user`)
    expect(calls()).toContain(`codex plugin add ${EXAMPLE}`)
    const installs = readDependencyInstalls(sb.recordFile)
    expect(installs.map(({ id, vendor }) => ({ id, vendor }))).toEqual([
      { id: EXAMPLE, vendor: 'claude' },
      { id: EXAMPLE, vendor: 'codex' },
    ])
    for (const { at } of installs) expect(Date.parse(at)).toBeGreaterThanOrEqual(before - 1000)
    // The record is worfy's own state: in its data folder, not in the Claude or the Codex home.
    expect(readdirSync(sb.dataDir).sort()).toEqual(['harness-codex.json', DEPENDENCY_RECORD_FILE].sort())
  })

  it('a plugin with worfy’s record is removed without the window, and its record goes with it', async () => {
    machine({ version: '1.4.0', installedAt: iso(WORFY_AT - minutes(60 * 24 * 60)) })
    recorded({ id: MP, vendor: 'claude' })
    const result = await installer(makeBundle(V2)).install(yes)
    expect(removals()).toEqual([UNINSTALL_MP])
    expect(result.status.cleanup).toMatchObject([{ id: MP, outcome: 'removed' }])
    expect(readDependencyInstalls(sb.recordFile)).toEqual([])
  })

  it('a record without the plugin in the list: nothing', async () => {
    machine(undefined)
    recorded({ id: MP, vendor: 'claude' })
    const result = await installer(makeBundle(V2)).install(yes)
    expect(removals()).toEqual([])
    expect(result.status.cleanup).toBeUndefined()
  })

  it('a record of Codex does not remove the plugin from Claude Code', async () => {
    machine({ version: '1.4.0' })
    recorded({ id: MP, vendor: 'codex' })
    await installer(makeBundle(V2)).install(yes)
    expect(removals()).toEqual([])
  })
})

describe('Update Harness in Codex (fake Codex, temporary CODEX_HOME)', () => {
  it('without an install time and without worfy’s record the plugin stays', async () => {
    machine(undefined, { mp: { version: '1.4.0' } })
    const result = await installer(makeBundle(V2), { codex: true }).install(yes)
    expect(calls()).toContain(`codex plugin add ${HARNESS_PLUGIN_ID}`)
    expect(removals()).toEqual([])
    expect(result.status.cleanup).toBeUndefined()
    expect(readState(sb.codexState).plugins[MP]).toBeDefined()
  })

  it('with worfy’s record: `codex plugin remove`, after `codex plugin add worfy@worfy-harness`; the result names the command that puts it back', async () => {
    machine(undefined, { mp: { version: '1.4.0' } })
    recorded({ id: MP, vendor: 'codex' })
    const result = await installer(makeBundle(V2), { codex: true }).install(yes)
    expect(removals()).toEqual([`codex plugin remove ${MP}`])
    expect(calls().indexOf(`codex plugin remove ${MP}`)).toBeGreaterThan(calls().indexOf(`codex plugin add ${HARNESS_PLUGIN_ID}`))
    expect(result.status.cleanup).toEqual([{ vendor: 'codex', id: MP, outcome: 'removed', text: expect.stringContaining(`To get it back: codex plugin add ${MP}`) as string }])
    expect(readState(sb.codexState).plugins[MP]).toBeUndefined()
  })

  it('with install times inside the window the same rule removes it; outside it, it stays', async () => {
    const seconds = (time: number): number => time / 1000
    machine(undefined, { mp: { version: '1.4.0', installedAt: seconds(WORFY_AT - minutes(2)) }, worfyAt: seconds(WORFY_AT) })
    await installer(makeBundle(V2), { codex: true }).install(yes)
    expect(removals()).toEqual([`codex plugin remove ${MP}`])

    machine(undefined, { mp: { version: '1.4.0', installedAt: seconds(WORFY_AT - minutes(30)) }, worfyAt: seconds(WORFY_AT) })
    await installer(makeBundle(V3), { codex: true }).install(yes)
    expect(removals()).toEqual([`codex plugin remove ${MP}`])
  })

  it('a first add of worfy to Codex removes nothing, even with worfy’s record', async () => {
    machine({ version: '1.4.0' })
    writeState(sb.codexState, { marketplaces: { 'claude-plugins-official': 'anthropics/claude-plugins-official' }, plugins: { [MP]: { version: '1.4.0' } } })
    recorded({ id: MP, vendor: 'codex' })
    const result = await installer(makeBundle(V2), { codex: true }).install(yes)
    expect(calls()).toContain(`codex plugin add ${HARNESS_PLUGIN_ID}`)
    expect(removals()).toEqual([])
    expect(result.status.codex?.state).toEqual({ kind: 'installed', version: V2 })
  })

  it('a failed `codex plugin remove` is a line of the result; the Harness in Codex stays installed', async () => {
    machine(undefined, { mp: { version: '1.4.0' } })
    recorded({ id: MP, vendor: 'codex' })
    sb.env.STUB_CODEX_FAIL = 'plugin remove'
    const result = await installer(makeBundle(V2), { codex: true }).install(yes)
    expect(result.status.codex?.state).toEqual({ kind: 'installed', version: V2 })
    expect(result.status.cleanup).toMatchObject([{ vendor: 'codex', id: MP, outcome: 'failed' }])
    expect(result.status.cleanup?.[0]?.text).toContain('failed: stub error')
  })
})

describe('a Linked machine', () => {
  it('cannot start a removal: the installs that run it are local channels, and nothing else in src/ reaches the module', () => {
    for (const channel of [harnessInstall, firstRunRun]) {
      expect(channel.access).toBe('local')
      expect(LINKED_MACHINE_ACCESS).not.toContain(accessOf(channel.name))
    }
    const importers: string[] = []
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name)
        if (entry.isDirectory()) walk(path)
        else if (/\.tsx?$/.test(entry.name) && /from '[./]+(harness\/)?dependency-cleanup'/.test(readFileSync(path, 'utf8'))) importers.push(relative(REPO, path).split(sep).join('/'))
      }
    }
    walk(join(REPO, 'src'))
    // install.ts and codex-install.ts run it inside HarnessInstaller.install(); ipc/harness.ts only names the record file.
    expect(importers.sort()).toEqual(['src/main/harness/codex-install.ts', 'src/main/harness/install.ts', 'src/main/ipc/harness.ts'])
  })
})
