// The Layout of a Project end to end in main: src/main/ipc/layout.ts registered through
// registerIpc (the same wrapper the app uses) over a mocked `electron`, the shared store from
// src/main/layout/store.ts called directly as later parts of main (MCP tools) will call it, and a
// temporary WORFY_DATA_DIR. main is the only writer of layout.json (ADR-0003).
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IpcMainInvokeEvent } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNEL_PREFIX, type IpcResult } from '../../src/shared/ipc/channels'
import { layoutSchema, type Layout, type LayoutOpInput, type LayoutState } from '../../src/shared/layout/types'
import type { LayoutStore } from '../../src/main/layout/store'

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

type Listener = (event: IpcMainInvokeEvent, input: unknown) => unknown

let scratch: string
let dataDir: string
let repo: string
let handlers: Map<string, Listener>
let store: LayoutStore

/** Loads src/main/ipc/layout.ts afresh, as an app start does, over the current data dir. */
async function start(): Promise<void> {
  vi.resetModules()
  electron.quitListeners.length = 0
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

    const moves = Array.from({ length: 100 }, (_, n) => ({ op: 'move' as const, id: ids[n % ids.length] ?? 'a', x: n * 10 + 1, y: n * -7 - 1 }))
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
