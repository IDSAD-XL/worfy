// `browser.page.live` (src/main/ipc/browser.ts, worfy-browser ticket 04): main takes the page of a
// Browser only from the window that draws it — a guest of a <webview> whose embedder is the caller.
// A web contents of another window, one that is not a <webview>'s guest, or one already closed is
// never registered, so no window hands main a page a Session would then drive. Nor is a guest on the
// partition of another Browser profile or Project: its page holds other logins.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { browserPageLive } from '../../src/shared/ipc/browser'

interface FakeContents {
  id: number
  type: string
  host: object | null
  destroyed?: boolean
  /** The partition of the guest's session; that of the Browser's profile unless said. */
  partition?: string
}

const PROJECT = 'demo-0a1b2c3d'
const ADMIN = 'persist:worfy-browser-0a1b2c3d-admin'

const fake = vi.hoisted(() => ({
  contents: new Map<number, unknown>(),
  registered: [] as [string, string, number][],
  /** The Session object of each partition: Electron answers the same one for a partition every time. */
  sessions: new Map<string, object>(),
  nodes: [] as { id: string; kind: string; data: Record<string, unknown> }[],
  profiles: [] as { id: string }[],
}))
const sessionOf = (partition: string): object => {
  const known = fake.sessions.get(partition) ?? { partition }
  fake.sessions.set(partition, known)
  return known
}

vi.mock('electron', () => ({
  app: { on: () => undefined, isPackaged: false, getAppPath: () => '/nowhere' },
  BrowserWindow: { getAllWindows: () => [], fromWebContents: () => null },
  webContents: { fromId: (id: number) => fake.contents.get(id) },
  session: { fromPartition: (partition: string) => sessionOf(partition) },
}))
vi.mock('../../src/main/layout/store', () => ({ layoutStore: () => ({ get: () => ({ layout: { nodes: fake.nodes } }) }) }))
vi.mock('../../src/main/browser/profiles', () => ({ browserProfileStore: () => ({ list: () => fake.profiles }) }))
vi.mock('../../src/main/browser/live', () => ({
  liveBrowsers: () => ({
    register: (projectId: string, nodeId: string, contents: { id: number }) => fake.registered.push([projectId, nodeId, contents.id]),
  }),
}))

function guest({ id, type, host, destroyed = false, partition = ADMIN }: FakeContents): void {
  fake.contents.set(id, { id, getType: () => type, hostWebContents: host, isDestroyed: () => destroyed, session: sessionOf(partition) })
}

async function live(webContentsId: number, sender: object): Promise<unknown> {
  const handlers = (await import('../../src/main/ipc/browser')).default
  const handler = handlers.find((each) => each.channel === browserPageLive)!
  return handler.handle({ projectId: PROJECT, nodeId: 'browser-1', webContentsId } as never, { event: { sender } as never })
}

describe('browser.page.live', () => {
  const window = { name: 'this window' }
  const other = { name: 'another window' }
  guest({ id: 1, type: 'webview', host: window })
  guest({ id: 2, type: 'webview', host: other })
  guest({ id: 3, type: 'window', host: window })
  guest({ id: 4, type: 'webview', host: window, destroyed: true })
  guest({ id: 5, type: 'webview', host: null })
  beforeEach(() => {
    fake.registered = []
    fake.profiles = [{ id: 'admin' }, { id: 'staff' }]
    fake.nodes = [{ id: 'browser-1', kind: 'browser', data: { profile: 'admin' } }]
  })

  it("takes the guest of a <webview> of the caller's own window", async () => {
    fake.registered = []
    expect(await live(1, window)).toEqual({ live: true })
    expect(fake.registered).toEqual([[PROJECT, 'browser-1', 1]])
  })

  it('takes nothing of another window, nothing that is not a guest, nothing closed or unknown', async () => {
    fake.registered = []
    for (const id of [2, 3, 4, 5, 99]) expect(await live(id, window), `web contents ${id}`).toEqual({ live: false })
    // The caller's own window is no Browser's page either.
    guest({ id: 6, type: 'webview', host: window })
    expect(await live(6, other)).toEqual({ live: false })
    expect(fake.registered).toEqual([])
  })

  it("takes no guest on the partition of another profile of the Project, of another Project, or of the app", async () => {
    guest({ id: 7, type: 'webview', host: window, partition: 'persist:worfy-browser-0a1b2c3d-staff' })
    guest({ id: 8, type: 'webview', host: window, partition: 'persist:worfy-browser-9f9f9f9f-admin' })
    guest({ id: 9, type: 'webview', host: window, partition: '' })
    for (const id of [7, 8, 9]) expect(await live(id, window), `web contents ${id}`).toEqual({ live: false })
    expect(fake.registered).toEqual([])
  })

  it('takes a guest on any profile of the Project while the Node names none yet, and none for a Node that is no Browser here', async () => {
    guest({ id: 10, type: 'webview', host: window, partition: 'persist:worfy-browser-0a1b2c3d-staff' })
    // A Browser saved before profiles existed, and a new one the frame has not written its profile into yet.
    for (const data of [{}, { profile: null }]) {
      fake.nodes = [{ id: 'browser-1', kind: 'browser', data }]
      expect(await live(10, window)).toEqual({ live: true })
    }
    fake.profiles = [{ id: 'admin' }]
    expect(await live(10, window)).toEqual({ live: false })
    fake.profiles = [{ id: 'admin' }, { id: 'staff' }]
    for (const nodes of [[], [{ id: 'browser-1', kind: 'note', data: {} }]]) {
      fake.nodes = nodes
      expect(await live(1, window)).toEqual({ live: false })
    }
    expect(fake.registered).toEqual([
      [PROJECT, 'browser-1', 10],
      [PROJECT, 'browser-1', 10],
    ])
  })
})
