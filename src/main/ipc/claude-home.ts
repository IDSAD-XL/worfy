// Handlers of the `claudeHome` domain (src/shared/ipc/claude-home.ts): Sessions of a Project read
// from the Claude home. Asking for a Project's Sessions also subscribes the asking window to
// `claudeHome.changed` for that Project; the subscription ends with `claudeHome.close` or with the
// window.
import { resolve } from 'node:path'
import { ClaudeHomeRegistry, type ClaudeHomeWatch } from '../claude-home/registry'
import { readNewLines } from '../claude-home/tail'
import { claudeHome } from '../storage/paths'
import { claudeHomeChanged, claudeHomeClose, claudeHomeLive, claudeHomeSessions, claudeHomeTranscript } from '../../shared/ipc/claude-home'
import { mainThreadEvents, parseTranscriptLines } from '../../shared/transcript/parse'
import { defineHandler, emit, type HandlerModule } from './index'

/** The part of a window's webContents the subscriptions use; tests pass a fake. */
export interface Subscriber {
  readonly id: number
  send(channel: string, ...args: unknown[]): void
  isDestroyed(): boolean
  once(event: 'destroyed', listener: () => void): unknown
}

/** Keeps one watcher per (window, Project) and forwards its changes to that window. */
export class ClaudeHomeSubscriptions {
  private readonly watches = new Map<string, Promise<ClaudeHomeWatch | undefined>>()
  private readonly subscribers = new Set<number>()

  constructor(private readonly registry: ClaudeHomeRegistry) {}

  /** Starts watching `projectRoot` for `subscriber` unless it already does or the window is gone. */
  async subscribe(subscriber: Subscriber, projectRoot: string): Promise<void> {
    // A destroyed webContents never emits 'destroyed' again: its watcher would never be closed.
    if (subscriber.isDestroyed()) return
    const key = `${subscriber.id}\0${projectRoot}`
    if (!this.watches.has(key)) {
      if (!this.subscribers.has(subscriber.id)) {
        this.subscribers.add(subscriber.id)
        subscriber.once('destroyed', () => void this.unsubscribeAll(subscriber.id))
      }
      const started = this.registry
        .watch(projectRoot, (change) => {
          if (subscriber.isDestroyed()) return
          try {
            emit(subscriber, claudeHomeChanged, { projectRoot, ...change })
          } catch (error) {
            console.error('[claude-home] could not send a change', error)
          }
        })
        .then(async (watch) => {
          await watch.ready
          return watch
        })
        .catch((error: unknown) => {
          console.error(`[claude-home] could not watch ${projectRoot}`, error)
          this.watches.delete(key)
          return undefined
        })
      this.watches.set(key, started)
    }
    await this.watches.get(key)
  }

  /** Stops watching `projectRoot` for one window; false when it was not watching. */
  async unsubscribe(subscriberId: number, projectRoot: string): Promise<boolean> {
    const key = `${subscriberId}\0${projectRoot}`
    const watch = this.watches.get(key)
    if (watch === undefined) return false
    this.watches.delete(key)
    await (await watch)?.close()
    return true
  }

  /** Number of watchers open now; for tests. */
  get size(): number {
    return this.watches.size
  }

  async unsubscribeAll(subscriberId: number): Promise<void> {
    this.subscribers.delete(subscriberId)
    const prefix = `${subscriberId}\0`
    const closing: Promise<void>[] = []
    for (const [key, watch] of this.watches) {
      if (!key.startsWith(prefix)) continue
      this.watches.delete(key)
      closing.push(watch.then((started) => started?.close()))
    }
    await Promise.all(closing)
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.subscribers].map((id) => this.unsubscribeAll(id)))
  }
}

/** Builds the handler list over a registry; the default export uses the real Claude home. */
export function claudeHomeHandlers(registry: ClaudeHomeRegistry, subscriptions = new ClaudeHomeSubscriptions(registry)): HandlerModule {
  return [
    defineHandler(claudeHomeSessions, async ({ projectRoot }, { event }) => {
      const root = resolve(projectRoot)
      // Watch first, read second: a change made while the files are read still produces an event.
      const sender = event.sender as Subscriber | undefined
      if (sender) await subscriptions.subscribe(sender, root)
      return registry.sessions(root)
    }),
    defineHandler(claudeHomeLive, async ({ projectRoot }) => ({ live: await registry.live(resolve(projectRoot)) })),
    defineHandler(claudeHomeClose, async ({ projectRoot }, { event }) => {
      const sender = event.sender as Subscriber | undefined
      return { closed: sender ? await subscriptions.unsubscribe(sender.id, resolve(projectRoot)) : false }
    }),
    defineHandler(claudeHomeTranscript, async ({ projectRoot, sessionId, cursor, maxBytes }) => {
      const path = await registry.transcriptPath(resolve(projectRoot), sessionId)
      if (path === null) return { found: false, events: [], cursor: { offset: 0, fileId: null }, reset: false, more: false }
      const chunk = await readNewLines(path, cursor, maxBytes === undefined ? {} : { maxBytes })
      return { found: true, events: mainThreadEvents(parseTranscriptLines(chunk.lines)), cursor: chunk.cursor, reset: chunk.reset, more: chunk.more }
    }),
  ]
}

export default claudeHomeHandlers(new ClaudeHomeRegistry({ home: claudeHome() })) satisfies HandlerModule
