// Integrations in Autopilot (worfy-integrations ticket 09; owner's answer Q7; ADR-0111 item 7; spec, implementation
// decisions, Autopilot). A Session no person is at gets only the Integrations «Available to Autopilot» of its Project,
// read when it starts: what the Project changes while the Wave runs does not reach it — no new server, no Restart, no
// row offering one. A sign-in the service refuses is never mended by Autopilot: the tool answers «Sign-in needed», the
// Health check gets its row, and no sign-in window opens — integrations.signIn is not called.
//
// The Claude Session is sdkQueryFactory over the fake agent (src/main/agent/fake-query.ts), whose in-process SDK
// servers a Client stand-in for Claude Code connects to; the Codex Session is the resolver of its servers
// (codexMcpSessions) with worfy's endpoint on 127.0.0.1 and a stand-in of the app-server's handle — what the fake
// app-server would be given in thread/start is the resolver's `config`. The services are the OAuth stub and the token
// stub of test/fixtures/integrations/; the OAuth sign-in a person did before the Wave follows the stub's redirect
// without a window. No real Claude Code, Codex, Electron or service.
import { mkdirSync, mkdtempSync, realpathSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeQueryFactory } from '../../src/main/agent/fake-query'
import type { QueryHandle, QueryRequest } from '../../src/main/agent/session'
import { HealthReports } from '../../src/main/first-run/health-reports'
import { IntegrationOAuth, redirectOutcome, type OpenWindow } from '../../src/main/integrations/auth/oauth'
import { integrationHealth } from '../../src/main/integrations/health'
import { IntegrationProxy, signInNeeded } from '../../src/main/integrations/proxy'
import { IntegrationStore } from '../../src/main/integrations/store'
import type { CanvasBinding, CanvasSession } from '../../src/main/mcp/canvas-server'
import { startMcpHttpEndpoint, type McpHttpEndpoint } from '../../src/main/mcp/http-server'
import { readProjectIntegrations, writeProjectIntegrations } from '../../src/main/projects/settings'
import { claudeMcpStatus } from '../../src/main/vendors/claude/mcp'
import { codexIntegrations, codexMcp, codexMcpSessions } from '../../src/main/vendors/codex/mcp'
import type { SessionHandle } from '../../src/main/vendors/session'
import type { McpServerRow } from '../../src/shared/agent/mcp-status'
import { DEFAULT_SETTINGS } from '../../src/shared/agent/settings'
import { CANVAS_SERVER_NAME } from '../../src/shared/canvas/tools'
import { startOAuthStub, type OAuthStub } from '../fixtures/integrations/oauth-stub'
import { startServiceStub, type ServiceStub } from '../fixtures/integrations/service-stub'
import { AGENT_SCRIPTS } from './autopilot-faults-setup'

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

const TOKEN_L = 'tok-linear-2f7a90c1'

let scratch: string
let cwd: string
let projectData: string
let oauthStub: OAuthStub
let tokenStub: ServiceStub
let store: IntegrationStore
let reports: HealthReports
let oauth: IntegrationOAuth
let proxy: IntegrationProxy
let endpoint: McpHttpEndpoint
let clients: Client[]
/** The Integrations a sign-in window opened for. */
let windows: string[]
let ids: { jira: string; linear: string }
const project = { id: 'alpha-0000000a', name: 'alpha' }

/** The sign-in window of a person: it follows the stub's redirect, which approves at once, and catches the code. */
const openWindow: OpenWindow = (request) => {
  windows.push(request.id)
  return {
    outcome: (async () => {
      const answer = await fetch(request.authorizationUrl, { redirect: 'manual' })
      const outcome = redirectOutcome(answer.headers.get('location') ?? '', request.id, request.state)
      if (outcome === null) throw new Error('no redirect')
      return outcome
    })(),
    close: () => undefined,
  }
}

beforeEach(async () => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-integrations-autopilot-')))
  cwd = join(scratch, 'repo')
  projectData = join(scratch, 'project-data')
  mkdirSync(cwd)
  mkdirSync(projectData)
  mocks.agentEnv.mockReset().mockResolvedValue({ env: { HOME: join(scratch, 'home'), PATH: '/usr/bin:/bin' }, from: 'login-shell' })
  oauthStub = await startOAuthStub()
  tokenStub = await startServiceStub({ bearer: { [TOKEN_L]: 'beta' } })
  store = new IntegrationStore(join(scratch, 'integrations'))
  windows = []
  clients = []
  oauth = new IntegrationOAuth({ store, openWindow, clearPartition: async () => undefined })
  reports = new HealthReports()
  proxy = new IntegrationProxy({
    store,
    oauth: (integration) => oauth.transport(integration),
    onStatus: integrationHealth({ reports, store, projects: () => ({ list: () => [project], dataDir: () => projectData }) }),
  })
  endpoint = await startMcpHttpEndpoint()
  const jira = store.add({ service: 'custom', label: 'Jira — client A', auth: 'oauth', transport: { kind: 'http', url: oauthStub.url } }).id
  const linear = store.add({ service: 'custom', label: 'Linear', auth: 'bearer', transport: { kind: 'http', url: tokenStub.url } }).id
  store.setSecret(linear, 'access', TOKEN_L)
  ids = { jira, linear }
  // A person signed Jira in before the Wave.
  await oauth.signIn(jira)
  windows = []
  writeProjectIntegrations(projectData, [
    { id: jira, enabled: true, tools: 'all', autopilot: true },
    { id: linear, enabled: true, tools: 'all', autopilot: false },
  ])
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})

afterEach(async () => {
  vi.restoreAllMocks()
  for (const client of clients) await client.close()
  await endpoint.close()
  await proxy.close()
  await oauthStub.close()
  await tokenStub.close()
  await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

interface Started {
  servers: Record<string, { type: string; instance?: unknown }>
  handle: QueryHandle
}

/** One start of a Claude Session of the Project through sdkQueryFactory; the fake agent answers its servers connected. */
async function startClaude(unattended: boolean): Promise<Started> {
  const request: QueryRequest = {
    prompt: (async function* () {})(),
    cwd,
    resume: undefined,
    stderr: () => undefined,
    settings: DEFAULT_SETTINGS,
    canUseTool: () => Promise.resolve({ behavior: 'deny', message: 'not in this test' }),
    unattended,
  }
  const handle = await fakeQueryFactory({ scriptsDir: AGENT_SCRIPTS, script: 'turn' })({ ...request, mcpListed: undefined })
  let servers: Started['servers'] | undefined
  const sdk = {
    query: ({ options }: { options: { mcpServers?: Started['servers'] } }) => {
      servers = options.mcpServers ?? {}
      handle.mcpServerStatus = () => Promise.resolve(Object.keys(servers ?? {}).map((name) => ({ name, status: 'connected', source: 'sdk', tools: [{ name: 'whoami' }] })))
      return handle
    },
  }
  const attached: CanvasSession = {
    attachment: { server: { type: 'sdk', name: CANVAS_SERVER_NAME } as never, cardsDir: join(scratch, 'cards'), instructions: 'canvas' },
    observe: (query) => query,
  }
  const got = await sdkQueryFactory(() => Promise.resolve(attached), () => Promise.resolve([CANVAS_SERVER_NAME]), {
    loadSdk: () => Promise.resolve(sdk),
    autoCompactWindow: () => null,
    browser: () => Promise.resolve(null),
    skills: () => Promise.resolve(null),
    privateSkills: () => Promise.resolve(null),
    integrations: projectIntegrationsResolver({ dataDirOf: () => projectData, store, proxy, taken: () => [] }),
  })(request)
  if (servers === undefined) throw new Error('query() was not called')
  return { servers, handle: got }
}

/** Claude Code's side of the Session's in-process server `name`. */
async function connect(started: Started, name: string): Promise<Client> {
  const server = started.servers[name]
  if (server?.instance === undefined) throw new Error(`no SDK server ${name}`)
  const [ours, theirs] = InMemoryTransport.createLinkedPair()
  await (server.instance as { connect(transport: InMemoryTransport): Promise<void> }).connect(theirs)
  const client = new Client({ name: 'claude-code-stand-in', version: '1.0.0' })
  await client.connect(ours)
  clients.push(client)
  return client
}

const textOf = (result: unknown): string =>
  (((result as { content?: unknown }).content ?? []) as { type: string; text?: string }[])
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('\n')

/** The Project changes its mind while the Wave runs: Jira is no longer for Autopilot, Linear is. */
function flipAutopilot(): void {
  writeProjectIntegrations(
    projectData,
    readProjectIntegrations(projectData).map((entry) => ({ ...entry, autopilot: !entry.autopilot })),
  )
}

describe('a Claude Session of Autopilot', () => {
  it('gets only the Integrations «Available to Autopilot»; a person`s Session gets every enabled one', async () => {
    expect(Object.keys((await startClaude(true)).servers)).toEqual([CANVAS_SERVER_NAME, 'jira-client-a'])
    expect(Object.keys((await startClaude(false)).servers)).toEqual([CANVAS_SERVER_NAME, 'jira-client-a', 'linear'])
  })

  it('keeps its set through the Wave: a change of the Project adds no server, no Restart and no row that offers one', async () => {
    const started = await startClaude(true)
    const client = await connect(started, 'jira-client-a')
    flipAutopilot()
    // The server it has still answers, and the rows are the same, with nothing to restart.
    expect(textOf(await client.callTool({ name: 'whoami', arguments: {} }))).toBe('dataset client-1')
    const rows = (await claudeMcpStatus(started.handle, null, 'autopilot', { attended: false, pickUp: false })) ?? []
    expect(rows.map((row) => row.name)).toEqual([CANVAS_SERVER_NAME, 'jira-client-a'])
    expect(rows.flatMap((row) => row.actions)).toEqual([])
  })

  it('a refused sign-in answers «Sign-in needed», makes the Health check row, and opens no window', async () => {
    const signIn = vi.spyOn(oauth, 'signIn')
    const started = await startClaude(true)
    const client = await connect(started, 'jira-client-a')
    await client.listTools()
    oauthStub.expireAccessTokens()
    oauthStub.expireRefreshTokens()
    const refused = await client.callTool({ name: 'whoami', arguments: {} })
    expect(refused.isError).toBe(true)
    expect(textOf(refused)).toBe(signInNeeded('Jira — client A'))
    expect(signIn).not.toHaveBeenCalled()
    expect(windows).toEqual([])
    const row = reports.current()?.checks.find((check) => check.id === 'integration')
    expect(row).toMatchObject({ status: 'fail', severity: 'non-critical', project, subject: { id: ids.jira, label: 'Jira — client A' }, detail: 'Jira — client A: sign-in needed' })
    // The row of the chip says so too, and an unattended Session's row offers nothing.
    const rows = (await claudeMcpStatus(started.handle, null, 'autopilot', { attended: false, pickUp: false })) ?? []
    expect(rows.find((each) => each.name === 'jira-client-a')).toMatchObject({ status: 'needs-auth', error: signInNeeded('Jira — client A'), actions: [] })
    expect(signIn).not.toHaveBeenCalled()
    expect(windows).toEqual([])
  })
})

describe('a Codex Session of Autopilot', () => {
  const canvas = (): CanvasBinding => ({
    server: { name: CANVAS_SERVER_NAME, version: '1.0.0', tools: [] },
    cardsDir: join(scratch, 'cards'),
    instructions: 'The Cards folder.',
    setSessionId: () => undefined,
    wrote: () => undefined,
  })
  const resolver = () =>
    codexMcpSessions({
      canvas: () => Promise.resolve(canvas()),
      browser: () => Promise.resolve(null),
      allowlist: () => Promise.resolve([CANVAS_SERVER_NAME]),
      endpoint: () => Promise.resolve(endpoint),
      integrations: codexIntegrations({ dataDirOf: () => projectData, store, proxy, taken: () => [] }),
    })

  /** A stand-in of the Codex driver's handle: Codex reports every server of thread/start connected. */
  function handleOf(names: readonly string[]): SessionHandle {
    const rows = (): McpServerRow[] => names.map((name) => ({ name, status: 'connected', tools: 6, error: null, source: 'user', sourceWord: null, actions: [] }))
    return {
      events: (async function* () {})(),
      close: () => undefined,
      codexMcpStatus: () => Promise.resolve(rows()),
      codexMcpReload: () => Promise.resolve(),
      codexMcpSignIn: () => Promise.resolve(),
    } as unknown as SessionHandle
  }

  it('starts its thread with only the Integrations «Available to Autopilot», and keeps them through the Wave', async () => {
    const session = await resolver()({ cwd, resume: undefined, unattended: true })
    const names = Object.keys(session?.config ?? {}).map((key) => key.slice('mcp_servers.'.length))
    expect(names).toEqual([CANVAS_SERVER_NAME, 'jira-client-a'])
    const handle = session!.observe(handleOf(names))
    flipAutopilot()
    const rows = (await codexMcp.status!(handle)) ?? []
    expect(rows.map((row) => row.name)).toEqual([CANVAS_SERVER_NAME, 'jira-client-a'])
    expect(rows.flatMap((row) => row.actions)).toEqual([])
    session!.close()
  })
})
