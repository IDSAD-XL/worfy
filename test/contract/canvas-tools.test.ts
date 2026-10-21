// The canvas MCP server (src/main/mcp/canvas-server.ts) through its in-process instance, the way
// Claude Code talks to it: JSON-RPC over a transport, so the server's own schema check runs too.
// The tools write through the app's shared LayoutStore, next to src/main/ipc/layout.ts registered
// over a mocked `electron`, so a tool call and a renderer call take the same path (ADR-0003).
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, sep } from 'node:path'
import type { IpcMainInvokeEvent } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNEL_PREFIX, type IpcResult } from '../../src/shared/ipc/channels'
import { CANVAS_SERVER_NAME, TOOL_SIZE_MAX, type ListedNode } from '../../src/shared/canvas/tools'
import { layoutSchema, type Layout, type LayoutNode, type LayoutOpInput, type LayoutState } from '../../src/shared/layout/types'
import type { LayoutStore } from '../../src/main/layout/store'
import type { CanvasContext, CanvasDeps, CanvasWorkflow, ToolResult } from '../../src/main/mcp/canvas-server'
import type { QueryRequest } from '../../src/main/agent/session'
import { DEFAULT_SETTINGS } from '../../src/shared/agent/settings'
import { APP_URL, INDEX_HTML } from '../app-url'
import { removeTestTree, saveLayoutNow } from '../remove'
import { canLink, countFsCalls, SHARE, through } from './counted-fs'

const PROJECT = 'demo-0a1b2c3d'
const OTHER = 'other-11223344'

const mocks = vi.hoisted(() => {
  const sent: { channel: string; payload: unknown }[] = []
  const window = { isDestroyed: () => false, webContents: { send: (channel: string, payload: unknown) => sent.push({ channel, payload }) } }
  return { sent, window, query: vi.fn(), agentEnv: vi.fn() }
})

vi.mock('electron', () => ({
  app: { on: () => undefined, isPackaged: false, getAppPath: () => '/nowhere' },
  BrowserWindow: { getAllWindows: () => [mocks.window], fromWebContents: () => null },
  dialog: { showOpenDialog: vi.fn() },
}))
// The real SDK, except query(): it records the options a Session would start Claude Code with.
vi.mock('@anthropic-ai/claude-agent-sdk', async (importOriginal) => ({ ...(await importOriginal<object>()), query: mocks.query }))
vi.mock('../../src/main/agent/env', () => ({ agentEnv: mocks.agentEnv }))
// randomUUID as it is, except the ids a test queues: a new Node's id can then be made to meet one
// the Layout already has.
const uuids = vi.hoisted(() => ({ queued: [] as string[] }))
vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>()
  return { ...actual, randomUUID: () => uuids.queued.shift() ?? actual.randomUUID() }
})

type Listener = (event: IpcMainInvokeEvent, input: unknown) => unknown

let scratch: string
let dataDir: string
let repo: string
let handlers: Map<string, Listener>
let store: LayoutStore
let server: typeof import('../../src/main/mcp/canvas-server')

/** The workflow model of the fixture Project: Epic worfy-mvp with Tickets 7 and 24. */
const WORKFLOW: CanvasWorkflow = {
  epics: [{ epic: 'worfy-mvp', hasSpec: true, hasMap: false, title: 'worfy MVP' }],
  tickets: [7, 24].map((num) => ({
    epic: 'worfy-mvp',
    num,
    slug: `t${num}`,
    title: `Ticket ${num}`,
    statusRaw: 'open',
    state: 'open' as const,
    blockedRaw: null,
    blockedNums: [],
    blockedParsed: true,
    files: [],
    filesListed: true,
    fromBranch: null,
  })),
  error: null,
}

beforeEach(async () => {
  // Ids a test queued and did not use would be the next test's.
  uuids.queued.length = 0
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-canvas-')))
  dataDir = join(scratch, 'data')
  repo = join(scratch, 'repo')
  mkdirSync(repo)
  mkdirSync(join(dataDir, PROJECT), { recursive: true })
  mkdirSync(join(dataDir, OTHER), { recursive: true })
  writeFileSync(
    join(dataDir, 'projects.json'),
    JSON.stringify({ projects: [{ id: PROJECT, name: 'demo', path: repo }, { id: OTHER, name: 'other', path: join(scratch, 'other') }], activeId: PROJECT }),
  )
  mocks.sent.length = 0
  mocks.query.mockReset().mockImplementation(() => ({ kind: 'sdk query', [Symbol.asyncIterator]: () => ({ next: () => Promise.resolve({ done: true, value: undefined }) }) }))
  mocks.agentEnv.mockReset().mockResolvedValue({ env: { HOME: '/Users/tester', PATH: '/usr/bin' }, from: 'login-shell' })

  vi.resetModules()
  process.env.WORFY_DATA_DIR = dataDir
  const { registerIpc, appUrlMatcher } = await import('../../src/main/ipc/index')
  handlers = new Map()
  await registerIpc(
    { handle: (channel, listener) => handlers.set(channel, listener as Listener) },
    {
      modules: { './layout.ts': () => import('../../src/main/ipc/layout').then((module) => module.default) },
      isTrustedSender: appUrlMatcher({ indexHtml: INDEX_HTML }),
    },
  )
  store = (await import('../../src/main/layout/store')).layoutStore()
  server = await import('../../src/main/mcp/canvas-server')
})

afterEach(async () => {
  // Before the folder goes: the Layout store saves a moment after the last change, and a save
  // that came after the removal made the folder again.
  await saveLayoutNow()
  delete process.env.WORFY_DATA_DIR
  removeTestTree(scratch)
})

/** A renderer call of layout.apply through the registered IPC handler. */
async function rendererApply(op: LayoutOpInput, projectId: string = PROJECT): Promise<IpcResult<unknown>> {
  const listener = handlers.get(`${IPC_CHANNEL_PREFIX}layout.apply`)
  if (!listener) throw new Error('no layout.apply handler')
  const event = { senderFrame: { url: APP_URL }, sender: {} } as unknown as IpcMainInvokeEvent
  return (await listener(event, { projectId, op })) as IpcResult<unknown>
}

const context = (overrides: Partial<CanvasContext> = {}): CanvasContext => ({
  projectId: PROJECT,
  cardsDir: join(dataDir, PROJECT, 'cards'),
  layout: store,
  workflow: () => Promise.resolve(WORKFLOW),
  sessionId: () => null,
  ...overrides,
})

interface Rpc {
  request(method: string, params: unknown): Promise<{ result?: unknown; error?: unknown }>
  call(name: string, args?: Record<string, unknown>): Promise<ToolResult>
}

type ServerConfig = Awaited<ReturnType<typeof import('../../src/main/mcp/canvas-server').createCanvasServer>>

/** Connects to a server for `ctx` as Claude Code would: initialize, then requests. */
const connect = async (ctx: CanvasContext = context()): Promise<Rpc> => connectTo(await server.createCanvasServer(ctx))

/** Connects to a server's MCP instance. */
async function connectTo(config: ServerConfig): Promise<Rpc> {
  expect(config).toMatchObject({ type: 'sdk', name: CANVAS_SERVER_NAME })
  type Message = { id?: number; result?: unknown; error?: unknown }
  const pending = new Map<number, (message: Message) => void>()
  const transport: { onmessage?: (message: unknown) => void; start(): Promise<void>; close(): Promise<void>; send(message: Message): Promise<void> } = {
    start: () => Promise.resolve(),
    close: () => Promise.resolve(),
    send: (message) => {
      const resolve = message.id === undefined ? undefined : pending.get(message.id)
      if (resolve && message.id !== undefined) {
        pending.delete(message.id)
        resolve(message)
      }
      return Promise.resolve()
    },
  }
  await config.instance.connect(transport as never)
  let next = 0
  const request: Rpc['request'] = (method, params) =>
    new Promise((resolve) => {
      next += 1
      pending.set(next, resolve)
      transport.onmessage?.({ jsonrpc: '2.0', id: next, method, params })
    })
  await request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } })
  transport.onmessage?.({ jsonrpc: '2.0', method: 'notifications/initialized' })
  return {
    request,
    call: async (name, args = {}) => {
      const answer = await request('tools/call', { name, arguments: args })
      if (answer.error !== undefined) return { content: [{ type: 'text', text: JSON.stringify(answer.error) }], isError: true }
      return answer.result as ToolResult
    },
  }
}

const textOf = (result: ToolResult): string => result.content[0]?.text ?? ''
const json = <T>(result: ToolResult): T => {
  expect(result.isError, textOf(result)).toBeFalsy()
  return JSON.parse(textOf(result)) as T
}
const nodes = (projectId: string = PROJECT): LayoutNode[] => store.get(projectId).layout.nodes
const nodeOf = (id: string, projectId: string = PROJECT): LayoutNode | undefined => nodes(projectId).find((node) => node.id === id)
const broadcasts = (): LayoutState[] => mocks.sent.filter((message) => message.channel === `${IPC_CHANNEL_PREFIX}layout.changed`).map((message) => message.payload as LayoutState)
const lastBroadcast = (): LayoutState | undefined => broadcasts().at(-1)

/** The SDK's system/init message, which starts every turn and carries the Session's id. */
const initMessage = (sessionId: string, cwd: string): Record<string, unknown> => ({
  type: 'system',
  subtype: 'init',
  session_id: sessionId,
  model: 'claude-test',
  permissionMode: 'bypassPermissions',
  apiKeySource: 'none',
  cwd,
  slash_commands: [],
})
const note = (id: string, extra: Partial<LayoutNode> = {}): LayoutOpInput => ({ op: 'create', node: { id, kind: 'note', x: 0, y: 0, w: 220, h: 120, data: { text: id }, ...extra } })
const orchestrator = (): LayoutOpInput => ({ op: 'create', node: { id: 'orch', kind: 'orchestrator', x: 0, y: 0, w: 300, h: 200, locked: true, data: { sessionId: 'session-a' } } })

/** Asserts a refused call: a tool error whose text matches, and the Layout untouched. */
async function refused(rpc: Rpc, name: string, args: Record<string, unknown>, message: RegExp): Promise<void> {
  const before = store.get(PROJECT)
  const result = await rpc.call(name, args)
  expect(result.isError, textOf(result)).toBe(true)
  expect(textOf(result)).toMatch(message)
  expect(store.get(PROJECT)).toEqual(before)
}

describe('canvas tools: the tool list', () => {
  it('lists exactly the eight canvas tools, none of which removes a Node, with short descriptions', async () => {
    const rpc = await connect()
    const { result } = await rpc.request('tools/list', {})
    const tools = (result as { tools: { name: string; description: string }[] }).tools
    expect(tools.map((tool) => tool.name).sort()).toEqual(['create_card', 'create_note', 'hide_node', 'link_card', 'list_nodes', 'move_node', 'resize_node', 'update_node'])
    // Every Session carries the list in its context (ticket 06): it stays small.
    expect(JSON.stringify(tools).length).toBeLessThan(6000)
  })
})

describe('canvas tools: each tool changes the Layout and the change is broadcast', () => {
  it('list_nodes reports id, kind, title, place, size, hidden and locked, and nothing else', async () => {
    store.apply(PROJECT, note('n1'))
    // Hidden before the Orchestrator comes: a hidden Node is in nobody's way (ADR-0038), so both are at (0, 0).
    store.apply(PROJECT, { op: 'hide', id: 'n1', hidden: true })
    store.apply(PROJECT, orchestrator())
    const rpc = await connect()
    const listed = json<ListedNode[]>(await rpc.call('list_nodes'))
    expect(listed).toEqual([
      { id: 'n1', kind: 'note', title: 'n1', x: 0, y: 0, w: 220, h: 120, hidden: true, locked: false },
      { id: 'orch', kind: 'orchestrator', title: null, x: 0, y: 0, w: 300, h: 200, hidden: false, locked: true },
    ])
  })

  it('create_card makes the Card folder in the data folder and a card Node next to the calling Session', async () => {
    store.apply(PROJECT, orchestrator())
    const rpc = await connect(context({ sessionId: () => 'session-a' }))
    const created = json<ListedNode & { folder: string; index: string }>(await rpc.call('create_card', { title: 'Clock' }))
    expect(created.id).toMatch(/^card-[0-9a-f]{8}$/)
    expect(created.folder).toBe(join(dataDir, PROJECT, 'cards', created.id))
    expect(created.index).toBe(join(created.folder, 'index.html'))
    expect(statSync(created.folder).isDirectory()).toBe(true)
    // The agent writes index.html itself; the tool only makes the folder.
    expect(existsSync(created.index)).toBe(false)
    expect(nodeOf(created.id)).toMatchObject({ kind: 'card', x: 340, y: 0, w: 360, h: 280, data: { title: 'Clock' } })
    expect(lastBroadcast()?.layout.nodes.map((node) => node.id)).toContain(created.id)
    // The repository of the Project is not touched (ADR-0005).
    expect(existsSync(join(repo, 'cards'))).toBe(false)
  })

  it('create_card at a given place, and a second Card next to the Session goes below the first', async () => {
    store.apply(PROJECT, orchestrator())
    const rpc = await connect(context({ sessionId: () => 'session-a' }))
    const placed = json<ListedNode>(await rpc.call('create_card', { title: 'Here', x: -500, y: 900, w: 200, h: 100 }))
    expect(nodeOf(placed.id)).toMatchObject({ x: -500, y: 900, w: 200, h: 100 })
    const first = json<ListedNode>(await rpc.call('create_card', { title: 'One' }))
    const second = json<ListedNode>(await rpc.call('create_card', { title: 'Two' }))
    expect(nodeOf(first.id)).toMatchObject({ x: 340, y: 0 })
    expect(nodeOf(second.id)).toMatchObject({ x: 340, y: 320 })
  })

  it('create_card, create_note, move_node and resize_node onto a taken place answer with the nearest free place, and the Layout has the answer (ADR-0038)', async () => {
    // A Card-sized Node at (0, 0): 300 × 200.
    store.apply(PROJECT, orchestrator())
    const rpc = await connect()
    const card = json<ListedNode>(await rpc.call('create_card', { title: 'Here', x: 40, y: 40, w: 220, h: 120 }))
    expect(card).toMatchObject({ x: 40, y: 200 + 16, w: 220, h: 120 })
    expect(nodeOf(card.id)).toMatchObject({ x: card.x, y: card.y })
    const created = json<ListedNode>(await rpc.call('create_note', { text: 'n', x: 40, y: 40, w: 220, h: 120 }))
    // Under the Orchestrator is the Card now; above it (176 up) is nearer than right of it (276).
    expect(created).toMatchObject({ x: 40, y: -16 - 120 })
    expect(nodeOf(created.id)).toMatchObject({ x: created.x, y: created.y })

    const moved = json<ListedNode>(await rpc.call('move_node', { id: created.id, x: 10, y: 10 }))
    expect(moved).toMatchObject({ x: 10, y: -16 - 120 })
    expect(nodeOf(created.id)).toMatchObject({ x: moved.x, y: moved.y })

    // Wider with nothing in the way: as asked. Then the Orchestrator wider into the Note on its
    // right: its right edge stops 16 px short of the Note.
    const resized = json<ListedNode>(await rpc.call('resize_node', { id: card.id, w: 600, h: 120 }))
    expect(resized).toMatchObject({ x: 40, y: 216, w: 600, h: 120 })
    json<ListedNode>(await rpc.call('move_node', { id: created.id, x: 400, y: 10 }))
    const grown = json<ListedNode>(await rpc.call('resize_node', { id: 'orch', w: 600, h: 200 }))
    expect(grown).toMatchObject({ x: 0, y: 0, w: 400 - 16, h: 200 })
    expect(nodeOf('orch')).toMatchObject({ w: grown.w, h: grown.h })
    expect(lastBroadcast()?.layout).toEqual(store.get(PROJECT).layout)
  })

  it('the tool descriptions tell the agent that the place may be corrected and the answer has the real one', async () => {
    const rpc = await connect()
    const { result } = await rpc.request('tools/list', {})
    const tools = new Map((result as { tools: { name: string; description: string }[] }).tools.map((tool) => [tool.name, tool.description]))
    for (const name of ['create_card', 'create_note', 'move_node', 'resize_node']) expect(tools.get(name), name).toMatch(/nearest free place.*answer/i)
  })

  it('create_note makes a note Node with its text', async () => {
    const rpc = await connect()
    const created = json<ListedNode>(await rpc.call('create_note', { text: 'remember\nthis' }))
    expect(nodeOf(created.id)).toMatchObject({ kind: 'note', x: 0, y: 0, w: 220, h: 120, data: { text: 'remember\nthis' } })
    expect(created.title).toBe('remember')
    expect(lastBroadcast()?.layout).toEqual(store.get(PROJECT).layout)
  })

  it("update_node changes a Card's title and a note's text", async () => {
    store.apply(PROJECT, note('n1'))
    const rpc = await connect()
    const card = json<ListedNode>(await rpc.call('create_card', { title: 'Old' }))
    expect(json<ListedNode>(await rpc.call('update_node', { id: card.id, title: 'New' })).title).toBe('New')
    expect(nodeOf(card.id)?.data).toEqual({ title: 'New' })
    await rpc.call('update_node', { id: 'n1', text: 'changed' })
    expect(nodeOf('n1')?.data).toEqual({ text: 'changed' })
    expect(lastBroadcast()?.layout).toEqual(store.get(PROJECT).layout)
  })

  it('move_node, resize_node and hide_node change the Node, and hide_node with hidden=false shows it again', async () => {
    store.apply(PROJECT, note('n1'))
    const rpc = await connect()
    await rpc.call('move_node', { id: 'n1', x: 120, y: -40 })
    expect(nodeOf('n1')).toMatchObject({ x: 120, y: -40 })
    expect(lastBroadcast()?.layout.nodes[0]).toMatchObject({ x: 120, y: -40 })
    await rpc.call('resize_node', { id: 'n1', w: 500, h: 300 })
    expect(nodeOf('n1')).toMatchObject({ x: 120, y: -40, w: 500, h: 300 })
    await rpc.call('hide_node', { id: 'n1' })
    expect(nodeOf('n1')?.hidden).toBe(true)
    expect(lastBroadcast()?.layout.nodes[0]?.hidden).toBe(true)
    await rpc.call('hide_node', { id: 'n1', hidden: false })
    expect(nodeOf('n1')?.hidden).toBe(false)
  })

  it('link_card links a Card to an Epic and to a Ticket once each, and remove=true unlinks', async () => {
    const rpc = await connect()
    const card = json<ListedNode>(await rpc.call('create_card', { title: 'Board' }))
    expect(json<{ links: string[] }>(await rpc.call('link_card', { id: card.id, target: 'worfy-mvp' })).links).toEqual(['worfy-mvp'])
    expect(json<{ links: string[] }>(await rpc.call('link_card', { id: card.id, target: 'worfy-mvp/07' })).links).toEqual(['worfy-mvp', 'worfy-mvp/07'])
    expect(json<{ links: string[] }>(await rpc.call('link_card', { id: card.id, target: 'worfy-mvp/7' })).links).toEqual(['worfy-mvp', 'worfy-mvp/07'])
    expect(nodeOf(card.id)?.data.links).toEqual([
      { epic: 'worfy-mvp', num: null },
      { epic: 'worfy-mvp', num: 7 },
    ])
    expect(json<{ links: string[] }>(await rpc.call('link_card', { id: card.id, target: 'worfy-mvp', remove: true })).links).toEqual(['worfy-mvp/07'])
    expect(lastBroadcast()?.layout).toEqual(store.get(PROJECT).layout)
  })
})

describe('canvas tools: refused calls are tool errors with a reason', () => {
  it('move_node for a Node that is not there is a tool error, not an exception', async () => {
    const rpc = await connect()
    await refused(rpc, 'move_node', { id: 'missing', x: 10, y: 20 }, /no Node with id missing/i)
    expect(store.get(PROJECT).revision).toBe(0)
  })

  it('every tool that names a Node refuses an unknown id', async () => {
    const rpc = await connect()
    await refused(rpc, 'update_node', { id: 'missing', title: 't' }, /no Node with id missing/)
    await refused(rpc, 'resize_node', { id: 'missing', w: 100, h: 100 }, /no Node with id missing/)
    await refused(rpc, 'hide_node', { id: 'missing' }, /no Node with id missing/)
    await refused(rpc, 'link_card', { id: 'missing', target: 'worfy-mvp' }, /no Node with id missing/)
  })

  it("a Node of another Project is unknown to this Project's server, and stays as it is", async () => {
    store.apply(OTHER, note('foreign'))
    const rpc = await connect()
    await refused(rpc, 'move_node', { id: 'foreign', x: 1, y: 1 }, /no Node with id foreign/)
    await refused(rpc, 'hide_node', { id: 'foreign' }, /no Node with id foreign/)
    expect(nodeOf('foreign', OTHER)).toMatchObject({ x: 0, y: 0, hidden: false })
  })

  it('wrong types and sizes out of bounds are refused by the schema with the field named', async () => {
    store.apply(PROJECT, note('n1'))
    const rpc = await connect()
    await refused(rpc, 'move_node', { id: 'n1', x: 'left', y: 0 }, /x/)
    await refused(rpc, 'resize_node', { id: 'n1', w: TOOL_SIZE_MAX + 1, h: 100 }, /w/)
    await refused(rpc, 'resize_node', { id: 'n1', w: 100, h: 1 }, /h/)
    await refused(rpc, 'create_card', { title: 42 }, /title/)
    await refused(rpc, 'create_card', { title: '   ' }, /title/)
    await refused(rpc, 'create_note', { text: 'x', w: 10 ** 9 }, /w/)
    await refused(rpc, 'hide_node', { id: 'n1', hidden: 'yes' }, /hidden/)
    await refused(rpc, 'move_node', { x: 1, y: 1 }, /id/)
  })

  it('coordinates beyond ±100000 are refused, and the limit itself is accepted', async () => {
    store.apply(PROJECT, note('n1'))
    const rpc = await connect()
    await refused(rpc, 'move_node', { id: 'n1', x: 100_001, y: 0 }, /x/)
    await refused(rpc, 'move_node', { id: 'n1', x: 0, y: -100_001 }, /y/)
    await refused(rpc, 'create_card', { title: 'far', x: -100_001, y: 0 }, /x/)
    await refused(rpc, 'create_note', { text: 'far', x: 0, y: 1e9 }, /y/)
    await rpc.call('move_node', { id: 'n1', x: 100_000, y: -100_000 })
    expect(nodeOf('n1')).toMatchObject({ x: 100_000, y: -100_000 })
  })

  it('create_card whose Layout change fails is a tool error and leaves no Card folder behind', async () => {
    const cardsDir = join(dataDir, PROJECT, 'cards')
    const failing = { get: (projectId: string) => store.get(projectId), apply: () => { throw new Error('layout.json is not writable') } }
    const rpc = await connect(context({ layout: failing }))
    const result = await rpc.call('create_card', { title: 'Lost' })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toMatch(/layout.json is not writable/)
    expect(existsSync(cardsDir) ? readdirSync(cardsDir) : []).toEqual([])
  })

  // worfy-windows ticket 23: the folder goes with removeTree, which takes a link away as a link.
  // Under the Node of Electron 44 on Windows fs.rmSync went through a junction.
  it('create_card whose Layout change fails with a link in the Card folder: the folder goes, the folder the link leads to keeps its file', async () => {
    const cardsDir = join(dataDir, PROJECT, 'cards')
    const outside = join(scratch, 'outside')
    mkdirSync(outside)
    writeFileSync(join(outside, 'notes.txt'), 'keep me')
    let linked = 0
    const failing = {
      get: (projectId: string) => store.get(projectId),
      apply: () => {
        // A junction on Windows; elsewhere a symlink to the folder.
        for (const id of readdirSync(cardsDir)) {
          symlinkSync(outside, join(cardsDir, id, 'linked'), process.platform === 'win32' ? 'junction' : 'dir')
          linked++
        }
        throw new Error('layout.json is not writable')
      },
    }
    const rpc = await connect(context({ layout: failing }))
    expect((await rpc.call('create_card', { title: 'Lost' })).isError).toBe(true)
    expect(linked).toBe(1)
    expect(readdirSync(cardsDir)).toEqual([])
    expect(readdirSync(outside)).toEqual(['notes.txt'])
  })

  // worfy-windows ticket 20. A real symlink to a share nobody answers for; only Windows has the
  // rule, and making a symlink there needs Developer Mode.
  it.runIf(canLink())('create_card with a Cards folder that is a link to a share is a tool error that says so: no folder is made, and no call names a path through the link', async () => {
    const cardsDir = join(dataDir, PROJECT, 'cards')
    symlinkSync(`${SHARE}\\cards`, cardsDir, 'dir')
    const rpc = await connect()
    const counted = countFsCalls()
    try {
      const result = await rpc.call('create_card', { title: 'Lost' })
      expect(result.isError).toBe(true)
      expect(textOf(result)).toMatch(/Cards leads off this machine, or cannot be checked/)
      expect(through(counted.calls, cardsDir)).toEqual([])
      // A note needs no folder: it is made as before.
      expect((await rpc.call('create_note', { text: 'still here' })).isError).toBeFalsy()
      expect(through(counted.calls, cardsDir)).toEqual([])
    } finally {
      counted.restore()
      unlinkSync(cardsDir)
    }
  })

  it('update_node refuses a Node that is neither a Card nor a note, and a field the kind does not have', async () => {
    store.apply(PROJECT, orchestrator())
    store.apply(PROJECT, note('n1'))
    const rpc = await connect()
    const card = json<ListedNode>(await rpc.call('create_card', { title: 'C' }))
    await refused(rpc, 'update_node', { id: 'orch', title: 'Mine now' }, /Only Cards and notes/)
    await refused(rpc, 'update_node', { id: card.id, text: 'body' }, /Card/)
    await refused(rpc, 'update_node', { id: 'n1', title: 'T' }, /note/)
    await refused(rpc, 'update_node', { id: 'n1' }, /Nothing to update/)
  })

  it('link_card refuses a Ticket or an Epic that does not exist, a malformed target, a Node that is not a Card, and an unreadable workflow', async () => {
    store.apply(PROJECT, note('n1'))
    const rpc = await connect()
    const card = json<ListedNode>(await rpc.call('create_card', { title: 'C' }))
    await refused(rpc, 'link_card', { id: card.id, target: 'worfy-mvp/99' }, /no Ticket 99/)
    await refused(rpc, 'link_card', { id: card.id, target: 'nope/01' }, /no Epic nope/)
    await refused(rpc, 'link_card', { id: card.id, target: 'nope' }, /no Epic nope/)
    await refused(rpc, 'link_card', { id: card.id, target: 'worfy-mvp/07/extra' }, /target/)
    await refused(rpc, 'link_card', { id: 'n1', target: 'worfy-mvp' }, /not a Card/)
    const broken = await connect(context({ workflow: () => Promise.resolve({ epics: [], tickets: [], error: { code: 'not-found', message: 'epic-status is missing' } }) }))
    await refused(broken, 'link_card', { id: card.id, target: 'worfy-mvp' }, /epic-status is missing/)
  })
})

describe('canvas tools: the agent cannot remove Nodes or hide locked ones', () => {
  it('there is no tool to remove a Node, and hiding the Orchestrator is refused while moving and resizing it pass', async () => {
    store.apply(PROJECT, orchestrator())
    const rpc = await connect()
    for (const name of ['remove_node', 'delete_node']) {
      const result = await rpc.call(name, { id: 'orch' })
      expect(result.isError).toBe(true)
    }
    await refused(rpc, 'hide_node', { id: 'orch' }, /locked/)
    await refused(rpc, 'hide_node', { id: 'orch', hidden: true }, /locked/)
    expect(nodeOf('orch')).toMatchObject({ hidden: false, locked: true })
    await rpc.call('move_node', { id: 'orch', x: 50, y: 60 })
    await rpc.call('resize_node', { id: 'orch', w: 400, h: 260 })
    expect(nodeOf('orch')).toMatchObject({ x: 50, y: 60, w: 400, h: 260, hidden: false, locked: true })
  })
})

describe('canvas tools: Epic frames and Tickets', () => {
  // The renderer keeps, per Epic, a Layout Node of kind epic-frame: its x/y are the frame's offset
  // from its automatic place and data.collapsed whether the user collapsed it, nothing else
  // (ADR-0037); it is not a Node on the canvas.
  const frameState = (): LayoutOpInput => ({
    op: 'create',
    node: { id: 'epic:worfy-mvp', kind: 'epic-frame', x: 30, y: -20, w: 1, h: 1, locked: true, data: { collapsed: true } },
  })

  it('list_nodes does not list the saved state of an Epic frame, nor a stray ticket Node', async () => {
    store.apply(PROJECT, frameState())
    store.apply(PROJECT, { op: 'create', node: { id: 'stray', kind: 'ticket', x: 0, y: 0, w: 220, h: 120, data: {} } })
    store.apply(PROJECT, note('n1'))
    const rpc = await connect()
    expect(json<ListedNode[]>(await rpc.call('list_nodes')).map((node) => node.id)).toEqual(['n1'])
  })

  it('every tool that names a Node refuses an Epic frame or a Ticket and changes nothing', async () => {
    store.apply(PROJECT, frameState())
    const rpc = await connect()
    const reason = /is an Epic frame or a Ticket: .*only the user moves them/
    await refused(rpc, 'move_node', { id: 'epic:worfy-mvp', x: 500, y: 300 }, reason)
    await refused(rpc, 'resize_node', { id: 'epic:worfy-mvp', w: 400, h: 300 }, reason)
    await refused(rpc, 'hide_node', { id: 'epic:worfy-mvp', hidden: true }, reason)
    await refused(rpc, 'update_node', { id: 'epic:worfy-mvp', title: 't' }, reason)
    await refused(rpc, 'link_card', { id: 'epic:worfy-mvp', target: 'worfy-mvp' }, reason)
    // A Ticket has no Layout Node at all; the answer still says what it is.
    await refused(rpc, 'move_node', { id: 'ticket:worfy-mvp/3', x: 10, y: 10 }, reason)
    await refused(rpc, 'move_node', { id: 'epic:other', x: 10, y: 10 }, reason)
    expect(nodeOf('epic:worfy-mvp')).toMatchObject({ x: 30, y: -20, w: 1, h: 1, hidden: false })
  })

  it('a Layout Node of kind epic-frame or ticket is refused by its kind, whatever its id', async () => {
    store.apply(PROJECT, { op: 'create', node: { id: 'stray-ticket', kind: 'ticket', x: 0, y: 0, w: 220, h: 120, data: {} } })
    store.apply(PROJECT, { op: 'create', node: { id: 'stray-frame', kind: 'epic-frame', x: 0, y: 0, w: 1, h: 1, data: {} } })
    const rpc = await connect()
    const reason = /is an Epic frame or a Ticket: .*only the user moves them/
    await refused(rpc, 'move_node', { id: 'stray-ticket', x: 10, y: 10 }, reason)
    await refused(rpc, 'link_card', { id: 'stray-frame', target: 'worfy-mvp' }, reason)
    expect(nodeOf('stray-ticket')).toMatchObject({ x: 0, y: 0 })
  })
})

describe('canvas tools: the Epic frames\' arrangement record', () => {
  // The renderer keeps the order of the Epic frames and their number of columns in one locked 1×1
  // Layout Node, id and kind epic-arrangement (ADR-0075); it is no Node on the canvas.
  const record = (id = 'epic-arrangement'): LayoutOpInput => ({
    op: 'create',
    node: { id, kind: 'epic-arrangement', x: 0, y: 0, w: 1, h: 1, locked: true, data: { order: ['a'], columns: 1, at: '2026-10-19T08:00:00.000Z' } },
  })

  it('list_nodes does not list it, and every tool that names it says what it is and changes nothing', async () => {
    store.apply(PROJECT, record())
    store.apply(PROJECT, record('stray-record'))
    store.apply(PROJECT, note('n1'))
    const rpc = await connect()
    expect(json<ListedNode[]>(await rpc.call('list_nodes')).map((node) => node.id)).toEqual(['n1'])
    const reason = /is not a Node: it is the Canvas's internal record of how the Epic frames are arranged/
    await refused(rpc, 'move_node', { id: 'epic-arrangement', x: 500, y: 300 }, reason)
    await refused(rpc, 'update_node', { id: 'epic-arrangement', title: 't' }, reason)
    await refused(rpc, 'link_card', { id: 'epic-arrangement', target: 'worfy-mvp' }, reason)
    await refused(rpc, 'hide_node', { id: 'stray-record', hidden: true }, reason)
    expect(nodeOf('epic-arrangement')).toMatchObject({ x: 0, y: 0, w: 1, h: 1, hidden: false, data: { columns: 1 } })
  })
})

describe('canvas tools: archived Nodes', () => {
  // The automatic archive takes finished Sessions off the Canvas (ADR-0076); the Node stays in the
  // Layout. The agent works on what the user sees: it neither lists nor changes an archived Node.
  const archive = (...ids: string[]): LayoutOpInput => ({ op: 'archive', batch: 'batch-1', nodes: ids.map((id) => ({ id, rule: 'idle' as const })) })

  it('list_nodes does not list an archived Node, and lists it again once it is restored', async () => {
    store.apply(PROJECT, note('n1'))
    store.apply(PROJECT, note('n2', { x: 400 }))
    store.apply(PROJECT, archive('n2'))
    const rpc = await connect()
    expect(json<ListedNode[]>(await rpc.call('list_nodes')).map((node) => node.id)).toEqual(['n1'])
    store.apply(PROJECT, { op: 'restore', ids: ['n2'] })
    expect(json<ListedNode[]>(await rpc.call('list_nodes')).map((node) => node.id)).toEqual(['n1', 'n2'])
  })

  it('every tool that names an archived Node refuses it, says it is archived, and changes nothing', async () => {
    store.apply(PROJECT, note('n2'))
    store.apply(PROJECT, { op: 'create', node: { id: 'c1', kind: 'card', x: 600, y: 0, w: 320, h: 240, data: { title: 'Old' } } })
    store.apply(PROJECT, archive('n2', 'c1'))
    const rpc = await connect()
    const reason = /^Node \S+ is archived: it is off the canvas until the user brings it back/
    await refused(rpc, 'move_node', { id: 'n2', x: 500, y: 300 }, reason)
    await refused(rpc, 'resize_node', { id: 'n2', w: 400, h: 300 }, reason)
    await refused(rpc, 'hide_node', { id: 'n2', hidden: true }, reason)
    await refused(rpc, 'update_node', { id: 'n2', text: 't' }, reason)
    await refused(rpc, 'link_card', { id: 'c1', target: 'worfy-mvp' }, reason)
    expect(nodeOf('n2')).toMatchObject({ x: 0, y: 0, w: 220, h: 120, hidden: false, archived: { rule: 'idle', batch: 'batch-1' } })
  })

  it("a new Node's id is never an archived Node's: the id is still taken", async () => {
    store.apply(PROJECT, note('note-aaaaaaaa'))
    store.apply(PROJECT, archive('note-aaaaaaaa'))
    const rpc = await connect()
    uuids.queued.push('aaaaaaaa-0000-4000-8000-000000000000', 'bbbbbbbb-0000-4000-8000-000000000000')
    const made = json<ListedNode>(await rpc.call('create_note', { text: 'new' }))
    expect(made.id).toBe('note-bbbbbbbb')
    expect(nodeOf('note-aaaaaaaa')).toMatchObject({ data: { text: 'note-aaaaaaaa' }, archived: { batch: 'batch-1' } })
  })
})

describe('canvas tools: Subagent Nodes', () => {
  // Subagent Nodes are computed from their Session's transcript and nothing about them is in the
  // Layout (ADR-0037). Older versions kept a Layout Node of kind subagent-tree per Session; main
  // removes it when it reads layout.json. One put straight into the store stands for a stray one:
  // the tools neither list nor change it.
  const SESSION = '77777777-7777-4777-8777-777777777777'
  const treeState = (): LayoutOpInput => ({
    op: 'create',
    node: { id: `subagents:${SESSION}`, kind: 'subagent-tree', x: 0, y: 0, w: 1, h: 1, locked: true, data: {} },
  })

  it('list_nodes lists neither a stray Subagent tree nor a stray subagent Node', async () => {
    store.apply(PROJECT, treeState())
    store.apply(PROJECT, { op: 'create', node: { id: 'stray', kind: 'subagent', x: 0, y: 0, w: 260, h: 96, data: {} } })
    store.apply(PROJECT, note('n1'))
    const rpc = await connect()
    expect(json<ListedNode[]>(await rpc.call('list_nodes')).map((node) => node.id)).toEqual(['n1'])
  })

  it('every tool that names a Node refuses a Subagent, says it is one, and changes nothing', async () => {
    store.apply(PROJECT, treeState())
    store.apply(PROJECT, { op: 'create', node: { id: 'stray', kind: 'subagent', x: 0, y: 0, w: 260, h: 96, data: {} } })
    const rpc = await connect()
    const reason = /is a Subagent of a Session: .*only the user moves it\. A Card cannot be linked to it\./
    const tree = `subagents:${SESSION}`
    await refused(rpc, 'move_node', { id: tree, x: 500, y: 300 }, reason)
    await refused(rpc, 'resize_node', { id: tree, w: 400, h: 300 }, reason)
    await refused(rpc, 'hide_node', { id: tree, hidden: true }, reason)
    await refused(rpc, 'update_node', { id: tree, title: 't' }, reason)
    await refused(rpc, 'link_card', { id: tree, target: 'worfy-mvp' }, reason)
    // A Subagent Node has no Layout Node; a Layout Node of kind subagent is refused by its kind.
    await refused(rpc, 'move_node', { id: `subagent:${SESSION}/toolu_1`, x: 10, y: 10 }, reason)
    await refused(rpc, 'move_node', { id: 'stray', x: 10, y: 10 }, reason)
    expect(nodeOf(tree)).toMatchObject({ x: 0, y: 0, w: 1, h: 1, hidden: false })
  })
})

describe('canvas tools: arguments at the boundary', () => {
  it('keys a tool does not declare never reach the Layout, through the server and through a direct call', async () => {
    store.apply(PROJECT, note('n1'))
    const rpc = await connect()
    const created = json<ListedNode>(await rpc.call('create_note', { text: 'hi', kind: 'orchestrator', locked: true, data: { sessionId: 'stolen' }, id: 'chosen' }))
    expect(nodeOf(created.id)).toMatchObject({ kind: 'note', locked: false, data: { text: 'hi' } })
    expect(created.id).not.toBe('chosen')

    const direct = server.canvasToolCaller(context())
    const moved = await direct('move_node', { id: 'n1', x: 5, y: 6, hidden: true, w: 999 })
    expect(moved.isError, textOf(moved)).toBeFalsy()
    expect(nodeOf('n1')).toMatchObject({ x: 5, y: 6, w: 220, hidden: false })
    const card = await direct('create_card', { title: 'T', data: { lastEditor: 'forged' }, kind: 'note' })
    const cardId = (JSON.parse(textOf(card)) as ListedNode).id
    expect(nodeOf(cardId)).toMatchObject({ kind: 'card', data: { title: 'T' } })
    expect(nodeOf(cardId)?.data).not.toHaveProperty('lastEditor')
  })

  it('a direct call gets the parsed arguments: defaults filled in, titles trimmed', async () => {
    store.apply(PROJECT, note('n1'))
    const direct = server.canvasToolCaller(context())
    const hidden = await direct('hide_node', { id: 'n1' })
    expect(hidden.isError, textOf(hidden)).toBeFalsy()
    expect(nodeOf('n1')?.hidden).toBe(true)
    const card = await direct('create_card', { title: '  Clock  ' })
    expect(nodeOf((JSON.parse(textOf(card)) as ListedNode).id)?.data).toEqual({ title: 'Clock' })
  })

  it('a direct call with a wrong type is a tool error too, and changes nothing', async () => {
    store.apply(PROJECT, note('n1'))
    const direct = server.canvasToolCaller(context())
    const before = store.get(PROJECT)
    const result = await direct('move_node', { id: 'n1', x: '5', y: 6 })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toMatch(/Invalid arguments for move_node/)
    expect(store.get(PROJECT)).toEqual(before)
  })
})

describe('canvas tools: tool calls and the renderer at once', () => {
  it('100 parallel moves from the renderer and from move_node leave a valid layout.json where the last move of each Node wins', async () => {
    const ids = ['a', 'b', 'c', 'd']
    for (const id of ids) store.apply(PROJECT, note(id))
    const rpc = await connect()

    // The order main actually applied the moves in, whoever sent them.
    const order: { id: string; x: number; y: number }[] = []
    store.onChange(({ op }) => {
      if (op.op === 'move') order.push({ id: op.id, x: op.x, y: op.y })
    })

    // Places far apart: none of them is corrected for an overlap (ADR-0038), so the last move is where the Node is.
    const moves = Array.from({ length: 100 }, (_, n) => ({ id: ids[n % ids.length] ?? 'a', x: n * 1000 + 1, y: n * -700 - 1 }))
    const results = await Promise.all(
      moves.map(async (move, n) => {
        if (n % 2 === 0) return (await rendererApply({ op: 'move', ...move })).ok
        return !(await rpc.call('move_node', move)).isError
      }),
    )
    expect(results.every(Boolean)).toBe(true)
    expect(order).toHaveLength(100)

    store.flushAll()
    const saved: Layout = layoutSchema.parse(JSON.parse(readFileSync(join(dataDir, PROJECT, 'layout.json'), 'utf8')))
    expect(saved.nodes.map((node) => node.id).sort()).toEqual(ids)
    for (const id of ids) {
      const last = order.filter((move) => move.id === id).at(-1)
      expect(saved.nodes.find((node) => node.id === id)).toMatchObject({ x: last?.x, y: last?.y, w: 220, h: 120 })
    }
    expect(store.get(PROJECT).layout).toEqual(saved)
    expect(lastBroadcast()?.layout).toEqual(saved)
  })
})

describe('canvas in a Session', () => {
  const deps = (): CanvasDeps => ({
    projects: () => [{ id: PROJECT, name: 'demo', path: repo }],
    dataDir: (projectId) => join(dataDir, projectId),
    layout: store,
    workflow: () => Promise.resolve(WORKFLOW),
  })
  const request = (cwd: string): QueryRequest => ({ prompt: (async function* () {})(), cwd, resume: undefined, stderr: () => undefined, settings: DEFAULT_SETTINGS, canUseTool: () => Promise.resolve({ behavior: 'deny', message: 'not in this test' }) })
  /** The options the factory passed to the SDK's query(). */
  const sdkOptions = (): Record<string, unknown> => {
    expect(mocks.query).toHaveBeenCalledOnce()
    return (mocks.query.mock.calls[0] as [{ options: Record<string, unknown> }])[0].options
  }

  it('a Session in a Project gets the worfy-canvas server, the Cards folder and the agent instructions in its system prompt', async () => {
    const { sdkQueryFactory } = await import('../../src/main/agent/app-registry')
    await sdkQueryFactory((input) => server.canvasForSession(input, deps()), () => Promise.resolve(['qmd', CANVAS_SERVER_NAME]))(request(repo))
    const options = sdkOptions()
    const cardsDir = join(dataDir, PROJECT, 'cards')
    expect(statSync(cardsDir).isDirectory()).toBe(true)
    expect(options.additionalDirectories).toEqual([cardsDir])
    expect((options.mcpServers as Record<string, unknown>)[CANVAS_SERVER_NAME]).toMatchObject({ type: 'sdk', name: CANVAS_SERVER_NAME })
    const prompt = options.systemPrompt as { type: string; preset: string; append: string }
    expect(prompt).toMatchObject({ type: 'preset', preset: 'claude_code' })
    expect(prompt.append).toContain(`${cardsDir}/<id>/`)
    expect(prompt.append).toContain('create_card')
    expect(prompt.append).toMatch(/only with the `worfy-canvas` tools, never by editing files/)
    // The user's own settings still apply: the canvas is added, nothing is replaced.
    expect(options.settingSources).toEqual(['user', 'project', 'local'])
    expect(options).not.toHaveProperty('strictMcpConfig')
  })

  it('a worktree inside the Project is the same Project', async () => {
    const worktree = join(repo, '.claude', 'worktrees', '24')
    mkdirSync(worktree, { recursive: true })
    const { sdkQueryFactory } = await import('../../src/main/agent/app-registry')
    await sdkQueryFactory((input) => server.canvasForSession(input, deps()), () => Promise.resolve(['qmd', CANVAS_SERVER_NAME]))(request(worktree))
    expect(sdkOptions().additionalDirectories).toEqual([join(dataDir, PROJECT, 'cards')])
  })

  it('a Session outside every Project, or whose canvas fails, runs without canvas tools and with the plain preset', async () => {
    const { sdkQueryFactory } = await import('../../src/main/agent/app-registry')
    const elsewhere = join(scratch, 'elsewhere')
    mkdirSync(elsewhere)
    await sdkQueryFactory((input) => server.canvasForSession(input, deps()))(request(elsewhere))
    let options = sdkOptions()
    expect(options).not.toHaveProperty('mcpServers')
    expect(options).not.toHaveProperty('additionalDirectories')
    expect(options.systemPrompt).toEqual({ type: 'preset', preset: 'claude_code' })

    mocks.query.mockClear()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    await sdkQueryFactory(() => Promise.reject(new Error('no store')))(request(repo))
    options = sdkOptions()
    expect(options).not.toHaveProperty('mcpServers')
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('the Session id read from its messages decides where create_card puts a Card', async () => {
    store.apply(PROJECT, orchestrator())
    store.apply(PROJECT, { op: 'create', node: { id: 'b-node', kind: 'session', x: 2000, y: 2000, w: 200, h: 100, data: { sessionId: 'session-b' } } })
    const canvas = await server.canvasForSession({ cwd: repo, resume: undefined }, deps())
    if (canvas === null) throw new Error('no canvas for the Project root')
    const rpc = await connectTo(canvas.attachment.server as ServerConfig)

    // Before the Session's id is known there is no anchor: right of everything visible, at the top.
    const loose = json<ListedNode>(await rpc.call('create_card', { title: 'loose' }))
    expect(nodeOf(loose.id)).toMatchObject({ x: 2240, y: 0 })

    const messages = [initMessage('session-b', repo)]
    const query = canvas.observe({
      extra: () => 'kept',
      [Symbol.asyncIterator]: () => {
        let index = 0
        return { next: () => Promise.resolve(index < messages.length ? { done: false, value: messages[index++] } : { done: true, value: undefined }) }
      },
    })
    // Everything but the message stream is the query's own.
    expect(query.extra()).toBe('kept')
    const seen: unknown[] = []
    for await (const message of query as AsyncIterable<unknown>) seen.push(message)
    expect(seen).toEqual(messages)

    const near = json<ListedNode>(await rpc.call('create_card', { title: 'near' }))
    expect(nodeOf(near.id)).toMatchObject({ x: 2240, y: 2000 })
  })

  it("a resumed Session that gets a new id in its init is anchored by the new id; other messages' ids do not move it", async () => {
    store.apply(PROJECT, orchestrator())
    store.apply(PROJECT, { op: 'create', node: { id: 'b-node', kind: 'session', x: 2000, y: 2000, w: 200, h: 100, data: { sessionId: 'session-b' } } })
    const canvas = await server.canvasForSession({ cwd: repo, resume: 'session-a' }, deps())
    if (canvas === null) throw new Error('no canvas for the Project root')
    const rpc = await connectTo(canvas.attachment.server as ServerConfig)
    const messages: unknown[] = [
      initMessage('session-b', repo),
      // Not an init: the Session does not take its id from it, and neither does the canvas.
      { type: 'assistant', message: { id: 'm1', content: [{ type: 'text', text: 'hi' }] }, parent_tool_use_id: null, session_id: 'session-z' },
    ]
    const query = canvas.observe({
      [Symbol.asyncIterator]: () => {
        let index = 0
        return { next: () => Promise.resolve(index < messages.length ? { done: false, value: messages[index++] } : { done: true, value: undefined }) }
      },
    })
    for await (const message of query as AsyncIterable<unknown>) void message
    const card = json<ListedNode>(await rpc.call('create_card', { title: 'next to B' }))
    expect(nodeOf(card.id)).toMatchObject({ x: 2240, y: 2000 })
  })

  it('a resumed Session is anchored by its resume id from the start', async () => {
    store.apply(PROJECT, orchestrator())
    const canvas = await server.canvasForSession({ cwd: repo, resume: 'session-a' }, deps())
    if (canvas === null) throw new Error('no canvas for the Project root')
    const rpc = await connectTo(canvas.attachment.server as ServerConfig)
    const card = json<ListedNode>(await rpc.call('create_card', { title: 'next to the Orchestrator' }))
    expect(nodeOf(card.id)).toMatchObject({ x: 340, y: 0 })
  })

  /** The Project id a Session in `cwd` gets its canvas for, or null for none. */
  const projectOf = async (cwd: string, overrides: Partial<CanvasDeps> = {}): Promise<string | null> => {
    const canvas = await server.canvasForSession({ cwd, resume: undefined }, { ...deps(), ...overrides })
    // `<data folder>/<Project id>/cards`
    return canvas === null ? null : basename(dirname(canvas.attachment.cardsDir))
  }

  it('a folder whose name only starts with the Project root is not in the Project', async () => {
    const sibling = `${repo}-old`
    mkdirSync(sibling)
    expect(await projectOf(sibling)).toBeNull()
    expect(existsSync(join(dataDir, PROJECT, 'cards'))).toBe(false)
  })

  it('a cwd reached through a symlink is in the Project the link points into', async () => {
    const link = join(scratch, 'link-to-repo')
    symlinkSync(repo, link)
    mkdirSync(join(repo, 'src'))
    expect(await projectOf(link)).toBe(PROJECT)
    expect(await projectOf(join(link, 'src'))).toBe(PROJECT)
  })

  // On Windows one folder has spellings that are not links: another letter case, an 8.3 short
  // name, a `subst` drive. git and the native realpath give the long spelling from the disk, the
  // plain realpath keeps the one typed; the Project root is saved as git prints it.
  it('a cwd in another letter case of the Project root is in the Project, and so is a cwd under a root saved in another case', async (context) => {
    const shouted = repo.toUpperCase()
    const same = (() => {
      try {
        return statSync(shouted).ino === statSync(repo).ino
      } catch {
        return false
      }
    })()
    context.skip(!same, 'the disk tells letter case apart')
    mkdirSync(join(repo, 'src'))
    expect(await projectOf(shouted)).toBe(PROJECT)
    expect(await projectOf(join(shouted, 'SRC'))).toBe(PROJECT)
    const savedShouted = () => [{ id: PROJECT, name: 'demo', path: shouted }]
    expect(await projectOf(join(repo, 'src'), { projects: savedShouted })).toBe(PROJECT)
  })

  // With TEMP=W:\ over a `subst` drive this is the drive letter against the long path git prints;
  // with an ordinary TEMP both spellings are one.
  it('a cwd in the spelling of the temporary folder as typed is in the Project saved as git prints it', async () => {
    const typed = join(realpathSync(tmpdir()), basename(scratch), 'repo')
    expect(await projectOf(typed)).toBe(PROJECT)
    expect(await projectOf(repo, { projects: () => [{ id: PROJECT, name: 'demo', path: typed }] })).toBe(PROJECT)
  })

  // No realpath reads a path that is not there; it is compared as resolved, so `..` leaves the root.
  it('a cwd that is not there and leads out of the Project root through `..` is in no Project', () => {
    const elsewhere = `${repo}${sep}..${sep}elsewhere`
    expect(existsSync(join(scratch, 'elsewhere'))).toBe(false)
    expect(server.projectForCwd([{ id: PROJECT, name: 'demo', path: repo }], elsewhere)).toBeUndefined()
  })

  it('Windows: a cwd in the 8.3 short spelling of a Project root is in the Project', (context) => {
    const long = (() => {
      try {
        return realpathSync.native('C:\\PROGRA~1')
      } catch {
        return ''
      }
    })()
    // New folders on this PC get no 8.3 name; C:\PROGRA~1 was made when Windows was installed.
    context.skip(long !== 'C:\\Program Files', 'no 8.3 short name C:\\PROGRA~1 on this system')
    const project = { id: PROJECT, name: 'programs', path: long }
    expect(server.projectForCwd([project], 'C:\\PROGRA~1')).toBe(project)
    expect(server.projectForCwd([project], 'C:\\PROGRA~1\\Common Files')).toBe(project)
    const saved = { ...project, path: 'C:\\PROGRA~1' }
    expect(server.projectForCwd([saved], 'C:\\Program Files\\Common Files')).toBe(saved)
  })

  it('of nested Projects, the deepest one holding the cwd is the Session\'s, whatever the list order', async () => {
    const inner = join(repo, 'vendor', 'lib')
    mkdirSync(join(inner, 'src'), { recursive: true })
    const projects = [
      { id: PROJECT, name: 'demo', path: repo },
      { id: OTHER, name: 'lib', path: inner },
    ]
    expect(await projectOf(join(inner, 'src'), { projects: () => projects })).toBe(OTHER)
    expect(await projectOf(join(inner, 'src'), { projects: () => [...projects].reverse() })).toBe(OTHER)
    expect(await projectOf(join(repo, 'vendor'), { projects: () => projects })).toBe(PROJECT)
  })

  it('a linked git worktree outside the Project root is the same Project, as the Project list resolves it', async () => {
    const git = (cwd: string, ...args: string[]) =>
      execFileSync('git', ['-c', 'user.email=test@example.com', '-c', 'user.name=test', '-c', 'init.defaultBranch=main', ...args], { cwd, stdio: 'pipe', env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: scratch } })
    git(repo, 'init', '-q')
    git(repo, 'commit', '-q', '--allow-empty', '-m', 'first')
    const feature = join(scratch, 'repo-feature')
    git(repo, 'worktree', 'add', '-q', '-b', 'feature', feature)
    expect(await projectOf(feature)).toBe(PROJECT)
    expect(await projectOf(join(scratch, 'elsewhere-not-git'))).toBeNull()
  })

  it('a Project removed while git resolved the worktree gets no canvas', async () => {
    let calls = 0
    const projects = () => (calls++ === 0 ? [{ id: PROJECT, name: 'demo', path: repo }] : [])
    const outside = join(scratch, 'outside')
    mkdirSync(outside)
    expect(await projectOf(outside, { projects, repositoryRoot: () => Promise.resolve(repo) })).toBeNull()
    calls = 0
    const kept = () => [{ id: PROJECT, name: 'demo', path: repo }]
    expect(await projectOf(outside, { projects: kept, repositoryRoot: () => Promise.resolve(repo) })).toBe(PROJECT)
  })

  it("nothing is written into the Project's repository: not by the Session's start, the tools, nor the watcher of its messages (ADR-0005)", async () => {
    const worktree = join(repo, '.claude', 'worktrees', '24')
    mkdirSync(worktree, { recursive: true })
    writeFileSync(join(repo, 'README.md'), 'readme\n')
    writeFileSync(join(worktree, 'notes.txt'), 'notes\n')
    /** Every path under `root` with its kind, size and modification time. */
    const tree = (root: string): string[] =>
      readdirSync(root, { recursive: true, encoding: 'utf8' })
        .sort()
        .map((path) => {
          const info = statSync(join(root, path))
          return `${path} ${info.isDirectory() ? 'dir' : 'file'} ${info.size} ${info.mtimeMs}`
        })
    const before = tree(repo)

    const { sdkQueryFactory } = await import('../../src/main/agent/app-registry')
    for (const cwd of [repo, worktree]) await sdkQueryFactory((input) => server.canvasForSession(input, deps()), () => Promise.resolve(['qmd', CANVAS_SERVER_NAME]))(request(cwd))
    store.apply(PROJECT, orchestrator())
    const canvas = await server.canvasForSession({ cwd: worktree, resume: undefined }, deps())
    if (canvas === null) throw new Error('no canvas for the worktree')
    const rpc = await connectTo(canvas.attachment.server as ServerConfig)
    const card = json<ListedNode>(await rpc.call('create_card', { title: 'Clock' }))
    const noteId = json<ListedNode>(await rpc.call('create_note', { text: 'n' })).id
    for (const [name, args] of [
      ['list_nodes', {}],
      ['update_node', { id: card.id, title: 'Clock 2' }],
      ['update_node', { id: noteId, text: 'n2' }],
      ['move_node', { id: card.id, x: 10, y: 10 }],
      ['resize_node', { id: card.id, w: 400, h: 300 }],
      ['hide_node', { id: noteId }],
      ['hide_node', { id: noteId, hidden: false }],
      ['link_card', { id: card.id, target: 'worfy-mvp/07' }],
      ['link_card', { id: card.id, target: 'worfy-mvp/07', remove: true }],
      ['move_node', { id: 'missing', x: 0, y: 0 }],
    ] as const) await rpc.call(name, args)
    const messages: unknown[] = [
      initMessage('session-a', worktree),
      { type: 'assistant', message: { id: 'm1', content: [{ type: 'tool_use', id: 't1', name: 'Write', input: { file_path: join(canvas.attachment.cardsDir, card.id, 'index.html') } }] }, parent_tool_use_id: null, session_id: 'session-a' },
    ]
    const query = canvas.observe({
      [Symbol.asyncIterator]: () => {
        let index = 0
        return { next: () => Promise.resolve(index < messages.length ? { done: false, value: messages[index++] } : { done: true, value: undefined }) }
      },
    })
    for await (const message of query as AsyncIterable<unknown>) void message
    expect(nodeOf(card.id)?.data.lastEditor).toBe('session-a')
    store.flushAll()

    expect(tree(repo)).toEqual(before)
  })
})
