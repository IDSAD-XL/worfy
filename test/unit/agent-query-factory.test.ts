// How a Session's Claude Code is started (src/main/vendors/claude/query.ts): the real SDK unless
// WORFY_AGENT=fake, with the login shell environment from env.ts rather than worfy's own, and the
// unpacked native binary in the packaged app. The SDK's query() and agentEnv() are mocked.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, posix, win32 } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProductWriteAnswer } from '../../src/main/agent/product-guard'
import type { QueryRequest } from '../../src/main/agent/session'
import { DEFAULT_SETTINGS } from '../../src/shared/agent/settings'
import { removeTestTree } from '../remove'

const mocks = vi.hoisted(() => ({
  app: { isPackaged: false, getAppPath: () => '/nowhere', on: () => undefined },
  query: vi.fn(),
  agentEnv: vi.fn(),
}))

vi.mock('electron', () => ({ app: mocks.app }))
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: mocks.query }))
vi.mock('../../src/main/agent/env', () => ({ agentEnv: mocks.agentEnv }))

const { queryFactoryFromEnv, sdkQueryFactory } = await import('../../src/main/vendors/claude/query')

/** The environment env.ts hands over: the login shell's, already without API keys. */
const LOGIN_ENV = { HOME: '/Users/someone', PATH: '/opt/homebrew/bin:/usr/bin:/bin', SHELL: '/bin/zsh' }
const SDK_QUERY = { kind: 'sdk query' }
const RESOURCES = '/Applications/worfy.app/Contents/Resources'

const request = (): QueryRequest => ({
  prompt: (async function* () {})(),
  cwd: '/Users/someone/project',
  resume: 'sdk-123',
  stderr: () => undefined,
  settings: DEFAULT_SETTINGS,
  canUseTool: () => Promise.resolve({ behavior: 'deny', message: 'not in this test' }),
})

/** The options the factory passed to the SDK's query(). */
function sdkOptions(): Record<string, unknown> {
  expect(mocks.query).toHaveBeenCalledOnce()
  const [argument] = mocks.query.mock.calls[0] as [{ options: Record<string, unknown> }]
  return argument.options
}

let resourcesPath: PropertyDescriptor | undefined
/** An empty worfy data folder: the canvas (ticket 24) finds no Project and stays out of these tests. */
let dataDir: string

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'worfy-query-factory-'))
  vi.stubEnv('WORFY_DATA_DIR', dataDir)
  mocks.app.isPackaged = false
  mocks.query.mockReset().mockReturnValue(SDK_QUERY)
  mocks.agentEnv.mockReset().mockResolvedValue({ env: LOGIN_ENV, from: 'login-shell' })
  vi.stubEnv('ANTHROPIC_API_KEY', 'worfy-own-key')
  vi.stubEnv('ANTHROPIC_AUTH_TOKEN', 'worfy-own-token')
  resourcesPath = Object.getOwnPropertyDescriptor(process, 'resourcesPath')
  Object.defineProperty(process, 'resourcesPath', { value: RESOURCES, configurable: true })
})

afterEach(() => {
  vi.unstubAllEnvs()
  removeTestTree(dataDir)
  if (resourcesPath) Object.defineProperty(process, 'resourcesPath', resourcesPath)
  else Reflect.deleteProperty(process, 'resourcesPath')
})

describe('sdkQueryFactory', () => {
  it("gives Claude Code the login shell's environment, never worfy's own with its API keys", async () => {
    const req = request()
    expect(await sdkQueryFactory()(req)).toBe(SDK_QUERY)
    const options = sdkOptions()
    expect(options.env).toStrictEqual(LOGIN_ENV)
    expect(options.env).not.toHaveProperty('ANTHROPIC_API_KEY')
    expect(options.env).not.toHaveProperty('ANTHROPIC_AUTH_TOKEN')
    expect(JSON.stringify(options)).not.toContain('worfy-own')
    // The rest of the request reaches the SDK too: stderr is what explains a crash.
    expect(options).toMatchObject({ cwd: req.cwd, resume: 'sdk-123', permissionMode: 'bypassPermissions' })
    expect(options.stderr).toBe(req.stderr)
    // Permission requests outside bypassPermissions go to the Session's own gate (ticket 21).
    expect(options.canUseTool).toBe(req.canUseTool)
    expect(mocks.query.mock.calls[0]?.[0]).toMatchObject({ prompt: req.prompt })
    // The default settings leave the model and effort to Claude Code.
    expect(options).not.toHaveProperty('model')
    expect(options).not.toHaveProperty('effort')
  })

  it("starts Claude Code with the Session's picked model, effort and permission mode (a resume continues with them)", async () => {
    await sdkQueryFactory()({ ...request(), settings: { model: 'sonnet', effort: 'low', permissionMode: 'plan' } })
    expect(sdkOptions()).toMatchObject({ model: 'sonnet', effort: 'low', permissionMode: 'plan', resume: 'sdk-123', allowDangerouslySkipPermissions: true })
  })

  it('starts an unattended Session (Autopilot, worfy-daily ticket 02) in bypassPermissions whatever mode it carries', async () => {
    await sdkQueryFactory()({ ...request(), settings: { model: 'sonnet', effort: 'low', permissionMode: 'plan' }, unattended: true })
    expect(sdkOptions()).toMatchObject({ model: 'sonnet', effort: 'low', permissionMode: 'bypassPermissions', allowDangerouslySkipPermissions: true })
  })

  it("gives an Autopilot run's Session its TMPDIR and git environment over the login shell's, and a PreToolUse hook that tells where each call stands (worfy-auto-approve ticket 04)", async () => {
    const seen: unknown[] = []
    await sdkQueryFactory()({ ...request(), unattended: true, environment: { TMPDIR: '/tmp/run-tmp', GIT_NO_LAZY_FETCH: '1' }, toolUse: (use) => seen.push(use) })
    const options = sdkOptions() as { env: Record<string, string>; hooks: { PreToolUse: { hooks: ((input: unknown, id: string, extra: unknown) => Promise<unknown>)[] }[] } }
    expect(options.env).toMatchObject({ ...LOGIN_ENV, TMPDIR: '/tmp/run-tmp', GIT_NO_LAZY_FETCH: '1' })
    await options.hooks.PreToolUse[0]?.hooks[0]?.({ hook_event_name: 'PreToolUse', cwd: '/Users/someone/project/wt', tool_use_id: 'toolu_1' }, 'toolu_1', { signal: new AbortController().signal })
    expect(seen).toEqual([{ toolUseId: 'toolu_1', cwd: '/Users/someone/project/wt', scratchpad: null }])
  })

  it('tells the Session the whole environment its Claude Code process starts with (worfy-auto-approve ticket 04, round 3 of PR #1460)', async () => {
    const told: unknown[] = []
    await sdkQueryFactory()({ ...request(), unattended: true, environment: { TMPDIR: '/tmp/run-tmp' }, processEnv: (env) => told.push(env) })
    const options = sdkOptions() as { env: Record<string, string> }
    expect(told).toEqual([options.env])
    expect(told[0]).toMatchObject({ ...LOGIN_ENV, TMPDIR: '/tmp/run-tmp' })
  })

  it('adds no hook and no variable to a Session without them', async () => {
    await sdkQueryFactory()(request())
    expect(sdkOptions()).not.toHaveProperty('hooks')
    expect(sdkOptions()['env']).not.toHaveProperty('GIT_CONFIG_PARAMETERS')
  })

  it('writes what the fake agent was asked to do to WORFY_AGENT_LOG, one JSON line each', async () => {
    const scriptsDir = join(import.meta.dirname, '..', 'fixtures', 'agent-scripts')
    const log = join(dataDir, 'agent.log')
    const query = await queryFactoryFromEnv({ WORFY_AGENT: 'fake', WORFY_AGENT_SCRIPTS: scriptsDir, WORFY_AGENT_LOG: log })(request())
    await query.setModel('opus')
    query.close()
    const lines = readFileSync(log, 'utf8').trim().split('\n').map((line) => JSON.parse(line) as unknown)
    expect(lines).toEqual([
      { kind: 'start', resume: 'sdk-123', settings: DEFAULT_SETTINGS },
      { kind: 'setModel', model: 'opus' },
    ])
  })

  it('names the SDK session of a new Session with the id the Session asks for (worfy-daily ticket 24)', async () => {
    const id = 'f0000000-0000-4000-8000-000000000024'
    await sdkQueryFactory()({ ...request(), resume: undefined, sessionId: id })
    const options = sdkOptions()
    expect(options.sessionId).toBe(id)
    expect(options).not.toHaveProperty('resume')
  })

  it('passes no session id with `resume`: Claude Code refuses --session-id with --resume', async () => {
    await sdkQueryFactory()({ ...request(), sessionId: 'f0000000-0000-4000-8000-000000000024' })
    const options = sdkOptions()
    expect(options.resume).toBe('sdk-123')
    expect(options).not.toHaveProperty('sessionId')
  })

  it('lets the SDK find Claude Code itself when worfy is not packaged', async () => {
    await sdkQueryFactory()(request())
    expect(sdkOptions()).not.toHaveProperty('pathToClaudeCodeExecutable')
  })

  it('points the packaged app at the native binary unpacked from app.asar', async () => {
    mocks.app.isPackaged = true
    await sdkQueryFactory()(request())
    // claude.exe with Windows separators on win32 (ADR-0057), claude with / elsewhere.
    const windows = process.platform === 'win32'
    const paths = windows ? win32 : posix
    expect(sdkOptions().pathToClaudeCodeExecutable).toBe(
      paths.join(RESOURCES, 'app.asar.unpacked', 'node_modules', '@anthropic-ai', `claude-agent-sdk-${process.platform}-${process.arch}`, windows ? 'claude.exe' : 'claude'),
    )
  })
})

describe('queryFactoryFromEnv', () => {
  it.each([
    ['WORFY_AGENT unset', {}],
    ['WORFY_AGENT set to something else', { WORFY_AGENT: 'real' }],
  ])('starts the real Claude Code with %s', async (_label, env) => {
    expect(await queryFactoryFromEnv(env)(request())).toBe(SDK_QUERY)
    expect(mocks.query).toHaveBeenCalledOnce()
  })

  it('plays a fake script with WORFY_AGENT=fake and never calls the SDK', async () => {
    const scriptsDir = join(import.meta.dirname, '..', 'fixtures', 'agent-scripts')
    const query = await queryFactoryFromEnv({ WORFY_AGENT: 'fake', WORFY_AGENT_SCRIPTS: scriptsDir, WORFY_AGENT_SCRIPT: 'turn' })(request())
    expect(await query.accountInfo()).toMatchObject({ subscriptionType: 'Claude Max' })
    expect(mocks.query).not.toHaveBeenCalled()
    expect(mocks.agentEnv).not.toHaveBeenCalled()
    query.close()
  })

  it('lets the fake agent write its registry entry to WORFY_CLAUDE_HOME only with WORFY_AGENT_REGISTRY=1', async () => {
    const scriptsDir = join(import.meta.dirname, '..', 'fixtures', 'agent-scripts')
    const home = join(dataDir, 'claude-home')
    const fake = { WORFY_AGENT: 'fake', WORFY_AGENT_SCRIPTS: scriptsDir, WORFY_AGENT_SCRIPT: 'turn', WORFY_CLAUDE_HOME: home }
    const sessions = join(home, 'sessions')
    const fresh = { ...request(), resume: undefined, sessionId: 'f0000000-0000-4000-8000-000000000024' }

    // Without the flag nothing is written to the Claude home, as with the real agent (ADR-0005).
    const quiet = await queryFactoryFromEnv(fake)(fresh)
    expect(existsSync(home)).toBe(false)
    quiet.close()

    const registering = await queryFactoryFromEnv({ ...fake, WORFY_AGENT_REGISTRY: '1' })(fresh)
    const files = readdirSync(sessions)
    expect(files).toHaveLength(1)
    expect(JSON.parse(readFileSync(join(sessions, files[0] ?? ''), 'utf8'))).toMatchObject({ sessionId: fresh.sessionId, cwd: fresh.cwd, entrypoint: 'sdk-ts' })
    registering.close()
    expect(readdirSync(sessions)).toEqual([])
    expect(mocks.query).not.toHaveBeenCalled()
  })
})

// worfy-harness ticket 12 (ADR-0049): the Harness on the machine is looked for at every Session
// start, in WORFY_CLAUDE_HOME here; the plugin, or no Harness, gives the Session the build's copy.
describe('the Harness a Session of sdkQueryFactory carries', () => {
  let home: string

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'worfy-query-factory-home-'))
    vi.stubEnv('WORFY_CLAUDE_HOME', home)
    vi.stubEnv('WORFY_HARNESS_HOME', '')
    mocks.app.isPackaged = true
  })

  afterEach(() => {
    removeTestTree(home)
  })

  const plugins = async (): Promise<unknown> => {
    mocks.query.mockClear()
    await sdkQueryFactory()(request())
    return sdkOptions().plugins
  }

  it('is the copy in Contents/Resources/harness with the plugin and with none; nothing with the old Harness; looked for again at each start', async () => {
    // Without its own MCP discovery: worfy registers the plugin's servers itself (worfy-harness ticket 17).
    const own = [{ type: 'local', path: join(RESOURCES, 'harness'), skipMcpDiscovery: true }]
    expect(await plugins()).toEqual(own)

    const plugin = join(home, 'worfy-harness', 'plugin')
    mkdirSync(join(plugin, '.claude-plugin'), { recursive: true })
    mkdirSync(join(plugin, 'bin'), { recursive: true })
    writeFileSync(join(plugin, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'worfy' }))
    writeFileSync(join(plugin, 'bin', 'epic-status'), '#!/bin/sh\n')
    expect(await plugins()).toEqual(own)

    mkdirSync(join(home, 'bin'))
    writeFileSync(join(home, 'bin', 'epic-status'), '#!/bin/sh\n')
    expect(await plugins()).toBeUndefined()
  })
})

// worfy-polish ticket 82: the fake agent runs a Product Session's PreToolUse guard before canUseTool, as Claude
// Code does, so an e2e run meets the question about a write outside the folder. The guard is the one
// sdkQueryFactory gives the SDK (productHooks); the person's answer comes from the request's askProductWrite.
describe('a Product Session write outside its folder on the fake agent', () => {
  const scriptsDir = join(import.meta.dirname, '..', 'fixtures', 'agent-scripts')
  let top: string
  let project: string

  beforeEach(() => {
    // Not in the worfy data folder of these tests: that folder is closed to every write.
    top = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-product-fake-')))
    project = join(top, 'alpha')
    mkdirSync(join(project, 'docs', 'product'), { recursive: true })
    mkdirSync(join(project, '.git'), { recursive: true })
  })
  afterEach(() => removeTestTree(top))

  /** Plays one turn of product-write-outside.jsonl per message; what the tools answered, and the questions asked. */
  async function play(turns: number, answer: ProductWriteAnswer | undefined, listed: string[] = []) {
    const { fakeQueryFactory } = await import('../../src/main/agent/fake-query')
    const { productHooks, fakePreToolUse } = await import('../../src/main/vendors/claude/query')
    const asked: string[] = []
    const prompt = (async function* () {
      for (let turn = 0; turn < turns; turn++) yield { type: 'user', message: { role: 'user', content: `turn ${turn}` }, parent_tool_use_id: null }
    })()
    const productRequest: QueryRequest = {
      ...request(),
      prompt,
      cwd: project,
      resume: undefined,
      kind: 'product',
      settings: { ...DEFAULT_SETTINGS, permissionMode: 'bypassPermissions' },
      ...(answer === undefined ? {} : { askProductWrite: (question) => (asked.push(question.target.path), Promise.resolve(answer)) }),
    }
    const list = { read: () => listed, add: (folder: string) => void listed.push(folder) }
    const factory = fakeQueryFactory({
      scriptsDir,
      script: 'product-write-outside',
      preToolUse: (req) => productHooks(req, () => Promise.resolve(join(project, 'docs', 'product')), () => list).then(fakePreToolUse),
    })
    const query = await factory(productRequest)
    const results: { content: unknown; is_error: boolean }[] = []
    let ended = 0
    for await (const message of query as AsyncIterable<{ type: string; message?: { content?: { type: string; content: unknown; is_error: boolean }[] } }>) {
      for (const block of message.message?.content ?? []) if (block.type === 'tool_result') results.push({ content: block.content, is_error: block.is_error })
      if (message.type === 'result' && ++ended === turns) break
    }
    query.close()
    return { asked, results, listed }
  }

  it('«Allow once» writes the file, in bypassPermissions too; «Deny» writes nothing and tells the agent', async () => {
    const allowed = await play(1, 'once')
    expect(allowed.asked).toEqual([join(project, 'context', 'strong', 'brief.md')])
    expect(allowed.results).toEqual([{ content: expect.stringContaining('Write ran') as unknown, is_error: false }])
    expect(readFileSync(join(project, 'context', 'strong', 'brief.md'), 'utf8')).toBe('# Brief, version 2\n')

    const denied = await play(2, 'deny', [join(project, 'context', 'strong')])
    // The listed folder goes without a question; the next folder is asked about and refused.
    expect(denied.asked).toEqual([join(project, 'notes', 'plan.md')])
    expect(denied.results[1]).toEqual({ content: expect.stringContaining('The user denied writing') as unknown, is_error: true })
    expect(existsSync(join(project, 'notes', 'plan.md'))).toBe(false)
  })

  it('an unattended request (no one to ask) and .git are refused without a question', async () => {
    const unattended = await play(1, undefined)
    expect(unattended.results).toEqual([{ content: expect.stringContaining('No one is at this Session') as unknown, is_error: true }])
    expect(existsSync(join(project, 'context', 'strong', 'brief.md'))).toBe(false)

    const git = await play(3, 'always', [join(project, 'context', 'strong'), join(project, 'notes')])
    expect(git.asked).toEqual([])
    expect(git.results[2]).toEqual({ content: expect.stringContaining('.git') as unknown, is_error: true })
    expect(existsSync(join(project, '.git', 'hooks', 'pre-commit'))).toBe(false)
    expect(git.listed).toEqual([join(project, 'context', 'strong'), join(project, 'notes')])
  })

  it("closes worfy's data folder, the Claude home it reads, the user's own ~/.claude and the Harness to every write", async () => {
    const { productClosedFolders, productHooks, fakePreToolUse } = await import('../../src/main/vendors/claude/query')
    const env = { WORFY_DATA_DIR: join(top, 'data'), WORFY_CLAUDE_HOME: join(top, 'claude'), WORFY_HARNESS_HOME: join(top, 'harness') }
    expect(productClosedFolders(env)).toEqual([join(top, 'data'), join(top, 'claude'), join(homedir(), '.claude'), join(top, 'harness')])
    // The app's guard reads them from its own environment: here the worfy data folder of this test.
    const asked: string[] = []
    const run = fakePreToolUse(
      await productHooks(
        { ...request(), cwd: project, kind: 'product', askProductWrite: (question) => (asked.push(question.target.path), Promise.resolve('once')) },
        () => Promise.resolve(join(project, 'docs', 'product')),
        () => null,
      ),
    )
    const said = await run?.({ toolName: 'Write', toolUseId: 't', input: { file_path: join(dataDir, 'projects.json') }, cwd: project }, new AbortController().signal)
    expect(said?.decision).toBe('deny')
    expect(asked).toEqual([])
  })

  it('makes no hooks for a plain Session', async () => {
    const { productHooks } = await import('../../src/main/vendors/claude/query')
    expect(await productHooks(request(), () => Promise.resolve('/x'), () => null)).toBeUndefined()
  })
})
