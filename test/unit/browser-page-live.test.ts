// `browser.page.live` (src/main/ipc/browser.ts, worfy-browser ticket 04): main takes the page of a
// Browser only from the window that draws it — a guest of a <webview> whose embedder is the caller.
// A web contents of another window, one that is not a <webview>'s guest, or one already closed is
// never registered, so no window hands main a page a Session would then drive.
import { describe, expect, it, vi } from 'vitest'
import { browserPageLive } from '../../src/shared/ipc/browser'

interface FakeContents {
  id: number
  type: string
  host: object | null
  destroyed?: boolean
}

const fake = vi.hoisted(() => ({ contents: new Map<number, unknown>(), registered: [] as [string, string, number][] }))

vi.mock('electron', () => ({
  app: { on: () => undefined, isPackaged: false, getAppPath: () => '/nowhere' },
  BrowserWindow: { getAllWindows: () => [], fromWebContents: () => null },
  webContents: { fromId: (id: number) => fake.contents.get(id) },
}))
vi.mock('../../src/main/browser/live', () => ({
  liveBrowsers: () => ({
    register: (projectId: string, nodeId: string, contents: { id: number }) => fake.registered.push([projectId, nodeId, contents.id]),
  }),
}))

function guest({ id, type, host, destroyed = false }: FakeContents): void {
  fake.contents.set(id, { id, getType: () => type, hostWebContents: host, isDestroyed: () => destroyed })
}

async function live(webContentsId: number, sender: object): Promise<unknown> {
  const handlers = (await import('../../src/main/ipc/browser')).default
  const handler = handlers.find((each) => each.channel === browserPageLive)!
  return handler.handle({ projectId: 'demo-0a1b2c3d', nodeId: 'browser-1', webContentsId } as never, { event: { sender } as never })
}

describe('browser.page.live', () => {
  const window = { name: 'this window' }
  const other = { name: 'another window' }
  guest({ id: 1, type: 'webview', host: window })
  guest({ id: 2, type: 'webview', host: other })
  guest({ id: 3, type: 'window', host: window })
  guest({ id: 4, type: 'webview', host: window, destroyed: true })
  guest({ id: 5, type: 'webview', host: null })

  it("takes the guest of a <webview> of the caller's own window", async () => {
    fake.registered = []
    expect(await live(1, window)).toEqual({ live: true })
    expect(fake.registered).toEqual([['demo-0a1b2c3d', 'browser-1', 1]])
  })

  it('takes nothing of another window, nothing that is not a guest, nothing closed or unknown', async () => {
    fake.registered = []
    for (const id of [2, 3, 4, 5, 99]) expect(await live(id, window), `web contents ${id}`).toEqual({ live: false })
    // The caller's own window is no Browser's page either.
    guest({ id: 6, type: 'webview', host: window })
    expect(await live(6, other)).toEqual({ live: false })
    expect(fake.registered).toEqual([])
  })
})
