// The automatic archive of finished Sessions end to end in main (worfy-canvas ticket 07, ADR-0076):
// src/main/ipc/layout.ts registered through registerIpc over a mocked `electron` with two windows,
// the shared Layout store and an AutoArchiver over it (src/main/layout/archive.ts), with a temporary
// WORFY_DATA_DIR. The registry of live Sessions, the transcripts, the workflow model and the
// Bindings are stand-ins the test controls; nothing reads the real ~/.claude, and no timer runs:
// the test calls the archiver's runs itself.
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IpcMainInvokeEvent } from 'electron'
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { IPC_CHANNEL_PREFIX, type IpcResult } from '../../src/shared/ipc/channels'
import { layoutChangeSchema } from '../../src/shared/ipc/layout'
import { onThePlane } from '../../src/shared/layout/derived'
import { isArchived, layoutSchema, layoutStateSchema, type Layout, type LayoutNode, type LayoutOpInput } from '../../src/shared/layout/types'
import type { AutoArchiveDeps, AutoArchiver as AutoArchiverClass, HistoryLike, LiveSessionLike } from '../../src/main/layout/archive'
import type { LayoutStore } from '../../src/main/layout/store'
import { APP_URL, INDEX_HTML } from '../app-url'
import { removeTestTree, saveLayoutNow } from '../remove'

const PROJECT = 'demo-0a1b2c3d'
const HOUR = 3_600_000

const electron = vi.hoisted(() => {
  const sent: { window: number; channel: string; payload: unknown }[] = []
  const windowOf = (n: number) => ({ isDestroyed: () => false, webContents: { send: (channel: string, payload: unknown) => sent.push({ window: n, channel, payload }) } })
  return { sent, windows: [windowOf(1), windowOf(2)] }
})

vi.mock('electron', () => ({
  app: { on: () => undefined },
  BrowserWindow: { getAllWindows: () => electron.windows, fromWebContents: () => null },
  dialog: { showOpenDialog: vi.fn() },
}))

type Listener = (event: IpcMainInvokeEvent, input: unknown) => unknown

let scratch: string
let dataDir: string
let repo: string
let handlers: Map<string, Listener>
let store: LayoutStore
let AutoArchiver: typeof AutoArchiverClass
let startAppArchiver: typeof import('../../src/main/layout/archive').startAppArchiver

/** Loads src/main/ipc/layout.ts afresh, as an app start does, over the current data dir. */
async function start(): Promise<void> {
  ;(store as LayoutStore | undefined)?.flushAll()
  vi.resetModules()
  process.env.WORFY_DATA_DIR = dataDir
  const { registerIpc, appUrlMatcher } = await import('../../src/main/ipc/index')
  handlers = new Map()
  await registerIpc(
    { handle: (channel, listener) => handlers.set(channel, listener as Listener) },
    { modules: { './layout.ts': () => import('../../src/main/ipc/layout').then((module) => module.default) }, isTrustedSender: appUrlMatcher({ indexHtml: INDEX_HTML }) },
  )
  store = (await import('../../src/main/layout/store')).layoutStore()
  ;({ AutoArchiver, startAppArchiver } = await import('../../src/main/layout/archive'))
}

/** Calls a handler as a window of this Machine does; with `sender`, as that client does (a string id: a Linked machine's). */
async function call(channel: string, input?: unknown, sender: { id?: string } = {}): Promise<IpcResult<unknown>> {
  const listener = handlers.get(IPC_CHANNEL_PREFIX + channel)
  if (!listener) throw new Error(`no handler for ${channel}`)
  const event = { senderFrame: { url: APP_URL }, sender } as unknown as IpcMainInvokeEvent
  return (await listener(event, input)) as IpcResult<unknown>
}

const apply = (op: LayoutOpInput, screen: string | null = null) => store.apply(PROJECT, op, screen)
const nodes = (): LayoutNode[] => store.get(PROJECT).layout.nodes
const nodeOf = (id: string): LayoutNode | undefined => nodes().find((node) => node.id === id)
const layoutFile = () => join(dataDir, PROJECT, 'layout.json')
const onDisk = (): Layout => layoutSchema.parse(JSON.parse(readFileSync(layoutFile(), 'utf8')))

/** An external Session Node of `sessionId` at (x, y). */
const sessionNode = (sessionId: string, x = 0, y = 0): LayoutOpInput => ({
  op: 'create',
  node: { id: `session:${sessionId}`, kind: 'session', x, y, w: 300, h: 120, data: { sessionId, origin: 'external', source: 'terminal', cwd: '/p' } },
})

/** A way to answer a read later: the archiver waits on it. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => (resolve = done))
  return { promise, resolve }
}

/** What the stand-in registry answers; a test may replace `live` and `history` with a pending read. */
interface World {
  live: () => Promise<readonly LiveSessionLike[]>
  history: () => Promise<readonly HistoryLike[]>
  now: number
}

let world: World
let batches: number

function archiver(overrides: Partial<AutoArchiveDeps> = {}): AutoArchiverClass {
  return new AutoArchiver({
    store,
    projects: () => [{ id: PROJECT, path: repo }],
    live: () => world.live(),
    history: () => world.history(),
    running: () => new Set(),
    workflow: () => Promise.resolve(undefined),
    bindings: () => Promise.resolve(new Map()),
    settings: () => ({ idleMs: 24 * HOUR, ticketDone: true }),
    now: () => world.now,
    batchId: () => `batch-${(batches += 1)}`,
    ...overrides,
  })
}

/** Transcripts of the Sessions, each with its last record `ago` ms before the world's now. */
const transcripts = (...sessions: [string, number][]) => () => Promise.resolve(sessions.map(([sessionId, ago]) => ({ sessionId, lastAt: new Date(world.now - ago).toISOString() })))
const noneLive = () => Promise.resolve([])

/** The layout.changed events each window got, by operation kind. */
const changes = (window: number, kind?: string) =>
  electron.sent
    .filter((message) => message.window === window && message.channel === `${IPC_CHANNEL_PREFIX}layout.changed`)
    .map((message) => layoutChangeSchema.parse(message.payload))
    .filter((change) => kind === undefined || change.op.op === kind)

beforeEach(async () => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-archive-')))
  dataDir = join(scratch, 'data')
  repo = join(scratch, 'repo')
  mkdirSync(repo)
  mkdirSync(join(dataDir, PROJECT), { recursive: true })
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT, name: 'demo', path: repo }], activeId: PROJECT }))
  electron.sent.length = 0
  batches = 0
  // The store stamps touchedAt and archived.at with the real clock; the archiver's clock is the same.
  world = { live: noneLive, history: () => Promise.resolve([]), now: Date.now() }
  await start()
})

afterEach(async () => {
  await saveLayoutNow()
  delete process.env.WORFY_DATA_DIR
  removeTestTree(scratch)
})

describe('archive and restore through the Layout store', () => {
  it('archive takes the Nodes off the plane as one batch, with their rules; restore brings them back; layout.json keeps it', async () => {
    apply(sessionNode('a'))
    apply(sessionNode('b', 400, 0))
    apply({ op: 'archive', batch: 'b1', nodes: [{ id: 'session:a', rule: 'idle' }, { id: 'session:b', rule: 'ticket-done' }] })
    expect(nodeOf('session:a')?.archived).toMatchObject({ rule: 'idle', batch: 'b1', at: expect.any(Number) })
    expect(nodeOf('session:b')?.archived).toMatchObject({ rule: 'ticket-done', batch: 'b1' })
    expect(nodes().filter(onThePlane)).toEqual([])
    // Not `hidden`: what the user hid and what the archive took stay apart.
    expect(nodeOf('session:a')?.hidden).toBe(false)

    store.flushAll()
    expect(onDisk().nodes.filter(isArchived).map((node) => node.id)).toEqual(['session:a', 'session:b'])

    // Archiving again keeps the first record.
    apply({ op: 'archive', batch: 'b2', nodes: [{ id: 'session:a', rule: 'ticket-done' }] })
    expect(nodeOf('session:a')?.archived).toMatchObject({ rule: 'idle', batch: 'b1' })

    apply({ op: 'restore', ids: ['session:a'] })
    expect(nodeOf('session:a')?.archived).toBeNull()
    expect(onThePlane(nodeOf('session:a')!)).toBe(true)
    expect(isArchived(nodeOf('session:b')!)).toBe(true)
  })

  it('an archived Node is in nobody\'s way: a Node created at its place stays there', () => {
    apply(sessionNode('a'))
    apply({ op: 'archive', batch: 'b1', nodes: [{ id: 'session:a', rule: 'idle' }] })
    apply({ op: 'create', node: { id: 'n', kind: 'note', x: 0, y: 0, w: 220, h: 120 } })
    expect(nodeOf('n')).toMatchObject({ x: 0, y: 0 })
  })

  it('an id the Layout does not have is refused and changes nothing', () => {
    apply(sessionNode('a'))
    const before = store.get(PROJECT)
    expect(() => apply({ op: 'archive', batch: 'b1', nodes: [{ id: 'session:a', rule: 'idle' }, { id: 'nope', rule: 'idle' }] })).toThrow(/no Node with id nope/)
    expect(() => apply({ op: 'restore', ids: ['nope'] })).toThrow(/no Node with id nope/)
    expect(store.get(PROJECT)).toEqual(before)
  })

  it('keep sets the flag; touch, and every operation of the user on a Node, set touchedAt; an operation without a screen does not', () => {
    apply(sessionNode('a'))
    apply({ op: 'move', id: 'session:a', x: 10, y: 10 })
    apply({ op: 'keep', id: 'session:a', keep: true })
    expect(nodeOf('session:a')).toMatchObject({ keep: true })
    expect(nodeOf('session:a')?.touchedAt).toBeUndefined()
    apply({ op: 'touch', id: 'session:a' })
    expect(nodeOf('session:a')?.touchedAt).toEqual(expect.any(Number))

    const ops: ((id: string) => LayoutOpInput)[] = [
      (id) => ({ op: 'move', id, x: 0, y: 2000 }),
      (id) => ({ op: 'moveMany', moves: [{ id, x: 0, y: 2000 }] }),
      (id) => ({ op: 'resize', id, w: 310, h: 130 }),
      (id) => ({ op: 'pin', id, pinned: true, x: 1, y: 1, w: 300, h: 120 }),
      (id) => ({ op: 'tag', id, add: ['x'] }),
      (id) => ({ op: 'patchData', id, data: { name: 'n' } }),
      (id) => ({ op: 'hide', id, hidden: false }),
      (id) => ({ op: 'keep', id, keep: true }),
    ]
    for (const [n, make] of ops.entries()) {
      apply(sessionNode(`s${n}`, 0, 400 * (n + 1)))
      const op = make(`session:s${n}`)
      apply(op, 'screen-1')
      expect(nodeOf(`session:s${n}`)?.touchedAt, op.op).toEqual(expect.any(Number))
    }
  })

  it('a layout.json written before the archive — no archived, keep or touchedAt — reads, and is archived like any other', () => {
    store.flushAll()
    store.forget(PROJECT)
    writeFileSync(layoutFile(), JSON.stringify({ nodes: [{ id: 'session:old', kind: 'session', x: 0, y: 0, w: 300, h: 120, data: { sessionId: 'old' } }], viewport: { x: 0, y: 0, zoom: 1 } }))
    const [old] = nodes()
    expect(old).toEqual({ id: 'session:old', kind: 'session', x: 0, y: 0, w: 300, h: 120, hidden: false, locked: false, pinned: false, tags: [], data: { sessionId: 'old' } })
    expect(isArchived(old!)).toBe(false)
    expect(onThePlane(old!)).toBe(true)
    // The fields written as null read the same.
    store.forget(PROJECT)
    writeFileSync(layoutFile(), JSON.stringify({ nodes: [{ id: 'session:old', kind: 'session', x: 0, y: 0, w: 300, h: 120, data: { sessionId: 'old' }, archived: null, touchedAt: null }] }))
    expect(isArchived(nodes()[0]!)).toBe(false)
    apply({ op: 'archive', batch: 'b1', nodes: [{ id: 'session:old', rule: 'idle' }] })
    store.flushAll()
    expect(onDisk().nodes[0]?.archived).toMatchObject({ rule: 'idle', batch: 'b1' })
  })
})

describe('the archiver', () => {
  it('archives the candidates of a run as one operation with a new batch, without a screen', async () => {
    apply(sessionNode('a'))
    apply(sessionNode('b', 400, 0))
    apply(sessionNode('fresh', 800, 0))
    world.history = transcripts(['a', 30 * HOUR], ['b', 25 * HOUR], ['fresh', HOUR])
    expect(await archiver().run({ id: PROJECT, path: repo })).toBe(2)
    const [change, ...more] = changes(1, 'archive')
    expect(more).toEqual([])
    expect(change?.screen).toBeNull()
    expect(change?.op).toEqual({ op: 'archive', batch: 'batch-1', nodes: [{ id: 'session:a', rule: 'idle' }, { id: 'session:b', rule: 'idle' }] })
    expect(isArchived(nodeOf('session:fresh')!)).toBe(false)
  })

  it('with «Never» archives nothing and still brings a resumed Session back', async () => {
    apply(sessionNode('a'))
    world.history = transcripts(['a', 300 * HOUR])
    const never = archiver({ settings: () => ({ idleMs: null, ticketDone: true }) })
    expect(await never.run({ id: PROJECT, path: repo })).toBe(0)
    expect(changes(1, 'archive')).toEqual([])

    apply({ op: 'archive', batch: 'b1', nodes: [{ id: 'session:a', rule: 'idle' }] })
    world.live = () => Promise.resolve([{ sessionId: 'a', status: 'idle' }])
    await never.run({ id: PROJECT, path: repo })
    expect(isArchived(nodeOf('session:a')!)).toBe(false)
  })

  it('two windows of one Project: one batch, made by main; runs that overlap make one batch', async () => {
    apply(sessionNode('a'))
    world.history = transcripts(['a', 30 * HOUR])
    const read = deferred<readonly LiveSessionLike[]>()
    world.live = () => read.promise
    const one = archiver()
    // At start and on the timer, as two windows would if each ran it.
    const runs = [one.runAll(), one.runAll(), one.run({ id: PROJECT, path: repo })]
    read.resolve([])
    await Promise.all(runs)
    expect(changes(1, 'archive')).toHaveLength(1)
    expect(changes(2, 'archive')).toHaveLength(1)
    expect(changes(1, 'archive')[0]).toEqual(changes(2, 'archive')[0])
    // A later run finds nothing more to do.
    await one.runAll()
    expect(changes(1, 'archive')).toHaveLength(1)
  })

  it('a watcher\'s read of a root that is no Project of this Machine changes nothing; another spelling of the root counts', async () => {
    apply(sessionNode('a'))
    apply({ op: 'archive', batch: 'b1', nodes: [{ id: 'session:a', rule: 'idle' }] })
    const one = archiver()
    one.noteLive(join(scratch, 'elsewhere'), [{ sessionId: 'a', status: 'busy' }])
    expect(isArchived(nodeOf('session:a')!)).toBe(true)
    one.noteLive(`${repo}/sub/..`, [{ sessionId: 'a', status: 'busy' }])
    expect(isArchived(nodeOf('session:a')!)).toBe(false)
  })

  it('a Session worfy runs is live whatever the registry says', async () => {
    apply(sessionNode('a'))
    world.history = transcripts(['a', 30 * HOUR])
    expect(await archiver({ running: () => new Set(['a']) }).run({ id: PROJECT, path: repo })).toBe(0)
  })

  it('a Session resumed later comes back to its old place when it is clear', async () => {
    apply(sessionNode('a', 40, 60))
    world.history = transcripts(['a', 30 * HOUR])
    const one = archiver()
    await one.run({ id: PROJECT, path: repo })
    expect(isArchived(nodeOf('session:a')!)).toBe(true)

    // A registry watcher reads it live: main restores it at once, without a screen.
    one.noteLive(repo, [{ sessionId: 'a', status: 'busy' }])
    expect(nodeOf('session:a')).toMatchObject({ archived: null, x: 40, y: 60 })
    const [restore] = changes(1, 'restore')
    expect(restore).toMatchObject({ screen: null, op: { op: 'restore', ids: ['session:a'] } })
  })

  it('a Session resumed later goes to the nearest clear place when its old one is taken', async () => {
    apply(sessionNode('a'))
    world.history = transcripts(['a', 30 * HOUR])
    const one = archiver()
    await one.run({ id: PROJECT, path: repo })
    apply({ op: 'create', node: { id: 'n', kind: 'note', x: 0, y: 0, w: 300, h: 120 } })

    world.live = () => Promise.resolve([{ sessionId: 'a', status: 'idle' }])
    await one.run({ id: PROJECT, path: repo })
    const back = nodeOf('session:a')!
    expect(isArchived(back)).toBe(false)
    expect(back.x !== 0 || back.y !== 0).toBe(true)
    const note = nodeOf('n')!
    const apart = back.x >= note.x + note.w || note.x >= back.x + back.w || back.y >= note.y + note.h || note.y >= back.y + back.h
    expect(apart).toBe(true)
  })

  it('race: a Session comes to life while the run reads the registry — it is not archived', async () => {
    apply(sessionNode('a'))
    world.history = transcripts(['a', 30 * HOUR])
    const read = deferred<readonly LiveSessionLike[]>()
    const asked = deferred<void>()
    world.live = () => {
      asked.resolve()
      return read.promise
    }
    const one = archiver()
    const run = one.run({ id: PROJECT, path: repo })
    // The run's read looked before `claude --resume`; a watcher reports while it is still going.
    await asked.promise
    one.noteLive(repo, [{ sessionId: 'a', status: 'busy' }])
    read.resolve([])
    expect(await run).toBe(0)
    expect(isArchived(nodeOf('session:a')!)).toBe(false)
  })

  it('race: a Session comes to life just after its batch was written — it does not stay in the archive', async () => {
    apply(sessionNode('a'))
    world.history = transcripts(['a', 30 * HOUR])
    const one = archiver()
    expect(await one.run({ id: PROJECT, path: repo })).toBe(1)
    one.noteLive(repo, [{ sessionId: 'a', status: 'unknown' }])
    expect(isArchived(nodeOf('session:a')!)).toBe(false)
  })

  it('a Node the user moved while the run read is left: the rule runs again on the Layout of the write', async () => {
    apply(sessionNode('a'))
    world.history = transcripts(['a', 30 * HOUR])
    const read = deferred<readonly LiveSessionLike[]>()
    world.live = () => read.promise
    const run = archiver().run({ id: PROJECT, path: repo })
    apply({ op: 'move', id: 'session:a', x: 500, y: 500 }, 'screen-1')
    read.resolve([])
    expect(await run).toBe(0)
  })
})

describe('round 2 of the review of PR #536', () => {
  it('a Session whose process state cannot be told (ps did not answer) is live: the archive registry never takes it for finished', async () => {
    const { archiveRegistry } = await import('../../src/main/layout/archive')
    const home = join(scratch, 'claude-home')
    mkdirSync(join(home, 'sessions'), { recursive: true })
    writeFileSync(join(home, 'sessions', '4242.json'), JSON.stringify({ pid: 4242, sessionId: 'a', cwd: repo, status: 'idle' }))
    apply(sessionNode('a'))
    world.history = transcripts(['a', 30 * HOUR])
    const over = (state: 'alive' | 'gone' | 'unknown') => {
      const registry = archiveRegistry({ home, processState: () => Promise.resolve(state), listWorktrees: () => Promise.resolve([]) })
      return archiver({ live: (project) => registry.live({ path: project.path, local: true }) })
    }
    expect(await over('unknown').run({ id: PROJECT, path: repo })).toBe(0)
    expect(await over('alive').run({ id: PROJECT, path: repo })).toBe(0)
    expect(isArchived(nodeOf('session:a')!)).toBe(false)
    // The same entry with its process gone: finished, archived.
    expect(await over('gone').run({ id: PROJECT, path: repo })).toBe(1)
  })

  it('a restored Node is touched, so the next run does not take it again', async () => {
    apply(sessionNode('a'))
    world.history = transcripts(['a', 30 * HOUR])
    const one = archiver()
    expect(await one.run({ id: PROJECT, path: repo })).toBe(1)
    apply({ op: 'restore', ids: ['session:a'] }, 'screen-1')
    expect(nodeOf('session:a')?.touchedAt).toEqual(expect.any(Number))
    expect(await one.run({ id: PROJECT, path: repo })).toBe(0)
    expect(isArchived(nodeOf('session:a')!)).toBe(false)
  })

  it('under «Never» a run reads no registry and no transcripts while no Node is archived', async () => {
    apply(sessionNode('a'))
    const live = vi.fn(noneLive)
    const history = vi.fn(transcripts(['a', 300 * HOUR]))
    const never = archiver({ live, history, settings: () => ({ idleMs: null, ticketDone: true }) })
    await never.runAll()
    expect(live).not.toHaveBeenCalled()
    expect(history).not.toHaveBeenCalled()
    // With a Node archived before, the registry is read: a resumed Session must come back.
    apply({ op: 'archive', batch: 'b1', nodes: [{ id: 'session:a', rule: 'idle' }] })
    await never.runAll()
    expect(live).toHaveBeenCalledTimes(1)
  })

  it('under «Never» a run does not read the layout.json of a Project nobody opened', async () => {
    writeFileSync(layoutFile(), JSON.stringify({ nodes: [{ id: 'session:a', kind: 'session', x: 0, y: 0, w: 300, h: 120, data: { sessionId: 'a' }, archived: { at: 1, rule: 'idle', batch: 'b1' } }] }))
    const live = vi.fn(() => Promise.resolve([{ sessionId: 'a', status: 'idle' }]))
    const never = archiver({ live, settings: () => ({ idleMs: null, ticketDone: true }) })
    await never.runAll()
    expect(store.peek(PROJECT)).toBeUndefined()
    expect(live).not.toHaveBeenCalled()
    // Once main holds it (a window opened the Project), the resumed Session comes back.
    expect(isArchived(nodeOf('session:a')!)).toBe(true)
    await never.runAll()
    expect(isArchived(nodeOf('session:a')!)).toBe(false)
  })

  it('Bindings are looked up only for the Sessions the ticket-done rule alone could take', async () => {
    apply(sessionNode('old'))
    apply(sessionNode('mid', 400, 0))
    apply(sessionNode('fresh', 800, 0))
    apply(sessionNode('pinned', 1200, 0))
    apply({ op: 'pin', id: 'session:pinned', pinned: true, x: 1, y: 1, w: 300, h: 120 })
    apply(sessionNode('kept', 1600, 0))
    apply({ op: 'keep', id: 'session:kept', keep: true })
    world.history = transcripts(['old', 30 * HOUR], ['mid', 2 * HOUR], ['fresh', HOUR / 2], ['pinned', 2 * HOUR], ['kept', 2 * HOUR])
    const workflow = vi.fn(() => Promise.resolve({ epics: ['e'], tickets: [{ epic: 'e', num: 1, state: 'done' }] }))
    const bindings = vi.fn((_project: unknown, ids: readonly string[]) => Promise.resolve(new Map(ids.map((id) => [id, { kind: 'ticket' as const, epic: 'e', num: 1 }]))))
    const one = archiver({ workflow, bindings })
    expect(await one.run({ id: PROJECT, path: repo })).toBe(2)
    expect(bindings).toHaveBeenCalledTimes(1)
    expect(bindings.mock.calls[0]?.[1]).toEqual(['mid'])
    expect(changes(1, 'archive')[0]?.op).toEqual({ op: 'archive', batch: 'batch-1', nodes: [{ id: 'session:old', rule: 'idle' }, { id: 'session:mid', rule: 'ticket-done' }] })
    // Nothing left that only a Binding could decide: no workflow model, no lookup.
    await one.run({ id: PROJECT, path: repo })
    expect(workflow).toHaveBeenCalledTimes(1)
    expect(bindings).toHaveBeenCalledTimes(1)
  })
})

describe('the undo history of a screen', () => {
  it('the timer\'s operations are no step of it: ⌘Z after an archive undoes the user\'s own move', async () => {
    const { applyRecorded, historyOf, noteLayoutChange, resetHistories } = await import('../../src/renderer/canvas/history')
    resetHistories()
    apply(sessionNode('a'))
    apply({ op: 'create', node: { id: 'n', kind: 'note', x: 1000, y: 0, w: 220, h: 120 } })
    // The user's move, sent with the screen as the Canvas sends it.
    const channel = {
      send: (op: LayoutOpInput) => Promise.resolve({ revision: apply(op, 'screen-1').revision }),
      layout: () => store.get(PROJECT).layout,
    }
    expect(await applyRecorded(PROJECT, { op: 'move', id: 'n', x: 1000, y: 400 }, channel)).toBeUndefined()

    world.history = transcripts(['a', 30 * HOUR])
    await archiver().run({ id: PROJECT, path: repo })
    for (const change of changes(1)) noteLayoutChange(change)

    expect(historyOf(PROJECT).size).toBe(1)
    expect(await historyOf(PROJECT).undo()).toBe(true)
    expect(nodeOf('n')).toMatchObject({ x: 1000, y: 0 })
    // The archive stays: ⌘Z does not undo the timer.
    expect(isArchived(nodeOf('session:a')!)).toBe(true)
    expect(historyOf(PROJECT).canUndo).toBe(false)
  })

  /** The screen's channel to the real store, as the Canvas and canvas/show-node.ts send. */
  const screenChannel = () => ({
    send: (op: LayoutOpInput) => Promise.resolve({ revision: apply(op, 'screen-1').revision }),
    layout: () => store.get(PROJECT).layout,
  })

  it('⌘Z after a Restore that had to put the Node elsewhere archives it again at its old place, with its old record (worfy-canvas 14)', async () => {
    const { applyRecorded, historyOf, resetHistories } = await import('../../src/renderer/canvas/history')
    resetHistories()
    apply(sessionNode('a'))
    apply({ op: 'archive', batch: 'b1', nodes: [{ id: 'session:a', rule: 'ticket-done' }] })
    const record = nodeOf('session:a')!.archived
    // Another Node takes the archived one's place: an archived Node is in nobody's way.
    apply({ op: 'create', node: { id: 'b', kind: 'note', x: 0, y: 0, w: 300, h: 120 } })
    await new Promise((resolve) => setTimeout(resolve, 5))

    expect(await applyRecorded(PROJECT, { op: 'restore', ids: ['session:a'] }, screenChannel())).toBeUndefined()
    const restored = nodeOf('session:a')!
    expect(restored.archived).toBeNull()
    expect({ x: restored.x, y: restored.y }).not.toEqual({ x: 0, y: 0 })

    expect(await historyOf(PROJECT).undo()).toBe(true)
    expect(nodeOf('session:a')).toMatchObject({ x: 0, y: 0, archived: record })
    expect(nodeOf('b')).toMatchObject({ x: 0, y: 0 })

    // Redo restores it again, off the other Node.
    expect(await historyOf(PROJECT).redo()).toBe(true)
    expect(nodeOf('session:a')).toMatchObject({ x: restored.x, y: restored.y, archived: null })
  })

  it('⌘Z after one Restore of Nodes from two batches puts each back into its own batch, at its own place and time', async () => {
    const { applyRecorded, historyOf, resetHistories } = await import('../../src/renderer/canvas/history')
    resetHistories()
    apply(sessionNode('a'))
    apply(sessionNode('c', 1000, 0))
    apply({ op: 'archive', batch: 'b1', nodes: [{ id: 'session:a', rule: 'idle' }] })
    await new Promise((resolve) => setTimeout(resolve, 5))
    apply({ op: 'archive', batch: 'b2', nodes: [{ id: 'session:c', rule: 'ticket-done' }] })
    const before = { a: nodeOf('session:a')!.archived, c: nodeOf('session:c')!.archived }
    apply({ op: 'create', node: { id: 'b', kind: 'note', x: 0, y: 0, w: 300, h: 120 } })
    apply({ op: 'create', node: { id: 'd', kind: 'note', x: 1000, y: 0, w: 300, h: 120 } })
    await new Promise((resolve) => setTimeout(resolve, 5))

    expect(await applyRecorded(PROJECT, { op: 'restore', ids: ['session:a', 'session:c'] }, screenChannel())).toBeUndefined()
    expect(nodes().filter(isArchived)).toEqual([])

    expect(await historyOf(PROJECT).undo()).toBe(true)
    expect(nodeOf('session:a')).toMatchObject({ x: 0, y: 0, archived: before.a })
    expect(nodeOf('session:c')).toMatchObject({ x: 1000, y: 0, archived: before.c })
  })
})

describe('the read-only screen of a Linked machine (ADR-0066)', () => {
  it('gets the Layout with archived Nodes, and every change of the archive, without an error', async () => {
    apply(sessionNode('a'))
    world.history = transcripts(['a', 30 * HOUR])
    await archiver().run({ id: PROJECT, path: repo })

    const answer = await call('layout.get', { projectId: PROJECT }, { id: 'link:mac/1' })
    expect(answer.ok).toBe(true)
    const state = layoutStateSchema.parse(answer.ok ? answer.value : null)
    expect(state.layout.nodes.map((node) => [node.id, isArchived(node)])).toEqual([['session:a', true]])
    // What every client hears, a Linked machine's window too, parses with the channel's schema.
    expect(changes(1, 'archive')).toHaveLength(1)
    expect(changes(2, 'archive')).toHaveLength(1)
  })
})

/** Starts the app's archiver under `settings`; its run at start archives nothing under «Never». Stopped after the test. */
function appArchiver(settings: AutoArchiveDeps['settings'] = () => ({ idleMs: null, ticketDone: true })): void {
  const stop = startAppArchiver(archiver({ settings }), 3_600_000)
  onTestFinished(stop)
}

/** A screen's recorded channel through the real `layout.apply` handler, as the renderer sends (screenChannel). */
const ipcChannel = (screen = 'screen-1') => ({
  send: async (op: LayoutOpInput) => {
    const answer = await call('layout.apply', { projectId: PROJECT, op, screen })
    return answer.ok ? { revision: layoutStateSchema.parse(answer.value).revision } : answer.error
  },
  layout: () => store.get(PROJECT).layout,
})

describe('«Archive finished sessions now» (worfy-canvas ticket 08, ADR-0076, point 9)', () => {

  it('layout.archiveCandidates answers the rule\'s candidates with 24 h under «Never», and archives nothing itself', async () => {
    apply(sessionNode('old'))
    apply(sessionNode('day', 400, 0))
    apply(sessionNode('kept', 800, 0))
    apply({ op: 'keep', id: 'session:kept', keep: true })
    world.history = transcripts(['old', 30 * HOUR], ['day', 20 * HOUR], ['kept', 300 * HOUR])
    appArchiver(() => ({ idleMs: null, ticketDone: true }))
    const answer = await call('layout.archiveCandidates', { projectId: PROJECT })
    expect(answer).toEqual({ ok: true, value: [{ id: 'session:old', sessionId: 'old', rule: 'idle' }] })
    expect(nodes().filter(isArchived)).toEqual([])
    expect(changes(1, 'archive')).toEqual([])
  })

  it('takes the threshold of the Setting when it is not «Never»', async () => {
    apply(sessionNode('day', 400, 0))
    world.history = transcripts(['day', 20 * HOUR])
    // «Never» while the archiver starts, so its run at start leaves the Node; then the person picks 6 h.
    let idleMs: number | null = null
    appArchiver(() => ({ idleMs, ticketDone: true }))
    idleMs = 6 * HOUR
    expect(await call('layout.archiveCandidates', { projectId: PROJECT })).toEqual({ ok: true, value: [{ id: 'session:day', sessionId: 'day', rule: 'idle' }] })
  })

  it('is refused while the app has no archiver, and for a Project that is not of this Machine', async () => {
    expect(await call('layout.archiveCandidates', { projectId: PROJECT })).toMatchObject({ ok: false })
    appArchiver(() => ({ idleMs: null, ticketDone: true }))
    expect(await call('layout.archiveCandidates', { projectId: 'other-00000000' })).toMatchObject({ ok: false })
  })

  it('the screen\'s `archive` of the candidates is one step of ⌘Z: undo brings every Node back at its place, redo archives them again', async () => {
    const { applyRecorded, historyOf, resetHistories } = await import('../../src/renderer/canvas/history')
    resetHistories()
    appArchiver()
    apply(sessionNode('a'))
    apply(sessionNode('b', 400, 0))
    const op: LayoutOpInput = { op: 'archive', batch: 'now-1', nodes: [{ id: 'session:a', rule: 'idle' }, { id: 'session:b', rule: 'idle' }] }
    expect(await applyRecorded(PROJECT, op, ipcChannel())).toBeUndefined()
    expect(nodes().filter(isArchived).map((node) => node.id)).toEqual(['session:a', 'session:b'])
    expect(historyOf(PROJECT).size).toBe(1)

    expect(await historyOf(PROJECT).undo()).toBe(true)
    expect(nodes().filter(isArchived)).toEqual([])
    expect(nodeOf('session:a')).toMatchObject({ x: 0, y: 0 })
    expect(nodeOf('session:b')).toMatchObject({ x: 400, y: 0 })

    expect(await historyOf(PROJECT).redo()).toBe(true)
    expect(nodes().filter(isArchived).map((node) => node.archived?.batch)).toEqual(['now-1', 'now-1'])
  })
})

describe('a screen\'s `archive` keeps the rule\'s exceptions at the write (round 1 of the review of PR #664)', () => {
  const both: LayoutOpInput = { op: 'archive', batch: 'now-1', nodes: [{ id: 'session:a', rule: 'idle' }, { id: 'session:b', rule: 'idle' }] }

  it('a Node kept on another screen between the candidates and the apply stays on the Canvas', async () => {
    appArchiver()
    apply(sessionNode('a'))
    apply(sessionNode('b', 400, 0))
    world.history = transcripts(['a', 30 * HOUR], ['b', 30 * HOUR])
    const candidates = await call('layout.archiveCandidates', { projectId: PROJECT })
    expect(candidates).toMatchObject({ ok: true, value: [{ id: 'session:a' }, { id: 'session:b' }] })
    apply({ op: 'keep', id: 'session:b', keep: true }, 'screen-2')

    expect(await call('layout.apply', { projectId: PROJECT, op: both, screen: 'screen-1' })).toMatchObject({ ok: true })
    expect(nodes().filter(isArchived).map((node) => node.id)).toEqual(['session:a'])
    expect(changes(1, 'archive').map((change) => change.op)).toEqual([{ op: 'archive', batch: 'now-1', nodes: [{ id: 'session:a', rule: 'idle' }] }])
  })

  it('a Session that came back to life during the read (`claude --resume`) is not archived; one worfy runs neither', async () => {
    const running = new Set<string>()
    const stop = startAppArchiver(archiver({ settings: () => ({ idleMs: null, ticketDone: true }), running: () => running }), 3_600_000)
    onTestFinished(stop)
    apply(sessionNode('a'))
    apply(sessionNode('b', 400, 0))
    apply(sessionNode('c', 800, 0))
    world.history = transcripts(['a', 30 * HOUR], ['b', 30 * HOUR], ['c', 30 * HOUR])
    expect(await call('layout.archiveCandidates', { projectId: PROJECT })).toMatchObject({ ok: true, value: [{ id: 'session:a' }, { id: 'session:b' }, { id: 'session:c' }] })
    world.live = () => Promise.resolve([{ sessionId: 'b', status: 'unknown' }])
    running.add('c')

    const op: LayoutOpInput = { op: 'archive', batch: 'now-1', nodes: [{ id: 'session:a', rule: 'idle' }, { id: 'session:b', rule: 'idle' }, { id: 'session:c', rule: 'idle' }] }
    expect(await call('layout.apply', { projectId: PROJECT, op, screen: 'screen-1' })).toMatchObject({ ok: true })
    expect(nodes().filter(isArchived).map((node) => node.id)).toEqual(['session:a'])
  })

  it('a pinned Node, or one that is no Session Node, is not archived; with none left the apply is refused and changes nothing', async () => {
    appArchiver()
    apply(sessionNode('a'))
    apply({ op: 'create', node: { id: 'n', kind: 'note', x: 1000, y: 0, w: 220, h: 120 } })
    apply({ op: 'pin', id: 'session:a', pinned: true, x: 10, y: 10, w: 300, h: 120 }, 'screen-1')
    const op: LayoutOpInput = { op: 'archive', batch: 'now-1', nodes: [{ id: 'session:a', rule: 'idle' }, { id: 'n', rule: 'idle' }] }
    const before = store.get(PROJECT).revision
    const answer = await call('layout.apply', { projectId: PROJECT, op, screen: 'screen-1' })
    expect(answer.ok).toBe(false)
    expect(answer.ok ? '' : answer.error).toMatch(/nothing to archive/)
    expect(store.get(PROJECT).revision).toBe(before)
    expect(nodes().filter(isArchived)).toEqual([])
  })

  it('without the app\'s archiver a screen\'s `archive` is refused: nobody can tell a live Session', async () => {
    apply(sessionNode('a'))
    expect(await call('layout.apply', { projectId: PROJECT, op: { op: 'archive', batch: 'b', nodes: [{ id: 'session:a', rule: 'idle' }] }, screen: 'screen-1' })).toMatchObject({ ok: false })
    expect(nodes().filter(isArchived)).toEqual([])
  })

  it('Archive now, ⌘Z, Keep on another screen, ⇧⌘Z: the redo leaves the kept Node; with every Node kept the redo is refused', async () => {
    const { applyRecorded, historyOf, resetHistories } = await import('../../src/renderer/canvas/history')
    resetHistories()
    appArchiver()
    apply(sessionNode('a'))
    apply(sessionNode('b', 400, 0))
    expect(await applyRecorded(PROJECT, both, ipcChannel())).toBeUndefined()
    expect(await historyOf(PROJECT).undo()).toBe(true)
    expect(nodes().filter(isArchived)).toEqual([])

    apply({ op: 'keep', id: 'session:b', keep: true }, 'screen-2')
    expect(await historyOf(PROJECT).redo()).toBe(true)
    expect(nodes().filter(isArchived).map((node) => node.id)).toEqual(['session:a'])
    expect(nodeOf('session:b')!.keep).toBe(true)

    // Again, with both kept: the redo is refused and archives nothing.
    expect(await historyOf(PROJECT).undo()).toBe(true)
    apply({ op: 'keep', id: 'session:a', keep: true }, 'screen-2')
    expect(await historyOf(PROJECT).redo()).toBe(false)
    expect(nodes().filter(isArchived)).toEqual([])
  })

  it('a candidate the timer archived before the screen\'s write keeps its batch, and ⌘Z does not restore it', async () => {
    const { applyRecorded, historyOf, resetHistories } = await import('../../src/renderer/canvas/history')
    resetHistories()
    appArchiver()
    apply(sessionNode('a'))
    apply(sessionNode('b', 400, 0))
    apply({ op: 'archive', batch: 'timer-1', nodes: [{ id: 'session:a', rule: 'idle' }] })
    const record = nodeOf('session:a')!.archived

    expect(await applyRecorded(PROJECT, both, ipcChannel())).toBeUndefined()
    expect(nodeOf('session:a')!.archived).toEqual(record)
    expect(nodeOf('session:b')!.archived?.batch).toBe('now-1')

    expect(await historyOf(PROJECT).undo()).toBe(true)
    expect(nodeOf('session:a')!.archived).toEqual(record)
    expect(isArchived(nodeOf('session:b')!)).toBe(false)

    // A screen's archive of only the Node archived already is refused: no empty write, no step.
    const before = store.get(PROJECT).revision
    const again = await call('layout.apply', { projectId: PROJECT, op: { op: 'archive', batch: 'now-2', nodes: [{ id: 'session:a', rule: 'idle' }] }, screen: 'screen-1' })
    expect(again.ok ? '' : again.error).toMatch(/nothing to archive/)
    expect(store.get(PROJECT).revision).toBe(before)
  })
})

describe('the timer', () => {
  it('skips a tick while the previous runs still read', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    onTestFinished(() => {
      vi.useRealTimers()
    })
    apply(sessionNode('a'))
    world.history = transcripts(['a', 30 * HOUR])
    const read = deferred<readonly LiveSessionLike[]>()
    let reads = 0
    world.live = () => {
      reads += 1
      return read.promise
    }
    const stop = archiver().start(10)
    onTestFinished(stop)
    await vi.advanceTimersByTimeAsync(100)
    expect(reads).toBe(1)
    read.resolve([])
    await vi.waitFor(() => expect(isArchived(nodeOf('session:a')!)).toBe(true))
    world.live = noneLive
    await vi.advanceTimersByTimeAsync(10)
    expect(changes(1, 'archive')).toHaveLength(1)
  })
})
