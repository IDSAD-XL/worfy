// How a Session's Claude Code is started (src/main/agent/app-registry.ts): the real SDK unless
// WORFY_AGENT=fake, with the login shell environment from env.ts rather than worfy's own, and the
// unpacked native binary in the packaged app. The SDK's query() and agentEnv() are mocked.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { QueryRequest } from '../../src/main/agent/session'
import { DEFAULT_SETTINGS } from '../../src/shared/agent/settings'

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
  rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
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

  it('lets the SDK find Claude Code itself when worfy is not packaged', async () => {
    await sdkQueryFactory()(request())
    expect(sdkOptions()).not.toHaveProperty('pathToClaudeCodeExecutable')
  })

  it('points the packaged app at the native binary unpacked from app.asar', async () => {
    mocks.app.isPackaged = true
    await sdkQueryFactory()(request())
    expect(sdkOptions().pathToClaudeCodeExecutable).toBe(
      join(RESOURCES, 'app.asar.unpacked', 'node_modules', '@anthropic-ai', `claude-agent-sdk-${process.platform}-${process.arch}`, 'claude'),
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
})
