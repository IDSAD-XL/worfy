// The Integrations of a Project in a Codex Session (worfy-integrations ticket 07; ADR-0111 item 1; spec, implementation
// decisions, Session Codex; Q8). Each enabled Integration of the Project's `integrations` (its settings.json) that the
// Machine's store still has goes to Codex as a key `mcp_servers.<name>` of the thread/start config: the URL of worfy's
// endpoint on 127.0.0.1 (src/main/mcp/http-server.ts) and `bearer_token_env_var` of the Session, as worfy-canvas goes.
// The endpoint serves the same McpServer of the proxy (src/main/integrations/proxy.ts) the Claude Session gets: the
// Project's tools filter cuts tools/list and tools/call, and each description is led by the label. Two Integrations on
// one address of a service are two names, each answering with its own data. A Session outside every Project gets none,
// an unattended one only those «Available to Autopilot». Their rows in the chip «MCP n/m» have the source
// `integration` and the label; a refused sign-in shows in the row, and Codex's own sign-in is never offered for them.
//
// The token of a service never reaches Codex: not in the arguments or the environment of its process, not in the
// thread/start config or any other message to it, not in a line of main's log, not in the Session's events (what the
// Journal and the Flight recorder read) and not in the endpoint's answers (what Codex's transcript keeps).
//
// The Session runs on the fake app-server (WORFY_CODEX=fake, which test/setup-contract.ts sets) under scriptNode(),
// through the spawn stand-in of the session part, as in test/contract/codex-session-mcp.test.ts; the script is
// test/fixtures/codex-scripts/integrations.jsonl. The test plays Codex's part with the tools: it reads the URL from
// thread/start and the Session's token from the process's environment, and calls the endpoint over HTTP. No real
// Codex runs; the service is the stub of test/fixtures/integrations/service-stub.ts.
import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hasExited } from '../../src/main/agent/session/process'
import { IntegrationProxy } from '../../src/main/integrations/proxy'
import { IntegrationStore } from '../../src/main/integrations/store'
import type { CanvasBinding } from '../../src/main/mcp/canvas-server'
import { startMcpHttpEndpoint, type McpHttpEndpoint } from '../../src/main/mcp/http-server'
import { readProjectIntegrations, writeProjectIntegrations } from '../../src/main/projects/settings'
import type { CodexRuntime } from '../../src/main/vendors/codex/binary'
import { codexConfigServerNames, codexIntegrations, codexMcp, codexMcpSessions, configReplacedNote, INTEGRATION_JOINED, MCP_TOKEN_ENV, type CodexMcpResolver } from '../../src/main/vendors/codex/mcp'
import { codexSessions } from '../../src/main/vendors/codex/session'
import { McpActionRefused, type McpCallExtra, type McpServer } from '../../src/main/vendors/mcp'
import type { SessionHandle, SessionPart, SessionStart } from '../../src/main/vendors/session'
import type { AgentEvent } from '../../src/shared/agent/events'
import { mcpServerRowSchema, mcpShownName } from '../../src/shared/agent/mcp-status'
import { DEFAULT_SETTINGS } from '../../src/shared/agent/settings'
import { CANVAS_SERVER_NAME } from '../../src/shared/canvas/tools'
import type { ProjectIntegration } from '../../src/shared/integrations/types'
import { startServiceStub, type ServiceStub } from '../fixtures/integrations/service-stub'
import { removeTestTree } from '../remove'
import { scriptNode } from '../script-node'
import { ms } from '../time-scale'

const REPO = join(import.meta.dirname, '..', '..')
const RUNTIME: CodexRuntime = { packaged: false, resourcesPath: '/Resources', platform: process.platform, arch: process.arch }
const ANSWER_MS = ms(10_000)

const TOKEN_A = 'tok-jira-a-5be1c09a'
const TOKEN_B = 'tok-jira-b-07d3f4e2'
const TOKEN_L = 'tok-linear-c82a61f9'
const TOKENS = [TOKEN_A, TOKEN_B, TOKEN_L]
const leaks = (text: string): string[] => TOKENS.filter((token) => text.includes(token))

let scratch: string
let projectData: string
let stub: ServiceStub
let store: IntegrationStore
let proxy: IntegrationProxy
let endpoint: McpHttpEndpoint
const handles: SessionHandle[] = []
const children: ChildProcess[] = []

beforeEach(async () => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-integrations-codex-')))
  projectData = join(scratch, 'project-data')
  mkdirSync(projectData)
  // One address of the service, three sign-ins: each token opens a dataset of its own.
  stub = await startServiceStub({ bearer: { [TOKEN_A]: 'alpha', [TOKEN_B]: 'beta', [TOKEN_L]: 'gamma' } })
  store = new IntegrationStore(join(scratch, 'integrations'))
  proxy = new IntegrationProxy({ store })
  endpoint = await startMcpHttpEndpoint()
  const add = (label: string, token: string): string => {
    const added = store.add({ service: 'custom', label, auth: 'bearer', transport: { kind: 'http', url: stub.url } })
    store.setSecret(added.id, 'access', token)
    return added.id
  }
  const jiraA = add('Jira — client A', TOKEN_A)
  const jiraB = add('Jira — client B', TOKEN_B)
  const linear = add('Linear', TOKEN_L)
  const off = add('Notion', TOKEN_L)
  const entries: ProjectIntegration[] = [
    { id: jiraA, enabled: true, tools: 'all', autopilot: false },
    { id: jiraB, enabled: true, tools: 'all', autopilot: true },
    { id: linear, enabled: true, tools: 'read-only', autopilot: false },
    // Turned off in this Project.
    { id: off, enabled: false, tools: 'all', autopilot: true },
    // Removed from the Machine since: skipped, never an error.
    { id: 'removed-0000', enabled: true, tools: 'all', autopilot: true },
  ]
  writeProjectIntegrations(projectData, entries)
})

afterEach(async () => {
  vi.restoreAllMocks()
  for (const handle of handles.splice(0)) handle.close()
  for (const child of children.splice(0)) {
    if (child.pid === undefined || hasExited(child)) continue
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()))
    child.kill('SIGKILL')
    await exited
  }
  await endpoint.close()
  await proxy.close()
  await stub.close()
  removeTestTree(scratch)
})

async function eventually(check: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + ANSWER_MS
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`not in time: ${what}`)
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

/** A canvas binding of the Project: worfy-canvas with no tools, enough to stand beside the Integrations. */
const canvas = (): CanvasBinding => ({
  server: { name: CANVAS_SERVER_NAME, version: '1.0.0', tools: [] },
  cardsDir: join(scratch, 'cards'),
  instructions: 'The Cards folder.',
  setSessionId: () => undefined,
  wrote: () => undefined,
})

/** The resolver of a Session's servers: `project: false` — the canvas finds no Project; `listed` — the Profile's list. */
function resolver(input: { project?: boolean; listed?: readonly string[]; userServers?: readonly string[] } = {}): CodexMcpResolver {
  return codexMcpSessions({
    canvas: () => Promise.resolve(input.project === false ? null : canvas()),
    browser: () => Promise.resolve(null),
    allowlist: () => Promise.resolve(input.listed ?? [CANVAS_SERVER_NAME]),
    endpoint: () => Promise.resolve(endpoint),
    integrations: codexIntegrations({ dataDirOf: () => (input.project === false ? null : projectData), store, proxy, taken: () => [] }),
    userServers: () => Promise.resolve(input.userServers ?? []),
  })
}

interface Logged {
  method?: string
  params?: Record<string, unknown>
}

interface Started {
  handle: SessionHandle
  events: AgentEvent[]
  /** The arguments and the environment of the Codex process. */
  launch: { args: readonly string[]; env: NodeJS.ProcessEnv }
  /** Every message worfy sent the fake, as its log has it. */
  logText: () => string
  start: Logged
  /** The servers of thread/start, by name. */
  servers: Record<string, { url: string; bearer_token_env_var: string }>
  /** The Session's token, from the process's environment, as Codex reads it. */
  token: string
  mainLog: string[]
}

/** One Codex Session on the fake playing integrations.jsonl, with worfy's MCP servers by `mcp`. */
async function startSession(mcp: CodexMcpResolver, unattended = false): Promise<Started> {
  const root = join(scratch, `session-${handles.length}`)
  mkdirSync(root)
  const log = join(root, 'codex.log')
  const launches: Started['launch'][] = []
  const mainLog: string[] = []
  const spawnProcess = (_file: string, args: readonly string[], spawnOptions: SpawnOptions): ChildProcess => {
    launches.push({ args, env: spawnOptions.env ?? {} })
    const child = spawn(scriptNode(), [...args], spawnOptions)
    children.push(child)
    return child
  }
  const part: SessionPart = codexSessions(() =>
    Promise.resolve({
      runtime: RUNTIME,
      appPath: REPO,
      clientVersion: '9.9.9',
      env: { ...process.env, WORFY_CODEX_SCRIPT: 'integrations', WORFY_CODEX_LOG: log },
      spawnProcess,
      log: (line: string) => void mainLog.push(line),
      mcp,
    }),
  )
  const opts: SessionStart = {
    cwd: root,
    settings: DEFAULT_SETTINGS,
    unattended,
    orchestrator: false,
    permissions: { ask: () => Promise.resolve(null), askQuestions: () => Promise.resolve({ outcome: 'cancelled' }) },
    refused: () => undefined,
    stderr: (text) => void mainLog.push(text),
    spawned: () => undefined,
  }
  const handle = await part.start({ ...opts, sessionId: 'worfy-session-1' })
  handles.push(handle)
  const events: AgentEvent[] = []
  void (async () => {
    try {
      for await (const event of handle.events) events.push(event)
    } catch {
      // The events end with the Session.
    }
  })()
  const logText = (): string => {
    try {
      return readFileSync(log, 'utf8')
    } catch {
      return ''
    }
  }
  const logged = (): Logged[] =>
    logText()
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => JSON.parse(line) as Logged)
  await eventually(() => logged().some((message) => message.method === 'thread/start'), 'thread/start')
  const start = logged().find((message) => message.method === 'thread/start') ?? {}
  const servers = Object.fromEntries(
    Object.entries((start.params?.config ?? {}) as Record<string, { url: string; bearer_token_env_var: string }>)
      .filter(([key]) => key.startsWith('mcp_servers.'))
      .map(([key, value]) => [key.slice('mcp_servers.'.length), value]),
  )
  const [launch] = launches
  if (launch === undefined) throw new Error('no Codex process was started')
  return { handle, events, launch, logText, start, servers, token: launch.env[MCP_TOKEN_ENV] ?? '', mainLog }
}

interface Answer {
  result?: { tools?: { name: string; description: string }[]; content?: { type: string; text?: string }[]; isError?: boolean }
  error?: { code: number; message: string }
}

/** One JSON-RPC request to a server of the endpoint, as Codex sends it. */
async function rpc(url: string, token: string, method: string, params: unknown = {}): Promise<Answer> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  expect(response.status).toBe(200)
  return (await response.json()) as Answer
}

const textOf = (answer: Answer): string => (answer.result?.content ?? []).map((block) => block.text ?? '').join('\n')

describe('a Codex Session of the Project', () => {
  it('starts its thread with mcp_servers.<name> of each enabled Integration: the endpoint`s URL and the Session`s token variable', async () => {
    const session = await startSession(resolver())
    expect(Object.keys(session.servers).sort()).toEqual(['jira-client-a', 'jira-client-b', 'linear', CANVAS_SERVER_NAME])
    for (const name of ['jira-client-a', 'jira-client-b', 'linear']) {
      expect(session.servers[name]).toEqual({ url: `http://127.0.0.1:${endpoint.port}/mcp/${name}`, bearer_token_env_var: MCP_TOKEN_ENV })
    }
    expect(session.token).not.toBe('')
  })

  it('two Integrations on one address of the service are two names, each answering with its own data', async () => {
    const session = await startSession(resolver())
    expect(session.servers['jira-client-a']?.url).not.toBe(session.servers['jira-client-b']?.url)
    const a = await rpc(session.servers['jira-client-a']!.url, session.token, 'tools/call', { name: 'whoami', arguments: {} })
    const b = await rpc(session.servers['jira-client-b']!.url, session.token, 'tools/call', { name: 'whoami', arguments: {} })
    expect(textOf(a)).toBe('dataset alpha')
    expect(textOf(b)).toBe('dataset beta')
  })

  it('the endpoint lists the tools the Project`s filter lets through, each led by the label, with the service`s hints', async () => {
    const session = await startSession(resolver())
    const linear = await rpc(session.servers.linear!.url, session.token, 'tools/list')
    expect(linear.result?.tools?.map((tool) => tool.name)).toEqual(['whoami', 'list_items'])
    expect(linear.result?.tools?.[0]).toMatchObject({ description: '[Linear] The dataset of this sign-in', annotations: { readOnlyHint: true } })
    const jira = await rpc(session.servers['jira-client-a']!.url, session.token, 'tools/list')
    expect(jira.result?.tools?.map((tool) => tool.name)).toEqual(['whoami', 'list_items', 'create_item', 'picture', 'careless', 'broken'])
    expect(jira.result?.tools?.every((tool) => tool.description.startsWith('[Jira — client A] '))).toBe(true)
  })

  it('the endpoint refuses a call of a tool the filter cut, before the service', async () => {
    const session = await startSession(resolver())
    const before = stub.log.filter((entry) => entry.method === 'tools/call').length
    const refused = await rpc(session.servers.linear!.url, session.token, 'tools/call', { name: 'create_item', arguments: { title: 'x' } })
    expect(refused.result).toBeUndefined()
    expect(refused.error?.message).toMatch(/create_item/u)
    expect(stub.log.filter((entry) => entry.method === 'tools/call').length).toBe(before)
  })

  it('an unattended Session gets only the Integrations «Available to Autopilot»', async () => {
    const session = await startSession(resolver(), true)
    expect(Object.keys(session.servers).sort()).toEqual(['jira-client-b', CANVAS_SERVER_NAME])
  })

  it('gets its Integrations when the Profile`s list names none of worfy`s servers, and no instructions of theirs', async () => {
    const session = await startSession(resolver({ listed: [] }))
    expect(Object.keys(session.servers).sort()).toEqual(['jira-client-a', 'jira-client-b', 'linear'])
    // Codex keeps the developer instructions of its own config: worfy sets none for Integrations alone.
    expect(session.start.params?.developerInstructions ?? null).toBeNull()
  })
})

describe('a Codex Session outside every Project', () => {
  it('gets no Integration', async () => {
    const session = await startSession(resolver({ project: false }))
    expect(session.servers).toEqual({})
  })
})

describe('the rows of a Codex Session`s Integrations in the chip', () => {
  it('have the source integration and the label; a refused sign-in shows in the row, and Codex`s own Sign in is not offered', async () => {
    const session = await startSession(resolver())
    const rows = await codexMcp.status!(session.handle)
    const row = rows?.find((each) => each.name === 'jira-client-a')
    expect(row).toEqual({ name: 'jira-client-a', status: 'connected', tools: 6, error: null, source: 'integration', sourceWord: null, label: 'Jira — client A', integrationId: expect.any(String), actions: [] })
    expect(mcpServerRowSchema.parse(row)).toEqual(row)
    expect(row === undefined ? null : mcpShownName(row)).toBe('Jira — client A')
    expect(rows?.find((each) => each.name === CANVAS_SERVER_NAME)).toMatchObject({ source: 'worfy', actions: [] })
    // Codex lists the tools when the server starts; then the service no longer takes the token: a call answers
    // Sign-in needed, and the row says so.
    await rpc(session.servers['jira-client-a']!.url, session.token, 'tools/list')
    stub.revoke(TOKEN_A)
    const refused = await rpc(session.servers['jira-client-a']!.url, session.token, 'tools/call', { name: 'whoami', arguments: {} })
    expect(refused.result?.isError).toBe(true)
    expect(textOf(refused)).toMatch(/^Sign-in needed: Jira — client A\./u)
    const after = await codexMcp.status!(session.handle)
    expect(after?.find((each) => each.name === 'jira-client-a')).toMatchObject({ status: 'needs-auth', error: expect.stringMatching(/^Sign-in needed: Jira — client A\./u), source: 'integration', actions: ['reconnect'] })
    expect(after?.find((each) => each.name === 'jira-client-b')).toMatchObject({ status: 'connected', source: 'integration', label: 'Jira — client B' })
    // Codex's mcpServer/oauth/login would sign in to worfy's endpoint, not to the service.
    await expect(codexMcp.act!(session.handle, 'jira-client-a', 'sign-in')).rejects.toBeInstanceOf(McpActionRefused)
  }, ms(20_000))

  it('a sign-in refused before Codex listed any tool: tools/list fails with Sign-in needed, and the row says so', async () => {
    const session = await startSession(resolver())
    stub.revoke(TOKEN_B)
    const refused = await rpc(session.servers['jira-client-b']!.url, session.token, 'tools/list')
    expect(refused.result).toBeUndefined()
    expect(refused.error?.message).toMatch(/^Sign-in needed: Jira — client B\./u)
    const rows = await codexMcp.status!(session.handle)
    expect(rows?.find((each) => each.name === 'jira-client-b')).toMatchObject({ status: 'needs-auth', error: expect.stringMatching(/^Sign-in needed: Jira — client B\./u), actions: ['reconnect'] })
  })

  it('the `mcp` events of the Session carry the same rows', async () => {
    const session = await startSession(resolver())
    await codexMcp.status!(session.handle)
    await eventually(() => session.events.some((event) => event.type === 'mcp'), 'an mcp event')
    const event = session.events.find((each) => each.type === 'mcp')
    const servers = (event?.type === 'mcp' ? event.servers : null) ?? []
    expect(servers.find((each) => each.name === 'linear')).toMatchObject({ source: 'integration', label: 'Linear' })
  })
})

describe('the endpoint passes the agent`s cancel on to the call', () => {
  /** A server whose one tool `slow` runs until its call is cancelled; `calls` holds the signal of each call. */
  function slowServer(): { server: McpServer; calls: AbortSignal[] } {
    const calls: AbortSignal[] = []
    const server: McpServer = {
      name: 'slow-service',
      version: '1.0.0',
      tools: [],
      listTools: () =>
        Promise.resolve([
          {
            name: 'slow',
            description: 'Runs until cancelled',
            inputSchema: { type: 'object' },
            call: (_args: unknown, extra?: McpCallExtra) => {
              const signal = extra?.signal
              if (signal === undefined) return Promise.resolve({ content: [{ type: 'text' as const, text: 'no signal' }], isError: true })
              calls.push(signal)
              return new Promise((resolve) => signal.addEventListener('abort', () => resolve({ content: [{ type: 'text' as const, text: 'cancelled' }], isError: true })))
            },
          },
        ]),
    }
    return { server, calls }
  }

  const post = (url: string, token: string, body: unknown, signal?: AbortSignal): Promise<Response> =>
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      ...(signal === undefined ? {} : { signal }),
    })

  it('a request Codex abandons — its connection closed before the answer — cancels the call', async () => {
    const { server, calls } = slowServer()
    const grant = endpoint.grant([server])
    const client = new AbortController()
    const pending = post(grant.urls['slow-service']!, grant.token, { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'slow', arguments: {} } }, client.signal).catch(() => null)
    await eventually(() => calls.length === 1, 'the call to start')
    expect(calls[0]?.aborted).toBe(false)
    client.abort()
    await pending
    await eventually(() => calls[0]?.aborted === true, 'the call to be cancelled')
  })

  it('notifications/cancelled of the request`s id cancels that call only, and only for the same Session', async () => {
    const { server, calls } = slowServer()
    const grant = endpoint.grant([server])
    const other = endpoint.grant([server])
    const url = grant.urls['slow-service']!
    const call = (id: number) => post(url, grant.token, { jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'slow', arguments: {} } })
    const first = call(1)
    const second = call(2)
    await eventually(() => calls.length === 2, 'both calls to start')
    const cancel = (token: string, requestId: number) => post(url, token, { jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId, reason: 'the turn was interrupted' } })
    // Another Session's token, and an id no call has: nothing is cancelled.
    expect((await cancel(other.token, 1)).status).toBe(202)
    expect((await cancel(grant.token, 99)).status).toBe(202)
    expect(calls.map((signal) => signal.aborted)).toEqual([false, false])
    expect((await cancel(grant.token, 1)).status).toBe(202)
    const answered = (await (await first).json()) as Answer
    expect(textOf(answered)).toBe('cancelled')
    expect(calls.map((signal) => signal.aborted)).toEqual([true, false])
    expect((await cancel(grant.token, 2)).status).toBe(202)
    await second
  })
})

describe('the token of a service', () => {
  it('is not in the Codex process, in anything sent to it, in main`s log, in the Session`s events or in the endpoint`s answers', async () => {
    const lines: string[] = []
    for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => void lines.push(args.map((arg) => (arg instanceof Error ? `${arg.message}\n${arg.stack ?? ''}` : typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' ')))
    }
    const session = await startSession(resolver())
    const answers: string[] = []
    for (const name of ['jira-client-a', 'jira-client-b', 'linear']) {
      const url = session.servers[name]!.url
      answers.push(JSON.stringify(await rpc(url, session.token, 'tools/list')))
      for (const tool of ['whoami', 'careless', 'broken', 'picture', 'create_item']) answers.push(JSON.stringify(await rpc(url, session.token, 'tools/call', { name: tool, arguments: { title: 't' } })))
    }
    stub.revoke(TOKEN_A)
    answers.push(JSON.stringify(await rpc(session.servers['jira-client-a']!.url, session.token, 'tools/call', { name: 'whoami', arguments: {} })))
    await codexMcp.status!(session.handle)
    // The careless tool quoted the token, the broken one failed with it: the answers carry neither.
    expect(answers.join('\n')).toMatch(/dataset gamma/u)
    expect(leaks(answers.join('\n'))).toEqual([])
    expect(leaks(session.launch.args.join('\n'))).toEqual([])
    expect(leaks(JSON.stringify(session.launch.env))).toEqual([])
    expect(leaks(session.logText())).toEqual([])
    expect(leaks(JSON.stringify(session.start))).toEqual([])
    expect(leaks(JSON.stringify(session.events))).toEqual([])
    expect(leaks([...lines, ...session.mainLog].join('\n'))).toEqual([])
  }, ms(20_000))
})

// worfy-integrations ticket 09 (the review of ticket 07): an Integration whose server name is a server of the user's
// config.toml replaces it in the Session — its row says so — and an Integration turned on while the Session runs is a
// row «not started» whose Restart, with the same conversation, gives it to the Session in thread/resume.
describe('the rows of a Codex Session`s Integrations, ticket 09', () => {
  it('a server of the user`s config.toml with an Integration`s name is replaced in the Session, and its row says so', async () => {
    const session = await startSession(resolver({ userServers: ['jira-client-a', 'notes'] }))
    const rows = await codexMcp.status!(session.handle)
    expect(rows?.find((each) => each.name === 'jira-client-a')).toMatchObject({ source: 'integration', note: configReplacedNote('jira-client-a') })
    expect(rows?.find((each) => each.name === 'jira-client-b')?.note).toBeUndefined()
  })

  it('an Integration turned on while the Session runs is «not started» with Restart; the next start gets it', async () => {
    const session = await startSession(resolver())
    const entries = readProjectIntegrations(projectData)
    writeProjectIntegrations(
      projectData,
      entries.map((entry) => (entry.enabled ? entry : { ...entry, enabled: true })),
    )
    const rows = await codexMcp.status!(session.handle)
    expect(rows?.find((each) => each.name === 'notion')).toMatchObject({ status: 'not-started', source: 'integration', label: 'Notion', error: INTEGRATION_JOINED, actions: ['restart'] })
    expect(codexMcp.restarts).toBe(true)
    const again = await resolver()({ cwd: scratch, resume: 'thread-1', unattended: false })
    expect(Object.keys(again?.config ?? {})).toContain('mcp_servers.notion')
    again?.close()
  })

  it('an unattended Session shows no Integration turned on in the middle of its Wave', async () => {
    const session = await startSession(resolver(), true)
    writeProjectIntegrations(
      projectData,
      readProjectIntegrations(projectData).map((entry) => ({ ...entry, enabled: true })),
    )
    const rows = await codexMcp.status!(session.handle)
    expect(rows?.some((each) => each.status === 'not-started')).toBe(false)
  })
})

describe('the names of the MCP servers of a config.toml', () => {
  it('reads the tables [mcp_servers.<name>], quoted or bare, and their dotted keys, nothing else', () => {
    const text = [
      'model = "o4"',
      // A dotted key at the top, before any table, is a server.
      'mcp_servers.dotted.command = "npx"',
      '[mcp_servers.jira-client-a]',
      'url = "https://example.com/mcp"',
      '[mcp_servers."two words"]',
      "[mcp_servers.'single'.env]",
      'A = "1"',
      '  [ mcp_servers.spaced ]',
      '[profiles.mcp_servers]',
      '# [mcp_servers.commented]',
    ].join('\n')
    expect(codexConfigServerNames(text)).toEqual(['dotted', 'jira-client-a', 'two words', 'single', 'spaced'])
  })

  it('reads a server given as an inline table at the top: mcp_servers.<name> = { … }', () => {
    expect(codexConfigServerNames(['mcp_servers.inline = { url = "https://example.com/mcp" }', 'mcp_servers."quoted one" = { command = "npx" }'].join('\n'))).toEqual(['inline', 'quoted one'])
  })

  it('reads the keys of the table [mcp_servers], until the next table', () => {
    const text = ['[mcp_servers]', 'linear = { url = "https://mcp.linear.app/mcp" }', '"two words".command = "npx"', '', '[profiles.work]', 'model = "o4"'].join('\n')
    expect(codexConfigServerNames(text)).toEqual(['linear', 'two words'])
  })

  it('does not take a dotted key of another table for a server: [profiles.work] mcp_servers.foo.enabled = false', () => {
    const text = ['[mcp_servers.real]', 'url = "https://example.com/mcp"', '[profiles.work]', 'mcp_servers.foo.enabled = false'].join('\n')
    expect(codexConfigServerNames(text)).toEqual(['real'])
  })
})
