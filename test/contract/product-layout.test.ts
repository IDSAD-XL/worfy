// The channel `product.layout` (src/shared/ipc/product.ts, src/main/ipc/product.ts; worfy-product-session
// ticket 09): what the Mind map screen writes by hand, through registerIpc (the wrapper the app uses)
// against a real topic folder. It changes only `x`, `y` and `collapsed` of one node of mind-map.json, and
// through the one writer of the tools (MindMapWriter of src/main/mcp/mind-map-server.ts): the file is
// checked and written atomically; a refused change leaves it byte for byte. Any other field — `text`,
// `status`, `kind` — is refused by the channel's schema before main reads anything.
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IpcMainInvokeEvent } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNEL_PREFIX, type IpcResult } from '../../src/shared/ipc/channels'
import { productLayout } from '../../src/shared/ipc/product'
import { APP_URL, INDEX_HTML } from '../app-url'
import { removeTestTree } from '../remove'

const where = vi.hoisted(() => ({ root: '' }))
const update = vi.hoisted(() => ({ calls: 0 }))

vi.mock('electron', () => ({ app: { on: () => undefined, isPackaged: false, getAppPath: () => '/nowhere' }, BrowserWindow: { getAllWindows: () => [] } }))
vi.mock('../../src/main/projects/store', () => ({ projectStore: () => ({ get: () => ({ id: 'p1', path: where.root }) }) }))
// The Project's folders as docsSource answers them for a Full-mode Project: docs/product under its root.
vi.mock('../../src/main/ipc/docs', () => ({
  docsSource: () => Promise.resolve({ root: where.root, adrStatusLabel: undefined, productDir: ['docs', 'product'] }),
  docsHub: { topic: () => Promise.resolve(undefined) },
}))
// The real writer, counted: the screen's write goes through the tools' one writer, not a second path.
vi.mock('../../src/main/mcp/mind-map-server', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/main/mcp/mind-map-server')>()
  return {
    ...real,
    updateMindMap: (...args: Parameters<typeof real.updateMindMap>) => {
      update.calls += 1
      return real.updateMindMap(...args)
    },
  }
})

type Listener = (event: IpcMainInvokeEvent, input: unknown) => unknown

const FIXTURE = {
  version: 1,
  nodes: [
    { id: 'idea-1', kind: 'idea', text: 'Show the share of accepted advice', from: null, advice: true, message: 'msg-1' },
    { id: 'q-1', kind: 'question', text: 'Per Project or per topic?', from: 'idea-1' },
    { id: 'd-1', kind: 'decision', text: 'Per Project', from: 'q-1', status: 'accepted', reason: 'the owner reads one figure' },
  ],
}

let scratch: string
let mapFile: string
let handlers: Map<string, Listener>

async function call(input: unknown): Promise<IpcResult<unknown>> {
  const listener = handlers.get(`${IPC_CHANNEL_PREFIX}product.layout`)
  if (!listener) throw new Error('no handler for product.layout')
  const event = { senderFrame: { url: APP_URL }, sender: { id: 1 } } as unknown as IpcMainInvokeEvent
  return (await listener(event, input)) as IpcResult<unknown>
}

const read = (): typeof FIXTURE => JSON.parse(readFileSync(mapFile, 'utf8')) as typeof FIXTURE

beforeEach(async () => {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-product-layout-')))
  where.root = join(scratch, 'repo')
  const topicDir = join(where.root, 'docs', 'product', 'roadmap')
  mkdirSync(topicDir, { recursive: true })
  writeFileSync(join(topicDir, 'map.md'), '# Roadmap\n')
  mapFile = join(topicDir, 'mind-map.json')
  writeFileSync(mapFile, `${JSON.stringify(FIXTURE, null, 2)}\n`)
  update.calls = 0
  handlers = new Map()
  const { registerIpc, appUrlMatcher } = await import('../../src/main/ipc/index')
  const module = (await import('../../src/main/ipc/product')).default
  await registerIpc({ handle: (channel, listener) => handlers.set(channel, listener as Listener) }, { modules: { './product.ts': () => Promise.resolve(module) }, isTrustedSender: appUrlMatcher({ indexHtml: INDEX_HTML }) })
})

afterEach(() => removeTestTree(scratch))

describe('product.layout', () => {
  it('writes x and y of one node through the tools’ writer; every other field and node stays as it was', async () => {
    const result = await call({ projectId: 'p1', name: 'roadmap', id: 'q-1', x: 120, y: -40.5 })
    expect(result).toEqual({ ok: true, value: null })
    expect(update.calls).toBe(1)
    expect(read()).toEqual({ ...FIXTURE, nodes: [FIXTURE.nodes[0], { ...FIXTURE.nodes[1], x: 120, y: -40.5 }, FIXTURE.nodes[2]] })
  })

  it('folds a branch with collapsed: true and unfolds it with collapsed: false, which leaves no mark in the file', async () => {
    expect((await call({ projectId: 'p1', name: 'roadmap', id: 'idea-1', collapsed: true })).ok).toBe(true)
    expect(read().nodes[0]).toEqual({ ...FIXTURE.nodes[0], collapsed: true })
    expect((await call({ projectId: 'p1', name: 'roadmap', id: 'idea-1', collapsed: false })).ok).toBe(true)
    expect(read()).toEqual(FIXTURE)
  })

  it('refuses text, status or kind by its schema, before main reads anything: the file stays byte for byte', async () => {
    const before = readFileSync(mapFile)
    for (const extra of [{ text: 'Renamed by hand' }, { status: 'rejected' }, { kind: 'objection' }, { reason: 'because' }, { message: 'm' }]) {
      const input = { projectId: 'p1', name: 'roadmap', id: 'd-1', x: 1, y: 2, ...extra }
      expect(productLayout.input.safeParse(input).success).toBe(false)
      const result = await call(input)
      expect(result.ok).toBe(false)
    }
    expect(update.calls).toBe(0)
    expect(readFileSync(mapFile).equals(before)).toBe(true)
  })

  it('refuses x without y, a place that is no number, a change of nothing and a name that is no topic', () => {
    for (const input of [
      { projectId: 'p1', name: 'roadmap', id: 'q-1', x: 1 },
      { projectId: 'p1', name: 'roadmap', id: 'q-1', x: Number.POSITIVE_INFINITY, y: 1 },
      { projectId: 'p1', name: 'roadmap', id: 'q-1' },
      { projectId: 'p1', name: '../outside', id: 'q-1', collapsed: true },
      { projectId: 'p1', name: 'roadmap', id: 'ticket:01', collapsed: true },
    ]) {
      expect(productLayout.input.safeParse(input).success, JSON.stringify(input)).toBe(false)
    }
  })

  it('a node that is not in the file is refused with the reason, and the file stays byte for byte', async () => {
    const before = readFileSync(mapFile)
    const result = await call({ projectId: 'p1', name: 'roadmap', id: 'nowhere', x: 1, y: 2 })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/no node "nowhere"/)
    expect(readFileSync(mapFile).equals(before)).toBe(true)
  })

  it('a file with errors is not overwritten by a move: its errors are the answer', async () => {
    const broken = `${JSON.stringify({ version: 1, nodes: [{ ...FIXTURE.nodes[0] }, { ...FIXTURE.nodes[1], from: 'gone' }] }, null, 2)}\n`
    writeFileSync(mapFile, broken)
    const result = await call({ projectId: 'p1', name: 'roadmap', id: 'idea-1', x: 1, y: 2 })
    expect(result.ok).toBe(false)
    expect(readFileSync(mapFile, 'utf8')).toBe(broken)
  })
})
