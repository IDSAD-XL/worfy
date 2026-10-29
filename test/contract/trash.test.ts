// The trash of ticket 30 end to end in main: src/main/ipc/trash.ts registered through registerIpc
// (the same wrapper the app uses) over a mocked `electron`, the shared Layout store, and a temporary
// WORFY_DATA_DIR. A deleted Card moves with its files and data to <Project data folder>/trash/<label>/
// and comes back from there; entries older than three days are deleted when the app starts; nothing
// outside WORFY_DATA_DIR is ever touched (ADR-0005).
import { spawn } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import type { IpcMainInvokeEvent } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNEL_PREFIX, type IpcResult } from '../../src/shared/ipc/channels'
import { TRASH_KEEP_MS, type TrashEntry } from '../../src/shared/ipc/trash'
import type { LayoutNode, LayoutOpInput } from '../../src/shared/layout/types'
import type { LayoutStore } from '../../src/main/layout/store'
import { APP_URL, INDEX_HTML } from '../app-url'
import { removeTestTree, saveLayoutNow } from '../remove'
import { scriptNode } from '../script-node'

const PROJECT = 'demo-0a1b2c3d'
const DAY = 24 * 60 * 60 * 1000

const electron = vi.hoisted(() => {
  const sent: { channel: string; payload: unknown }[] = []
  const window = { isDestroyed: () => false, webContents: { send: (channel: string, payload: unknown) => sent.push({ channel, payload }) } }
  return { sent, window }
})

vi.mock('electron', () => ({
  app: { on: () => undefined },
  BrowserWindow: { getAllWindows: () => [electron.window], fromWebContents: () => null },
  dialog: { showOpenDialog: vi.fn() },
}))

// The Sessions worfy runs on Session Nodes: which Node runs one is all the trash asks.
const sessions = vi.hoisted(() => ({ views: [] as { projectId: string; nodeId: string; state: string }[] }))
vi.mock('../../src/main/agent/app-node-sessions', () => ({
  sharedNodeSessions: () => ({ list: (projectId: string) => sessions.views.filter((view) => view.projectId === projectId) }),
}))

type Listener = (event: IpcMainInvokeEvent, input: unknown) => unknown

let scratch: string
let dataDir: string
let repo: string
let claudeHome: string
let handlers: Map<string, Listener>
let layout: LayoutStore

/** Loads src/main/ipc/trash.ts afresh, as an app start does, over the current data dir. */
async function start(): Promise<void> {
  // The Layout store of the start before this one may still hold its last change back. It is
  // written now: left to its timer, it was written a quarter of a second later into whatever data
  // folder a test had by then, and made the folder of a finished test again (seen with the test of
  // worfy-windows ticket 44 in this file: one worfy-trash-* folder left in the temporary folder).
  ;(layout as LayoutStore | undefined)?.flushAll()
  vi.resetModules()
  process.env.WORFY_DATA_DIR = dataDir
  process.env.WORFY_CLAUDE_HOME = claudeHome
  const { registerIpc, appUrlMatcher } = await import('../../src/main/ipc/index')
  handlers = new Map()
  await registerIpc(
    { handle: (channel, listener) => handlers.set(channel, listener as Listener) },
    {
      modules: { './trash.ts': () => import('../../src/main/ipc/trash').then((module) => module.default) },
      isTrustedSender: appUrlMatcher({ indexHtml: INDEX_HTML }),
    },
  )
  layout = (await import('../../src/main/layout/store')).layoutStore()
}

async function call(channel: string, input?: unknown): Promise<IpcResult<unknown>> {
  const listener = handlers.get(IPC_CHANNEL_PREFIX + channel)
  if (!listener) throw new Error(`no handler for ${channel}`)
  const event = { senderFrame: { url: APP_URL }, sender: {} } as unknown as IpcMainInvokeEvent
  return (await listener(event, input)) as IpcResult<unknown>
}

async function value<T>(channel: string, input?: unknown): Promise<T> {
  const result = await call(channel, input)
  if (!result.ok) throw new Error(`${channel} failed: ${result.error}`)
  return result.value as T
}

const put = (nodeId: string) => value<TrashEntry>('trash.put', { projectId: PROJECT, nodeId })
const restore = (label: string) => value<TrashEntry>('trash.restore', { projectId: PROJECT, label })
const list = async () => (await value<{ entries: TrashEntry[] }>('trash.list', { projectId: PROJECT })).entries

const projectDir = () => join(dataDir, PROJECT)
const cardDir = (cardId: string) => join(projectDir(), 'cards', cardId)
const cardDataFile = (cardId: string) => join(projectDir(), 'card-data', `${cardId}.json`)
const trashDir = () => join(projectDir(), 'trash')
const nodeOf = (id: string): LayoutNode | undefined => layout.get(PROJECT).layout.nodes.find((node) => node.id === id)
const create = (node: Record<string, unknown>) => layout.apply(PROJECT, { op: 'create', node } as LayoutOpInput)

/** A script for a child node: opens the file it is given, says so on stdout, closes it after the given ms. */
const HOLD_OPEN = `const fs = require('node:fs'); const fd = fs.openSync(process.argv[1], 'r'); process.stdout.write('open\\n'); setTimeout(() => fs.closeSync(fd), Number(process.argv[2]))`

/** A Card with two files and stored data, and its Node with tags and a place of its own. */
function makeCard(cardId: string, nodeExtra: Record<string, unknown> = {}): void {
  mkdirSync(join(cardDir(cardId), 'assets'), { recursive: true })
  writeFileSync(join(cardDir(cardId), 'index.html'), `<title>Card ${cardId}</title><p>hello</p>`)
  writeFileSync(join(cardDir(cardId), 'assets', 'app.js'), 'console.log(1)')
  mkdirSync(join(projectDir(), 'card-data'), { recursive: true })
  writeFileSync(cardDataFile(cardId), JSON.stringify({ count: 7, items: ['a', 'b'] }))
  create({ id: cardId, kind: 'card', x: 40, y: -30, w: 360, h: 280, tags: ['keep'], ...nodeExtra })
}

/** Every file under `dir` with its mtime and content, to prove a call left the folder as it was. */
function snapshot(dir: string): Record<string, string> {
  const result: Record<string, string> = {}
  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name)
      if (entry.isDirectory()) walk(path)
      else result[relative(dir, path)] = `${statSync(path).mtimeMs} ${readFileSync(path, 'utf8')}`
    }
    result[`${relative(dir, current)}/`] = String(statSync(current).mtimeMs)
  }
  walk(dir)
  return result
}

beforeEach(async () => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-trash-')))
  dataDir = join(scratch, 'data')
  repo = join(scratch, 'repo')
  claudeHome = join(scratch, 'claude')
  // A repository and a Claude home with files whose names a careless path join could reach.
  mkdirSync(join(repo, 'cards', 'c1'), { recursive: true })
  writeFileSync(join(repo, 'cards', 'c1', 'index.html'), 'repository file')
  writeFileSync(join(repo, 'README.md'), 'repo')
  mkdirSync(join(claudeHome, 'projects', 'x'), { recursive: true })
  writeFileSync(join(claudeHome, 'projects', 'x', 's.jsonl'), '{}\n')
  const old = new Date('2026-01-01T00:00:00Z')
  for (const path of [join(repo, 'cards', 'c1', 'index.html'), join(repo, 'README.md'), join(claudeHome, 'projects', 'x', 's.jsonl')]) utimesSync(path, old, old)
  mkdirSync(projectDir(), { recursive: true })
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT, name: 'demo', path: repo }], activeId: PROJECT }))
  electron.sent.length = 0
  sessions.views = []
  await start()
})

afterEach(async () => {
  vi.useRealTimers()
  // Before the folder goes: the Layout store saves a moment after the last change, and a save
  // that came after the removal made the folder again.
  await saveLayoutNow()
  delete process.env.WORFY_DATA_DIR
  delete process.env.WORFY_CLAUDE_HOME
  removeTestTree(scratch)
})

describe('trash: a Card and its data', () => {
  it('a deleted Card is restored from the trash with its files, its data and its Node as they were', async () => {
    makeCard('c1')
    const before = nodeOf('c1')
    const files = snapshot(cardDir('c1'))

    const entry = await put('c1')
    expect(entry).toMatchObject({ nodeId: 'c1', kind: 'card', title: 'Card c1', hasFiles: true })
    // Gone from the Canvas and from the Card folders, kept in the Project's trash.
    expect(nodeOf('c1')).toBeUndefined()
    expect(existsSync(cardDir('c1'))).toBe(false)
    expect(existsSync(cardDataFile('c1'))).toBe(false)
    expect(readdirSync(trashDir())).toEqual([entry.label])
    expect(await list()).toEqual([entry])

    const restored = await restore(entry.label)
    expect(restored).toEqual(entry)
    expect(nodeOf('c1')).toEqual(before)
    expect(readFileSync(join(cardDir('c1'), 'index.html'), 'utf8')).toBe('<title>Card c1</title><p>hello</p>')
    expect(readFileSync(join(cardDir('c1'), 'assets', 'app.js'), 'utf8')).toBe('console.log(1)')
    expect(JSON.parse(readFileSync(cardDataFile('c1'), 'utf8'))).toEqual({ count: 7, items: ['a', 'b'] })
    expect(Object.keys(snapshot(cardDir('c1'))).sort()).toEqual(Object.keys(files).sort())
    // The entry is used up.
    expect(readdirSync(trashDir())).toEqual([])
    expect(await list()).toEqual([])
  })

  // Windows refuses to move a folder while another process has a file in it open (EPERM), and an
  // antivirus, the indexer or the Card's own page being read again holds one for a moment. The
  // Delete key right after a Restore met that on the GitHub runner (trash-undo.spec.ts).
  it.runIf(process.platform === 'win32')('a Card whose file another process holds open for a moment is still deleted', async () => {
    makeCard('c1')
    const holder = spawn(scriptNode(), ['-e', HOLD_OPEN, join(cardDir('c1'), 'index.html'), '250'], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['ignore', 'pipe', 'inherit'] })
    const exited = new Promise((resolve) => holder.once('exit', resolve))
    await new Promise<void>((resolve, reject) => {
      holder.stdout.once('data', () => resolve())
      holder.once('exit', (code) => reject(new Error(`the holder exited with ${code} before it opened the file`)))
    })

    const entry = await put('c1')
    await exited
    expect(entry).toMatchObject({ nodeId: 'c1', hasFiles: true })
    expect(nodeOf('c1')).toBeUndefined()
    expect(existsSync(cardDir('c1'))).toBe(false)
    expect(readdirSync(trashDir())).toEqual([entry.label])
  })

  it('a Node showing a Card under another id (data.cardId) takes that Card along', async () => {
    makeCard('c2', { id: 'node-of-c2', data: { cardId: 'c2' } })
    const entry = await put('node-of-c2')
    expect(entry.hasFiles).toBe(true)
    expect(existsSync(cardDir('c2'))).toBe(false)
    await restore(entry.label)
    expect(existsSync(join(cardDir('c2'), 'index.html'))).toBe(true)
    expect(nodeOf('node-of-c2')?.data).toEqual({ cardId: 'c2' })
  })

  it('a Card still shown by another Node keeps its files; only the deleted Node goes to the trash', async () => {
    makeCard('c3')
    create({ id: 'second', kind: 'card', x: 0, y: 0, w: 360, h: 280, data: { cardId: 'c3' } })
    const entry = await put('second')
    expect(entry.hasFiles).toBe(false)
    expect(existsSync(join(cardDir('c3'), 'index.html'))).toBe(true)
    expect(existsSync(cardDataFile('c3'))).toBe(true)
    expect(nodeOf('c3')).toBeDefined()
    expect(nodeOf('second')).toBeUndefined()
  })

  it('a Card without files or data goes to the trash as a Node alone', async () => {
    create({ id: 'empty', kind: 'card', x: 0, y: 0, w: 360, h: 280 })
    const entry = await put('empty')
    expect(entry).toMatchObject({ hasFiles: false, title: null })
    await restore(entry.label)
    expect(nodeOf('empty')).toBeDefined()
    expect(existsSync(cardDir('empty'))).toBe(false)
  })

  it('a note keeps its text in the trash and comes back with it', async () => {
    create({ id: 'n1', kind: 'note', x: 5, y: 6, w: 220, h: 120, data: { text: 'first line\nsecond' } })
    const entry = await put('n1')
    expect(entry).toMatchObject({ kind: 'note', title: 'first line', hasFiles: false })
    await restore(entry.label)
    expect(nodeOf('n1')).toMatchObject({ x: 5, y: 6, data: { text: 'first line\nsecond' } })
  })

  it('lists the newest entry first and tells every window when the trash changes', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-05T10:00:00Z'))
    create({ id: 'a', kind: 'note', x: 0, y: 0, w: 220, h: 120 })
    create({ id: 'b', kind: 'note', x: 0, y: 0, w: 220, h: 120 })
    await put('a')
    vi.setSystemTime(new Date('2026-10-05T10:00:05Z'))
    await put('b')
    expect((await list()).map((entry) => entry.nodeId)).toEqual(['b', 'a'])
    const notices = electron.sent.filter((message) => message.channel === `${IPC_CHANNEL_PREFIX}trash.changed`)
    expect(notices.map((message) => message.payload)).toEqual([{ projectId: PROJECT }, { projectId: PROJECT }])
  })
})

describe('trash: what cannot be deleted', () => {
  it('the Orchestrator, a HANDOFF Node, Tickets, Epic frames and a running Session are refused, and nothing moves', async () => {
    create({ id: 'orch', kind: 'orchestrator', x: 0, y: 0, w: 400, h: 300, locked: true })
    create({ id: 'handoff', kind: 'handoff', x: 0, y: 0, w: 400, h: 300, locked: true })
    create({ id: 'epic:alpha', kind: 'epic-frame', x: 0, y: 0, w: 1, h: 1, locked: true })
    create({ id: 'ticket-state', kind: 'ticket', x: 0, y: 0, w: 1, h: 1 })
    create({ id: 'locked-note', kind: 'note', x: 0, y: 0, w: 220, h: 120, locked: true })
    create({ id: 'live', kind: 'session', x: 0, y: 0, w: 300, h: 120, data: { origin: 'worfy', sessionId: 's1' } })
    sessions.views = [{ projectId: PROJECT, nodeId: 'live', state: 'busy' }]
    const before = layout.get(PROJECT).layout

    for (const nodeId of ['orch', 'handoff', 'epic:alpha', 'ticket-state', 'locked-note', 'live', 'ticket:alpha/3', 'missing']) {
      const result = await call('trash.put', { projectId: PROJECT, nodeId })
      expect(result.ok, nodeId).toBe(false)
    }
    const refused = await call('trash.put', { projectId: PROJECT, nodeId: 'live' })
    expect(refused).toMatchObject({ ok: false, error: expect.stringContaining('Session') })
    expect(layout.get(PROJECT).layout).toEqual(before)
    expect(existsSync(trashDir()) ? readdirSync(trashDir()) : []).toEqual([])
  })

  it('a Session Node whose Session is closed, or that shows a Session started outside worfy, is deleted; the Session is not touched', async () => {
    create({ id: 'closed', kind: 'session', x: 0, y: 0, w: 300, h: 120, data: { origin: 'worfy', sessionId: 's1' } })
    create({ id: 'external', kind: 'session', x: 0, y: 0, w: 300, h: 120, data: { sessionId: 's2' } })
    sessions.views = [{ projectId: PROJECT, nodeId: 'closed', state: 'closed' }]
    await put('closed')
    await put('external')
    expect(nodeOf('closed')).toBeUndefined()
    expect(nodeOf('external')).toBeUndefined()
  })

  it('restore is refused while the Node id or the Card id is taken again, and the entry stays', async () => {
    makeCard('c4')
    const entry = await put('c4')
    // A new Card with the same id was written meanwhile.
    mkdirSync(cardDir('c4'), { recursive: true })
    writeFileSync(join(cardDir('c4'), 'index.html'), 'newer')
    expect(await call('trash.restore', { projectId: PROJECT, label: entry.label })).toMatchObject({ ok: false })
    expect(readFileSync(join(cardDir('c4'), 'index.html'), 'utf8')).toBe('newer')
    expect(nodeOf('c4')).toBeUndefined()
    expect(await list()).toEqual([entry])

    removeTestTree(cardDir('c4'))
    create({ id: 'c4', kind: 'note', x: 0, y: 0, w: 220, h: 120 })
    expect(await call('trash.restore', { projectId: PROJECT, label: entry.label })).toMatchObject({ ok: false })
    expect(existsSync(cardDir('c4'))).toBe(false)
    expect(await list()).toEqual([entry])
  })
})

describe('trash: the IPC boundary', () => {
  it('refuses inputs of the wrong type and labels that name another folder', async () => {
    create({ id: 'n', kind: 'note', x: 0, y: 0, w: 220, h: 120 })
    for (const input of [{ projectId: PROJECT, nodeId: 7 }, { projectId: PROJECT }, { projectId: 1, nodeId: 'n' }]) {
      expect(await call('trash.put', input)).toMatchObject({ ok: false, error: expect.stringContaining('invalid input') })
    }
    for (const label of ['..', '../cards', '1-abc', '123-0123456789', 'cards', '1700000000000-0123abcd/..']) {
      expect(await call('trash.restore', { projectId: PROJECT, label })).toMatchObject({ ok: false, error: expect.stringContaining('invalid input') })
    }
    expect(nodeOf('n')).toBeDefined()
  })

  it('answers with the declared keys only: the stored Node and file paths stay in main', async () => {
    makeCard('c5')
    const result = await call('trash.put', { projectId: PROJECT, nodeId: 'c5', extra: 'ignored' })
    expect(result.ok).toBe(true)
    const entry = (result as { value: Record<string, unknown> }).value
    expect(Object.keys(entry).sort()).toEqual(['hasFiles', 'kind', 'label', 'nodeId', 'title', 'trashedAt'])
    const { entries } = await value<{ entries: Record<string, unknown>[] }>('trash.list', { projectId: PROJECT })
    expect(Object.keys(entries[0] ?? {}).sort()).toEqual(['hasFiles', 'kind', 'label', 'nodeId', 'title', 'trashedAt'])
  })
})

describe('trash: three days', () => {
  it('entries older than three days are deleted when the app starts, younger ones stay', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const now = new Date('2026-10-05T12:00:00Z').getTime()
    vi.setSystemTime(now - TRASH_KEEP_MS - 1000)
    makeCard('old')
    const old = await put('old')
    vi.setSystemTime(now - TRASH_KEEP_MS + 60_000)
    create({ id: 'young', kind: 'note', x: 0, y: 0, w: 220, h: 120 })
    const young = await put('young')
    expect(readdirSync(trashDir()).sort()).toEqual([old.label, young.label].sort())

    // The app starts again three days later.
    vi.setSystemTime(now)
    await start()
    await vi.waitFor(() => expect(readdirSync(trashDir())).toEqual([young.label]))
    expect((await list()).map((entry) => entry.nodeId)).toEqual(['young'])
    // The old Card's files are gone with its entry, and were never put back.
    expect(existsSync(cardDir('old'))).toBe(false)
    expect(existsSync(cardDataFile('old'))).toBe(false)
  })

  // worfy-windows ticket 44. The first entry whose removal failed ended the cleanup of its Project,
  // and the entries after it stayed. Here the removal of one entry is refused by a folder in its
  // Card that cannot be listed: off Windows a tree is looked through before anything of it is
  // removed, and what cannot be looked at ends the removal with nothing removed. (A volume mounted
  // in a Card folder is refused the same way; test/unit/trash-mounted.test.ts has it over a model.)
  // Not on Windows, where a mode keeps nobody out; not for root, whom no mode keeps out.
  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)('an old entry that cannot be removed stays whole and is named; the other old entries are deleted all the same', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const now = new Date('2026-10-05T12:00:00Z').getTime()
    const entries: TrashEntry[] = []
    for (const [index, cardId] of ['before', 'held', 'after'].entries()) {
      vi.setSystemTime(now - TRASH_KEEP_MS - 60_000 + index * 1000)
      makeCard(cardId)
      entries.push(await put(cardId))
    }
    const [before, held, after] = entries as [TrashEntry, TrashEntry, TrashEntry]
    const closed = join(trashDir(), held.label, 'card', 'closed')
    mkdirSync(closed)
    writeFileSync(join(closed, 'inner.txt'), 'x')
    chmodSync(closed, 0o000)
    const said = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      vi.setSystemTime(now)
      electron.sent.length = 0
      await start()
      await vi.waitFor(() => expect(readdirSync(trashDir())).toEqual([held.label]))
      // Every window is told once that the trash of the Project changed: two entries went, one
      // stayed (worfy-windows ticket 47; a refusal does not keep the notice from the others).
      const notices = electron.sent.filter((message) => message.channel === `${IPC_CHANNEL_PREFIX}trash.changed`)
      expect(notices.map((message) => message.payload)).toEqual([{ projectId: PROJECT }])
      expect(existsSync(join(trashDir(), before.label))).toBe(false)
      expect(existsSync(join(trashDir(), after.label))).toBe(false)
      // Nothing of the entry is gone: it is still listed, and can still be restored.
      expect(readdirSync(join(trashDir(), held.label)).sort()).toEqual(['card', 'card-data.json', 'entry.json'])
      expect(readdirSync(join(trashDir(), held.label, 'card')).sort()).toEqual(['assets', 'closed', 'index.html'])
      expect((await list()).map((entry) => entry.nodeId)).toEqual(['held'])
      // Named by every start of the application, and by nothing else. The start of beforeEach has
      // its cleanup still waiting when this test begins, so here it may be named twice.
      expect(said.mock.calls.length).toBeGreaterThan(0)
      for (const call of said.mock.calls) {
        expect(call).toEqual([`[trash] could not delete entry ${held.label} from the trash of ${PROJECT}; it is left there`, expect.objectContaining({ code: 'EACCES', path: closed })])
      }
    } finally {
      said.mockRestore()
      chmodSync(closed, 0o755)
    }
    // And restored it is: the Card comes back with everything it held, and the entry is gone.
    await restore(held.label)
    expect(readdirSync(cardDir('held')).sort()).toEqual(['assets', 'closed', 'index.html'])
    expect(readFileSync(join(cardDir('held'), 'closed', 'inner.txt'), 'utf8')).toBe('x')
    expect(readFileSync(join(cardDir('held'), 'index.html'), 'utf8')).toBe('<title>Card held</title><p>hello</p>')
    expect(existsSync(cardDataFile('held'))).toBe(true)
    expect(nodeOf('held')).toMatchObject({ id: 'held', kind: 'card' })
    expect(readdirSync(trashDir())).toEqual([])
    expect(await list()).toEqual([])
  })

  it('a stray file or folder in the trash that is not an entry is left alone', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    // A real old entry next to the strays: its going away shows that the cleanup has run.
    create({ id: 'old', kind: 'note', x: 0, y: 0, w: 220, h: 120 })
    const old = await put('old')
    mkdirSync(join(trashDir(), 'not-an-entry'), { recursive: true })
    writeFileSync(join(trashDir(), 'notes.txt'), 'x')
    expect(readdirSync(trashDir()).sort()).toEqual([old.label, 'not-an-entry', 'notes.txt'].sort())
    vi.setSystemTime(Date.now() + 10 * DAY)
    await start()
    await vi.waitFor(() => expect(existsSync(join(trashDir(), old.label))).toBe(false))
    expect(await list()).toEqual([])
    expect(readdirSync(trashDir()).sort()).toEqual(['not-an-entry', 'notes.txt'])
  })
})

describe('trash: only WORFY_DATA_DIR', () => {
  it('delete, restore and the start-up cleanup leave the repository and the Claude home as they were', async () => {
    const repoBefore = snapshot(repo)
    const claudeBefore = snapshot(claudeHome)
    vi.useFakeTimers({ toFake: ['Date'] })
    makeCard('c1')
    create({ id: 'n', kind: 'note', x: 0, y: 0, w: 220, h: 120 })
    const card = await put('c1')
    await put('n')
    await restore(card.label)
    await put('c1')
    vi.setSystemTime(Date.now() + 4 * DAY)
    await start()
    await vi.waitFor(async () => expect(await list()).toEqual([]))
    layout.flushAll()
    expect(snapshot(repo)).toEqual(repoBefore)
    expect(snapshot(claudeHome)).toEqual(claudeBefore)
  })
})
