// Handlers of the `claudeHome` domain (src/shared/ipc/claude-home.ts): Sessions of a Project read
// from the Claude home. Asking for a Project's Sessions also subscribes the asking client to
// `claudeHome.changed` for that Project; the subscription ends with `claudeHome.close` or with the
// client (src/main/clients.ts).
//
// The live Sessions a watcher sees also go to liveSessionListeners (ticket 21: a notification when
// a Session from the registry finishes its turn, src/main/notify.ts): once when the watcher starts,
// and again after each change of the registry.
import { resolve } from 'node:path'
import { ClaudeHomeRegistry, type ClaudeHomeWatch } from '../claude-home/registry'
import { SubagentReader, subagentTranscriptPath } from '../claude-home/subagents'
import { readNewLines } from '../claude-home/tail'
import { clientOf, type Client, type ClientId } from '../clients'
import { claudeHome } from '../storage/paths'
import {
  claudeHomeChanged,
  claudeHomeClose,
  claudeHomeLive,
  claudeHomeSessions,
  claudeHomeSubagents,
  claudeHomeSubagentTranscript,
  claudeHomeTranscript,
  type LiveSession,
} from '../../shared/ipc/claude-home'
import { mainThreadEvents, parseTranscriptLines, timedEvent } from '../../shared/transcript/parse'
import { defineHandler, emit, type HandlerModule } from './index'

/** The client the subscriptions serve (src/main/clients.ts); tests pass a fake. */
export type Subscriber = Client

/** Who gets the live Sessions of a Project each time a watcher reads them. */
export type LiveSessionsListener = (projectRoot: string, live: readonly LiveSession[]) => void

/** The app's listeners of live Sessions (src/main/notify.ts adds one). */
export const liveSessionListeners = new Set<LiveSessionsListener>()

/** Keeps one watcher per (client, Project) and forwards its changes to that client. */
export class ClaudeHomeSubscriptions {
  private readonly watches = new Map<string, Promise<ClaudeHomeWatch | undefined>>()
  private readonly subscribers = new Set<ClientId>()

  constructor(
    private readonly registry: ClaudeHomeRegistry,
    private readonly listeners: ReadonlySet<LiveSessionsListener> = liveSessionListeners,
  ) {}

  /** Reads the Project's live Sessions for the listeners; nothing when there are none. */
  private reportLive(projectRoot: string): void {
    if (this.listeners.size === 0) return
    this.registry.live(projectRoot).then(
      (live) => {
        for (const listener of this.listeners) {
          try {
            listener(projectRoot, live)
          } catch (error) {
            console.warn('[claude-home] a live Sessions listener failed', error)
          }
        }
      },
      (error: unknown) => console.warn(`[claude-home] could not read the live Sessions of ${projectRoot}`, error),
    )
  }

  /** Starts watching `projectRoot` for `subscriber` unless it already does or the client is gone. */
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
          if (change.sessions) this.reportLive(projectRoot)
          if (subscriber.isDestroyed()) return
          try {
            emit(subscriber, claudeHomeChanged, { projectRoot, ...change })
          } catch (error) {
            console.error('[claude-home] could not send a change', error)
          }
        })
        .then(async (watch) => {
          await watch.ready
          this.reportLive(projectRoot)
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

  /** Stops watching `projectRoot` for one client; false when it was not watching. */
  async unsubscribe(subscriberId: ClientId, projectRoot: string): Promise<boolean> {
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

  async unsubscribeAll(subscriberId: ClientId): Promise<void> {
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
export function claudeHomeHandlers(
  registry: ClaudeHomeRegistry,
  subscriptions = new ClaudeHomeSubscriptions(registry),
  subagents = new SubagentReader(),
): HandlerModule {
  const notFound = { found: false, events: [], cursor: { offset: 0, fileId: null }, reset: false, more: false }
  return [
    defineHandler(claudeHomeSessions, async ({ projectRoot }, { event }) => {
      const root = resolve(projectRoot)
      // Watch first, read second: a change made while the files are read still produces an event.
      const client = clientOf(event)
      if (client) await subscriptions.subscribe(client, root)
      return registry.sessions(root)
    }),
    defineHandler(claudeHomeLive, async ({ projectRoot }) => ({ live: await registry.live(resolve(projectRoot)) })),
    defineHandler(claudeHomeClose, async ({ projectRoot }, { event }) => {
      const client = clientOf(event)
      return { closed: client ? await subscriptions.unsubscribe(client.id, resolve(projectRoot)) : false }
    }),
    defineHandler(claudeHomeTranscript, async ({ projectRoot, sessionId, cursor, maxBytes }) => {
      const path = await registry.transcriptPath(resolve(projectRoot), sessionId)
      if (path === null) return notFound
      const chunk = await readNewLines(path, cursor, maxBytes === undefined ? {} : { maxBytes })
      return { found: true, events: mainThreadEvents(parseTranscriptLines(chunk.lines)), cursor: chunk.cursor, reset: chunk.reset, more: chunk.more }
    }),
    defineHandler(claudeHomeSubagents, async ({ projectRoot, sessionId }) => {
      const path = await registry.transcriptPath(resolve(projectRoot), sessionId)
      if (path === null) return { found: false, signals: [], files: [] }
      return { found: true, ...(await subagents.session(path)) }
    }),
    defineHandler(claudeHomeSubagentTranscript, async ({ projectRoot, sessionId, agentId, cursor, maxBytes }) => {
      const session = await registry.transcriptPath(resolve(projectRoot), sessionId)
      const path = session === null ? null : await subagentTranscriptPath(session, agentId)
      if (path === null) return notFound
      const chunk = await readNewLines(path, cursor, maxBytes === undefined ? {} : { maxBytes })
      return { found: true, events: parseTranscriptLines(chunk.lines).map(timedEvent), cursor: chunk.cursor, reset: chunk.reset, more: chunk.more }
    }),
  ]
}

export default claudeHomeHandlers(new ClaudeHomeRegistry({ home: claudeHome() })) satisfies HandlerModule
