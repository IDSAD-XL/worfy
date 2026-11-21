// The Integrations of a Project in a Claude Session (worfy-integrations ticket 06; ADR-0111 items 1, 7 and 10; spec,
// implementation decisions, Session Claude). sdkQueryFactory reads the Project's `integrations` (its settings.json),
// resolves each enabled id through the Machine's store — an id the store no longer has is skipped — and hands each to
// Claude Code as an SDK server in worfy's process, in `mcpServers` next to worfy-canvas, under its server name. The
// policy tier (managedSettings) and the Profile's list mcp.allowed stay as they were: the Integrations are not on it
// and it does not cut them (the spike of ticket 01, 3.2). A Session outside every Project gets none; an unattended one
// only those «Available to Autopilot»; a server turned off for the Session is left out of its next start. Its row in
// the chip «MCP n/m» has the source `integration` and the Integration's label.
//
// The token of an Integration never leaves worfy main: not in the arguments of the Claude Code process (where
// `--mcp-config` would carry an `http` server's headers, the spike's 3.4), not in its environment, not in a line of
// main's log, and not in a tool's answer — what Claude Code's transcript keeps, and so what the Journal and the
// Flight recorder read. The arguments are those the Agent SDK itself builds: its real query() runs with a spawn of the
// test's own that records them and starts nothing (`spawnClaudeCodeProcess`); no Claude Code binary runs.
import { EventEmitter } from 'node:events'
import { mkdirSync, mkdtempSync, realpathSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeQueryFactory } from '../../src/main/agent/fake-query'
import type { QueryHandle, QueryRequest } from '../../src/main/agent/session'
import { IntegrationProxy } from '../../src/main/integrations/proxy'
import { IntegrationStore } from '../../src/main/integrations/store'
import type { CanvasSession } from '../../src/main/mcp/canvas-server'
import { writeProjectIntegrations } from '../../src/main/projects/settings'
import { claudeMcpStatus, INTEGRATION_JOINED } from '../../src/main/vendors/claude/mcp'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { signInNeeded } from '../../src/main/integrations/proxy'
import { McpActionRefused } from '../../src/main/vendors/mcp'
import { mcpServerRowSchema, mcpShownName } from '../../src/shared/agent/mcp-status'
import { DEFAULT_SETTINGS } from '../../src/shared/agent/settings'
import { CANVAS_SERVER_NAME } from '../../src/shared/canvas/tools'
import type { ProjectIntegration } from '../../src/shared/integrations/types'
import { startServiceStub, type ServiceStub } from '../fixtures/integrations/service-stub'
import { AGENT_SCRIPTS } from './autopilot-faults-setup'
import { ms } from '../time-scale'

const mocks = vi.hoisted(() => ({ agentEnv: vi.fn() }))

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => '/nowhere', on: () => undefined },
  BrowserWindow: { getAllWindows: () => [] },
}))
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: () => {
    throw new Error('the Agent SDK module was imported: sdkQueryFactory must take query() from loadSdk')
  },
}))
vi.mock('../../src/main/agent/env', () => ({ agentEnv: mocks.agentEnv }))

const { projectIntegrationsResolver, sdkQueryFactory } = await import('../../src/main/vendors/claude/query')
const { LimitsTracker } = await import('../../src/main/agent/limits')

const TOKEN_A = 'tok-jira-a-91c2e7d4'
const TOKEN_L = 'tok-linear-3a8f0b62'
/** The Profile's list of MCP servers: worfy-canvas and a server of the user's. */
const LIST = [CANVAS_SERVER_NAME, 'example-notes']

let scratch: string
let cwd: string
let projectData: string
let stub: ServiceStub
let store: IntegrationStore
let proxy: IntegrationProxy
let ids: { jiraA: string; linear: string; jiraB: string }

beforeEach(async () => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-integrations-session-')))
  cwd = join(scratch, 'repo')
  projectData = join(scratch, 'project-data')
  mkdirSync(cwd)
  mkdirSync(projectData)
  mocks.agentEnv.mockReset().mockResolvedValue({ env: { HOME: join(scratch, 'home'), PATH: '/usr/bin:/bin' }, from: 'login-shell' })
  stub = await startServiceStub({ bearer: { [TOKEN_A]: 'alpha', [TOKEN_L]: 'beta' } })
  store = new IntegrationStore(join(scratch, 'integrations'))
  proxy = new IntegrationProxy({ store })
  const add = (label: string, token: string): string => {
    const added = store.add({ service: 'custom', label, auth: 'bearer', transport: { kind: 'http', url: stub.url } })
    store.setSecret(added.id, 'access', token)
    return added.id
  }
  ids = { jiraA: add('Jira — client A', TOKEN_A), linear: add('Linear', TOKEN_L), jiraB: add('Jira — client B', TOKEN_A) }
  const entries: ProjectIntegration[] = [
    { id: ids.jiraA, enabled: true, tools: 'all', autopilot: false },
    { id: ids.linear, enabled: true, tools: 'read-only', autopilot: true },
    // Turned off in this Project.
    { id: ids.jiraB, enabled: false, tools: 'all', autopilot: true },
    // Removed from the Machine since (the review of ticket 03): skipped, never an error.
    { id: 'removed-0000', enabled: true, tools: 'all', autopilot: true },
  ]
  writeProjectIntegrations(projectData, entries)
})

afterEach(async () => {
  vi.restoreAllMocks()
  await proxy.close()
  await stub.close()
  await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

interface Started {
  options: Record<string, unknown> & { mcpServers?: Record<string, { type: string; instance?: unknown }>; managedSettings?: unknown; env?: Record<string, string> }
  handle: QueryHandle
  listed: (readonly string[] | null)[]
}

/**
 * One start of a Session's Claude Code through sdkQueryFactory. `project: false` — the canvas finds no Project. The
 * query is the fake agent's, whose mcpServerStatus() answers the servers its options handed to Claude Code, connected,
 * as Claude Code would; `taken` — the servers of Claude Code from the inventory's last answer.
 */
async function start(input: { project?: boolean; unattended?: boolean; mcpOff?: string[]; taken?: string[]; limits?: boolean } = {}): Promise<Started> {
  const listed: (readonly string[] | null)[] = []
  const request: QueryRequest = {
    prompt: (async function* () {})(),
    cwd,
    resume: undefined,
    stderr: () => undefined,
    settings: DEFAULT_SETTINGS,
    canUseTool: () => Promise.resolve({ behavior: 'deny', message: 'not in this test' }),
    unattended: input.unattended === true,
    mcpListed: (list) => listed.push(list),
    ...(input.mcpOff === undefined ? {} : { mcpOff: input.mcpOff }),
  }
  // The fake agent tells its own (lack of a) list: only what sdkQueryFactory tells is kept here.
  const handle = await fakeQueryFactory({ scriptsDir: AGENT_SCRIPTS, script: 'turn' })({ ...request, mcpListed: undefined })
  let options: Started['options'] | undefined
  const sdk = {
    query: ({ options: given }: { options: object }) => {
      options = given as Started['options']
      handle.mcpServerStatus = () =>
        Promise.resolve(Object.keys(options?.mcpServers ?? {}).map((name) => ({ name, status: 'connected', source: 'sdk', tools: [{ name: 'whoami' }] })))
      return handle
    },
  }
  const attached: CanvasSession = {
    attachment: { server: { type: 'sdk', name: CANVAS_SERVER_NAME } as never, cardsDir: join(scratch, 'cards'), instructions: 'canvas' },
    observe: (query) => query,
  }
  const made = sdkQueryFactory(() => Promise.resolve(input.project === false ? null : attached), () => Promise.resolve(LIST), {
    loadSdk: () => Promise.resolve(sdk),
    autoCompactWindow: () => null,
    browser: () => Promise.resolve(null),
    skills: () => Promise.resolve(null),
    privateSkills: () => Promise.resolve(null),
    integrations: projectIntegrationsResolver({ dataDirOf: () => projectData, store, proxy, taken: () => input.taken ?? [] }),
  })
  // The app wraps the factory as session.ts does: appLimits().observe, whose queries are Proxies of the SDK's.
  const factory = input.limits === true ? new LimitsTracker({ dataDir: join(scratch, 'limits'), watch: null }).observe(made) : made
  const got = await factory(request)
  if (options === undefined) throw new Error('query() was not called')
  return { options, handle: got, listed }
}

const serverNames = (started: Started) => Object.keys(started.options.mcpServers ?? {})

describe('a Session of the Project', () => {
  it('gets exactly its enabled Integrations in mcpServers, as SDK servers next to worfy-canvas', async () => {
    const started = await start()
    expect(serverNames(started)).toEqual([CANVAS_SERVER_NAME, 'jira-client-a', 'linear'])
    for (const name of ['jira-client-a', 'linear']) expect(started.options.mcpServers?.[name]?.type).toBe('sdk')
  })

  it('leaves managedSettings and the Profile`s list as they are: the Integrations are on neither', async () => {
    const started = await start()
    expect(started.options.managedSettings).toEqual({
      allowManagedMcpServersOnly: true,
      allowedMcpServers: LIST.map((serverName) => ({ serverName })),
    })
    expect(started.listed).toEqual([LIST])
  })

  it('an unattended Session gets only the Integrations «Available to Autopilot»', async () => {
    const started = await start({ unattended: true })
    expect(serverNames(started)).toEqual([CANVAS_SERVER_NAME, 'linear'])
  })

  it('a server name of Claude Code`s own is not shadowed: the Integration gets -2', async () => {
    const started = await start({ taken: ['linear'] })
    expect(serverNames(started)).toEqual([CANVAS_SERVER_NAME, 'jira-client-a', 'linear-2'])
  })

  it('Turn off for this Session: the next start goes without it', async () => {
    const first = await start()
    const rows = await claudeMcpStatus(first.handle, null, 'test', { attended: true, pickUp: false })
    expect(rows?.find((row) => row.name === 'jira-client-a')?.actions).toEqual(['turn-off'])
    const restarted = await start({ mcpOff: ['jira-client-a'] })
    expect(serverNames(restarted)).toEqual([CANVAS_SERVER_NAME, 'linear'])
  })

  it('its row in the chip has the source integration and the label', async () => {
    const started = await start()
    const rows = await claudeMcpStatus(started.handle, null, 'test', { attended: true, pickUp: false })
    const row = rows?.find((each) => each.name === 'jira-client-a')
    expect(row).toEqual({ name: 'jira-client-a', status: 'connected', tools: 1, error: null, source: 'integration', sourceWord: null, label: 'Jira — client A', integrationId: ids.jiraA, actions: ['turn-off'] })
    expect(mcpServerRowSchema.parse(row)).toEqual(row)
    expect(row === undefined ? null : mcpShownName(row)).toBe('Jira — client A')
    // worfy-canvas stays worfy's own, with no Turn off.
    expect(rows?.find((each) => each.name === CANVAS_SERVER_NAME)).toMatchObject({ source: 'worfy', actions: [] })
  })
})

describe('a Session the app wraps', () => {
  it('its Integration`s row keeps the source integration and the label through the Limits` observe', async () => {
    const started = await start({ limits: true })
    const rows = await claudeMcpStatus(started.handle, null, 'test', { attended: true, pickUp: false })
    expect(rows?.find((each) => each.name === 'jira-client-a')).toMatchObject({ source: 'integration', label: 'Jira — client A' })
  })
})

describe('a Session outside every Project', () => {
  it('gets no Integration', async () => {
    const started = await start({ project: false })
    expect(serverNames(started)).toEqual([])
    expect(started.options.mcpServers).toBeUndefined()
  })
})

describe('the token of an Integration', () => {
  const tokens = [TOKEN_A, TOKEN_L]
  const leaks = (text: string): string[] => tokens.filter((token) => text.includes(token))

  it('is not in the arguments or the environment of the Claude Code process the Agent SDK starts', async () => {
    const started = await start()
    const real = await vi.importActual<typeof import('@anthropic-ai/claude-agent-sdk')>('@anthropic-ai/claude-agent-sdk')
    const spawned: { args: string[]; env: Record<string, string | undefined> }[] = []
    const fakeProcess = () => {
      const events = new EventEmitter()
      const stdout = new PassThrough()
      const process = {
        stdin: new PassThrough(),
        stdout,
        killed: false,
        exitCode: null as number | null,
        kill: () => {
          process.killed = true
          process.exitCode = 0
          stdout.end()
          events.emit('exit', 0, null)
          return true
        },
        on: (event: string, listener: (...args: unknown[]) => void) => void events.on(event, listener),
        once: (event: string, listener: (...args: unknown[]) => void) => void events.once(event, listener),
        off: (event: string, listener: (...args: unknown[]) => void) => void events.off(event, listener),
      }
      return process
    }
    const options = {
      ...started.options,
      spawnClaudeCodeProcess: (spawn: { args: string[]; env: Record<string, string | undefined> }) => {
        spawned.push({ args: spawn.args, env: spawn.env })
        return fakeProcess()
      },
    }
    const query = real.query({ prompt: (async function* () {})(), options: options as never })
    await vi.waitFor(() => expect(spawned).toHaveLength(1), { timeout: ms(10_000) })
    query.close()
    const [first] = spawned
    if (first === undefined) throw new Error('the Agent SDK started no process')
    expect(leaks(first.args.join('\n'))).toEqual([])
    expect(leaks(JSON.stringify(first.env))).toEqual([])
    // The Integrations are SDK servers: none of them is in --mcp-config, where an http server's headers would be.
    const config = first.args[first.args.indexOf('--mcp-config') + 1] ?? ''
    expect(first.args.includes('--mcp-config') ? config : '').not.toMatch(/jira-client-a|linear/u)
  }, ms(20_000))

  it('is in no line of main`s log and in no tool answer, through a whole Session of calls and failures', async () => {
    const lines: string[] = []
    for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => void lines.push(args.map((arg) => (arg instanceof Error ? `${arg.message}\n${arg.stack ?? ''}` : typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' ')))
    }
    const started = await start()
    expect(leaks(JSON.stringify(started.options, (key, value: unknown) => (key === 'instance' ? '[server]' : value)))).toEqual([])
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
    const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js')
    const answers: string[] = []
    const clients = new Map<string, InstanceType<typeof Client>>()
    for (const name of ['jira-client-a', 'linear']) {
      const server = started.options.mcpServers?.[name]?.instance as { connect(transport: unknown): Promise<void> }
      const [ours, theirs] = InMemoryTransport.createLinkedPair()
      await server.connect(theirs)
      const client = new Client({ name: 'claude-code-stand-in', version: '1.0.0' })
      await client.connect(ours)
      clients.set(name, client)
      answers.push(JSON.stringify(await client.listTools()))
      for (const tool of ['whoami', 'careless', 'broken', 'picture']) answers.push(JSON.stringify(await client.callTool({ name: tool, arguments: {} })))
    }
    // A token the service no longer takes: Sign-in needed, logged without it.
    stub.revoke(TOKEN_A)
    const refused = await clients.get('jira-client-a')?.callTool({ name: 'whoami', arguments: {} })
    answers.push(JSON.stringify(refused))
    for (const client of clients.values()) await client.close()
    expect(refused?.isError).toBe(true)
    expect(answers.join('\n')).toMatch(/dataset alpha/u)
    expect(leaks(answers.join('\n'))).toEqual([])
    expect(leaks(lines.join('\n'))).toEqual([])
  }, ms(20_000))
})

// worfy-integrations ticket 09: the row of an Integration says what the proxy found — a refused sign-in is needs-auth,
// with worfy's Sign in for one that signs in with OAuth and none for a token — and an Integration the Project turned on
// while the Session runs is a row «not started» whose Restart, with the same conversation, gives it to the Session.
describe('the rows of a Session`s Integrations, ticket 09', () => {
  /** Claude Code's side of the Session's in-process server `name`. */
  async function connect(started: Started, name: string): Promise<Client> {
    const server = started.options.mcpServers?.[name]
    if (server?.instance === undefined) throw new Error(`no SDK server ${name}`)
    const [ours, theirs] = InMemoryTransport.createLinkedPair()
    await (server.instance as { connect(transport: InMemoryTransport): Promise<void> }).connect(theirs)
    const client = new Client({ name: 'claude-code-stand-in', version: '1.0.0' })
    await client.connect(ours)
    return client
  }

  it('a sign-in the proxy found refused is needs-auth with its text; a token Integration offers no Sign in of the Vendor`s', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const started = await start()
    const client = await connect(started, 'jira-client-a')
    stub.revoke(TOKEN_A)
    await client.callTool({ name: 'whoami', arguments: {} }).catch(() => undefined)
    const rows = await claudeMcpStatus(started.handle, null, 'test', { attended: true, pickUp: false })
    expect(rows?.find((row) => row.name === 'jira-client-a')).toEqual({
      name: 'jira-client-a',
      status: 'needs-auth',
      tools: null,
      error: signInNeeded('Jira — client A'),
      source: 'integration',
      sourceWord: null,
      label: 'Jira — client A',
      integrationId: ids.jiraA,
      actions: [],
    })
    expect(rows?.find((row) => row.name === 'linear')).toMatchObject({ status: 'connected', integrationId: ids.linear })
    await client.close()
  })

  it('an OAuth Integration in needs-auth offers Sign in, which the Vendor never does for it', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const oauthId = store.add({ service: 'custom', label: 'Notion', auth: 'oauth', transport: { kind: 'http', url: stub.url } }).id
    writeProjectIntegrations(projectData, [{ id: oauthId, enabled: true, tools: 'all', autopilot: false }])
    const started = await start()
    const client = await connect(started, 'notion')
    await client.callTool({ name: 'whoami', arguments: {} }).catch(() => undefined)
    const handle = started.handle as QueryHandle & { mcpAuthenticate?: (name: string) => Promise<void> }
    handle.mcpAuthenticate = vi.fn(() => Promise.resolve())
    const rows = await claudeMcpStatus(started.handle, null, 'test', { attended: true, pickUp: false })
    expect(rows?.find((row) => row.name === 'notion')).toMatchObject({ status: 'needs-auth', integrationId: oauthId, actions: ['sign-in'] })
    const { claudeMcp } = await import('../../src/main/vendors/claude/mcp')
    // The Session's handle as the Claude driver holds it (ClaudeMcpLive): its live query and its rows.
    const session = { query: started.handle, readMcp: () => Promise.resolve(rows) }
    await expect(claudeMcp.act!(session as never, 'notion', 'sign-in')).rejects.toThrow(McpActionRefused)
    expect(handle.mcpAuthenticate).not.toHaveBeenCalled()
    await client.close()
  })

  it('an Integration turned on while the Session runs is «not started» with Restart; an unattended Session shows none', async () => {
    const attended = await start()
    const unattended = await start({ unattended: true })
    writeProjectIntegrations(projectData, [
      { id: ids.jiraA, enabled: true, tools: 'all', autopilot: false },
      { id: ids.linear, enabled: true, tools: 'read-only', autopilot: true },
      { id: ids.jiraB, enabled: true, tools: 'all', autopilot: true },
    ])
    const rows = await claudeMcpStatus(attended.handle, null, 'test', { attended: true, pickUp: false })
    expect(rows?.find((row) => row.name === 'jira-client-b')).toEqual({
      name: 'jira-client-b',
      status: 'not-started',
      tools: null,
      error: INTEGRATION_JOINED,
      source: 'integration',
      sourceWord: null,
      label: 'Jira — client B',
      integrationId: ids.jiraB,
      actions: ['restart'],
    })
    expect(mcpServerRowSchema.parse(rows?.find((row) => row.name === 'jira-client-b'))).toBeTruthy()
    const fixed = await claudeMcpStatus(unattended.handle, null, 'test', { attended: false, pickUp: false })
    expect(fixed?.map((row) => row.name)).toEqual([CANVAS_SERVER_NAME, 'linear'])
    // The Restart's new start gets it.
    expect(serverNames(await start())).toEqual([CANVAS_SERVER_NAME, 'jira-client-a', 'linear', 'jira-client-b'])
  })
})
