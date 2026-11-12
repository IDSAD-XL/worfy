// The MCP inventory of Claude Code (worfy-mcp-live ticket 05; spec, Q11). Claude Code does not report a
// server its policy tier cut (the spike of ticket 01, F:cut-status-start), so main asks a query of its own:
// the user's settings as a Session reads them, but no Profile list (no managedSettings), no server of worfy
// and no message, so no model is called. A server of the user that the Session's list leaves out is a row
// `not-allowed` offering Allow. One run per folder at a time; its answer stays in memory and goes nowhere but
// to the Session's rows: not to the console, not to the Autopilot journal.
//
// Over the fake agent (src/main/agent/fake-query.ts): the Session's query leaves out what its list does not
// name, as Claude Code does; the inventory's query answers the script's servers as they are. The real
// starter is checked by the options it gives the SDK's query(), which the test answers itself: no Claude
// Code can start, the SDK module is mocked to throw.
import { execFileSync } from 'node:child_process'
import { readFileSync, realpathSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeInventoryStarter, fakeQueryFactory, type FakeCall } from '../../src/main/agent/fake-query'
import { SessionRegistry, type QueryHandle } from '../../src/main/agent/session'
import { McpInventory, notAllowedRows, silentInput, type InventoryQueryStarter } from '../../src/main/vendors/claude/mcp-inventory'
import { repositoryRoot } from '../../src/main/mcp/canvas-server'
import { claudeSessions } from '../../src/main/vendors/claude/session'
import type { AgentEvent } from '../../src/shared/agent/events'
import type { McpServerRow } from '../../src/shared/agent/mcp-status'
import { AGENT_SCRIPTS, faultRun } from './autopilot-faults-setup'

const mocks = vi.hoisted(() => ({ agentEnv: vi.fn() }))

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => '/nowhere', on: () => undefined },
  BrowserWindow: { getAllWindows: () => [], fromWebContents: () => null },
  dialog: { showMessageBox: () => Promise.reject(new Error('no dialog in this test')) },
  powerSaveBlocker: { start: () => 0, stop: () => undefined, isStarted: () => false },
}))
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: () => {
    throw new Error('the Agent SDK module was imported: the inventory must take query() from loadSdk')
  },
}))
vi.mock('../../src/main/agent/env', () => ({ agentEnv: mocks.agentEnv }))

const { sdkInventoryStarter } = await import('../../src/main/vendors/claude/query')

let cwd: string
let registries: SessionRegistry[] = []

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'worfy-mcp-inventory-'))
  mocks.agentEnv.mockReset().mockResolvedValue({ env: { HOME: cwd, PATH: '/usr/bin:/bin' }, from: 'login-shell' })
})

afterEach(async () => {
  for (const registry of registries) registry.closeAll()
  registries = []
  vi.restoreAllMocks()
  await rm(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

/** A Session in `cwd` whose Profile lists `listed`, on the fake agent playing `script`, with the app's inventory over the same script. */
function harness(listed: readonly string[] | null, script = 'mcp-sign-in') {
  const calls: FakeCall[] = []
  const options = { scriptsDir: AGENT_SCRIPTS, script, record: (call: FakeCall) => calls.push(call) }
  const fake = fakeQueryFactory({ ...options, ...(listed === null ? {} : { mcpAllowlist: () => Promise.resolve(listed) }) })
  const starts: string[] = []
  const starter = fakeInventoryStarter(options)
  const inventory = new McpInventory((at, prompt) => {
    starts.push(at)
    return starter(at, prompt)
  })
  const registry = new SessionRegistry(claudeSessions(fake, {}, inventory))
  registries.push(registry)
  const events: AgentEvent[] = []
  const session = registry.start(cwd, undefined, (_id, event) => events.push(event))
  const mcpEvents = () => events.filter((event): event is Extract<AgentEvent, { type: 'mcp' }> => event.type === 'mcp')
  return { calls, starts, inventory, registry, session, events, mcpEvents }
}

/** One whole turn of `session`: a message, its result, idle again. */
async function turn(h: ReturnType<typeof harness>, text: string): Promise<void> {
  await vi.waitFor(() => expect(h.session.state).toBe('idle'))
  const before = h.events.filter((event) => event.type === 'result').length
  h.session.send(text)
  await vi.waitFor(() => expect(h.events.filter((event) => event.type === 'result')).toHaveLength(before + 1))
  await vi.waitFor(() => expect(h.session.state).toBe('idle'))
}

const NOTES: McpServerRow = { name: 'example-notes', status: 'connected', tools: 1, error: null, source: 'user', sourceWord: null, actions: ['turn-off'] }
/** example-oauth outside the list, as the inventory found it (F:inventory-status): not allowed, Allow. */
const OAUTH_NOT_ALLOWED: McpServerRow = { name: 'example-oauth', status: 'not-allowed', tools: null, error: null, source: 'user', sourceWord: null, actions: ['allow'] }

describe('the query of the inventory', () => {
  it('has no Profile list, no server and no plugin of worfy, the user settings of a Session, and never yields a message', async () => {
    const seen: { prompt: unknown; options: Record<string, unknown> }[] = []
    const handle = { close: vi.fn(), mcpServerStatus: () => Promise.resolve([]) }
    const start = sdkInventoryStarter(() =>
      Promise.resolve({
        query: (params: { prompt: unknown; options: object }) => {
          seen.push(params as never)
          return handle
        },
      }),
    )
    const stop = new AbortController()
    const prompt = silentInput(stop.signal)
    expect(await start(cwd, prompt)).toBe(handle)
    expect(seen[0]!.prompt).toBe(prompt)
    const options = seen[0]!.options
    expect(options.cwd).toBe(cwd)
    expect(options.settingSources).toEqual(['user', 'project', 'local'])
    for (const key of ['managedSettings', 'mcpServers', 'plugins', 'canUseTool', 'resume', 'sessionId', 'systemPrompt', 'model']) expect(options, key).not.toHaveProperty(key)
    // The input: nothing until the inventory stops it, then its end — no message ever reaches the model.
    const next = prompt[Symbol.asyncIterator]().next()
    const early = await Promise.race([next.then(() => 'yielded'), new Promise((done) => setTimeout(() => done('waiting'), 50))])
    expect(early).toBe('waiting')
    stop.abort()
    expect(await next).toEqual({ done: true, value: undefined })
  })

  it('reads the servers once none is pending, then closes its query', async () => {
    const answers = [
      [{ name: 'example-notes', status: 'pending', source: 'user' }],
      [{ name: 'example-notes', status: 'connected', source: 'user', tools: [{ name: 'notes_list' }] }],
    ]
    const close = vi.fn()
    let input: AsyncIterable<never> | null = null
    const inventory = new McpInventory(
      (_at, prompt) => {
        input = prompt
        return Promise.resolve({ close, mcpServerStatus: () => Promise.resolve(answers.length > 1 ? answers.shift() : answers[0]) } as unknown as QueryHandle)
      },
      { settleMs: 5_000, pollMs: 10 },
    )
    expect(await inventory.refresh(cwd)).toEqual([{ ...NOTES, actions: [] }])
    expect(inventory.latest(cwd)).toEqual([{ ...NOTES, actions: [] }])
    expect(close).toHaveBeenCalledTimes(1)
    // Its input has ended with it.
    expect(await input![Symbol.asyncIterator]().next()).toEqual({ done: true, value: undefined })
  })
})

describe('a server the Session’s list leaves out', () => {
  it('is a row not-allowed offering Allow, once the inventory of the Session’s start answered; no turn, no message', async () => {
    const h = harness(['example-notes'])
    await vi.waitFor(() => expect(h.mcpEvents().at(-1)?.servers).toEqual([NOTES, OAUTH_NOT_ALLOWED]))
    // The inventory ran once, without the list (it found example-oauth), and read no message: only the Session's query starts.
    expect(h.starts).toEqual([cwd])
    expect(h.calls.filter((call) => call.kind === 'inventory')).toEqual([{ kind: 'inventory', cwd }])
    expect(h.calls.filter((call) => call.kind === 'message')).toEqual([])
    await turn(h, 'one')
    expect(h.calls.filter((call) => call.kind === 'message').map((call) => call.kind === 'message' && call.text)).toEqual(['one'])
    // After the turn the rows keep the server outside the list.
    await vi.waitFor(() => expect(h.mcpEvents().at(-1)?.servers).toEqual([NOTES, OAUTH_NOT_ALLOWED]))
  })

  it('runs again when a person opens the list (agent.mcp with pickUp), and not on a plain read', async () => {
    const h = harness(['example-notes'])
    await vi.waitFor(() => expect(h.starts).toHaveLength(1))
    await vi.waitFor(() => expect(h.mcpEvents().length).toBeGreaterThan(0))
    await h.session.mcp()
    await new Promise((done) => setTimeout(done, 50))
    expect(h.starts).toHaveLength(1)
    expect(await h.session.mcp({ pickUp: true })).toEqual([NOTES, OAUTH_NOT_ALLOWED])
    await vi.waitFor(() => expect(h.starts).toHaveLength(2))
  })

  it('a Session with no list — outside every Project — runs no inventory and has no such row', async () => {
    const h = harness(null)
    await turn(h, 'one')
    await vi.waitFor(() => expect(h.mcpEvents().length).toBeGreaterThan(0))
    await h.session.mcp({ pickUp: true })
    expect(h.starts).toEqual([])
    expect(h.mcpEvents().flatMap((event) => event.servers ?? []).filter((row) => row.status === 'not-allowed')).toEqual([])
  })

  it('a server turned off for this Session, worfy’s own and a plugin’s are never not-allowed', () => {
    const user = (name: string, source: McpServerRow['source'] = 'user'): McpServerRow => ({ name, status: 'connected', tools: 2, error: null, source, sourceWord: null, actions: [] })
    const inventory = [user('example-notes'), user('example-off'), user('plugin:example:server', 'worfy'), user('example-connector', 'claudeai'), user('example-tracker')]
    expect(notAllowedRows(inventory, { listed: ['example-notes'], rows: [user('example-notes')], off: ['example-off'] })).toEqual([
      { ...user('example-connector', 'claudeai'), status: 'not-allowed', actions: ['allow'] },
      { ...user('example-tracker'), status: 'not-allowed', actions: ['allow'] },
    ])
    expect(notAllowedRows(null, { listed: [], rows: [], off: [] })).toEqual([])
  })
})

describe('one inventory at a time', () => {
  it('a second ask while one runs gets the running one; the next ask after it starts another', async () => {
    let release: () => void = () => undefined
    const starts: string[] = []
    const inventory = new McpInventory(
      (at) => {
        starts.push(at)
        return new Promise((done) => {
          release = () => done({ close: () => undefined, mcpServerStatus: () => Promise.resolve([{ name: 'example-notes', status: 'connected', source: 'user' }]) } as unknown as QueryHandle)
        })
      },
      { settleMs: 1_000, pollMs: 10 },
    )
    const first = inventory.refresh(cwd)
    const second = inventory.refresh(join(cwd, '.'))
    await vi.waitFor(() => expect(starts).toHaveLength(1))
    await new Promise((done) => setTimeout(done, 20))
    expect(starts).toHaveLength(1)
    release()
    expect(await second).toBe(await first)
    const third = inventory.refresh(cwd)
    await vi.waitFor(() => expect(starts).toHaveLength(2))
    release()
    expect(await third).not.toBe(await first)
  })

  it('two different Projects run two inventories at once, each with its own answer (review of #1822)', async () => {
    const releases: (() => void)[] = []
    const starts: string[] = []
    const inventory = new McpInventory(
      (at) => {
        starts.push(at)
        return new Promise((done) => {
          releases.push(() => done({ close: () => undefined, mcpServerStatus: () => Promise.resolve([{ name: `example-of-${starts.indexOf(at)}`, status: 'connected', source: 'user' }]) } as unknown as QueryHandle))
        })
      },
      { settleMs: 1_000, pollMs: 10 },
      (folder) => Promise.resolve(folder),
    )
    const alpha = join(cwd, 'alpha')
    const beta = join(cwd, 'beta')
    const first = inventory.refresh(alpha)
    const second = inventory.refresh(beta)
    await vi.waitFor(() => expect(starts).toEqual([alpha, beta]))
    for (const release of releases) release()
    expect((await first)?.map((row) => row.name)).toEqual(['example-of-0'])
    expect((await second)?.map((row) => row.name)).toEqual(['example-of-1'])
    expect(inventory.latest(alpha)).not.toBe(inventory.latest(beta))
  })

  it('a folder whose Project git could not tell is asked again next time; a root found is kept (review of #1822)', async () => {
    const asked: string[] = []
    const answers: (string | null | Error)[] = [null, new Error('git failed'), join(cwd, 'root')]
    const inventory = new McpInventory(
      () => Promise.resolve({ close: () => undefined, mcpServerStatus: () => Promise.resolve([{ name: 'example-notes', status: 'connected', source: 'user' }]) } as unknown as QueryHandle),
      { settleMs: 1_000, pollMs: 10 },
      (folder) => {
        asked.push(folder)
        const answer = answers.shift() ?? null
        return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer)
      },
    )
    const folder = join(cwd, 'repo')
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    await inventory.refresh(folder)
    await inventory.refresh(folder)
    await inventory.refresh(folder)
    await inventory.refresh(folder)
    // null, a failure, then the root: three asks, and the root is kept for the fourth.
    expect(asked).toEqual([folder, folder, folder])
    expect(inventory.latest(folder)).toEqual([{ name: 'example-notes', status: 'connected', tools: null, error: null, source: 'user', sourceWord: null, actions: [] }])
  })

  it('two Sessions of one Project, in its main checkout and in a worktree of it, start one inventory, and both get its rows', async () => {
    const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.invalid', ...args], { cwd, stdio: 'pipe' })
    git('init', '-q', '-b', 'main')
    git('commit', '-q', '--allow-empty', '-m', 'first')
    const worktree = join(cwd, '.claude', 'worktrees', 'other')
    git('worktree', 'add', '-q', worktree)
    const options = { scriptsDir: AGENT_SCRIPTS, script: 'mcp-sign-in' }
    const fake = fakeQueryFactory({ ...options, mcpAllowlist: () => Promise.resolve(['example-notes']) })
    const starter = fakeInventoryStarter(options)
    const starts: string[] = []
    let open: () => void = () => undefined
    const opened = new Promise<void>((done) => (open = done))
    const held: InventoryQueryStarter = async (at, prompt) => {
      starts.push(at)
      await opened
      return starter(at, prompt)
    }
    // The app's way to the Project of a folder, counted: both Sessions have asked once both are found.
    const found: string[] = []
    const inventory = new McpInventory(held, undefined, async (folder) => {
      const root = await repositoryRoot(folder)
      found.push(folder)
      return root
    })
    const registry = new SessionRegistry(claudeSessions(fake, {}, inventory))
    registries.push(registry)
    const rowsOf = (events: AgentEvent[]) => events.filter((event): event is Extract<AgentEvent, { type: 'mcp' }> => event.type === 'mcp').at(-1)?.servers
    const mainEvents: AgentEvent[] = []
    const otherEvents: AgentEvent[] = []
    registry.start(cwd, undefined, (_id, event) => mainEvents.push(event))
    registry.start(worktree, undefined, (_id, event) => otherEvents.push(event))
    await vi.waitFor(() => expect(found).toHaveLength(2))
    open()
    await vi.waitFor(() => expect(rowsOf(mainEvents)).toEqual([NOTES, OAUTH_NOT_ALLOWED]))
    await vi.waitFor(() => expect(rowsOf(otherEvents)).toEqual([NOTES, OAUTH_NOT_ALLOWED]))
    expect(starts).toHaveLength(1)
    expect(inventory.latest(worktree)).toBe(inventory.latest(cwd))
    expect(realpathSync(starts[0]!)).toBe(realpathSync(found[0]!))
  })

  it('a Session started unattended (Autopilot) runs the inventory itself, not from an answer an attended Session left', async () => {
    const options = { scriptsDir: AGENT_SCRIPTS, script: 'mcp-sign-in' }
    const fake = fakeQueryFactory({ ...options, mcpAllowlist: () => Promise.resolve(['example-notes']) })
    const starter = fakeInventoryStarter(options)
    const starts: string[] = []
    const inventory = new McpInventory((at, prompt) => {
      starts.push(at)
      return starter(at, prompt)
    })
    const registry = new SessionRegistry(claudeSessions(fake, {}, inventory))
    registries.push(registry)
    const attended: AgentEvent[] = []
    registry.start(cwd, undefined, (_id, event) => attended.push(event))
    await vi.waitFor(() => expect(attended.filter((event) => event.type === 'mcp').at(-1)).toMatchObject({ servers: [NOTES, OAUTH_NOT_ALLOWED] }))
    expect(starts).toHaveLength(1)
    expect(inventory.latest(cwd)).not.toBeNull()
    const unattended: AgentEvent[] = []
    const session = registry.start(cwd, undefined, (_id, event) => unattended.push(event), undefined, { unattended: true })
    expect(session.unattended).toBe(true)
    // Its own run, at its own start: the answer the attended Session left is not what it reads.
    await vi.waitFor(() => expect(starts).toHaveLength(2))
    // No one is at it, so no Turn off on its rows (ticket 03); the server outside its list is there all the same.
    await vi.waitFor(() => expect(unattended.filter((event) => event.type === 'mcp').at(-1)).toMatchObject({ servers: [{ ...NOTES, actions: [] }, OAUTH_NOT_ALLOWED] }))
  })

  it('a Claude Code that never answers is closed at the limit: the run answers null, and the next ask starts another', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const close = vi.fn()
    const inventory = new McpInventory(() => Promise.resolve({ close, mcpServerStatus: () => new Promise(() => undefined) } as unknown as QueryHandle), { settleMs: 10, pollMs: 5, answerMs: 50 })
    expect(await inventory.refresh(cwd)).toBeNull()
    expect(close).toHaveBeenCalledTimes(1)
    // The folder is free again: the next ask runs, and is closed at the limit too.
    expect(await inventory.refresh(cwd)).toBeNull()
    expect(close).toHaveBeenCalledTimes(2)
  })

  it('a failed run answers null, keeps the last answer and logs no server', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    let fail = false
    const inventory = new McpInventory(
      () => (fail ? Promise.reject(new Error('example-secret-server refused')) : Promise.resolve({ close: () => undefined, mcpServerStatus: () => Promise.resolve([{ name: 'example-secret-server', status: 'connected', source: 'user' }]) } as unknown as QueryHandle)),
      { settleMs: 1_000, pollMs: 10 },
    )
    expect(await inventory.refresh(cwd)).toHaveLength(1)
    fail = true
    expect(await inventory.refresh(cwd)).toBeNull()
    expect(inventory.latest(cwd)?.map((row) => row.name)).toEqual(['example-secret-server'])
    expect(warn.mock.calls.flat().join(' ')).not.toContain('example-secret')
  })
})

describe('the answer goes to the Session’s rows only', () => {
  it('an Autopilot run journals nothing of it, and nothing of it reaches the console', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((level) => vi.spyOn(console, level).mockImplementation(() => undefined))
    // The waves of autopilot-waves, with the servers of mcp-allow first: example-tracker is not on the list.
    const read = (script: string) =>
      readFileSync(join(AGENT_SCRIPTS, `${script}.jsonl`), 'utf8')
        .split('\n')
        .filter((line) => line.trim() !== '')
        .map((line) => JSON.parse(line) as Record<string, unknown>)
    const h = faultRun({ scripts: [[read('mcp-allow')[0]!, ...read('autopilot-waves')]], mcpAllowlist: ['example-notes', 'worfy-canvas'] })
    const seen: AgentEvent[] = []
    h.registry.observe((_id, event) => {
      if (event.type === 'mcp') seen.push(event)
    })
    expect(await h.start()).toEqual({ refusal: null })
    await h.stopped(1)
    // The unattended Session did get the row of the server outside its list: the journal had it to write, and wrote none.
    expect(seen.some((event) => event.type === 'mcp' && event.servers?.some((row) => row.name === 'example-tracker' && row.status === 'not-allowed'))).toBe(true)
    const journals = h.journals().join('\n')
    expect(journals).toContain('run-started')
    expect(journals).not.toContain('example-tracker')
    expect(journals).not.toContain('tracker_list')
    const logged = spies.flatMap((spy) => spy.mock.calls.flat().map(String)).join('\n')
    expect(logged).not.toContain('example-tracker')
  })
})
