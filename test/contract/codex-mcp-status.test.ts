// The MCP servers of a Codex Session (worfy-mcp-live ticket 06, src/main/vendors/codex/mcp.ts and the
// hunks of src/main/vendors/codex/session.ts that read them): the rows of mcpServerStatus/list and of the
// mcpServer/startupStatus/updated notifications, Reconnect through config/mcpServer/reload, and the
// sign-in through mcpServer/oauth/login, over by its mcpServer/oauthLogin/completed. Codex shows the
// user's servers as they are (spec, Q8): no row is `not-allowed`, none offers `allow`.
//
// The Session runs on the fake app-server (WORFY_CODEX=fake with an empty CODEX_HOME of its own, which
// test/setup-contract.ts sets) under scriptNode(), through the spawn stand-in of the session part, as in
// test/contract/codex-session-mcp.test.ts. The scripts are test/fixtures/codex-scripts/mcp-status.jsonl
// mcp-action.jsonl, mcp-sign-in.jsonl and mcp-sign-in-wait.jsonl, with made-up server names; what worfy sent is read from the fake's log
// (WORFY_CODEX_LOG). No real Codex, no browser: the sign-in page goes to a stand-in of openUrl.
import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { mkdtempSync, readFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { AgentEvent } from '../../src/shared/agent/events'
import type { McpServerRow } from '../../src/shared/agent/mcp-status'
import { DEFAULT_SETTINGS } from '../../src/shared/agent/settings'
import { SessionRegistry } from '../../src/main/agent/session'
import { hasExited } from '../../src/main/agent/session/process'
import type { CodexRuntime } from '../../src/main/vendors/codex/binary'
import { codexDriver } from '../../src/main/vendors/codex'
import { codexMcp, MCP_TOKEN_ENV, type CodexMcpResolver } from '../../src/main/vendors/codex/mcp'
import { codexSessions } from '../../src/main/vendors/codex/session'
import { McpActionRefused } from '../../src/main/vendors/mcp'
import type { SessionHandle, SessionPart, SessionStart } from '../../src/main/vendors/session'
import { removeTestTree } from '../remove'
import { scriptNode } from '../script-node'
import { ms } from '../time-scale'

const REPO = join(import.meta.dirname, '..', '..')
const RUNTIME: CodexRuntime = { packaged: false, resourcesPath: '/Resources', platform: process.platform, arch: process.arch }
/** The thread the fake's scripts start. */
const THREAD = 'thr_fake_1'

/** How long the fake may take to send what a test waits for. */
const ANSWER_MS = ms(10_000)

const roots: string[] = []
const handles: SessionHandle[] = []
const children: ChildProcess[] = []
const registries: SessionRegistry[] = []
afterEach(async () => {
  for (const registry of registries.splice(0)) registry.closeAll()
  for (const handle of handles.splice(0)) handle.close()
  for (const child of children.splice(0)) {
    if (child.pid === undefined || hasExited(child)) continue
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()))
    child.kill('SIGKILL')
    await exited
  }
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
  id?: unknown
  method?: string
  params?: Record<string, unknown>
}

interface Fake {
  part: SessionPart
  root: string
  /** The pages the sign-in opened, in order. */
  opened: string[]
  logged: () => Logged[]
  requests: (method: string) => Logged[]
}

/**
 * worfy's own servers of the Session: worfy-canvas, as codexMcpSessions gives it in a Project whose
 * Profile lists it; the endpoint is never reached, the fake does not call tools.
 */
const canvasGiven: CodexMcpResolver = () =>
  Promise.resolve({
    config: { 'mcp_servers.worfy-canvas': { url: 'http://127.0.0.1:4100/mcp/worfy-canvas', bearer_token_env_var: MCP_TOKEN_ENV } },
    developerInstructions: '',
    env: (base) => base,
    observe: (handle) => handle,
    close: () => undefined,
  })

function fake(script: string, options: { mcp?: CodexMcpResolver; mcpLoginTimeoutMs?: number } = {}): Fake {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'worfy-codex-mcp-status-'))
  roots.push(root)
  const log = join(root, 'codex.log')
  const opened: string[] = []
  const spawnProcess = (_file: string, args: readonly string[], spawnOptions: SpawnOptions): ChildProcess => {
    const child = spawn(scriptNode(), [...args], spawnOptions)
    children.push(child)
    return child
  }
  const part = codexSessions(() =>
    Promise.resolve({
      runtime: RUNTIME,
      appPath: REPO,
      clientVersion: '9.9.9',
      env: { ...process.env, WORFY_CODEX_SCRIPT: script, WORFY_CODEX_LOG: log },
      spawnProcess,
      log: () => undefined,
      openUrl: (url: string) => {
        opened.push(url)
        return Promise.resolve()
      },
      ...(options.mcp === undefined ? {} : { mcp: options.mcp }),
      ...(options.mcpLoginTimeoutMs === undefined ? {} : { mcpLoginTimeoutMs: options.mcpLoginTimeoutMs }),
    }),
  )
  const logged = (): Logged[] => {
    try {
      return readFileSync(log, 'utf8').trim().split('\n').filter((line) => line !== '').map((line) => JSON.parse(line) as Logged)
    } catch {
      return []
    }
  }
  return { part, root, opened, logged, requests: (method) => logged().filter((message) => message.method === method) }
}

function startOptions(at: Fake): SessionStart {
  return {
    cwd: at.root,
    settings: DEFAULT_SETTINGS,
    unattended: false,
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
  /** The `servers` of every `mcp` event, in order. */
  mcp: () => (McpServerRow[] | null)[]
  until: (match: (servers: McpServerRow[] | null) => boolean, what: string) => Promise<void>
}

async function live(at: Fake): Promise<Live> {
  const handle = await at.part.start({ ...startOptions(at), sessionId: 'worfy-session-1' })
  handles.push(handle)
  const events: AgentEvent[] = []
  void (async () => {
    try {
      for await (const event of handle.events) events.push(event)
    } catch {
      // The process ended: the tests look at the events it gave.
    }
  })()
  const mcp = (): (McpServerRow[] | null)[] => events.flatMap((event) => (event.type === 'mcp' ? [event.servers] : []))
  const until = (match: (servers: McpServerRow[] | null) => boolean, what: string): Promise<void> =>
    eventually(() => mcp().some(match), `${what}; the mcp events: ${JSON.stringify(mcp())}`)
  return { handle, events, mcp, until }
}

const row = (servers: McpServerRow[] | null, name: string): McpServerRow | undefined => servers?.find((each) => each.name === name)

const NOTES: McpServerRow = { name: 'example-notes', status: 'connected', tools: 2, error: null, source: 'user', sourceWord: null, actions: [] }
const TRACKER_FAILED: McpServerRow = { name: 'example-tracker', status: 'failed', tools: null, error: 'connection refused', source: 'user', sourceWord: null, actions: ['reconnect'] }
const WIKI: McpServerRow = { name: 'example-wiki', status: 'needs-auth', tools: null, error: null, source: 'user', sourceWord: null, actions: ['sign-in'] }
const CANVAS: McpServerRow = { name: 'worfy-canvas', status: 'connected', tools: 1, error: null, source: 'worfy', sourceWord: null, actions: [] }

describe('a Codex Session: the status of its MCP servers', () => {
  it('sends `mcp` with the rows of the startup notifications, then of mcpServerStatus/list of its thread, every page; a notification changes its row; Reconnect is config/mcpServer/reload', async () => {
    const at = fake('mcp-status', { mcp: canvasGiven })
    const session = await live(at)

    // The startup notifications of the thread give rows at once, pending first; another thread's server is not this Session's.
    await session.until((servers) => row(servers, 'example-wiki')?.status === 'pending', 'the rows of the startup notifications')
    expect(session.mcp().some((servers) => row(servers, 'example-other') !== undefined)).toBe(false)

    // Once no server is starting any more, the list of the thread: both pages, worfy-canvas as worfy's own.
    await session.until((servers) => servers?.length === 4, 'the rows of mcpServerStatus/list')
    expect(session.mcp().at(-1)).toEqual([NOTES, TRACKER_FAILED, WIKI, CANVAS])
    expect(at.requests('mcpServerStatus/list').map((request) => request.params)).toEqual([{ threadId: THREAD }, { threadId: THREAD, cursor: 'page-2' }])

    // Reconnect: config/mcpServer/reload; the server's new startup changes its row, and the list after it gives its tools.
    await codexMcp.act!(session.handle, 'example-tracker', 'reconnect')
    expect(at.requests('config/mcpServer/reload')).toHaveLength(1)
    expect(at.requests('config/mcpServer/reload')[0]?.params).toBeUndefined()
    await session.until((servers) => row(servers, 'example-tracker')?.status === 'pending', 'the tracker starting again')
    await session.until((servers) => row(servers, 'example-tracker')?.tools === 3, 'the tracker connected with its tools')
    expect(row(session.mcp().at(-1)!, 'example-tracker')).toEqual({ ...TRACKER_FAILED, status: 'connected', tools: 3, error: null, actions: [] })
    expect(at.requests('mcpServerStatus/list').at(-1)?.params).toEqual({ threadId: THREAD })

    // Codex shows its servers as they are: no row is «not allowed», none offers Allow, Turn off or Restart.
    for (const servers of session.mcp()) {
      for (const each of servers ?? []) {
        expect(each.status).not.toBe('not-allowed')
        expect(each.actions).not.toContain('allow')
        expect(each.actions).not.toContain('turn-off')
        expect(each.actions).not.toContain('restart')
      }
    }
  })

  it('Sign in: mcpServer/oauth/login for the thread, its page opened, over when mcpServer/oauthLogin/completed says so; a failed sign-in rejects with Codex\'s reason', async () => {
    const at = fake('mcp-status')
    const session = await live(at)
    await session.until((servers) => servers?.length === 4, 'the rows of mcpServerStatus/list')
    await codexMcp.act!(session.handle, 'example-tracker', 'reconnect')
    await session.until((servers) => row(servers, 'example-tracker')?.tools === 3, 'the tracker connected with its tools')

    await codexMcp.act!(session.handle, 'example-wiki', 'sign-in')
    expect(at.requests('mcpServer/oauth/login').map((request) => request.params)).toEqual([{ name: 'example-wiki', threadId: THREAD }])
    expect(at.opened).toEqual(['https://wiki.example/authorize?state=fake-state'])

    await expect(codexMcp.act!(session.handle, 'example-wiki', 'sign-in')).rejects.toThrow('the sign-in was denied')
    expect(at.opened).toHaveLength(2)
  })

  it('Sign in opens only a web page: a file: or another scheme Codex names is refused, its address in no error, and nothing is opened', async () => {
    // A short wait for the completion: a sign-in that went on to wait would fail here with the timeout, not the refusal.
    const at = fake('mcp-sign-in', { mcpLoginTimeoutMs: ms(2_000) })
    const session = await live(at)
    await eventually(() => session.events.some((event) => event.type === 'account'), 'the thread')
    for (const scheme of ['file:', 'x-example-app:']) {
      const refused = await codexMcp.act!(session.handle, 'example-wiki', 'sign-in').then(
        () => null,
        (error: unknown) => error as Error,
      )
      expect(refused?.message, scheme).toBe('Codex gave a sign-in page that is not a web page')
      expect(refused?.message).not.toContain(scheme)
    }
    expect(at.opened).toEqual([])
  })

  it('a sign-in is over only by the completion of its own login, server and thread; the others leave it waiting', async () => {
    const at = fake('mcp-sign-in')
    const session = await live(at)
    await eventually(() => session.events.some((event) => event.type === 'account'), 'the thread')
    // The two refused pages of the script first.
    for (let page = 0; page < 2; page++) await expect(codexMcp.act!(session.handle, 'example-wiki', 'sign-in')).rejects.toThrow('not a web page')
    let over: 'waiting' | 'signed in' | Error = 'waiting'
    const signIn = codexMcp.act!(session.handle, 'example-wiki', 'sign-in').then(
      () => (over = 'signed in'),
      (error: unknown) => (over = error as Error),
    )
    await eventually(() => at.opened.length === 1, 'the sign-in page opened')
    // The fake sent the completions of another login, another server and another thread before it answers
    // this reload: once the answer is here, they were all read, and the right one is not sent yet.
    await codexMcp.act!(session.handle, 'example-tracker', 'reconnect')
    expect(over).toBe('waiting')
    await codexMcp.act!(session.handle, 'example-tracker', 'reconnect')
    await signIn
    expect(over).toBe('signed in')
  })

  it('a sign-in still waiting is refused when the Session closes, and when its wait runs out', async () => {
    const closing = fake('mcp-sign-in-wait')
    const closed = await live(closing)
    await eventually(() => closed.events.some((event) => event.type === 'account'), 'the thread')
    const waiting = codexMcp.act!(closed.handle, 'example-wiki', 'sign-in')
    await eventually(() => closing.opened.length === 1, 'the sign-in page opened')
    closed.handle.close()
    await expect(waiting).rejects.toThrow('The Session was closed before the sign-in was over')

    // unscaled: a bound the test expects to run out.
    const timing = fake('mcp-sign-in-wait', { mcpLoginTimeoutMs: 300 })
    const timed = await live(timing)
    await eventually(() => timed.events.some((event) => event.type === 'account'), 'the thread')
    await expect(codexMcp.act!(timed.handle, 'example-wiki', 'sign-in')).rejects.toThrow('The sign-in was not completed within')
    expect(timing.opened).toEqual(['https://wiki.example/authorize?state=fake-wait'])
  })

  it('refuses Allow, Turn off, Turn on and Restart before anything reaches Codex', async () => {
    const at = fake('mcp-status')
    const session = await live(at)
    await session.until((servers) => servers?.length === 4, 'the rows of mcpServerStatus/list')
    const before = at.logged().length
    for (const action of ['allow', 'turn-off', 'turn-on', 'restart'] as const) {
      await expect(codexMcp.act!(session.handle, 'example-notes', action)).rejects.toBeInstanceOf(McpActionRefused)
    }
    expect(at.logged()).toHaveLength(before)
  })

  it('status() asks mcpServerStatus/list of the thread now; a list Codex refuses is no data (null), not a failed Session', async () => {
    const at = fake('mcp-action')
    const session = await live(at)
    // The script waits for config/mcpServer/reload: Codex answers the list with an error.
    await expect(codexMcp.status!(session.handle)).resolves.toBeNull()
    expect(at.requests('mcpServerStatus/list').map((request) => request.params)).toEqual([{ threadId: THREAD }])
    await codexMcp.act!(session.handle, 'example-tracker', 'reconnect')
    await expect(codexMcp.status!(session.handle)).resolves.toEqual([{ ...TRACKER_FAILED, status: 'connected', tools: 1, error: null, actions: [] }])
  })

  it('a Session of the registry: agent.mcpAction Reconnect reloads, then answers the rows of the list and sends them as `mcp`', async () => {
    const at = fake('mcp-action')
    const registry = new SessionRegistry({ sessionsOf: () => at.part, partsOf: () => codexDriver() })
    registries.push(registry)
    const events: AgentEvent[] = []
    const session = registry.start(at.root, undefined, (_id, event) => events.push(event), DEFAULT_SETTINGS, undefined, undefined, 'codex')
    await eventually(() => events.some((event) => event.type === 'account'), 'the thread')
    const tracker: McpServerRow = { ...TRACKER_FAILED, status: 'connected', tools: 1, error: null, actions: [] }
    await expect(session.mcpAction('example-tracker', 'reconnect')).resolves.toEqual({ servers: [tracker], error: null })
    expect(at.requests('config/mcpServer/reload')).toHaveLength(1)
    expect(events.filter((event) => event.type === 'mcp').map((event) => event.type === 'mcp' && event.servers)).toEqual([[tracker]])
    await expect(session.mcpAction('example-tracker', 'allow')).rejects.toBeInstanceOf(McpActionRefused)
  })
})
