// worfy-multi-vendor ticket 35: Install Harness installs the same Harness folder into Codex as well
// (src/main/harness/codex-install.ts) — the local marketplace, a dependency as a plugin of its own
// (the fixture copy's DEP: the Harness of this repository declares none since worfy-skills 03), the version check — and writes the agents worfy-implementer, worfy-reviewer and
// worfy-scout as TOML only into <CODEX_HOME>/agents (src/main/harness/codex-agents.ts).
//
// Every case runs in a sandbox: the Claude home, the Harness home, CODEX_HOME and worfy's data folder
// are temporary folders. `claude` and `codex` are stand-ins (Node scripts the installer starts under
// worfy's own Node, src/main/program.ts) that log their arguments and keep their own state outside
// the sandbox, so the sandbox shows only what worfy itself wrote. The real Codex never runs.
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CODEX_AGENT_MARK, codexAgentFiles, writeCodexAgents } from '../../src/main/harness/codex-agents'
import { CodexHarness, codexInstallBinary, codexMarketplacesOf, codexPluginsOf, type CodexInstallerOptions, type CodexPlan } from '../../src/main/harness/codex-install'
import { confirmationText, DEPENDENCY_MARKETPLACE_SOURCE, HARNESS_PLUGIN_ID, HarnessInstaller, type InstallPlan } from '../../src/main/harness/install'
import { harnessHome } from '../../src/main/storage/paths'
import { harnessStatusSchema, skippedAgentsText } from '../../src/shared/ipc/harness'
import { removeTestTree } from '../remove'

const REPO = join(__dirname, '..', '..')
const FIXTURES = join(REPO, 'test', 'fixtures', 'codex-agents')
const V1 = '0.2.0+aaaaaaa'
const V2 = '0.3.0+bbbbbbb'
/** The dependency of the fixture copy makeBundle makes. */
const DEP = 'example-skills@claude-plugins-official'
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
if (command === 'plugin list' && (process.env.STUB_CLAUDE_WAIT_FOR ?? '') !== '') {
  // Answers only once the file exists (the codex stand-in writes it as it starts), for 10 s at most.
  const deadline = Date.now() + 10_000
  while (!existsSync(process.env.STUB_CLAUDE_WAIT_FOR) && Date.now() < deadline) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50)
  if (!existsSync(process.env.STUB_CLAUDE_WAIT_FOR)) {
    process.stderr.write('claude plugin list waited for codex in vain\\n')
    process.exit(4)
  }
}
if (command === 'plugin marketplace list') process.stdout.write(JSON.stringify(Object.keys(state.marketplaces).map((name) => ({ name }))))
else if (command === 'plugin marketplace add') state.marketplaces[isAbsolute(args[3]) ? manifest(args[3], 'marketplace.json').name : basename(args[3])] = args[3]
else if (command === 'plugin install' || command === 'plugin update') {
  const source = state.marketplaces[args[2].split('@')[1]]
  state.plugins[args[2]] = isAbsolute(source) ? manifest(source, 'plugin.json').version : '1.4.0'
} else if (command === 'plugin list') process.stdout.write(JSON.stringify(Object.entries(state.plugins).map(([id, version]) => ({ id, version, enabled: true, errors: [] }))))
writeFileSync(path, JSON.stringify(state))
`

// Codex's side. Its answers follow the pinned Codex 0.166.0: \`plugin list --json\` prints
// { installed, available } as the live recording test/fixtures/codex-cli/plugin-list-0.166.0.json
// does (worfy-multi-vendor ticket 46), \`plugin marketplace list --json\` prints
// { marketplaces: [{ name, root, marketplaceSource }] }; \`plugin marketplace add\` and \`plugin add\`
// follow its help texts. What a test can ask of it:
//   STUB_CODEX_FAIL           a command line prefix that exits 3 with an error on stderr
//   STUB_CODEX_LOCAL_VERSION  a plugin of a local marketplace is listed with the version "local"
//   STUB_CODEX_STATE          the file of its state ({ marketplaces, plugins }), outside the sandbox
//   STUB_CODEX_HANG           \`plugin list\` writes its pid to STUB_CODEX_STARTED and does not answer
//                             (for 20 s, so nothing outlives the test); \`ignore-term\` ignores SIGTERM too
const CODEX_STUB = `
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, isAbsolute, join } from 'node:path'
const args = process.argv.slice(2)
appendFileSync(process.env.STUB_LOG, JSON.stringify(['codex', ...args]) + '\\n')
if ((process.env.STUB_CODEX_HANG ?? '') !== '' && args.join(' ') === 'plugin list --json') {
  if (process.env.STUB_CODEX_HANG === 'ignore-term') process.on('SIGTERM', () => undefined)
  writeFileSync(process.env.STUB_CODEX_STARTED, String(process.pid))
  setTimeout(() => process.exit(0), 20_000)
} else {
appendFileSync(process.env.STUB_CODEX_HOMES, JSON.stringify(process.env.CODEX_HOME ?? null) + '\\n')
if ((process.env.STUB_CODEX_FAIL ?? '') !== '' && args.join(' ').startsWith(process.env.STUB_CODEX_FAIL)) {
  process.stderr.write('noise\\n' + args.join(' ') + ' failed: stub error\\n')
  process.exit(3)
}
const path = process.env.STUB_CODEX_STATE
const state = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : { marketplaces: {}, plugins: {} }
// Codex 0.166.0 reads a plugin's .codex-plugin/plugin.json before its .claude-plugin/plugin.json.
const manifest = (dir, file) => JSON.parse(readFileSync(join(dir, file === 'plugin.json' && existsSync(join(dir, '.codex-plugin', file)) ? '.codex-plugin' : '.claude-plugin', file), 'utf8'))
const command = args.slice(0, args[1] === 'marketplace' ? 3 : 2).join(' ')
if (command === 'plugin marketplace list') {
  process.stdout.write(JSON.stringify({ marketplaces: Object.entries(state.marketplaces).map(([name, source]) => ({ name, root: source, marketplaceSource: { sourceType: isAbsolute(source) ? 'local' : 'git', source } })) }))
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
  const installed = Object.entries(state.plugins).map(([pluginId, version]) => {
    const [name, marketplaceName] = pluginId.split('@')
    return { pluginId, name, marketplaceName, version, installed: true, enabled: true, installPolicy: 'AVAILABLE', authPolicy: 'ON_USE' }
  })
  process.stdout.write(JSON.stringify({ installed, available: [] }, null, 2) + '\\n')
}
writeFileSync(path, JSON.stringify(state))
}
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

/** A Harness copy of `version` from harness/ (without its tests) declaring DEP, with the agents of `agents` when given. */
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
  writeFileSync(manifestPath, `${JSON.stringify({ name: plugin, version, ...rest, dependencies: [DEP] }, null, 2)}\n`)
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
    expect(status.codex).toEqual({ state: { kind: 'installed', version: V1 }, agentsDir: join(sb.codexHome, 'agents'), hooksToApprove: true, skippedAgents: [] })
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

describe("the files of the agents folder that are not worfy's", () => {
  const MARKED = `${CODEX_AGENT_MARK} (Harness ${V1}); the next install rewrites or removes this file.\nname = "x"\n`
  const agentsDir = (): string => join(sb.codexHome, 'agents')
  const thisBuild = (): Map<string, string> => codexAgentFiles(join(REPO, 'harness'), sb.pluginDir, V1)
  /** Writes `text` into the agents folder and returns a check that it is still there, unchanged. */
  const put = (name: string, text: string): (() => void) => {
    writeFileSync(join(agentsDir(), name), text)
    return () => expect(readFileSync(join(agentsDir(), name), 'utf8')).toBe(text)
  }

  it('removes only a worfy-*.toml whose first line is the mark: the mark further down, another extension, a folder or an unreadable file stay', async () => {
    mkdirSync(agentsDir(), { recursive: true })
    put('worfy-old.toml', MARKED)
    const checks = [
      // The mark, but not on line 1.
      put('worfy-mark-later.toml', `name = "mine"\n${MARKED}`),
      // The mark, in a file that is not .toml.
      put('worfy-x.txt', MARKED),
    ]
    // A folder with the name of an agent file, holding a marked file.
    mkdirSync(join(agentsDir(), 'worfy-dir.toml'))
    checks.push(put(join('worfy-dir.toml', 'inside.toml'), MARKED))
    // A marked file worfy cannot read (POSIX permissions; root reads it anyway, Windows has no such mode).
    const locked = join(agentsDir(), 'worfy-locked.toml')
    const unreadable = process.platform !== 'win32' && process.getuid?.() !== 0
    if (unreadable) {
      writeFileSync(locked, MARKED)
      chmodSync(locked, 0o000)
    }
    try {
      const { removed } = await writeCodexAgents(agentsDir(), thisBuild())
      expect(removed).toEqual(['worfy-old.toml'])
      expect(existsSync(join(agentsDir(), 'worfy-old.toml'))).toBe(false)
      for (const check of checks) check()
      expect(statSync(join(agentsDir(), 'worfy-dir.toml')).isDirectory()).toBe(true)
      if (unreadable) {
        chmodSync(locked, 0o644)
        expect(readFileSync(locked, 'utf8')).toBe(MARKED)
      }
    } finally {
      if (unreadable && existsSync(locked)) chmodSync(locked, 0o644)
    }
  })

  // A symlink needs a privilege on Windows that a test cannot count on.
  it.skipIf(process.platform === 'win32')("a symlink is the user's, whatever it points at: dangling, at a file of the user's, or at a marked file", async () => {
    mkdirSync(agentsDir(), { recursive: true })
    const outside = join(sb.root, 'outside')
    mkdirSync(outside)
    writeFileSync(join(outside, 'mine.toml'), 'name = "mine"\n')
    writeFileSync(join(outside, 'marked.toml'), MARKED)
    const links: Record<string, string> = {
      'worfy-dangling.toml': join(outside, 'no-such-file.toml'),
      'worfy-user-link.toml': join(outside, 'mine.toml'),
      'worfy-marked-link.toml': join(outside, 'marked.toml'),
      // Under the name of an agent of this build: not written through, not replaced.
      'worfy-scout.toml': join(outside, 'marked.toml'),
    }
    for (const [name, target] of Object.entries(links)) symlinkSync(target, join(agentsDir(), name), 'file')

    const { written, removed, skipped } = await writeCodexAgents(agentsDir(), thisBuild())
    expect(removed).toEqual([])
    expect(skipped).toEqual(['worfy-scout.toml'])
    expect(written).toEqual(['worfy-implementer.toml', 'worfy-reviewer.toml'])
    for (const [name, target] of Object.entries(links)) {
      expect(lstatSync(join(agentsDir(), name)).isSymbolicLink()).toBe(true)
      expect(readlinkSync(join(agentsDir(), name))).toBe(target)
    }
    expect(readFileSync(join(outside, 'mine.toml'), 'utf8')).toBe('name = "mine"\n')
    expect(readFileSync(join(outside, 'marked.toml'), 'utf8')).toBe(MARKED)
  })

  it("an agent file of the user's own under an agent's name is never written over: the dialog and the status name it, and Install writes it once it is gone", async () => {
    mkdirSync(agentsDir(), { recursive: true })
    const unchanged = put('worfy-implementer.toml', 'name = "worfy-implementer"\ndeveloper_instructions = "mine"\n')
    const bundle = makeBundle('v1', V1)
    const plans: InstallPlan[] = []

    const { status } = await installer(bundle).install(yes(plans))

    unchanged()
    expect(plans[0]?.codex?.agents).toEqual({ write: ['worfy-reviewer.toml', 'worfy-scout.toml'], remove: [], skipped: ['worfy-implementer.toml'] })
    const { detail } = confirmationText(plans[0] as InstallPlan)
    expect(detail).toContain(skippedAgentsText(['worfy-implementer.toml'], agentsDir()))
    expect(detail).toContain('Agent files of your own stay as they are.')
    // Installed, not outdated for ever: worfy has nothing to do, and the status says what is left to the user.
    expect(status.codex).toMatchObject({ state: { kind: 'installed', version: V1 }, skippedAgents: ['worfy-implementer.toml'] })
    expect((await installer(bundle).install(yes())).outcome).toBe('nothing-to-do')
    unchanged()

    // The user moves the file away: the agent is missing, and Install writes it.
    rmSync(join(agentsDir(), 'worfy-implementer.toml'))
    expect((await installer(bundle).status()).codex).toMatchObject({ state: { kind: 'outdated', from: V1, to: V1 }, skippedAgents: [] })
    await installer(bundle).install(yes())
    expect(readFileSync(join(agentsDir(), 'worfy-implementer.toml'), 'utf8').startsWith(CODEX_AGENT_MARK)).toBe(true)
  })

  it('an agents folder that is a file is an error of the step agents in Codex, and the Claude Code part goes on', async () => {
    const bundle = makeBundle('v1', V1)
    await installer(bundle).install(yes())
    removeTestTree(agentsDir())
    writeFileSync(agentsDir(), 'not a folder')

    const status = await installer(bundle).status()
    expect(status.state).toEqual({ kind: 'installed', version: V1, enabled: true })
    expect(status.codex?.state).toMatchObject({ kind: 'error', step: 'agents', reason: expect.stringContaining(agentsDir()) as unknown })

    // An update with the file in place: Claude Code updates; Codex reports the step.
    const result = await installer(makeBundle('v2', V2)).install(yes())
    expect(result.status.state).toEqual({ kind: 'installed', version: V2, enabled: true })
    expect(result.status.codex?.state).toMatchObject({ kind: 'error', step: 'agents' })
    expect(readFileSync(agentsDir(), 'utf8')).toBe('not a folder')
  })
})

describe('a Codex that does not answer', () => {
  const started = (): string => join(sb.stubs, 'codex-started')
  const alive = (pid: number): boolean => {
    try {
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  }
  /** Stops the hanging stand-in, if it started and still runs. */
  const stopStandIn = (): void => {
    if (!existsSync(started())) return
    const pid = Number(readFileSync(started(), 'utf8'))
    if (alive(pid)) process.kill(pid, 'SIGKILL')
  }
  const within = <T,>(promise: Promise<T>, ms: number): Promise<T | 'late'> => {
    let timer: NodeJS.Timeout | undefined
    const late = new Promise<'late'>((resolve) => {
      timer = setTimeout(() => resolve('late'), ms)
    })
    return Promise.race([promise, late]).finally(() => clearTimeout(timer))
  }

  it('holds the Claude Code part only until the limit: then the Codex part is an error of plugin list, and both are read side by side', async () => {
    const bundle = makeBundle('v1', V1)
    await installer(bundle).install(yes())
    // Codex hangs and ignores SIGTERM; Claude Code answers only once the Codex read has started.
    sb.env.STUB_CODEX_HANG = 'ignore-term'
    sb.env.STUB_CODEX_STARTED = started()
    sb.env.STUB_CLAUDE_WAIT_FOR = started()
    try {
      const status = await within(installer(bundle, codexHarness(bundle, { statusTimeoutMs: 1_000 })).status(), 8_000)
      if (status === 'late') throw new Error('the status waited for the Codex that hangs')
      expect(status.state).toEqual({ kind: 'installed', version: V1, enabled: true })
      expect(status.codex?.state).toEqual({ kind: 'error', step: 'plugin list', reason: 'codex plugin list --json did not answer in 1 s' })
      expect(harnessStatusSchema.parse(status)).toEqual(status)
    } finally {
      stopStandIn()
    }
  })

  it('stops the codex command it gave up on', async () => {
    const bundle = makeBundle('v1', V1)
    await installer(bundle).install(yes())
    sb.env.STUB_CODEX_HANG = 'term'
    sb.env.STUB_CODEX_STARTED = started()
    try {
      const status = await within(installer(bundle, codexHarness(bundle, { statusTimeoutMs: 1_000 })).status(), 8_000)
      if (status === 'late') throw new Error('the status waited for the Codex that hangs')
      expect(status.codex?.state).toMatchObject({ kind: 'error', step: 'plugin list' })
      const pid = Number(readFileSync(started(), 'utf8'))
      const deadline = Date.now() + 5_000
      while (alive(pid) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50))
      expect(alive(pid)).toBe(false)
    } finally {
      stopStandIn()
    }
  })
})

/**
 * The stdio MCP servers Codex 0.166.0 starts for the plugin at `root`, the way its source reads them
 * (tag rust-v0.166.0 of github.com/openai/codex, worfy-polish ticket 55):
 * - the manifest is the first of .codex-plugin/plugin.json, .claude-plugin/plugin.json
 *   (codex-rs/exec-server-protocol/src/protocol.rs, DISCOVERABLE_PLUGIN_MANIFEST_PATHS);
 * - its `mcpServers`, an object or the path of a file, else <root>/.mcp.json
 *   (codex-rs/core-plugins/src/loader.rs, load_plugin_mcp_servers_from_manifest_with_format);
 * - `{ mcpServers }` or a plain map of servers; no `${…}` in command or args is filled in, a relative
 *   `cwd` is joined to the plugin root (codex-rs/codex-mcp/src/plugin_config.rs,
 *   normalize_plugin_mcp_server_value), and without `cwd` the server starts in the session's folder
 *   (codex-rs/rmcp-client/src/stdio_server_launcher.rs, fallback_cwd).
 * `script` is the first argument as the started program sees it: resolved against that folder.
 */
function codexMcpServers(root: string, sessionCwd: string): Record<string, { command: string; args: string[]; cwd: string; script: string }> {
  const manifestFile = ['.codex-plugin', '.claude-plugin'].map((dir) => join(root, dir, 'plugin.json')).find((file) => existsSync(file))
  const manifest = manifestFile === undefined ? {} : (JSON.parse(readFileSync(manifestFile, 'utf8')) as { mcpServers?: unknown })
  const file = typeof manifest.mcpServers === 'string' ? join(root, manifest.mcpServers) : join(root, '.mcp.json')
  const declared = typeof manifest.mcpServers === 'object' && manifest.mcpServers !== null ? manifest.mcpServers : existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as unknown) : {}
  const wrapped = (declared as { mcpServers?: unknown }).mcpServers
  const servers = (typeof wrapped === 'object' && wrapped !== null ? wrapped : declared) as Record<string, { command: string; args?: string[]; cwd?: string }>
  return Object.fromEntries(
    Object.entries(servers).map(([name, server]) => {
      const cwd = server.cwd === undefined ? sessionCwd : isAbsolute(server.cwd) ? server.cwd : join(root, server.cwd)
      const args = server.args ?? []
      return [name, { command: server.command, args, cwd, script: resolve(cwd, args[0] ?? '') }]
    }),
  )
}

describe('the qmd MCP server of the Harness in Codex', () => {
  it('an install into Codex gives Codex a manifest whose qmd server starts bin/qmd-mcp of the copy in the session folder; Claude Code keeps .mcp.json', async () => {
    const bundle = makeBundle('v1', V1)
    const project = join(sb.root, 'project')
    mkdirSync(project)

    await installer(bundle).install(yes())

    // Codex 0.166.0 does not fill in ${CLAUDE_PLUGIN_ROOT}: its manifest names the script by its full path.
    const qmd = codexMcpServers(sb.pluginDir, project).qmd
    expect(qmd).toEqual({ command: 'node', args: [join(sb.pluginDir, 'bin', 'qmd-mcp')], cwd: project, script: join(sb.pluginDir, 'bin', 'qmd-mcp') })
    expect(existsSync(qmd?.script ?? '')).toBe(true)
    // The rest of the manifest is Claude Code's, with the version of this build.
    const codexManifest = JSON.parse(readFileSync(join(sb.pluginDir, '.codex-plugin', 'plugin.json'), 'utf8')) as Record<string, unknown>
    const claudeManifest = JSON.parse(readFileSync(join(sb.pluginDir, '.claude-plugin', 'plugin.json'), 'utf8')) as Record<string, unknown>
    expect(codexManifest).toEqual({ ...claudeManifest, mcpServers: { qmd: { command: 'node', args: [join(sb.pluginDir, 'bin', 'qmd-mcp')] } } })
    expect(codexManifest.version).toBe(V1)

    // Claude Code reads .claude-plugin and .mcp.json, which stay as harness/ has them; it fills in the variable.
    expect(readFileSync(join(sb.pluginDir, '.mcp.json'), 'utf8')).toBe(readFileSync(join(REPO, 'harness', '.mcp.json'), 'utf8'))
    const claudeQmd = (JSON.parse(readFileSync(join(sb.pluginDir, '.mcp.json'), 'utf8')) as { mcpServers: { qmd: { command: string; args: string[] } } }).mcpServers.qmd
    expect(claudeQmd).toEqual({ command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/bin/qmd-mcp'] })
    expect(existsSync((claudeQmd.args[0] ?? '').replace('${CLAUDE_PLUGIN_ROOT}', sb.pluginDir))).toBe(true)
    // harness/ itself ships no Codex manifest: it is written for the copy Codex installs from.
    expect(existsSync(join(REPO, 'harness', '.codex-plugin'))).toBe(false)
  })

  it('without the Codex manifest Codex 0.166.0 starts node on a path that is not there (the failure of ticket 55)', () => {
    const bundle = makeBundle('v1', V1)
    const project = join(sb.root, 'project')
    mkdirSync(project)
    const qmd = codexMcpServers(bundle, project).qmd
    expect(qmd?.args).toEqual(['${CLAUDE_PLUGIN_ROOT}/bin/qmd-mcp'])
    expect(existsSync(qmd?.script ?? '')).toBe(false)
  })

  it('an update writes the manifest again for the new copy; a failed write is an error of plugin add and runs no plugin add', async () => {
    await installer(makeBundle('v1', V1)).install(yes())
    const v2 = makeBundle('v2', V2)
    await installer(v2).install(yes())
    expect(JSON.parse(readFileSync(join(sb.pluginDir, '.codex-plugin', 'plugin.json'), 'utf8'))).toMatchObject({ version: V2 })
    expect((await installer(v2).status()).codex?.state).toEqual({ kind: 'installed', version: V2 })

    // A file where the manifest's folder goes: the write fails before Codex is asked to add the plugin.
    const v3 = makeBundle('v3', '0.4.0+ccccccc')
    await installer(v3, null).install(yes())
    writeFileSync(join(sb.pluginDir, '.codex-plugin'), '')
    clearCalls()
    const status = (await codexHarness(v3).tryApply((await codexHarness(v3).plan()) as CodexPlan)) ?? null
    expect(status?.step).toBe('plugin add')
    expect(status?.message).toContain(join(sb.pluginDir, '.codex-plugin', 'plugin.json'))
    expect(codexCalls().filter((line) => !line.endsWith('list --json'))).toEqual([])
  })
})

describe('reading Codex', () => {
  it('reads the live plugin list of Codex 0.166.0: { installed, available } with pluginId, version and enabled', () => {
    const live = JSON.parse(readFileSync(join(REPO, 'test', 'fixtures', 'codex-cli', 'plugin-list-0.166.0.json'), 'utf8')) as { installed: Record<string, unknown>[]; available: unknown[] }
    const plugins = codexPluginsOf(live)
    expect(plugins?.size).toBe(live.installed.length)
    expect(plugins?.get('documents@openai-primary-runtime')).toEqual({ version: '26.1026.10807', enabled: true })
    expect(plugins?.get('github@openai-curated-remote')).toEqual({ version: '0.1.13-77c10e110b37', enabled: true })
    expect(plugins?.has(HARNESS_PLUGIN_ID)).toBe(false)
    // The Harness is found once Codex lists it among the installed; a disabled one keeps enabled false.
    const harness = { pluginId: HARNESS_PLUGIN_ID, name: 'worfy', marketplaceName: 'worfy-harness', version: V1, installed: true, enabled: false }
    expect(codexPluginsOf({ ...live, installed: [...live.installed, harness] })?.get(HARNESS_PLUGIN_ID)).toEqual({ version: V1, enabled: false })
    // `available` lists plugins that are not installed: the Harness there is not installed.
    expect(codexPluginsOf({ installed: live.installed, available: [{ ...harness, installed: false, enabled: false }] })?.has(HARNESS_PLUGIN_ID)).toBe(false)
    expect(codexPluginsOf({ installed: [], available: [harness] })?.size).toBe(0)
    expect(codexMarketplacesOf({ marketplaces: [{ name: 'worfy-harness', root: '/x', marketplaceSource: { sourceType: 'local', source: '/x' } }] })).toEqual(new Set(['worfy-harness']))
  })

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
