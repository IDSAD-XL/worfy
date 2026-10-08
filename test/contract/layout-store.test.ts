// The Layout of a Project end to end in main: src/main/ipc/layout.ts registered through
// registerIpc (the same wrapper the app uses) over a mocked `electron`, the shared store from
// src/main/layout/store.ts called directly as later parts of main (MCP tools) will call it, and a
// temporary WORFY_DATA_DIR. main is the only writer of layout.json (ADR-0003).
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IpcMainInvokeEvent } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNEL_PREFIX, type IpcResult } from '../../src/shared/ipc/channels'
import { layoutSchema, type Layout, type LayoutOpInput, type LayoutState } from '../../src/shared/layout/types'
import type { LayoutChange, LayoutStore } from '../../src/main/layout/store'
import { freePlace, freeShift } from '../../src/shared/layout/free-place'

const INDEX_HTML = '/Applications/worfy.app/Contents/Resources/app/out/renderer/index.html'
const PROJECT = 'demo-0a1b2c3d'

const electron = vi.hoisted(() => {
  const sent: { channel: string; payload: unknown }[] = []
  const quitListeners: (() => void)[] = []
  const window = { isDestroyed: () => false, webContents: { send: (channel: string, payload: unknown) => sent.push({ channel, payload }) } }
  return { sent, quitListeners, window }
})

vi.mock('electron', () => ({
  app: {
    on: (event: string, listener: () => void) => {
      if (event === 'will-quit') electron.quitListeners.push(listener)
    },
  },
  BrowserWindow: { getAllWindows: () => [electron.window], fromWebContents: () => null },
  dialog: { showOpenDialog: vi.fn() },
}))

// The trash's handlers (worfy-link ticket 07) ask which Node runs a Session; none does here.
vi.mock('../../src/main/agent/app-node-sessions', () => ({ sharedNodeSessions: () => ({ list: () => [] }) }))

type Listener = (event: IpcMainInvokeEvent, input: unknown) => unknown

let scratch: string
let dataDir: string
let repo: string
let handlers: Map<string, Listener>
let store: LayoutStore

/**
 * Loads src/main/ipc/layout.ts afresh, as an app start does, over the current data dir; with
 * `trash`, src/main/ipc/trash.ts too.
 */
async function start(trash = false): Promise<void> {
  vi.resetModules()
  electron.quitListeners.length = 0
  process.env.WORFY_DATA_DIR = dataDir
  const { registerIpc, appUrlMatcher } = await import('../../src/main/ipc/index')
  handlers = new Map()
  await registerIpc(
    { handle: (channel, listener) => handlers.set(channel, listener as Listener) },
    {
      modules: {
        './layout.ts': () => import('../../src/main/ipc/layout').then((module) => module.default),
        ...(trash ? { './trash.ts': () => import('../../src/main/ipc/trash').then((module) => module.default) } : {}),
      },
      isTrustedSender: appUrlMatcher({ indexHtml: INDEX_HTML }),
    },
  )
  // The same module instance the handlers use: vi.resetModules() above cleared the cache once.
  store = (await import('../../src/main/layout/store')).layoutStore()
}

async function call(channel: string, input?: unknown): Promise<IpcResult<unknown>> {
  const listener = handlers.get(IPC_CHANNEL_PREFIX + channel)
  if (!listener) throw new Error(`no handler for ${channel}`)
  const event = { senderFrame: { url: `file://${INDEX_HTML}` }, sender: {} } as unknown as IpcMainInvokeEvent
  return (await listener(event, input)) as IpcResult<unknown>
}

/** The value of a call that must succeed. */
async function value(channel: string, input?: unknown): Promise<LayoutState> {
  const result = await call(channel, input)
  if (!result.ok) throw new Error(`${channel} failed: ${result.error}`)
  return result.value as LayoutState
}

const apply = (op: unknown, projectId: string = PROJECT) => call('layout.apply', { projectId, op })
const applied = (op: unknown, projectId: string = PROJECT) => value('layout.apply', { projectId, op })
const note = (id: string, extra: Record<string, unknown> = {}) =>
  ({ op: 'create', node: { id, kind: 'note', x: 0, y: 0, w: 220, h: 120, data: { text: id }, ...extra } }) as LayoutOpInput

const layoutFile = (projectId: string = PROJECT) => join(dataDir, projectId, 'layout.json')
/** layout.json as it is on disk, parsed with the schema; fails the test when it does not match. */
const onDisk = (projectId: string = PROJECT): Layout => layoutSchema.parse(JSON.parse(readFileSync(layoutFile(projectId), 'utf8')))
const nodeOf = (layout: Layout, id: string) => layout.nodes.find((node) => node.id === id)

beforeEach(async () => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-layout-')))
  dataDir = join(scratch, 'data')
  repo = join(scratch, 'repo')
  mkdirSync(repo)
  mkdirSync(join(dataDir, PROJECT), { recursive: true })
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT, name: 'demo', path: repo }], activeId: PROJECT }))
  electron.sent.length = 0
  await start()
})

afterEach(() => {
  vi.useRealTimers()
  delete process.env.WORFY_DATA_DIR
  rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

describe('layout store: parallel writes', () => {
  it('100 parallel moves from the renderer and from a direct store call leave a valid layout.json where the last move of each Node wins', async () => {
    const ids = ['a', 'b', 'c', 'd']
    for (const id of ids) await applied(note(id))

    // The order main actually applied the moves in, whoever sent them.
    const order: { id: string; x: number; y: number }[] = []
    store.onChange(({ op }) => {
      if (op.op === 'move') order.push({ id: op.id, x: op.x, y: op.y })
    })

    // Places far apart: none of them is corrected for an overlap (ADR-0038), so the last move is where the Node is.
    const moves = Array.from({ length: 100 }, (_, n) => ({ op: 'move' as const, id: ids[n % ids.length] ?? 'a', x: n * 1000 + 1, y: n * -700 - 1 }))
    const results = await Promise.all(
      moves.map(async (move, n) => {
        if (n % 2 === 0) return apply(move)
        // A direct caller in main: queued behind the same microtasks the IPC calls go through.
        await Promise.resolve()
        store.apply(PROJECT, move)
        return { ok: true as const, value: null }
      }),
    )
    expect(results.every((result) => result.ok)).toBe(true)
    expect(order).toHaveLength(100)

    store.flushAll()
    const saved = onDisk()
    expect(saved.nodes.map((node) => node.id).sort()).toEqual(ids)
    for (const id of ids) {
      const last = order.filter((move) => move.id === id).at(-1)
      expect(nodeOf(saved, id)).toMatchObject({ x: last?.x, y: last?.y, w: 220, h: 120 })
    }
    // What main holds and what it last told the windows is the same Layout as on disk.
    expect(store.get(PROJECT).layout).toEqual(saved)
    const lastBroadcast = electron.sent.filter((message) => message.channel === `${IPC_CHANNEL_PREFIX}layout.changed`).at(-1)
    expect((lastBroadcast?.payload as LayoutState).layout).toEqual(saved)
  })
})

describe('layout store: operations', () => {
  it('create, move, resize, hide, patchData and remove change the Layout and every change is broadcast', async () => {
    let state = await applied(note('n1', { tags: ['x'] }))
    expect(state.projectId).toBe(PROJECT)
    expect(state.layout.nodes).toEqual([
      { id: 'n1', kind: 'note', x: 0, y: 0, w: 220, h: 120, hidden: false, locked: false, pinned: false, tags: ['x'], data: { text: 'n1' } },
    ])

    state = await applied({ op: 'move', id: 'n1', x: 40, y: -16 })
    expect(nodeOf(state.layout, 'n1')).toMatchObject({ x: 40, y: -16 })

    state = await applied({ op: 'resize', id: 'n1', w: 300, h: 180 })
    expect(nodeOf(state.layout, 'n1')).toMatchObject({ x: 40, y: -16, w: 300, h: 180 })
    // Resizing from the top-left corner moves the Node too.
    state = await applied({ op: 'resize', id: 'n1', x: 20, y: -30, w: 320, h: 194 })
    expect(nodeOf(state.layout, 'n1')).toMatchObject({ x: 20, y: -30, w: 320, h: 194 })

    state = await applied({ op: 'hide', id: 'n1', hidden: true })
    expect(nodeOf(state.layout, 'n1')?.hidden).toBe(true)

    state = await applied({ op: 'patchData', id: 'n1', data: { color: 'blue' } })
    expect(nodeOf(state.layout, 'n1')?.data).toEqual({ text: 'n1', color: 'blue' })

    state = await applied({ op: 'setViewport', viewport: { x: 12, y: 34, zoom: 1.5 } })
    expect(state.layout.viewport).toEqual({ x: 12, y: 34, zoom: 1.5 })

    state = await applied({ op: 'remove', id: 'n1' })
    expect(state.layout.nodes).toEqual([])

    const broadcasts = electron.sent.filter((message) => message.channel === `${IPC_CHANNEL_PREFIX}layout.changed`)
    expect(broadcasts.map((message) => (message.payload as LayoutState).revision)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect((broadcasts.at(-1)?.payload as LayoutState).layout).toEqual(state.layout)
  })

  it('create without an id gets a fresh id from main; a second create with a taken id is refused', async () => {
    const state = await applied({ op: 'create', node: { kind: 'note', x: 1, y: 2, w: 100, h: 50 } })
    const [created] = state.layout.nodes
    expect(created?.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(created).toMatchObject({ kind: 'note', x: 1, y: 2, w: 100, h: 50, hidden: false, locked: false, pinned: false, tags: [], data: {} })

    const again = await apply(note(created?.id ?? ''))
    expect(again).toEqual({ ok: false, error: expect.stringMatching(/already has a Node with id/) })
  })

  it('remove of a locked Node is refused with a clear error, while move and resize of it pass', async () => {
    await applied(note('orchestrator', { locked: true }))

    const removed = await apply({ op: 'remove', id: 'orchestrator' })
    expect(removed).toEqual({ ok: false, error: expect.stringMatching(/Node orchestrator is locked and cannot be removed/) })
    // Refused also when main itself asks, not only over IPC.
    expect(() => store.apply(PROJECT, { op: 'remove', id: 'orchestrator' })).toThrow(/locked and cannot be removed/)

    expect(nodeOf((await applied({ op: 'move', id: 'orchestrator', x: 5, y: 6 })).layout, 'orchestrator')).toMatchObject({ x: 5, y: 6 })
    expect(nodeOf((await applied({ op: 'resize', id: 'orchestrator', w: 400, h: 300 })).layout, 'orchestrator')).toMatchObject({ w: 400, h: 300 })
    expect(store.get(PROJECT).layout.nodes).toHaveLength(1)
  })

  it('an operation on a Node that is not there is refused, and nothing changes', async () => {
    await applied(note('n1'))
    const before = store.get(PROJECT)
    for (const op of [
      { op: 'move', id: 'ghost', x: 1, y: 1 },
      { op: 'resize', id: 'ghost', w: 10, h: 10 },
      { op: 'hide', id: 'ghost', hidden: true },
      { op: 'remove', id: 'ghost' },
      { op: 'patchData', id: 'ghost', data: {} },
    ]) {
      expect(await apply(op)).toEqual({ ok: false, error: expect.stringMatching(/no Node with id ghost/) })
    }
    expect(store.get(PROJECT)).toEqual(before)
  })

  it('a Project that is not in the list has no Layout', async () => {
    expect(await call('layout.get', { projectId: 'nope-00000000' })).toEqual({ ok: false, error: expect.stringMatching(/No Project with id nope-00000000/) })
    expect(await apply(note('n1'), 'nope-00000000')).toMatchObject({ ok: false })
    expect(existsSync(join(dataDir, 'nope-00000000'))).toBe(false)
  })

  it('a Project removed from the list is refused even though its Layout is already in memory', async () => {
    await applied(note('n1'))
    store.flushAll()
    const written = readFileSync(layoutFile(), 'utf8')

    // The same projects store the layout store asks: vi.resetModules() in start() cleared the cache once.
    ;(await import('../../src/main/projects/store')).projectStore().remove(PROJECT)
    expect(await call('layout.get', { projectId: PROJECT })).toEqual({ ok: false, error: expect.stringMatching(new RegExp(`No Project with id ${PROJECT}`)) })
    expect(await apply({ op: 'move', id: 'n1', x: 5, y: 5 })).toEqual({ ok: false, error: expect.stringMatching(new RegExp(`No Project with id ${PROJECT}`)) })
    store.flushAll()
    expect(readFileSync(layoutFile(), 'utf8')).toBe(written)
  })
})

describe('layout store: schema at the boundary', () => {
  it.each([
    ['a move with a string coordinate', { op: 'move', id: 'n1', x: '10', y: 0 }],
    ['a resize to zero width', { op: 'resize', id: 'n1', w: 0, h: 10 }],
    ['an unknown operation', { op: 'teleport', id: 'n1' }],
    ['a zoom outside 0.2–2.5', { op: 'setViewport', viewport: { x: 0, y: 0, zoom: 3 } }],
    ['a create without a kind', { op: 'create', node: { x: 0, y: 0, w: 10, h: 10 } }],
    ['a hide without the flag', { op: 'hide', id: 'n1' }],
  ])('refuses %s, over IPC and from a direct call', async (_name, op) => {
    await applied(note('n1'))
    const before = store.get(PROJECT)
    expect(await apply(op)).toEqual({ ok: false, error: expect.stringMatching(/layout\.apply: invalid input/) })
    expect(() => store.apply(PROJECT, op as LayoutOpInput)).toThrow(/invalid layout operation/)
    expect(store.get(PROJECT)).toEqual(before)
  })

  it('drops keys the schema does not declare, from an IPC call, a direct call and the file on disk', async () => {
    const viaIpc = await applied({ ...note('n1', { evil: 1 }), extra: true })
    expect(Object.keys(nodeOf(viaIpc.layout, 'n1') ?? {}).sort()).toEqual(['data', 'h', 'hidden', 'id', 'kind', 'locked', 'pinned', 'tags', 'w', 'x', 'y'])

    const direct = store.apply(PROJECT, { op: 'move', id: 'n1', x: 3, y: 4, sneaky: 'yes' } as unknown as LayoutOpInput)
    expect(nodeOf(direct.layout, 'n1')).not.toHaveProperty('sneaky')

    store.apply(PROJECT, { ...note('n2', { evil: 2 }), extra: 1 } as unknown as LayoutOpInput)
    expect(nodeOf(store.get(PROJECT).layout, 'n2')).not.toHaveProperty('evil')

    store.flushAll()
    const raw = JSON.parse(readFileSync(layoutFile(), 'utf8')) as { nodes: Record<string, unknown>[] } & Record<string, unknown>
    expect(Object.keys(raw).sort()).toEqual(['nodes', 'viewport'])
    for (const node of raw.nodes) expect(node).not.toHaveProperty('evil')

    // A file written by someone else with extra keys is read through the schema too.
    writeFileSync(layoutFile(), JSON.stringify({ ...raw, junk: 1, nodes: raw.nodes.map((node) => ({ ...node, junk: 2 })) }))
    await start()
    const reread = await value('layout.get', { projectId: PROJECT })
    expect(reread.layout).not.toHaveProperty('junk')
    for (const node of reread.layout.nodes) expect(node).not.toHaveProperty('junk')
  })

  it('keeps a Node of an unknown kind as it is, so the canvas can show a placeholder for it', async () => {
    writeFileSync(
      layoutFile(),
      JSON.stringify({
        nodes: [
          { id: 'u', kind: 'from-the-future', x: 1, y: 2, w: 30, h: 40, hidden: false, locked: false, pinned: false, tags: [], data: { anything: [1, 2] } },
          { id: 'n', kind: 'note', x: 0, y: 0, w: 220, h: 120 },
        ],
        viewport: { x: 0, y: 0, zoom: 1 },
      }),
    )
    const state = await value('layout.get', { projectId: PROJECT })
    expect(state.layout.nodes.map((node) => node.kind)).toEqual(['from-the-future', 'note'])
    expect(nodeOf(state.layout, 'u')?.data).toEqual({ anything: [1, 2] })
    // Fields added after a file was written get their defaults.
    expect(nodeOf(state.layout, 'n')).toMatchObject({ hidden: false, locked: false, pinned: false, tags: [], data: {} })
  })

  it('sets an unreadable layout.json aside and starts from an empty Layout', async () => {
    writeFileSync(layoutFile(), '{ not json')
    const state = await value('layout.get', { projectId: PROJECT })
    expect(state.layout).toEqual({ nodes: [], viewport: { x: 0, y: 0, zoom: 1 } })
    expect(readdirSync(join(dataDir, PROJECT)).some((name) => name.startsWith('layout.json.unreadable-'))).toBe(true)
  })
})

describe('layout store: what an older version kept and this one drops (ADR-0037)', () => {
  const SESSION = 'b2c3d4e5-0000-4000-8000-000000000001'
  const OLD = new Date('2026-10-01T00:00:00Z')

  it('removes Ticket offsets from the Epic frames and the subagent-tree Nodes once, with one log line; the frame keeps x, y and collapsed; a second read writes nothing', async () => {
    const before = {
      nodes: [
        { id: 'epic:worfy-mvp', kind: 'epic-frame', x: 30, y: -20, w: 1, h: 1, hidden: false, locked: true, pinned: false, tags: [], data: { collapsed: true, 'offset:3': { dx: 5, dy: 6 }, 'offset:12': { dx: 1, dy: 2 } } },
        { id: 'epic:demo', kind: 'epic-frame', x: 7, y: 8, w: 1, h: 1, hidden: false, locked: true, pinned: false, tags: [], data: { collapsed: false } },
        { id: `subagents:${SESSION}`, kind: 'subagent-tree', x: 0, y: 0, w: 1, h: 1, hidden: false, locked: true, pinned: false, tags: [], data: { 'offset:toolu_1': { dx: 5, dy: 6 } } },
        { id: 'n1', kind: 'note', x: 40, y: 40, w: 220, h: 120, hidden: false, locked: false, pinned: false, tags: [], data: { text: 'kept', 'offset:3': 'a note may hold any key' } },
      ],
      viewport: { x: 1, y: 2, zoom: 1 },
    }
    writeFileSync(layoutFile(), JSON.stringify(before))
    utimesSync(layoutFile(), OLD, OLD)
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    try {
      const state = await value('layout.get', { projectId: PROJECT })
      expect(state.revision).toBe(0)
      expect(state.layout.nodes.map((node) => node.id)).toEqual(['epic:worfy-mvp', 'epic:demo', 'n1'])
      expect(nodeOf(state.layout, 'epic:worfy-mvp')).toMatchObject({ kind: 'epic-frame', x: 30, y: -20, data: { collapsed: true } })
      expect(nodeOf(state.layout, 'epic:worfy-mvp')!.data).toEqual({ collapsed: true })
      expect(nodeOf(state.layout, 'epic:demo')).toEqual(layoutSchema.parse(before).nodes[1])
      // Only the frames lose `offset:*` keys.
      expect(nodeOf(state.layout, 'n1')!.data).toEqual({ text: 'kept', 'offset:3': 'a note may hold any key' })
      expect(state.layout.viewport).toEqual(before.viewport)
      // One line for the Project, naming what went.
      expect(info.mock.calls.map((args) => String(args[0]))).toEqual([expect.stringMatching(new RegExp(`^\\[layout\\] ${PROJECT}: removed 2 Ticket offset\\(s\\) from Epic frames and 1 Subagent tree Node\\(s\\)`))])
      // Written right away, not as an operation: nothing broadcast, nothing for ⌘Z.
      expect(onDisk()).toEqual(state.layout)
      expect(statSync(layoutFile()).mtimeMs).toBeGreaterThan(OLD.getTime())
      expect(electron.sent).toEqual([])

      // The next start reads a clean file and neither writes it nor logs.
      utimesSync(layoutFile(), OLD, OLD)
      const written = readFileSync(layoutFile(), 'utf8')
      info.mockClear()
      await start()
      expect((await value('layout.get', { projectId: PROJECT })).layout).toEqual(state.layout)
      store.flushAll()
      expect(statSync(layoutFile()).mtimeMs).toBe(OLD.getTime())
      expect(readFileSync(layoutFile(), 'utf8')).toBe(written)
      expect(info).not.toHaveBeenCalled()
    } finally {
      info.mockRestore()
    }
  })

  it('leaves a Layout with nothing to drop as it is on disk', async () => {
    writeFileSync(layoutFile(), JSON.stringify({ nodes: [{ id: 'epic:demo', kind: 'epic-frame', x: 3, y: 4, w: 1, h: 1, locked: true, data: { collapsed: true } }], viewport: { x: 0, y: 0, zoom: 1 } }))
    utimesSync(layoutFile(), OLD, OLD)
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    try {
      expect((await value('layout.get', { projectId: PROJECT })).layout.nodes[0]).toMatchObject({ x: 3, y: 4, data: { collapsed: true } })
      store.flushAll()
      expect(statSync(layoutFile()).mtimeMs).toBe(OLD.getTime())
      expect(info).not.toHaveBeenCalled()
    } finally {
      info.mockRestore()
    }
  })
})

describe('layout store: saving', () => {
  it('debounces writes: a burst of operations is one write, after the burst', async () => {
    vi.useFakeTimers()
    const { LayoutStore, LAYOUT_SAVE_DELAY_MS } = await import('../../src/main/layout/store')
    const writes: Layout[] = []
    const local = new LayoutStore(() => join(dataDir, PROJECT), { write: (_file, layout) => writes.push(layout) })

    local.apply(PROJECT, note('n1'))
    for (let n = 0; n < 20; n++) {
      local.apply(PROJECT, { op: 'move', id: 'n1', x: n, y: n })
      vi.advanceTimersByTime(LAYOUT_SAVE_DELAY_MS / 2)
    }
    expect(writes).toHaveLength(0)

    vi.advanceTimersByTime(LAYOUT_SAVE_DELAY_MS)
    expect(writes).toHaveLength(1)
    expect(nodeOf(writes[0] as Layout, 'n1')).toMatchObject({ x: 19, y: 19 })

    // Nothing pending: no second write.
    vi.advanceTimersByTime(LAYOUT_SAVE_DELAY_MS * 10)
    expect(writes).toHaveLength(1)
  })

  it('writes the pending Layout at once when the app quits', async () => {
    await applied(note('n1'))
    await applied({ op: 'move', id: 'n1', x: 77, y: 88 })
    expect(existsSync(layoutFile())).toBe(false)

    expect(electron.quitListeners).toHaveLength(1)
    for (const listener of electron.quitListeners) listener()
    expect(nodeOf(onDisk(), 'n1')).toMatchObject({ x: 77, y: 88 })
  })

  it('a failed write keeps the Layout unsaved: the next flush writes it again, and the quit handler writes it too', async () => {
    vi.useFakeTimers()
    const { LayoutStore, LAYOUT_SAVE_DELAY_MS } = await import('../../src/main/layout/store')
    const writes: Layout[] = []
    let failures = 1
    const local = new LayoutStore(() => join(dataDir, PROJECT), {
      write: (_file, layout) => {
        if (failures > 0) {
          failures -= 1
          throw new Error('ENOSPC: no space left on device')
        }
        writes.push(layout)
      },
    })
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      local.apply(PROJECT, note('n1'))
      local.apply(PROJECT, { op: 'move', id: 'n1', x: 7, y: 9 })
      // The debounced write fails: it is logged and nothing is written.
      vi.advanceTimersByTime(LAYOUT_SAVE_DELAY_MS)
      expect(writes).toHaveLength(0)
      expect(logged).toHaveBeenCalledWith(expect.stringMatching(/could not save the Layout of/), expect.any(Error))

      // No further operation: quitting still writes the current Layout.
      local.flushAll()
      expect(writes).toHaveLength(1)
      expect(nodeOf(writes[0] as Layout, 'n1')).toMatchObject({ x: 7, y: 9 })

      // Saved now: nothing more to write.
      local.flushAll()
      expect(writes).toHaveLength(1)
    } finally {
      logged.mockRestore()
    }
  })

  it('a restarted main reads the Layout back, and it is written only into the data folder', async () => {
    await applied(note('n1'))
    await applied({ op: 'move', id: 'n1', x: 120, y: 64 })
    await applied({ op: 'setViewport', viewport: { x: -50, y: 25, zoom: 0.5 } })
    store.flushAll()

    await start()
    const state = await value('layout.get', { projectId: PROJECT })
    expect(state.revision).toBe(0)
    expect(nodeOf(state.layout, 'n1')).toMatchObject({ x: 120, y: 64 })
    expect(state.layout.viewport).toEqual({ x: -50, y: 25, zoom: 0.5 })

    // The Project's repository is never written (ADR-0005).
    expect(readdirSync(repo)).toEqual([])
    expect(readdirSync(join(dataDir, PROJECT))).toEqual(['layout.json'])
  })

  it('each Project has its own Layout', async () => {
    const other = 'other-11111111'
    writeFileSync(
      join(dataDir, 'projects.json'),
      JSON.stringify({ projects: [{ id: PROJECT, name: 'demo', path: repo }, { id: other, name: 'other', path: repo }], activeId: PROJECT }),
    )
    await start()
    await applied(note('mine'))
    await applied(note('theirs'), other)
    expect((await value('layout.get', { projectId: PROJECT })).layout.nodes.map((node) => node.id)).toEqual(['mine'])
    expect((await value('layout.get', { projectId: other })).layout.nodes.map((node) => node.id)).toEqual(['theirs'])
    store.flushAll()
    expect(onDisk(other).nodes.map((node) => node.id)).toEqual(['theirs'])
  })
})

// ── Nodes never overlap (ADR-0038) ─────────────────────────────────────────

/** The gap two Nodes on the plane keep (ADR-0038, decision 25). */
const GAP = 16
type Box = { id: string; x: number; y: number; w: number; h: number }
/** How far apart two boxes are along the axis they are separated on; negative when they overlap. */
const separation = (a: Box, b: Box): number => Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w), b.y - (a.y + a.h), a.y - (b.y + b.h))
/** Pairs of Nodes on the plane closer than the gap. */
function crowded(layout: Layout): string[] {
  const plane = layout.nodes.filter((node) => !node.hidden && !node.pinned && !['epic-frame', 'ticket', 'subagent', 'subagent-tree'].includes(node.kind))
  const pairs: string[] = []
  for (const [i, a] of plane.entries()) for (const b of plane.slice(i + 1)) if (separation(a, b) < GAP) pairs.push(`${a.id}~${b.id}`)
  return pairs
}
const card = (id: string, x: number, y: number) => ({ op: 'create', node: { id, kind: 'card', x, y, w: 300, h: 200, data: { title: id } } }) as LayoutOpInput

describe('layout store: Nodes never overlap (ADR-0038)', () => {
  const OLD = new Date('2026-10-01T00:00:00Z')
  const CARD = { x: 0, y: 0, w: 300, h: 200 }

  /** A Card at (0, 0), a Node pinned to the screen and a hidden Node over it: neither of the last two takes part. */
  async function fixture(): Promise<{ pinned: unknown; hidden: unknown }> {
    await applied(card('card', CARD.x, CARD.y))
    await applied(note('pinned', { x: 50, y: 50, pinned: true }))
    const { layout } = await applied(note('hidden', { x: 40, y: 40, hidden: true }))
    return { pinned: nodeOf(layout, 'pinned'), hidden: nodeOf(layout, 'hidden') }
  }

  /** After the operation: no two Nodes on the plane closer than the gap, the Card where it was, the pinned and hidden Nodes untouched. */
  function expectClear(layout: Layout, untouched: { pinned: unknown; hidden: unknown }): void {
    expect(crowded(layout)).toEqual([])
    expect(nodeOf(layout, 'card')).toMatchObject(CARD)
    expect(nodeOf(layout, 'pinned')).toEqual(untouched.pinned)
    expect(nodeOf(layout, 'hidden')).toEqual(untouched.hidden)
  }

  it('a move of a Note onto a Card puts the Note on the nearest free place, at least 16 px off the Card, and the Card stays', async () => {
    await applied(card('card', 0, 0))
    await applied(note('note', { x: 1000, y: 0 }))
    const { layout } = await applied({ op: 'move', id: 'note', x: 40, y: 40 })
    expect(crowded(layout)).toEqual([])
    expect(nodeOf(layout, 'card')).toMatchObject({ x: 0, y: 0, w: 300, h: 200 })
    // The same place the shared function gives for the same input (test/unit/free-place.test.ts).
    expect(nodeOf(layout, 'note')).toMatchObject({ x: 40, y: 216 })
    expect(nodeOf(layout, 'note')).toMatchObject(freePlace({ x: 40, y: 40, w: 220, h: 120 }, [CARD]))
  })

  it('create onto the Card', async () => {
    const untouched = await fixture()
    const { layout } = await applied(note('new', { x: 40, y: 40 }))
    expectClear(layout, untouched)
    expect(nodeOf(layout, 'new')).toMatchObject({ x: 40, y: 216 })
  })

  it('move onto the Card', async () => {
    const untouched = await fixture()
    await applied(note('note', { x: 1000, y: 0 }))
    const { layout } = await applied({ op: 'move', id: 'note', x: 40, y: 40 })
    expectClear(layout, untouched)
  })

  it('resize into the Card on the right stops the right edge 16 px short of it; the left edge stays', async () => {
    const untouched = await fixture()
    await applied(note('note', { x: -400, y: 0, w: 200, h: 120 }))
    const { layout } = await applied({ op: 'resize', id: 'note', w: 900, h: 120 })
    expectClear(layout, untouched)
    expect(nodeOf(layout, 'note')).toMatchObject({ x: -400, y: 0, w: 400 - GAP, h: 120 })
  })

  it('resize into the Card on the left stops the left edge 16 px short of it; the right edge stays', async () => {
    const untouched = await fixture()
    await applied(note('note', { x: 400, y: 0, w: 200, h: 120 }))
    // Dragged by the left edge: x moves with it.
    const { layout } = await applied({ op: 'resize', id: 'note', x: 100, y: 0, w: 500, h: 120 })
    expectClear(layout, untouched)
    expect(nodeOf(layout, 'note')).toMatchObject({ x: 300 + GAP, y: 0, w: 600 - 300 - GAP, h: 120 })
  })

  it('hide with hidden: false of a Node hidden over the Card', async () => {
    const untouched = await fixture()
    await applied(note('note', { x: 40, y: 40, hidden: true }))
    const { layout } = await applied({ op: 'hide', id: 'note', hidden: false })
    expectClear(layout, untouched)
    expect(nodeOf(layout, 'note')).toMatchObject({ hidden: false, x: 40, y: 216 })
  })

  it('pin with pinned: false onto the Card', async () => {
    const untouched = await fixture()
    await applied(note('note', { x: 600, y: 600, pinned: true }))
    const { layout } = await applied({ op: 'pin', id: 'note', pinned: false, x: 40, y: 40, w: 220, h: 120 })
    expectClear(layout, untouched)
    expect(nodeOf(layout, 'note')).toMatchObject({ pinned: false, x: 40, y: 216 })
  })

  it('moveMany onto the Card shifts the whole group and keeps the Nodes where they are to each other', async () => {
    const untouched = await fixture()
    await applied(note('a', { x: 1000, y: 0 }))
    await applied(note('b', { x: 1240, y: 0 }))
    const { layout } = await applied({ op: 'moveMany', moves: [{ id: 'a', x: 40, y: 40 }, { id: 'b', x: 280, y: 40 }] })
    expectClear(layout, untouched)
    const a = nodeOf(layout, 'a')!
    const b = nodeOf(layout, 'b')!
    expect([b.x - a.x, b.y - a.y]).toEqual([240, 0])
    expect(a).toMatchObject({ x: 40 + freeShift([{ x: 40, y: 40, w: 220, h: 120 }, { x: 280, y: 40, w: 220, h: 120 }], [CARD]).dx })
  })

  it('moveMany of two neighbours by +100 px on x puts them exactly 100 px further, though the first lands where the second was', async () => {
    await applied(note('a', { x: 0, y: 0 }))
    await applied(note('b', { x: 240, y: 0 }))
    const { layout } = await applied({ op: 'moveMany', moves: [{ id: 'a', x: 100, y: 0 }, { id: 'b', x: 340, y: 0 }] })
    expect(nodeOf(layout, 'a')).toMatchObject({ x: 100, y: 0 })
    expect(nodeOf(layout, 'b')).toMatchObject({ x: 340, y: 0 })
  })

  it('moveMany is refused for a pinned Node, a missing Node and a Node named twice, and changes nothing', async () => {
    await applied(note('a', { x: 0, y: 0 }))
    await applied(note('p', { x: 500, y: 0, pinned: true }))
    const before = store.get(PROJECT).layout
    expect(await apply({ op: 'moveMany', moves: [{ id: 'a', x: 1, y: 1 }, { id: 'p', x: 2, y: 2 }] })).toMatchObject({ ok: false, error: expect.stringContaining('pinned') })
    expect(await apply({ op: 'moveMany', moves: [{ id: 'a', x: 1, y: 1 }, { id: 'gone', x: 2, y: 2 }] })).toMatchObject({ ok: false, error: expect.stringContaining('gone') })
    expect(await apply({ op: 'moveMany', moves: [{ id: 'a', x: 1, y: 1 }, { id: 'a', x: 2, y: 2 }] })).toMatchObject({ ok: false })
    expect(await apply({ op: 'moveMany', moves: [] })).toMatchObject({ ok: false })
    expect(store.get(PROJECT).layout).toEqual(before)
  })

  it('patchData and tag do not move a Node', async () => {
    await applied(card('card', 0, 0))
    await applied(note('note', { x: 400, y: 0 }))
    const before = nodeOf(store.get(PROJECT).layout, 'note')
    await applied({ op: 'patchData', id: 'note', data: { text: 'x' } })
    const { layout } = await applied({ op: 'tag', id: 'note', add: ['t'] })
    expect(nodeOf(layout, 'note')).toMatchObject({ x: before!.x, y: before!.y })
  })

  it('the HANDOFF Node shown again when HANDOFF.md comes back goes to a free place; the Orchestrator at (40, 40) stays', async () => {
    const base = { hidden: false, locked: true, pinned: false, tags: [] }
    writeFileSync(
      layoutFile(),
      JSON.stringify({
        nodes: [
          { id: 'orch', kind: 'orchestrator', x: 40, y: 40, w: 360, h: 200, ...base, data: {} },
          { id: 'handoff', kind: 'handoff', x: 40, y: 40, w: 360, h: 320, ...base, hidden: true, data: { missing: true } },
        ],
        viewport: { x: 0, y: 0, zoom: 1 },
      }),
    )
    await start()
    const { syncHandoffNode } = await import('../../src/main/ipc/docs')
    syncHandoffNode(PROJECT, true)
    const { layout } = store.get(PROJECT)
    expect(nodeOf(layout, 'orch')).toMatchObject({ x: 40, y: 40 })
    expect(nodeOf(layout, 'handoff')).toMatchObject({ hidden: false, data: { missing: false } })
    expect(crowded(layout)).toEqual([])
  })

  it('reading a saved Layout moves B (created later) off A to the nearest free place, A stays, one log line names B, from and to; a second read writes nothing; nothing is broadcast', async () => {
    const base = { hidden: false, locked: false, pinned: false, tags: [], data: {} }
    writeFileSync(
      layoutFile(),
      JSON.stringify({
        nodes: [
          { id: 'A', kind: 'card', x: 0, y: 0, w: 300, h: 200, ...base },
          { id: 'B', kind: 'note', x: 40, y: 40, w: 220, h: 120, ...base },
        ],
        viewport: { x: 0, y: 0, zoom: 1 },
      }),
    )
    utimesSync(layoutFile(), OLD, OLD)
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    try {
      const state = await value('layout.get', { projectId: PROJECT })
      expect(state.revision).toBe(0)
      expect(nodeOf(state.layout, 'A')).toMatchObject({ x: 0, y: 0 })
      expect(nodeOf(state.layout, 'B')).toMatchObject({ x: 40, y: 216 })
      expect(info.mock.calls.map((args) => String(args[0]))).toEqual([`[layout] ${PROJECT}: moved Node B from (40, 40) to (40, 216) off the Nodes created before it; Nodes never overlap (ADR-0038)`])
      expect(onDisk()).toEqual(state.layout)
      expect(statSync(layoutFile()).mtimeMs).toBeGreaterThan(OLD.getTime())
      // Not an operation: nothing broadcast, so nothing reaches the renderer's ⌘Z history.
      expect(electron.sent).toEqual([])

      utimesSync(layoutFile(), OLD, OLD)
      info.mockClear()
      await start()
      expect((await value('layout.get', { projectId: PROJECT })).layout).toEqual(state.layout)
      store.flushAll()
      expect(statSync(layoutFile()).mtimeMs).toBe(OLD.getTime())
      expect(info).not.toHaveBeenCalled()
    } finally {
      info.mockRestore()
    }
  })

  it('correcting one operation and reading a Layout of 500 Nodes take less than 1 s together', async () => {
    const base = { hidden: false, locked: false, pinned: false, tags: [], data: {} }
    // 500 Nodes on a grid, every tenth one dropped onto its neighbour.
    const nodes = Array.from({ length: 500 }, (_, index) => {
      const column = index % 25
      const row = Math.floor(index / 25)
      const onNeighbour = index % 10 === 9
      return { id: `n${index}`, kind: 'note', x: column * 260 - (onNeighbour ? 200 : 0), y: row * 160 + (onNeighbour ? 30 : 0), w: 220, h: 120, ...base }
    })
    writeFileSync(layoutFile(), JSON.stringify({ nodes, viewport: { x: 0, y: 0, zoom: 1 } }))
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    try {
      const started = performance.now()
      const read = store.get(PROJECT)
      const readMs = performance.now() - started
      const moveStarted = performance.now()
      const { layout } = store.apply(PROJECT, { op: 'move', id: 'n0', x: 3000, y: 1500 })
      const moveMs = performance.now() - moveStarted
      console.log(`[perf] 500 Nodes: read with overlap removal ${readMs.toFixed(1)} ms (${info.mock.calls.length} moved), one corrected move ${moveMs.toFixed(1)} ms`)
      // Only the 50 dropped Nodes: a moved Node keeps clear of the later ones too.
      expect(info.mock.calls.length).toBe(50)
      expect(crowded(read.layout)).toEqual([])
      expect(crowded(layout)).toEqual([])
      expect(readMs + moveMs).toBeLessThan(1000)
    } finally {
      info.mockRestore()
    }
  })
})

// worfy-link ticket 07: a change carries the screen that sent it, so a screen's ⌘Z can tell its own
// changes from another screen's (src/renderer/canvas/history.ts).
describe('layout store: the screen a change comes from', () => {
  const SCREEN = 'screen-a'
  const changed = () => electron.sent.filter((message) => message.channel === `${IPC_CHANNEL_PREFIX}layout.changed`).map((message) => message.payload as LayoutChange)

  it('apply with a screen puts it into the LayoutChange; without one the screen is null', async () => {
    const changes: LayoutChange[] = []
    store.onChange((change) => changes.push(change))
    await applied(note('n1'))
    await value('layout.apply', { projectId: PROJECT, op: { op: 'move', id: 'n1', x: 400, y: 0 }, screen: SCREEN })
    store.apply(PROJECT, { op: 'move', id: 'n1', x: 800, y: 0 })
    expect(changes.map(({ screen, op, revision }) => ({ screen, op: op.op, revision }))).toEqual([
      { screen: null, op: 'create', revision: 1 },
      { screen: SCREEN, op: 'move', revision: 2 },
      { screen: null, op: 'move', revision: 3 },
    ])
  })

  it('layout.changed carries the screen and the operation', async () => {
    await applied(note('n1'))
    await value('layout.apply', { projectId: PROJECT, op: { op: 'tag', id: 'n1', add: ['x'] }, screen: SCREEN })
    const [created, tagged] = changed()
    expect(created).toMatchObject({ projectId: PROJECT, revision: 1, screen: null, op: { op: 'create', node: { id: 'n1', kind: 'note' } } })
    expect(tagged).toMatchObject({ projectId: PROJECT, revision: 2, screen: SCREEN, op: { op: 'tag', id: 'n1', add: ['x'], remove: [] } })
    expect(tagged?.layout).toEqual(store.get(PROJECT).layout)
  })

  it('an invalid screen is refused and changes nothing', async () => {
    await applied(note('n1'))
    for (const screen of ['', 'x'.repeat(101), 7]) {
      expect(await call('layout.apply', { projectId: PROJECT, op: { op: 'move', id: 'n1', x: 1, y: 1 }, screen })).toMatchObject({ ok: false })
    }
    expect(store.get(PROJECT).revision).toBe(1)
  })

  it('trash.put and trash.restore with a screen give a layout.changed with it; without one, null', async () => {
    await start(true)
    await applied(note('n1'))
    await applied(note('n2', { x: 400 }))
    electron.sent.length = 0
    const put = await call('trash.put', { projectId: PROJECT, nodeId: 'n1', screen: SCREEN })
    expect(put.ok).toBe(true)
    const label = (put as { value: { label: string } }).value.label
    expect(await call('trash.restore', { projectId: PROJECT, label, screen: SCREEN })).toMatchObject({ ok: true })
    expect(await call('trash.put', { projectId: PROJECT, nodeId: 'n2' })).toMatchObject({ ok: true })
    expect(changed().map(({ screen, op }) => ({ screen, op: op.op }))).toEqual([
      { screen: SCREEN, op: 'remove' },
      { screen: SCREEN, op: 'create' },
      { screen: null, op: 'remove' },
    ])
  })
})
