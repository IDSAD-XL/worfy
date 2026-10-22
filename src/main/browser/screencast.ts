// The frames of Live Browsers for the screens that do not draw their page (ADR-0078 items 9 and 16,
// worfy-browser ticket 07): another window of this Machine, or a window of a Linked machine with full
// access. A screen that shows a Browser's frame without its page watches it (`browser.frames.watch`,
// src/shared/ipc/browser.ts); while at least one screen watches and the Browser has a page, main runs
// CDP `Page.startScreencast` on that page and sends each `Page.screencastFrame` to every watching
// client, and to no one else (`browser.frame` is `project` and `write`: a read-only Linked machine
// neither watches nor gets a frame, ADR-0078 item 14). Once the last watcher stops, its connection
// closes or its window goes, the screencast stops; it starts again on the next page of the Browser —
// a wake, a move to another window — as long as somebody watches.
//
// The frames are JPEGs of at most FRAME_OPTIONS.maxWidth × maxHeight at quality FRAME_OPTIONS.quality,
// at most one per FRAME_OPTIONS.frameMs: Chromium sends the next frame only after the last one is
// acknowledged, and only when the page changed (the answer to question 3 of the ticket, taken
// without the owner). The same rate goes to a Linked machine over the network.
//
// A watch lasts FRAMES_WATCH_MS unless the screen renews it (src/renderer/browser/frames.ts renews it
// every BROWSER_SCREEN_RENEW_MS and ends it on `pagehide`): the windows of a Linked machine share one
// connection, and a window reloaded here takes a new screen id, so neither the end of a client nor
// the window's own cleanup tells main of every screen that went. A screencast that ended by itself
// — the debugger detached (DevTools), an acknowledgement failed — or could not start is dropped and
// started again on the next sync: a new page, a watch or its renewal.
import type { CdpPage, ScreencastFrame, ScreencastOptions } from './cdp'
import { liveBrowsers } from './live'
import { LINKED_SCREEN_MS } from './sleep'
import { ClientHolders, type Client, type ClientId } from '../clients'
import { emit } from '../ipc'
import { browserFrame } from '../../shared/ipc/browser'

/** What the screencast asks of Chromium. */
export const FRAME_OPTIONS: ScreencastOptions = { maxWidth: 1280, maxHeight: 1280, quality: 60, frameMs: 100 }

/** How long a watch lasts without a renewal: as long as a Linked machine's screen report counts. */
export const FRAMES_WATCH_MS = LINKED_SCREEN_MS

export interface ScreencastDeps {
  /** The page of Browser `nodeId` while it is Live and drawn by a window here. */
  pageOf(projectId: string, nodeId: string): CdpPage | undefined
  /** Subscribes to every new page of a Browser (src/main/browser/live.ts); returns the unsubscribe. */
  onPage(listener: (projectId: string, nodeId: string) => void): () => void
  /** Sends one frame of Browser `nodeId` to `client`. */
  send(client: Client, projectId: string, nodeId: string, frame: ScreencastFrame): void
  options?: ScreencastOptions
}

const keyOf = (projectId: string, nodeId: string): string => `${projectId}\n${nodeId}`

interface Stream {
  page: CdpPage
  /** The stop of the screencast once it started; null when it could not start. */
  stop: Promise<(() => Promise<void>) | null>
}

interface Watcher {
  client: Client
  /** Ends the watch when the screen does not renew it in time. */
  expiry: ReturnType<typeof setTimeout>
}

export class Screencasts {
  /** The watchers of each Browser: `<client id> <screen>` → the client and the end of its watch. */
  private readonly watchers = new Map<string, Map<string, Watcher>>()
  private readonly streams = new Map<string, Stream>()
  /** The clients whose `destroyed` ends their watches. */
  private readonly holders = new ClientHolders((id) => this.leave(id))
  /** The pages whose `destroyed` main already listens for. */
  private readonly closing = new WeakSet<CdpPage>()
  /** Every start and stop of each Browser's screencast, one after another. */
  private readonly chains = new Map<string, Promise<void>>()
  private readonly unsubscribe: () => void

  constructor(private readonly deps: ScreencastDeps) {
    this.unsubscribe = deps.onPage((projectId, nodeId) => this.sync(projectId, nodeId))
  }

  /**
   * Screen `screen` of `client` starts (`on`) or stops showing the frames of Browser `nodeId`. A
   * watch lasts FRAMES_WATCH_MS from its last call with `on`.
   */
  watch(client: Client, screen: string, projectId: string, nodeId: string, on: boolean): Promise<void> {
    const key = keyOf(projectId, nodeId)
    const id = `${String(client.id)} ${screen}`
    const watchers = this.watchers.get(key) ?? new Map<string, Watcher>()
    const before = watchers.get(id)
    if (before !== undefined) clearTimeout(before.expiry)
    if (on && this.holders.hold(client)) {
      const expiry = setTimeout(() => {
        if (this.watchers.get(key)?.get(id)?.expiry !== expiry) return
        void this.watch(client, screen, projectId, nodeId, false)
      }, FRAMES_WATCH_MS)
      expiry.unref?.()
      watchers.set(id, { client, expiry })
      this.watchers.set(key, watchers)
    } else {
      watchers.delete(id)
      if (watchers.size === 0) this.watchers.delete(key)
    }
    return this.sync(projectId, nodeId)
  }

  /** How many screens watch Browser `nodeId`. */
  watching(projectId: string, nodeId: string): number {
    return this.watchers.get(keyOf(projectId, nodeId))?.size ?? 0
  }

  /** Client `id` went: none of its screens watches any more. */
  private leave(id: ClientId): void {
    for (const [key, watchers] of [...this.watchers]) {
      let left = false
      for (const [watcher, each] of [...watchers]) {
        if (each.client.id !== id) continue
        clearTimeout(each.expiry)
        watchers.delete(watcher)
        left = true
      }
      if (!left) continue
      if (watchers.size === 0) this.watchers.delete(key)
      const [projectId = '', nodeId = ''] = key.split('\n')
      void this.sync(projectId, nodeId)
    }
  }

  /** Brings the screencast of Browser `nodeId` up to its watchers and its page, after every change queued before. */
  sync(projectId: string, nodeId: string): Promise<void> {
    const key = keyOf(projectId, nodeId)
    const run = (this.chains.get(key) ?? Promise.resolve()).then(() => this.syncNow(projectId, nodeId))
    const chained = run.catch((error: unknown) => console.warn(`Browser ${nodeId}: its frames could not be started or stopped`, error))
    this.chains.set(key, chained)
    void chained.then(() => {
      if (this.chains.get(key) === chained) this.chains.delete(key)
    })
    return chained
  }

  private async syncNow(projectId: string, nodeId: string): Promise<void> {
    const key = keyOf(projectId, nodeId)
    const page = (this.watchers.get(key)?.size ?? 0) > 0 ? this.deps.pageOf(projectId, nodeId) : undefined
    const stream = this.streams.get(key)
    if (stream !== undefined && stream.page === page && !stream.page.contents.isDestroyed()) return
    if (stream !== undefined) {
      this.streams.delete(key)
      const stop = await stream.stop
      await stop?.().catch((error: unknown) => console.warn(`Browser ${nodeId}: its screencast could not be stopped`, error))
    }
    if (page === undefined) return
    const next: Stream = { page, stop: Promise.resolve(null) }
    const ended = () => {
      // Chromium sends no more frames of it: started again while somebody watches.
      if (this.streams.get(key) !== next) return
      this.streams.delete(key)
      void this.sync(projectId, nodeId)
    }
    next.stop = page.screencast((frame) => this.deliver(key, projectId, nodeId, frame), this.deps.options ?? FRAME_OPTIONS, ended).catch((error: unknown) => {
      console.warn(`Browser ${nodeId}: its screencast could not start`, error)
      return null
    })
    this.streams.set(key, next)
    if (!this.closing.has(page)) {
      this.closing.add(page)
      // A page closed while the screencast started, or after, is dropped on its next sync.
      page.contents.once('destroyed', () => void this.sync(projectId, nodeId))
    }
    // One that could not start is not kept: the next sync — a watch, its renewal, a new page — tries again.
    if ((await next.stop) === null && this.streams.get(key) === next) this.streams.delete(key)
  }

  private deliver(key: string, projectId: string, nodeId: string, frame: ScreencastFrame): void {
    const clients = new Set([...(this.watchers.get(key)?.values() ?? [])].map((watcher) => watcher.client))
    for (const client of clients) {
      if (client.isDestroyed()) continue
      try {
        this.deps.send(client, projectId, nodeId, frame)
      } catch (error) {
        console.warn(`Browser ${nodeId}: a frame could not be sent to client ${String(client.id)}`, error)
      }
    }
  }

  /** The app quits. */
  stop(): void {
    this.unsubscribe()
    for (const watchers of this.watchers.values()) for (const watcher of watchers.values()) clearTimeout(watcher.expiry)
  }
}

let shared: Screencasts | undefined

/** The frames of the running app: the pages of its Live Browsers, each frame as a `browser.frame` event. */
export function browserScreencasts(): Screencasts {
  shared ??= new Screencasts({
    pageOf: (projectId, nodeId) => liveBrowsers().page(projectId, nodeId),
    onPage: (listener) => liveBrowsers().onPage(listener),
    send: (client, projectId, nodeId, frame) => emit(client, browserFrame, { projectId, nodeId, ...frame }),
  })
  return shared
}
