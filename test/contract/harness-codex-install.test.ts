// worfy-multi-vendor ticket 35: Install Harness installs the same Harness folder into Codex as well
// (src/main/harness/codex-install.ts) — the local marketplace, the plugin `mattpocock-skills` as a
// plugin of its own, the version check — and writes the agents worfy-implementer, worfy-reviewer and
// worfy-scout as TOML only into <CODEX_HOME>/agents (src/main/harness/codex-agents.ts).
//
// Every case runs in a sandbox: the Claude home, the Harness home, CODEX_HOME and worfy's data folder
// are temporary folders. `claude` and `codex` are stand-ins (Node scripts the installer starts under
// worfy's own Node, src/main/program.ts) that log their arguments and keep their own state outside
// the sandbox, so the sandbox shows only what worfy itself wrote. The real Codex never runs.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, sep } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CODEX_AGENT_MARK, codexAgentFiles, writeCodexAgents } from '../../src/main/harness/codex-agents'
import { CodexHarness, codexInstallBinary, codexMarketplacesOf, codexPluginsOf, type CodexInstallerOptions } from '../../src/main/harness/codex-install'
import { confirmationText, DEPENDENCY_MARKETPLACE_SOURCE, HARNESS_PLUGIN_ID, HarnessInstaller, type InstallPlan } from '../../src/main/harness/install'
import { harnessHome } from '../../src/main/storage/paths'
import { harnessStatusSchema } from '../../src/shared/ipc/harness'
import { removeTestTree } from '../remove'

const REPO = join(__dirname, '..', '..')
const FIXTURES = join(REPO, 'test', 'fixtures', 'codex-agents')
const V1 = '0.2.0+aaaaaaa'
const V2 = '0.3.0+bbbbbbb'
const DEP = 'mattpocock-skills@claude-plugins-official'
const AGENT_FILES = ['worfy-implementer.toml', 'worfy-reviewer.toml', 'worfy-scout.toml']

// Claude Code's side, as much of it as an install that succeeds needs (the full stand-in is
// test/contract/harness-install.test.ts): marketplaces, plugins with their versions.
const CLAUDE_STUB = `
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, isAbsolute, join } from 'node:path'
const args = process.argv.slice(2)
appendFileSync(process.env.STUB_LOG, JSON.stringify(['claude', ...args]) + '\\n')
if ((process.env.STUB_CLAUDE_FAIL ?? '') !== '' && args.join(' ').startsWith(process.env.STUB_CLAUDE_FAIL)) {
  process.stderr.write('claude failed: stub error\\n')
  process.exit(3)
}
const path = process.env.STUB_CLAUDE_STATE
const state = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : { marketplaces: {}, plugins: {} }
const manifest = (dir, file) => JSON.parse(readFileSync(join(dir, '.claude-plugin', file), 'utf8'))
const command = args.slice(0, args[1] === 'marketplace' ? 3 : 2).join(' ')
if (command === 'plugin marketplace list') process.stdout.write(JSON.stringify(Object.keys(state.marketplaces).map((name) => ({ name }))))
else if (command === 'plugin marketplace add') state.marketplaces[isAbsolute(args[3]) ? manifest(args[3], 'marketplace.json').name : basename(args[3])] = args[3]
else if (command === 'plugin install' || command === 'plugin update') {
  const source = state.marketplaces[args[2].split('@')[1]]
  state.plugins[args[2]] = isAbsolute(source) ? manifest(source, 'plugin.json').version : '1.4.0'
} else if (command === 'plugin list') process.stdout.write(JSON.stringify(Object.entries(state.plugins).map(([id, version]) => ({ id, version, enabled: true, errors: [] }))))
writeFileSync(path, JSON.stringify(state))
`

// Codex's side. Its answers follow the pinned Codex 0.166.0 as far as its help texts tell
// (\`codex plugin list --json\`, \`codex plugin marketplace add|list\`, \`codex plugin add\`): a list of
// marketplaces with their plugins. What a test can ask of it:
//   STUB_CODEX_FAIL           a command line prefix that exits 3 with an error on stderr
//   STUB_CODEX_LOCAL_VERSION  a plugin of a local marketplace is listed with the version "local"
//   STUB_CODEX_STATE          the file of its state ({ marketplaces, plugins }), outside the sandbox
const CODEX_STUB = `
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, isAbsolute, join } from 'node:path'
const args = process.argv.slice(2)
appendFileSync(process.env.STUB_LOG, JSON.stringify(['codex', ...args]) + '\\n')
appendFileSync(process.env.STUB_CODEX_HOMES, JSON.stringify(process.env.CODEX_HOME ?? null) + '\\n')
if ((process.env.STUB_CODEX_FAIL ?? '') !== '' && args.join(' ').startsWith(process.env.STUB_CODEX_FAIL)) {
  process.stderr.write('noise\\n' + args.join(' ') + ' failed: stub error\\n')
  process.exit(3)
}
const path = process.env.STUB_CODEX_STATE
const state = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : { marketplaces: {}, plugins: {} }
const manifest = (dir, file) => JSON.parse(readFileSync(join(dir, '.claude-plugin', file), 'utf8'))
const command = args.slice(0, args[1] === 'marketplace' ? 3 : 2).join(' ')
if (command === 'plugin marketplace list') {
  process.stdout.write(JSON.stringify({ marketplaces: Object.entries(state.marketplaces).map(([name, source]) => ({ name, path: source })) }))
} else if (command === 'plugin marketplace add') {
  const name = isAbsolute(args[3]) ? manifest(args[3], 'marketplace.json').name : basename(args[3])
  if (name in state.marketplaces) process.stdout.write('Marketplace \`' + name + '\` is already added.\\n')
  else {
    state.marketplaces[name] = args[3]
    process.stdout.write('Added marketplace \`' + name + '\` from ' + args[3] + '\\n')
  }
} else if (command === 'plugin add') {
  const [name, market] = args[2].split('@')
  const source = state.marketplaces[market]
  if (source === undefined) {
    process.stderr.write('marketplace ' + market + ' not found\\n')
    process.exit(1)
  }
  const local = isAbsolute(source)
  state.plugins[args[2]] = local ? (process.env.STUB_CODEX_LOCAL_VERSION ? 'local' : manifest(source, 'plugin.json').version) : '1.4.0'
  process.stdout.write('Added plugin \`' + name + '\` from marketplace \`' + market + '\`\\n')
} else if (command === 'plugin list') {
  const marketplaces = Object.keys(state.marketplaces).map((market) => ({
    name: market,
    plugins: Object.entries(state.plugins)
      .filter(([id]) => id.endsWith('@' + market))
      .map(([id, version]) => ({ id, name: id.split('@')[0], localVersion: version, installed: true, enabled: true })),
  }))
  process.stdout.write(JSON.stringify({ marketplaces }))
}
writeFileSync(path, JSON.stringify(state))
`

interface Sandbox {
  root: string
  claudeHome: string
  harnessHome: string
  pluginDir: string
  codexHome: string
  dataDir: string
  stubs: string
  log: string
  env: Record<string, string | undefined>
}

let sb: Sandbox

beforeEach(() => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-harness-codex-')))
  const sandbox = join(root, 'sandbox')
  const claudeHome = join(sandbox, 'home', '.claude')
  mkdirSync(claudeHome, { recursive: true })
  const codexHome = join(sandbox, 'home', '.codex')
  mkdirSync(codexHome)
  const stubs = join(root, 'stubs')
  mkdirSync(stubs)
  writeFileSync(join(stubs, 'claude.mjs'), CLAUDE_STUB)
  writeFileSync(join(stubs, 'codex.mjs'), CODEX_STUB)
  const hHome = harnessHome({ WORFY_CLAUDE_HOME: claudeHome })
  sb = {
    root,
    claudeHome,
    harnessHome: hHome,
    pluginDir: join(hHome, 'plugin'),
    codexHome,
    dataDir: join(sandbox, 'data'),
    stubs,
    log: join(stubs, 'calls.jsonl'),
    env: {
      PATH: process.env.PATH,
      HOME: join(sandbox, 'home'),
      CODEX_HOME: codexHome,
      STUB_LOG: join(stubs, 'calls.jsonl'),
      STUB_CODEX_HOMES: join(stubs, 'codex-homes.jsonl'),
      STUB_CLAUDE_STATE: join(stubs, 'claude-state.json'),
      STUB_CODEX_STATE: join(stubs, 'codex-state.json'),
    },
  }
})

afterEach(() => {
  removeTestTree(sb.root)
})

/** A Harness copy of `version` from harness/ (without its tests), with the agents of `agents` when given. */
function makeBundle(name: string, version: string, agents?: string): string {
  const source = join(REPO, 'harness')
  const target = join(sb.root, name)
  const tests = [join('bin', 'tests'), join('hooks', 'tests')]
  cpSync(source, target, {
    recursive: true,
    filter: (path) => {
      const inside = relative(source, path)
      return !path.endsWith(`${sep}.DS_Store`) && !tests.some((dir) => inside === dir || inside.startsWith(`${dir}${sep}`))
    },
  })
  const manifestPath = join(target, '.claude-plugin', 'plugin.json')
  const { name: plugin, ...rest } = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>
  writeFileSync(manifestPath, `${JSON.stringify({ name: plugin, version, ...rest }, null, 2)}\n`)
  if (agents !== undefined) {
    removeTestTree(join(target, 'agents'))
    cpSync(agents, join(target, 'agents'), { recursive: true })
  }
  return target
}

function codexHarness(bundle: string, options: Partial<CodexInstallerOptions> = {}): CodexHarness {
  return new CodexHarness({
    bundledDir: bundle,
    pluginDir: sb.pluginDir,
    codex: join(sb.stubs, 'codex.mjs'),
    env: sb.env,
    codexHome: sb.codexHome,
    recordFile: join(sb.dataDir, 'harness-codex.json'),
    ...options,
  })
}

/** The installer of both; `null` — one without Codex. */
function installer(bundle: string, codex: CodexHarness | null = codexHarness(bundle)): HarnessInstaller {
  return new HarnessInstaller({
    bundledDir: bundle,
    harnessHome: sb.harnessHome,
    claude: join(sb.stubs, 'claude.mjs'),
    env: sb.env,
    canInstall: true,
    claudeHome: sb.claudeHome,
    ...(codex === null ? {} : { codex }),
  })
}

const calls = (): string[] =>
  existsSync(sb.log)
    ? readFileSync(sb.log, 'utf8')
        .trim()
        .split('\n')
        .filter((line) => line !== '')
        .map((line) => (JSON.parse(line) as string[]).join(' '))
    : []
const codexCalls = (): string[] => calls().filter((line) => line.startsWith('codex '))
const clearCalls = (): void => rmSync(sb.log, { force: true })

/** Every file under `dir`, relative to it, with its size and modification time. */
function files(dir: string): Record<string, string> {
  const out: Record<string, string> = {}
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir, { recursive: true }) as string[]) {
    const path = join(dir, name)
    const stat = statSync(path)
    if (stat.isFile()) out[name.split(sep).join('/')] = `${String(stat.size)}:${String(stat.mtimeMs)}`
  }
  return out
}

/** The expected agent file of the fixtures, filled in. */
const expected = (name: string, version: string): string =>
  readFileSync(join(FIXTURES, 'expected', name), 'utf8')
    .replace(/\r\n/g, '\n')
    .split('<PLUGIN_DIR_ESCAPED>')
    .join(JSON.stringify(sb.pluginDir).slice(1, -1))
    .split('<PLUGIN_DIR>')
    .join(sb.pluginDir)
    .split('<VERSION>')
    .join(version)

const yes = (plans: InstallPlan[] = []) => (plan: InstallPlan): Promise<boolean> => {
  plans.push(plan)
  return Promise.resolve(true)
}

describe('Install Harness in Codex', () => {
  it('a first install puts the plugin, its dependency and the agents into Codex after Claude Code, and writes nothing else', async () => {
    const bundle = makeBundle('bundle', V1, join(FIXTURES, 'agents'))
    const repoCodex = existsSync(join(REPO, '.codex'))
    const plans: InstallPlan[] = []

    const { outcome, status } = await installer(bundle).install(yes(plans))

    expect(outcome).toBe('done')
    expect(harnessStatusSchema.parse(status)).toEqual(status)
    expect(status.state).toEqual({ kind: 'installed', version: V1, enabled: true })
    expect(status.codex).toEqual({ state: { kind: 'installed', version: V1 }, agentsDir: join(sb.codexHome, 'agents'), hooksToApprove: true })
    // Codex after Claude Code, from the same folder; the dependency is a plugin of its own, first.
    const claudeDone = calls().lastIndexOf(`claude plugin install ${HARNESS_PLUGIN_ID} --scope user`)
    expect(claudeDone).toBeGreaterThan(-1)
    expect(calls().slice(claudeDone + 1).filter((line) => !line.endsWith('list --json'))).toEqual([
      `codex plugin marketplace add ${DEPENDENCY_MARKETPLACE_SOURCE}`,
      `codex plugin add ${DEP}`,
      `codex plugin marketplace add ${sb.pluginDir}`,
      `codex plugin add ${HARNESS_PLUGIN_ID}`,
    ])
    // The dialog named the Codex commands before any of them ran, and the hooks to approve.
    expect(plans).toHaveLength(1)
    const { detail } = confirmationText(plans[0] as InstallPlan)
    expect(detail).toContain(`  codex plugin marketplace add ${sb.pluginDir}`)
    expect(detail).toContain(`  codex plugin add ${DEP}`)
    expect(detail).toContain('approve them in Codex (/hooks)')
    expect(detail).toContain(join(sb.codexHome, 'agents'))

    // The agents equal the fixture, and are the only files in CODEX_HOME (Codex's own state is the stand-in's).
    expect(Object.keys(files(sb.codexHome)).sort()).toEqual(AGENT_FILES.map((name) => `agents/${name}`))
    for (const name of AGENT_FILES) expect(readFileSync(join(sb.codexHome, 'agents', name), 'utf8')).toBe(expected(name, V1))
    // The sandbox holds the Harness copy, the agents and worfy's record — nothing else.
    const written = Object.keys(files(join(sb.root, 'sandbox'))).filter((path) => !path.startsWith(relative(join(sb.root, 'sandbox'), sb.pluginDir).split(sep).join('/')))
    expect(written.sort()).toEqual(['data/harness-codex.json', ...AGENT_FILES.map((name) => `home/.codex/agents/${name}`)])
    // Every codex command ran with this CODEX_HOME; nothing went into a Project's folder.
    expect(new Set(readFileSync(sb.env.STUB_CODEX_HOMES as string, 'utf8').trim().split('\n'))).toEqual(new Set([JSON.stringify(sb.codexHome)]))
    expect(existsSync(join(REPO, '.codex'))).toBe(repoCodex)
    expect(existsSync(join(bundle, '.codex'))).toBe(false)
  })

  it('a second install has nothing to do, and an update of the build updates Codex with `plugin add` and its agents', async () => {
    await installer(makeBundle('v1', V1)).install(yes())
    clearCalls()
    expect((await installer(makeBundle('v1-again', V1)).install(yes())).outcome).toBe('nothing-to-do')
    // Only reads: the plan's, and the status the answer carries.
    expect(new Set(codexCalls())).toEqual(new Set(['codex plugin list --json']))

    // An agent an older Harness wrote goes; the user's own files stay.
    const agents = join(sb.codexHome, 'agents')
    writeFileSync(join(agents, 'worfy-planner.toml'), `${CODEX_AGENT_MARK} (Harness ${V1}); the next install rewrites or removes this file.\nname = "worfy-planner"\n`)
    writeFileSync(join(agents, 'worfy-mine.toml'), 'name = "worfy-mine"\n')
    writeFileSync(join(agents, 'helper.toml'), `${CODEX_AGENT_MARK}\nname = "helper"\n`)
    clearCalls()
    const plans: InstallPlan[] = []
    const { status } = await installer(makeBundle('v2', V2)).install(yes(plans))

    expect(status.state).toEqual({ kind: 'installed', version: V2, enabled: true })
    expect(status.codex?.state).toEqual({ kind: 'installed', version: V2 })
    expect(codexCalls().filter((line) => !line.endsWith('list --json'))).toEqual([`codex plugin add ${HARNESS_PLUGIN_ID}`])
    expect(plans[0]?.codex).toMatchObject({ from: V1, to: V2, commands: [['plugin', 'add', HARNESS_PLUGIN_ID]], agents: { remove: ['worfy-planner.toml'] } })
    expect(readdirSync(agents).sort()).toEqual(['helper.toml', 'worfy-implementer.toml', 'worfy-mine.toml', 'worfy-reviewer.toml', 'worfy-scout.toml'])
    expect(readFileSync(join(agents, 'worfy-scout.toml'), 'utf8')).toContain(`(Harness ${V2})`)
  })

  it('a version Codex lists that differs from Claude Code shows in the same status, and Install updates only Codex', async () => {
    // Codex got V1, then a build of V2 installed into Claude Code while Codex was away.
    await installer(makeBundle('v1', V1)).install(yes())
    const v2 = makeBundle('v2', V2)
    await installer(v2, null).install(yes())

    const status = await installer(v2).status()
    expect(status.state).toEqual({ kind: 'installed', version: V2, enabled: true })
    expect(status.codex?.state).toEqual({ kind: 'outdated', from: V1, to: V2 })
    expect(status.codex?.hooksToApprove).toBe(false)

    clearCalls()
    const plans: InstallPlan[] = []
    const result = await installer(v2).install(yes(plans))
    expect(calls().filter((line) => line.startsWith('claude ') && !line.endsWith('list --json'))).toEqual([])
    expect(codexCalls().filter((line) => !line.endsWith('list --json'))).toEqual([`codex plugin add ${HARNESS_PLUGIN_ID}`])
    expect(confirmationText(plans[0] as InstallPlan)).toMatchObject({ button: 'Update', message: `Update the worfy Harness in Codex ${V1} → ${V2}?` })
    expect(result.status.codex?.state).toEqual({ kind: 'installed', version: V2 })
  })

  it('a plugin Codex lists without a build version stands at the version worfy recorded', async () => {
    sb.env.STUB_CODEX_LOCAL_VERSION = '1'
    const bundle = makeBundle('v1', V1)
    expect((await installer(bundle).install(yes())).status.codex?.state).toEqual({ kind: 'installed', version: V1 })
    expect(JSON.parse(readFileSync(join(sb.dataDir, 'harness-codex.json'), 'utf8'))).toEqual({ version: V1 })
    clearCalls()
    expect((await installer(bundle).install(yes())).outcome).toBe('nothing-to-do')

    // Without the record the version is unknown: Install puts the plugin in again, once.
    rmSync(join(sb.dataDir, 'harness-codex.json'))
    expect((await installer(bundle).status()).codex?.state).toEqual({ kind: 'outdated', from: null, to: V1 })
    await installer(bundle).install(yes())
    expect((await installer(bundle).status()).codex?.state).toEqual({ kind: 'installed', version: V1 })
  })

  it('a failed codex command is reported as a failed Claude Code command is, and leaves Claude Code installed', async () => {
    sb.env.STUB_CODEX_FAIL = `plugin add ${HARNESS_PLUGIN_ID}`
    const { outcome, status } = await installer(makeBundle('v1', V1)).install(yes())

    expect(outcome).toBe('done')
    expect(status.state).toEqual({ kind: 'installed', version: V1, enabled: true })
    expect(status.codex?.state).toEqual({
      kind: 'error',
      step: 'plugin add',
      reason: `codex plugin add ${HARNESS_PLUGIN_ID} exited with 3:\nnoise\nplugin add ${HARNESS_PLUGIN_ID} failed: stub error`,
    })
    // The agents come after the plugin: none were written.
    expect(existsSync(join(sb.codexHome, 'agents'))).toBe(false)
  })

  it('a failed Claude Code part runs no codex command', async () => {
    sb.env.STUB_CLAUDE_FAIL = `plugin install ${HARNESS_PLUGIN_ID}`
    const { status } = await installer(makeBundle('v1', V1)).install(yes())
    expect(status.state).toMatchObject({ kind: 'error', step: 'install' })
    expect(codexCalls().filter((line) => !line.endsWith('list --json'))).toEqual([])
    expect(existsSync(join(sb.codexHome, 'agents'))).toBe(false)
  })

  it('declined, nothing is written into Codex and no codex command but its reads ran', async () => {
    const { outcome } = await installer(makeBundle('v1', V1)).install(() => Promise.resolve(false))
    expect(outcome).toBe('declined')
    expect(new Set(codexCalls())).toEqual(new Set(['codex plugin list --json', 'codex plugin marketplace list --json']))
    expect(files(sb.codexHome)).toEqual({})
    expect(existsSync(sb.dataDir)).toBe(false)
  })

  it('without CODEX_HOME (Codex never ran here) the status has no Codex and nothing runs or is created', async () => {
    removeTestTree(sb.codexHome)
    const bundle = makeBundle('v1', V1)
    const { status } = await installer(bundle).install(yes())
    expect(status.state).toMatchObject({ kind: 'installed' })
    expect(status).not.toHaveProperty('codex')
    expect(codexCalls()).toEqual([])
    expect(existsSync(sb.codexHome)).toBe(false)
    // Nor with no Codex binary in the build.
    mkdirSync(sb.codexHome)
    expect(await installer(bundle, codexHarness(bundle, { codex: undefined })).status()).not.toHaveProperty('codex')
  })
})

describe('the Codex agents', () => {
  it('turns the agents of harness/ into worfy-implementer, worfy-reviewer and worfy-scout', () => {
    const agents = codexAgentFiles(join(REPO, 'harness'), '/plugin', V1)
    expect([...agents.keys()]).toEqual(AGENT_FILES)
    for (const [name, text] of agents) {
      expect(text.startsWith(CODEX_AGENT_MARK)).toBe(true)
      expect(text).toContain(`name = "${name.replace('.toml', '')}"`)
      expect(text).toMatch(/^description = ".+"$/m)
      expect(text).toContain("developer_instructions = '''\n")
      expect(text).not.toContain('${CLAUDE_PLUGIN_ROOT}')
      expect(text).toContain('/plugin/bin/profile')
    }
    // Claude's model names mean nothing to Codex: the agent inherits its parent's model; the effort stays.
    expect(agents.get('worfy-scout.toml')).not.toMatch(/^model = /m)
    expect(agents.get('worfy-scout.toml')).toContain('model_reasoning_effort = "medium"')
    expect(agents.get('worfy-implementer.toml')).toContain('model_reasoning_effort = "high"')
  })

  it('on Windows a rename a held-open file refuses is tried again; elsewhere it fails the step at once', async () => {
    const agentsDir = join(sb.codexHome, 'agents')
    const files = codexAgentFiles(join(REPO, 'harness'), sb.pluginDir, V1)
    let refusals = 0
    const heldOpen = async (from: string, to: string): Promise<void> => {
      if (refusals < 2) {
        refusals += 1
        throw Object.assign(new Error('EPERM: operation not permitted, rename'), { code: 'EPERM' })
      }
      const { rename } = await import('node:fs/promises')
      await rename(from, to)
    }
    await writeCodexAgents(agentsDir, files, { platform: 'win32', retryMs: 5_000, renameFile: heldOpen })
    expect(readdirSync(agentsDir).sort()).toEqual(AGENT_FILES)

    removeTestTree(agentsDir)
    refusals = 0
    const bundle = makeBundle('v1', V1)
    const harness = codexHarness(bundle, { platform: 'darwin', renameFile: heldOpen })
    const { status } = await installer(bundle, harness).install(yes())
    expect(refusals).toBe(1)
    expect(status.codex?.state).toMatchObject({ kind: 'error', step: 'agents', reason: expect.stringContaining('EPERM') as unknown })
    // The plugin went in; the agents did not: the next status asks for the install again.
    expect((await installer(bundle, harness).status()).codex?.state).toEqual({ kind: 'outdated', from: V1, to: V1 })
    // No staging file is left behind.
    expect(readdirSync(agentsDir).filter((name) => name.startsWith('.'))).toEqual([])
  })
})

describe('reading Codex', () => {
  it('reads the plugin list as a list, as { plugins }, or as marketplaces with their plugins', () => {
    const plugin = { id: HARNESS_PLUGIN_ID, localVersion: V1, installed: true, enabled: false }
    expect(codexPluginsOf([plugin])?.get(HARNESS_PLUGIN_ID)).toEqual({ version: V1, enabled: false })
    expect(codexPluginsOf({ plugins: [{ name: 'worfy', marketplace: 'worfy-harness', version: V1 }] })?.get(HARNESS_PLUGIN_ID)).toEqual({ version: V1, enabled: true })
    expect(codexPluginsOf({ marketplaces: [{ name: 'worfy-harness', plugins: [{ id: 'worfy', localVersion: null, version: V2 }] }] })?.get(HARNESS_PLUGIN_ID)).toEqual({ version: V2, enabled: true })
    // A plugin a marketplace offers but that is not installed is not listed as installed.
    expect(codexPluginsOf([{ ...plugin, installed: false }])?.size).toBe(0)
    expect(codexPluginsOf('nothing')).toBeNull()
    expect(codexMarketplacesOf({ marketplaces: [{ name: 'worfy-harness' }] })).toEqual(new Set(['worfy-harness']))
    expect(codexMarketplacesOf([{ path: '/x' }])).toBeNull()
  })

  it('never takes the real Codex under vitest; a stand-in comes from WORFY_CODEX_CLI', () => {
    const runtime = { packaged: true, resourcesPath: 'C:\\worfy\\resources', platform: 'win32' as const, arch: 'x64' }
    expect(codexInstallBinary({ WORFY_CODEX_CLI: '/stub/codex.mjs' }, runtime)).toBe('/stub/codex.mjs')
    expect(codexInstallBinary({}, runtime, undefined, () => true)).toBeUndefined()
    expect(codexInstallBinary({ WORFY_CODEX: 'fake' }, runtime, undefined, () => true)).toBeUndefined()
    expect(codexInstallBinary({ WORFY_CODEX: 'absent' }, runtime, undefined, () => true)).toBeUndefined()
  })
})
