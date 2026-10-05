// Handlers of the `claudeHome` domain (src/shared/ipc/claude-home.ts): Sessions of a Project read
// from the Claude home. Asking for a Project's Sessions also subscribes the asking window to
// `claudeHome.changed` for that Project; the subscription ends with the window.
import { resolve } from 'node:path'
import { ClaudeHomeRegistry, type ClaudeHomeWatch } from '../claude-home/registry'
import { readNewLines } from '../claude-home/tail'
import { claudeHome } from '../storage/paths'
import { claudeHomeChanged, claudeHomeSessions, claudeHomeTranscript } from '../../shared/ipc/claude-home'
import { parseTranscriptLines } from '../../shared/transcript/parse'
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

  /** Starts watching `projectRoot` for `subscriber` unless it already does. */
  async subscribe(subscriber: Subscriber, projectRoot: string): Promise<void> {
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
      const sessions = await registry.sessions(root)
      const sender = event.sender as Subscriber | undefined
      if (sender) await subscriptions.subscribe(sender, root)
      return sessions
    }),
    defineHandler(claudeHomeTranscript, async ({ projectRoot, sessionId, cursor, maxBytes }) => {
      const path = await registry.transcriptPath(resolve(projectRoot), sessionId)
      if (path === null) return { found: false, events: [], cursor: { offset: 0, fileId: null }, reset: false, more: false }
      const chunk = await readNewLines(path, cursor, maxBytes === undefined ? {} : { maxBytes })
      return { found: true, events: parseTranscriptLines(chunk.lines), cursor: chunk.cursor, reset: chunk.reset, more: chunk.more }
    }),
  ]
}

export default claudeHomeHandlers(new ClaudeHomeRegistry({ home: claudeHome() })) satisfies HandlerModule
