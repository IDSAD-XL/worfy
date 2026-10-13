// How a Session's Claude Code is started (src/main/agent/app-registry.ts): the real SDK unless
// WORFY_AGENT=fake, with the login shell environment from env.ts rather than worfy's own, and the
// unpacked native binary in the packaged app. The SDK's query() and agentEnv() are mocked.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, posix, win32 } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

const { queryFactoryFromEnv, sdkQueryFactory } = await import('../../src/main/agent/app-registry')

/** The environment env.ts hands over: the login shell's, already without API keys. */
const LOGIN_ENV = { HOME: '/Users/tester', PATH: '/opt/homebrew/bin:/usr/bin:/bin', SHELL: '/bin/zsh' }
const SDK_QUERY = { kind: 'sdk query' }
const RESOURCES = '/Applications/worfy.app/Contents/Resources'

const request = (): QueryRequest => ({
  prompt: (async function* () {})(),
  cwd: '/Users/tester/project',
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
