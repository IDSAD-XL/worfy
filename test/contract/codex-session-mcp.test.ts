// worfy's MCP servers for a Codex Session in a Project (worfy-multi-vendor ticket 33,
// src/main/vendors/codex/mcp.ts and the hunks of src/main/vendors/codex/session.ts that pass them on): the
// endpoint of src/main/mcp/http-server.ts, the Project's canvas and Browser bound as the Claude driver
// binds them, and the Profile's list naming `worfy-canvas`. The Session runs on the fake app-server
// (WORFY_CODEX=fake, which test/setup-contract.ts sets) under scriptNode() (test/script-node.ts), through
// the spawn stand-in of the session part, as in test/contract/codex-session.test.ts; what worfy sent is
// read from the fake's log (WORFY_CODEX_LOG). The tools are called over HTTP, as Codex calls them.
import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { AgentEvent } from '../../src/shared/agent/events'
import { DEFAULT_SETTINGS } from '../../src/shared/agent/settings'
import type { BrowserProfile } from '../../src/shared/browser/profiles'
import { AUTOPILOT_ONLY } from '../../src/shared/browser/tools'
import { SessionRegistry } from '../../src/main/agent/session'
import { hasExited } from '../../src/main/agent/session/process'
import type { LiveBrowsers } from '../../src/main/browser/live'
import { CardAsk } from '../../src/main/cards/ask'
import { sendFromCard } from '../../src/main/ipc/card-api'
import { LayoutStore } from '../../src/main/layout/store'
import { browserBindingForSession } from '../../src/main/mcp/browser-server'
import { canvasBindingForSession } from '../../src/main/mcp/canvas-server'
import { startMcpHttpEndpoint, type McpHttpEndpoint } from '../../src/main/mcp/http-server'
import type { CodexRuntime } from '../../src/main/vendors/codex/binary'
import { codexMcpSessions, type CodexMcpResolver } from '../../src/main/vendors/codex/mcp'
import { codexSessions } from '../../src/main/vendors/codex/session'
import type { SessionHandle, SessionPart, SessionStart } from '../../src/main/vendors/session'
import { removeTestTree } from '../remove'
import { scriptNode } from '../script-node'
import { ms } from '../time-scale'

const REPO = join(import.meta.dirname, '..', '..')
const RUNTIME: CodexRuntime = { packaged: false, resourcesPath: '/Resources', platform: process.platform, arch: process.arch }
const PROJECT = 'demo-0a1b2c3d'
/** The thread the fake's scripts start. */
const THREAD = 'thr_fake_1'

/** How long the fake may take to send what a test waits for. */
const ANSWER_MS = ms(10_000)

/** A Browser profile the user did not mark «Available to Autopilot». */
const ADMIN: BrowserProfile = { id: 'admin-aaaaaa', name: 'admin', origins: ['https://site.example'], autopilot: false }

const roots: string[] = []
const handles: SessionHandle[] = []
const children: ChildProcess[] = []
const endpoints: McpHttpEndpoint[] = []
afterEach(async () => {
  for (const handle of handles.splice(0)) handle.close()
  for (const child of children.splice(0)) {
    if (child.pid === undefined || hasExited(child)) continue
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()))
    child.kill('SIGKILL')
    await exited
  }
  for (const endpoint of endpoints.splice(0)) await endpoint.close()
  for (const root of roots.splice(0)) removeTestTree(root)
})

/** Waits until `check` holds, looking every 20 ms, for ANSWER_MS at most. */
async function eventually(check: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + ANSWER_MS
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`not in time: ${what}`)
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

interface Logged {
  method?: string
  params?: Record<string, unknown>
}

/** A session part over the fake playing `script`, and what a test looks at. */
interface Fake {
  part: SessionPart
  root: string
  log: string
  /** The arguments and the environment each process was started with, in order. */
  launches: { args: readonly string[]; env: NodeJS.ProcessEnv }[]
  started: ChildProcess[]
  /** worfy's MCP servers of the Sessions started from now on. */
  mcp?: CodexMcpResolver
  requests: (method: string) => Logged[]
}

/** The test's environment without any spelling of NO_PROXY: what the fake gets of it is the test's to say. */
function baseEnv(): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'no_proxy'))
}

/** `env` goes on top of baseEnv(); with `spawnFails` the stand-in throws instead of starting the process. */
function fake(script: string, options: { env?: Record<string, string>; spawnFails?: boolean } = {}): Fake {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'worfy-codex-mcp-'))
  roots.push(root)
  const log = join(root, 'codex.log')
  const launches: Fake['launches'] = []
  const started: ChildProcess[] = []
  const spawnProcess = (_file: string, args: readonly string[], spawnOptions: SpawnOptions): ChildProcess => {
    launches.push({ args, env: spawnOptions.env ?? {} })
    if (options.spawnFails === true) throw new Error('spawn EACCES')
    const child = spawn(scriptNode(), [...args], spawnOptions)
    children.push(child)
    started.push(child)
    return child
  }
  const part = codexSessions(() =>
    Promise.resolve({
      runtime: RUNTIME,
      appPath: REPO,
      clientVersion: '9.9.9',
      env: { ...baseEnv(), WORFY_CODEX_SCRIPT: script, WORFY_CODEX_LOG: log, ...options.env },
      spawnProcess,
      log: () => undefined,
      ...(made.mcp === undefined ? {} : { mcp: made.mcp }),
    }),
  )
  const logged = (): Logged[] => {
    try {
      return readFileSync(log, 'utf8').trim().split('\n').filter((line) => line !== '').map((line) => JSON.parse(line) as Logged)
    } catch {
      return []
    }
  }
  const made: Fake = { part, root, log, launches, started, requests: (method) => logged().filter((message) => message.method === method) }
  return made
}

/** What a Session gives its driver; approvals are never asked in these tests. */
function startOptions(at: Fake, unattended: boolean): SessionStart {
  return {
    cwd: at.root,
    settings: DEFAULT_SETTINGS,
    unattended,
    orchestrator: false,
    permissions: { ask: () => Promise.resolve(null), askQuestions: () => Promise.resolve({ outcome: 'cancelled' }) },
    refused: () => undefined,
    stderr: () => undefined,
    spawned: () => undefined,
  }
}

interface Live {
  handle: SessionHandle
  events: AgentEvent[]
  /** Settles when the events end: null when they ended, or the error they ended with. */
  ended: Promise<Error | null>
  until: (match: (event: AgentEvent) => boolean, what: string) => Promise<void>
}

async function live(at: Fake, options: { unattended?: boolean; resume?: string } = {}): Promise<Live> {
  const opts = startOptions(at, options.unattended ?? false)
  const handle = options.resume === undefined ? await at.part.start({ ...opts, sessionId: 'worfy-session-1' }) : await at.part.resume(options.resume, opts)
  handles.push(handle)
  const events: AgentEvent[] = []
  const ended = (async (): Promise<Error | null> => {
    try {
      for await (const event of handle.events) events.push(event)
      return null
    } catch (error) {
      return error as Error
    }
  })()
  const until = (match: (event: AgentEvent) => boolean, what: string): Promise<void> => eventually(() => events.some(match), `${what}; the events: ${JSON.stringify(events)}`)
  return { handle, events, ended, until }
}

const text = (value: string) => ({ type: 'text', text: value, text_elements: [] })
const isResult = (event: AgentEvent): boolean => event.type === 'result'
const isAccount = (event: AgentEvent): boolean => event.type === 'account'
const message = (value: string) => ({ text: value, attachments: [] })

/**
 * The Live Browsers of a Machine whose window shows no page: a Browser opens — its Node is made — and
 * the call then says it has no live page. Enough for the tools to show whom they act for.
 */
const pagelessLive = {
  asSession: (_session: string | null, run: () => Promise<unknown>) => run(),
  sessionDrives: () => undefined,
  sessionReleases: () => undefined,
  wake: () => Promise.resolve({ overLimit: false }),
  mayDrive: () => undefined,
  page: () => undefined,
  whenLive: () => Promise.resolve(undefined),
  control: () => null,
} as unknown as LiveBrowsers

interface Mcp {
  resolver: CodexMcpResolver
  store: LayoutStore
  cardsDir: string
  endpoint: McpHttpEndpoint
}

/** The servers of a Session whose cwd is `root`, a Project's root; the data folder lies in it too. */
async function mcpFor(root: string, listed: readonly string[] = ['worfy-canvas'], profiles: readonly BrowserProfile[] = []): Promise<Mcp> {
  const store = new LayoutStore(() => join(root, 'data'), { write: () => undefined })
  const projects = () => [{ id: PROJECT, name: 'demo', path: root }]
  const endpoint = await startMcpHttpEndpoint()
  endpoints.push(endpoint)
  const resolver = codexMcpSessions({
    canvas: (request) => canvasBindingForSession(request, { projects, dataDir: () => join(root, 'data'), layout: store, workflow: () => Promise.resolve({ epics: [], tickets: [], error: null }) }),
    browser: (request) => browserBindingForSession(request, { projects, layout: store, profiles: () => profiles, live: pagelessLive }),
    allowlist: () => Promise.resolve(listed),
    endpoint: () => Promise.resolve(endpoint),
  })
  return { resolver, store, cardsDir: join(root, 'data', 'cards'), endpoint }
}

interface Server {
  url: string
  bearer_token_env_var: string
}

/** The servers thread/start (or thread/resume) named, by name. */
const serversOf = (request: Logged | undefined): Record<string, Server> =>
  Object.fromEntries(Object.entries((request?.params?.config ?? {}) as Record<string, Server>).map(([key, value]) => [key.replace(/^mcp_servers\./, ''), value]))

interface Called {
  status: number
  body: { result?: { content?: { text: string }[]; tools?: { name: string }[]; isError?: boolean } } | null
}

const call = async (url: string, token: string | undefined, method: string, params: unknown = {}): Promise<Called> => {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...(token === undefined ? {} : { Authorization: `Bearer ${token}` }) },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  const body = await response.text()
  return { status: response.status, body: body === '' ? null : (JSON.parse(body) as Called['body']) }
}

const toolText = (called: Called): string => called.body?.result?.content?.[0]?.text ?? ''

describe('a Codex Session: worfy\'s MCP servers', () => {
  it('starts the thread with worfy-canvas and worfy-browser: their URLs and the token\'s variable in config, the token only in the process\'s environment', async () => {
    const withMcp = fake('turn')
    const mcp = await mcpFor(withMcp.root)
    withMcp.mcp = mcp.resolver
    const session = await live(withMcp)
    await session.until(isAccount, 'account')
    const [start] = withMcp.requests('thread/start')
    expect(start?.params).toMatchObject({ cwd: withMcp.root, approvalPolicy: 'never', sandbox: 'danger-full-access' })
    expect(Object.keys(start?.params?.config as object).sort()).toEqual(['mcp_servers.worfy-browser', 'mcp_servers.worfy-canvas'])
    const servers = serversOf(start)
    for (const [name, server] of Object.entries(servers)) {
      expect(server).toEqual({ url: expect.stringMatching(new RegExp(`^http://127\\.0\\.0\\.1:\\d+/mcp/${name}$`)), bearer_token_env_var: 'WORFY_MCP_TOKEN' })
    }
    // The instructions a Claude Session gets in its system prompt: where the Cards go, how the Browser is driven.
    expect(start?.params?.developerInstructions).toContain(mcp.cardsDir)
    expect(start?.params?.developerInstructions).toMatch(/browser_open/)
    const [launch] = withMcp.launches
    const token = launch?.env.WORFY_MCP_TOKEN
    expect(token).toMatch(/^[\w-]{43}$/)
    // Nowhere else: not in the arguments, not in what worfy sent the app-server (the fake's log file).
    expect(launch?.args.join(' ')).not.toContain(token)
    expect(readFileSync(withMcp.log, 'utf8')).not.toContain(token)
    const canvas = await call(servers['worfy-canvas']!.url, token, 'tools/list')
    expect(canvas.body?.result?.tools?.map((tool) => tool.name)).toContain('create_card')
    const browser = await call(servers['worfy-browser']!.url, token, 'tools/list')
    expect(browser.body?.result?.tools?.map((tool) => tool.name)).toContain('browser_open')
  })

  it('reaches the endpoint past the user\'s proxy: 127.0.0.1 and localhost join NO_PROXY and no_proxy, the user\'s entries and proxy kept', async () => {
    const withMcp = fake('turn', { env: { HTTP_PROXY: 'http://proxy.example:3128', ALL_PROXY: 'socks5://proxy.example:1080', NO_PROXY: 'corp.example' } })
    withMcp.mcp = (await mcpFor(withMcp.root)).resolver
    await (await live(withMcp)).until(isAccount, 'account')
    const [launch] = withMcp.launches
    expect(launch?.env).toMatchObject({
      HTTP_PROXY: 'http://proxy.example:3128',
      ALL_PROXY: 'socks5://proxy.example:1080',
      NO_PROXY: 'corp.example,127.0.0.1,localhost',
      // The lowercase spelling, which curl and others read first, gets the user's list too.
      no_proxy: 'corp.example,127.0.0.1,localhost',
    })
    // The endpoint's URLs name a host on that list.
    expect(new URL(serversOf(withMcp.requests('thread/start')[0])['worfy-canvas']!.url).hostname).toBe('127.0.0.1')
  })

  it('a tool call through the endpoint creates a Card next to the Session\'s Node, as for Claude', async () => {
    const withMcp = fake('turn')
    const mcp = await mcpFor(withMcp.root)
    withMcp.mcp = mcp.resolver
    // The Session's Node, by the id the thread's init gives: new Nodes go next to it.
    mcp.store.apply(PROJECT, { op: 'create', node: { id: 'session-node', kind: 'session', x: 1000, y: 2000, w: 400, h: 300, data: { sessionId: THREAD } } })
    const session = await live(withMcp)
    await session.handle.send(message('Make a clock'))
    await session.until(isResult, 'the result')
    const token = withMcp.launches[0]?.env.WORFY_MCP_TOKEN
    const created = await call(serversOf(withMcp.requests('thread/start')[0])['worfy-canvas']!.url, token, 'tools/call', { name: 'create_card', arguments: { title: 'Clock' } })
    expect(created.status).toBe(200)
    const card = JSON.parse(toolText(created) || '{}') as { id: string; folder: string; x: number; y: number }
    expect(card.folder).toBe(join(mcp.cardsDir, card.id))
    expect(existsSync(card.folder)).toBe(true)
    const node = mcp.store.get(PROJECT).layout.nodes.find((each) => each.id === card.id)
    expect(node).toMatchObject({ kind: 'card', data: { title: 'Clock' } })
    // Placed near the Session's Node, not at the origin: the tools know the Session's thread.
    expect(Math.abs(card.x - 1000) + Math.abs(card.y - 2000)).toBeLessThan(1500)
  })

  it('a Browser the Session opens through the endpoint names the Session\'s thread as its opener', async () => {
    const withMcp = fake('turn')
    const mcp = await mcpFor(withMcp.root, ['worfy-canvas'], [ADMIN])
    withMcp.mcp = mcp.resolver
    const session = await live(withMcp)
    // Each turn's init names the thread the tools act for.
    await session.handle.send(message('Check the site'))
    await session.until(isResult, 'the result')
    const opened = await call(serversOf(withMcp.requests('thread/start')[0])['worfy-browser']!.url, withMcp.launches[0]?.env.WORFY_MCP_TOKEN, 'tools/call', { name: 'browser_open', arguments: { profile: ADMIN.id } })
    // No window draws it in this test, so the call ends there; the Node was made first.
    expect(toolText(opened)).toMatch(/has no live page/)
    const browsers = mcp.store.get(PROJECT).layout.nodes.filter((node) => node.kind === 'browser')
    expect(browsers).toMatchObject([{ data: { profile: ADMIN.id, openedBy: THREAD } }])
  })

  it('an unattended Session knows only the Browser profiles marked for Autopilot (ADR-0078): browser_open of another is refused', async () => {
    const withMcp = fake('turn')
    const mcp = await mcpFor(withMcp.root, ['worfy-canvas'], [ADMIN])
    withMcp.mcp = mcp.resolver
    const session = await live(withMcp, { unattended: true })
    await session.handle.send(message('Check the site'))
    await session.until(isResult, 'the result')
    const url = serversOf(withMcp.requests('thread/start')[0])['worfy-browser']!.url
    const opened = await call(url, withMcp.launches[0]?.env.WORFY_MCP_TOKEN, 'tools/call', { name: 'browser_open', arguments: { profile: ADMIN.id } })
    expect(opened.body?.result?.isError).toBe(true)
    expect(toolText(opened)).toContain(`Browser profile ${ADMIN.id} ("admin") ${AUTOPILOT_ONLY}`)
    expect(mcp.store.get(PROJECT).layout.nodes.filter((node) => node.kind === 'browser')).toEqual([])
  })

  it('resumes the thread with the servers and a new token; the old one no longer opens anything', async () => {
    const first = fake('turn')
    const mcp = await mcpFor(first.root)
    first.mcp = mcp.resolver
    const one = await live(first)
    await one.until(isAccount, 'account')
    const oldToken = first.launches[0]?.env.WORFY_MCP_TOKEN
    const servers = serversOf(first.requests('thread/start')[0])
    one.handle.close()
    expect((await call(servers['worfy-canvas']!.url, oldToken, 'tools/list')).status).toBe(401)
    const second = fake('resume')
    second.mcp = mcp.resolver
    // The same Project folder as the first process: a Session resumed where it ran.
    const two = await live({ ...second, root: first.root }, { resume: THREAD })
    await two.until(isAccount, 'account')
    const [resume] = second.requests('thread/resume')
    expect(resume?.params).toMatchObject({ threadId: THREAD, cwd: first.root })
    expect(serversOf(resume)).toEqual(servers)
    const newToken = second.launches[0]?.env.WORFY_MCP_TOKEN
    expect(newToken).not.toBe(oldToken)
    expect((await call(servers['worfy-canvas']!.url, newToken, 'tools/list')).status).toBe(200)
    expect((await call(servers['worfy-canvas']!.url, oldToken, 'tools/list')).status).toBe(401)
    expect((await call(servers['worfy-canvas']!.url, undefined, 'tools/list')).status).toBe(401)
  })

  it('the token ends when the process dies', async () => {
    const withMcp = fake('turn')
    withMcp.mcp = (await mcpFor(withMcp.root)).resolver
    const session = await live(withMcp)
    await session.until(isAccount, 'account')
    const token = withMcp.launches[0]?.env.WORFY_MCP_TOKEN
    const url = serversOf(withMcp.requests('thread/start')[0])['worfy-canvas']!.url
    expect((await call(url, token, 'tools/list')).status).toBe(200)
    withMcp.started[0]!.kill('SIGKILL')
    expect(await session.ended).toBeInstanceOf(Error)
    expect((await call(url, token, 'tools/list')).status).toBe(401)
  })

  it('the token ends when the app-server cannot be started', async () => {
    const withMcp = fake('turn', { spawnFails: true })
    const mcp = await mcpFor(withMcp.root)
    withMcp.mcp = mcp.resolver
    await expect(live(withMcp)).rejects.toThrow()
    const token = withMcp.launches[0]?.env.WORFY_MCP_TOKEN
    expect(token).toMatch(/^[\w-]{43}$/)
    expect((await call(`http://127.0.0.1:${mcp.endpoint.port}/mcp/worfy-canvas`, token, 'tools/list')).status).toBe(401)
  })

  it('without worfy-canvas in the Profile\'s list, or outside every Project, the thread starts as before: no servers, no token, the environment untouched', async () => {
    const withMcp = fake('turn', { env: { NO_PROXY: 'corp.example' } })
    withMcp.mcp = (await mcpFor(withMcp.root, ['qmd'])).resolver
    await (await live(withMcp)).until(isAccount, 'account')
    expect(withMcp.requests('thread/start').map((request) => request.params)).toEqual([{ cwd: withMcp.root, approvalPolicy: 'never', sandbox: 'danger-full-access' }])
    expect(withMcp.launches[0]?.env.WORFY_MCP_TOKEN).toBeUndefined()
    expect(withMcp.launches[0]?.env.NO_PROXY).toBe('corp.example')
    expect(withMcp.launches[0]?.env.no_proxy).toBeUndefined()

    const noProject = fake('turn')
    // The Project is a folder inside the Session's cwd, so the cwd is in no Project.
    noProject.mcp = (await mcpFor(join(noProject.root, 'another-project'))).resolver
    await (await live(noProject)).until(isAccount, 'account')
    expect(noProject.requests('thread/start').map((request) => request.params)).toEqual([{ cwd: noProject.root, approvalPolicy: 'never', sandbox: 'danger-full-access' }])
    expect(noProject.launches[0]?.env.WORFY_MCP_TOKEN).toBeUndefined()
  })

  it('a Card the Codex Session wrote names it the last editor, and the Card\'s session.ask reaches that Session', async () => {
    const withMcp = fake('card-edit')
    const mcp = await mcpFor(withMcp.root)
    withMcp.mcp = mcp.resolver
    mcp.store.apply(PROJECT, { op: 'create', node: { id: 'card-1', kind: 'card', x: 0, y: 0, w: 360, h: 280, data: { title: 'Clock' } } })
    const registry = new SessionRegistry(withMcp.part)
    const events: AgentEvent[] = []
    const session = registry.start(withMcp.root, undefined, (_id, event) => events.push(event), DEFAULT_SETTINGS)
    try {
      await eventually(() => session.state === 'idle', 'the Session is idle')
      session.send('Make the clock Card')
      await eventually(() => events.some(isResult), 'the first turn ends')
      // The fileChange into data/cards/card-1/ made the thread the Card's last editor.
      expect(mcp.store.get(PROJECT).layout.nodes.find((node) => node.id === 'card-1')?.data.lastEditor).toBe(THREAD)

      const ask = new CardAsk({
        nodes: (projectId) => mcp.store.get(projectId).layout.nodes,
        sessions: () => registry.list(),
        orchestrator: () => Promise.reject(new Error('the Orchestrator is not the recipient here')),
        cardTitle: () => Promise.resolve('Clock'),
        refuseUnattended: () => undefined,
        send: (sessionId, value) => sendFromCard(registry, sessionId, value),
      })
      const prepared = await ask.prepare(PROJECT, 'card-1', 'Make it tick')
      expect(prepared.recipientLabel).toBe('Session thr_fake, which last edited this Card')
      expect(ask.finish(PROJECT, prepared.askId, true)).toEqual({ sent: true, recipient: 'session' })
      await eventually(() => withMcp.requests('turn/start').length === 2, 'the message reaches Codex')
      expect(withMcp.requests('turn/start')[1]?.params).toMatchObject({ threadId: THREAD, input: [text('Message from Card "Clock" (card-1):\n\nMake it tick')] })
    } finally {
      registry.closeAll()
    }
  })
})
