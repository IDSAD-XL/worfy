// Handlers of the `claudeHome` domain (src/shared/ipc/claude-home.ts): Sessions of a Project read
// from the Claude home. Asking for a Project's Sessions also subscribes the asking client to
// `claudeHome.changed` for that Project; the subscription ends with `claudeHome.close` or with the
// client (src/main/clients.ts).
//
// The live Sessions a watcher sees also go to liveSessionListeners (ticket 21: a notification when
// a Session from the registry finishes its turn, src/main/notify.ts): once when the watcher starts,
// and again after each change of the registry.
import { resolve } from 'node:path'
import { imageRef } from '../agent/attachments'
import { ClaudeHomeRegistry, rootPath, type ClaudeHomeWatch, type RegistryRoot } from '../claude-home/registry'
import { TranscriptSearch } from '../claude-home/search'
import { SubagentReader, subagentTranscriptPath } from '../claude-home/subagents'
import { readLinesBefore, readNewLines, type TailCursor } from '../claude-home/tail'
import { FIND_LIMITS, findInTranscript } from '../claude-home/transcript-find'
import { ClientHolders, clientOf, type Client, type ClientId } from '../clients'
import { isRemoteCall, projectRootOf } from '../link/caller'
import { LINK_MAX_PAYLOAD } from '../link/messages'
import { projectStore } from '../projects/store'
import { claudeHome } from '../storage/paths'
import {
  claudeHomeChanged,
  claudeHomeClose,
  claudeHomeLive,
  claudeHomeSearch,
  claudeHomeSessions,
  claudeHomeSubagents,
  claudeHomeSubagentTranscript,
  claudeHomeTranscript,
  claudeHomeTranscriptFind,
  type LiveSession,
} from '../../shared/ipc/claude-home'
import type { AgentEvent } from '../../shared/agent/events'
import { findNeedle } from '../../shared/transcript/find'
import { mainThreadEvents, parseTranscriptLine, timedEvent, type TranscriptEntry } from '../../shared/transcript/parse'
import { summaryLine, type SubagentFile, type SubagentSignal } from '../../shared/transcript/subagents'
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
  /** The client holding each id leaves its watchers when it is destroyed or another client takes its id. */
  private readonly holders = new ClientHolders((id) => void this.unsubscribeAll(id))

  constructor(
    private readonly registry: ClaudeHomeRegistry,
    private readonly listeners: ReadonlySet<LiveSessionsListener> = liveSessionListeners,
  ) {}

  /**
   * Reads the Project's live Sessions for the listeners; nothing when there are none. They get
   * the resolved root in the spelling that names its folders, not a real path, so one Project is
   * one key for the notifications (src/main/notify.ts) whichever client watches it.
   */
  private reportLive(root: RegistryRoot): void {
    if (this.listeners.size === 0) return
    const projectRoot = rootPath(root)
    this.registry.live(root).then(
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

  /**
   * Starts watching `projectRoot` for `subscriber` unless it already does or the client is gone.
   * `asSent` is the root as the client spelled it: its `claudeHome.changed` carries that spelling
   * and `unsubscribe` takes it, since the window looks the root up by its own string. On Windows
   * the window keeps git's `C:/…` while path.resolve gives `C:\…` (worfy-windows ticket 57).
   */
  async subscribe(subscriber: Subscriber, projectRoot: RegistryRoot, asSent = rootPath(projectRoot)): Promise<void> {
    // First: a new client under an old one's id takes the id over, ending the old one's watchers.
    // A destroyed client is not held: it never emits 'destroyed' again, its watcher would never be
    // closed, and a late call of an old client must not take the id back from a new one.
    if (!this.holders.hold(subscriber)) return
    // By the client's spelling: two spellings of one root get a watcher each, each event in its own.
    const key = `${subscriber.id}\0${asSent}`
    if (!this.watches.has(key)) {
      const started: Promise<ClaudeHomeWatch | undefined> = this.registry
        .watch(projectRoot, (change) => {
          if (change.sessions) this.reportLive(projectRoot)
          if (subscriber.isDestroyed()) return
          try {
            emit(subscriber, claudeHomeChanged, { projectRoot: asSent, ...change })
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
          console.error(`[claude-home] could not watch ${rootPath(projectRoot)}`, error)
          // Only this watcher's entry: the key may hold a later subscription by now.
          if (this.watches.get(key) === started) this.watches.delete(key)
          return undefined
        })
      this.watches.set(key, started)
    }
    await this.watches.get(key)
  }

  /** Stops watching the root spelled `asSent` for one client; false when it was not watching. */
  async unsubscribe(subscriberId: ClientId, asSent: string): Promise<boolean> {
    const key = `${subscriberId}\0${asSent}`
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
    await Promise.all(this.holders.ids().map((id) => this.unsubscribeAll(id)))
  }
}

/** What `claudeHome.subagents` answers for a Session it found. */
export interface SubagentsAnswer {
  found: boolean
  signals: SubagentSignal[]
  files: SubagentFile[]
  truncated?: boolean
}

/**
 * The most an answer of `claudeHome.subagents` to a Linked machine may take: a link connection
 * carries LINK_MAX_PAYLOAD bytes in one message, and the frame around the answer takes a little of it.
 */
export const SUBAGENTS_LINK_BYTES = LINK_MAX_PAYLOAD - 64 * 1024

/**
 * Each longer text of a result or an answer is cut to these lengths in turn until the answer fits;
 * the last cut keeps only the line the tree shows of it (summaryLine, src/shared/transcript/subagents.ts).
 * An emptied text would stand in front of the one-line summary there, and the tree would lose it.
 */
const TEXT_CUTS = [1000, 200, 'summary line'] as const
type TextCut = (typeof TEXT_CUTS)[number]

function cutText<T extends string | null>(text: T, length: TextCut): T {
  if (text === null) return text
  // A text without such a line (only marks or spaces) keeps its first 200 characters rather than none.
  if (length === 'summary line') return (summaryLine(text) ?? text.slice(0, 200)) as T
  return (text.length <= length ? text : text.slice(0, length)) as T
}

function cutSignal(signal: SubagentSignal, length: TextCut): SubagentSignal {
  if (signal.kind === 'result') return { ...signal, text: cutText(signal.text, length) }
  if (signal.kind === 'finished') return { ...signal, result: cutText(signal.result, length) }
  return signal
}

function cutFile(file: SubagentFile, length: TextCut): SubagentFile {
  return {
    ...file,
    finalText: cutText(file.finalText, length),
    signals: file.signals.map((signal) => cutSignal(signal, length)),
    workflow: file.workflow === null ? null : { ...file.workflow, result: cutText(file.workflow.result, length) },
  }
}

const bytesOf = (answer: SubagentsAnswer): number => Buffer.byteLength(JSON.stringify(answer))

/**
 * The answer of `claudeHome.subagents`, made to fit in `maxBytes` (worfy-link ticket 33): a Session
 * with a large tree of Subagents gave an answer larger than a link connection carries, and the
 * Linked machine got an error instead of the tree. The texts of results and answers are cut first,
 * down to the one line the tree shows of each; every signal and file stays, so the tree
 * is whole.
 * `truncated` says the answer was shortened. An answer that fits is returned as it is.
 */
export function fitSubagentsAnswer(answer: SubagentsAnswer, maxBytes: number): SubagentsAnswer {
  if (bytesOf(answer) <= maxBytes) return answer
  let cut: SubagentsAnswer = answer
  for (const length of TEXT_CUTS) {
    cut = { found: answer.found, signals: answer.signals.map((signal) => cutSignal(signal, length)), files: answer.files.map((file) => cutFile(file, length)), truncated: true }
    if (bytesOf(cut) <= maxBytes) return cut
  }
  // shortcut: with only one line of each text left the oldest half of the signals and of the files is left out until the answer fits, so the oldest Subagents leave the tree; redo with pages of the answer when a Session of so many Subagents (tens of thousands) is seen.
  while (bytesOf(cut) > maxBytes && (cut.signals.length > 0 || cut.files.length > 0)) {
    cut = { ...cut, signals: cut.signals.slice(Math.ceil(cut.signals.length / 2)), files: cut.files.slice(Math.ceil(cut.files.length / 2)) }
  }
  return cut
}

interface TranscriptRead {
  cursor?: TailCursor | undefined
  maxBytes?: number | undefined
  back?: { bytes: number; before?: TailCursor | undefined } | undefined
}

/**
 * The answer of `claudeHome.transcript` and `claudeHome.subagentTranscript` for the file at
 * `path`: forward from `cursor`, or the window `back` names, read from the end. `events` picks the
 * events a line's entries give; each keeps the offset of its line in `offsets`.
 */
async function readTranscript(path: string, read: TranscriptRead, events: (entries: TranscriptEntry[]) => AgentEvent[]) {
  const parse = (lines: readonly string[], lineOffsets: readonly number[]) => {
    const all: AgentEvent[] = []
    const offsets: number[] = []
    lines.forEach((line, at) => {
      // An image of a user message is named by the hash of its copy; its bytes stay here (worfy-ui ticket 28).
      // shortcut: the hash is computed again on each read, in main: about 1.7 ms per 3 MB image (30 such images, about 50 ms, measured 2026-10-25), redo with a cache by file and line offset when a read of a transcript with many large images holds main up noticeably.
      for (const each of events(parseTranscriptLine(line, { imageRef }))) {
        all.push(each)
        offsets.push(lineOffsets[at] ?? 0)
      }
    })
    return { events: all, offsets }
  }
  if (read.back !== undefined) {
    const chunk = await readLinesBefore(path, { windowBytes: read.back.bytes, ...(read.back.before ? { before: read.back.before } : {}) })
    return { found: true, ...parse(chunk.lines, chunk.offsets), cursor: chunk.cursor, reset: chunk.reset, more: false, earlier: chunk.start }
  }
  const chunk = await readNewLines(path, read.cursor, read.maxBytes === undefined ? {} : { maxBytes: read.maxBytes })
  return { found: true, ...parse(chunk.lines, chunk.offsets), cursor: chunk.cursor, reset: chunk.reset, more: chunk.more }
}

/**
 * Builds the handler list over a registry; the default export uses the real Claude home. A call
 * from a Linked machine names the root of a Project of `projects` or one of its worktrees
 * (src/main/link/caller.ts).
 */
export function claudeHomeHandlers(
  registry: ClaudeHomeRegistry,
  subscriptions = new ClaudeHomeSubscriptions(registry),
  subagents = new SubagentReader(),
  projects: () => readonly { readonly path: string }[] = () => projectStore().list(),
  search = new TranscriptSearch(registry),
): HandlerModule {
  const notFound = { found: false, events: [], cursor: { offset: 0, fileId: null }, reset: false, more: false }
  /**
   * The resolved root. For a call from a Linked machine, also the real path its check answers:
   * git runs there, so a link swapped in after the check does not lead it elsewhere, while the
   * Claude home folders are still found by the resolved spelling (RegistryRoot). A Linked machine
   * names a Project root or one of its worktrees, not any folder inside: a Claude home folder name
   * stands for several paths (src/main/link/caller.ts, projectRootOf), and its root is judged
   * strictly. A window's root is `local` (RegistryRoot).
   */
  const rootOf = async (projectRoot: string, event: { readonly sender?: unknown }): Promise<RegistryRoot> => {
    const root = resolve(projectRoot)
    if (!isRemoteCall(event)) return { path: root, local: true }
    const checked = await projectRootOf(event, root, projects, (at) => registry.worktrees(at), 'the Project root')
    return { path: root, gitAt: checked }
  }
  return [
    defineHandler(claudeHomeSessions, async ({ projectRoot }, { event }) => {
      const root = await rootOf(projectRoot, event)
      // Watch first, read second: a change made while the files are read still produces an event.
      const client = clientOf(event)
      if (client) await subscriptions.subscribe(client, root, projectRoot)
      return registry.sessions(root)
    }),
    defineHandler(claudeHomeLive, async ({ projectRoot }, { event }) => ({ live: await registry.live(await rootOf(projectRoot, event)) })),
    defineHandler(claudeHomeClose, async ({ projectRoot }, { event }) => {
      const client = clientOf(event)
      return { closed: client ? await subscriptions.unsubscribe(client.id, projectRoot) : false }
    }),
    defineHandler(claudeHomeTranscript, async ({ projectRoot, sessionId, ...read }, { event }) => {
      const path = await registry.transcriptPath(await rootOf(projectRoot, event), sessionId)
      if (path === null) return notFound
      return readTranscript(path, read, mainThreadEvents)
    }),
    defineHandler(claudeHomeSubagents, async ({ projectRoot, sessionId }, { event }) => {
      const path = await registry.transcriptPath(await rootOf(projectRoot, event), sessionId)
      if (path === null) return { found: false, signals: [], files: [] }
      const answer = { found: true, ...(await subagents.session(path)) }
      // A window's own main has no limit; a link connection has (LINK_MAX_PAYLOAD).
      return isRemoteCall(event) ? fitSubagentsAnswer(answer, SUBAGENTS_LINK_BYTES) : answer
    }),
    defineHandler(claudeHomeSubagentTranscript, async ({ projectRoot, sessionId, agentId, cursor, maxBytes, back }, { event }) => {
      const session = await registry.transcriptPath(await rootOf(projectRoot, event), sessionId)
      const path = session === null ? null : await subagentTranscriptPath(session, agentId)
      if (path === null) return notFound
      return readTranscript(path, { cursor, maxBytes, back }, (entries) => entries.map(timedEvent))
    }),
    defineHandler(claudeHomeSearch, async ({ projectRoot, query }, { event }) => search.search(await rootOf(projectRoot, event), query)),
    defineHandler(claudeHomeTranscriptFind, async ({ projectRoot, sessionId, agentId, query, before, from }, { event }) => {
      const session = await registry.transcriptPath(await rootOf(projectRoot, event), sessionId)
      const path = session === null || agentId === undefined ? session : await subagentTranscriptPath(session, agentId)
      if (path === null) return { found: false, hits: [], total: 0, skipped: 0 }
      // The same events as the reads above: the Session's own thread, or every record of a Subagent's file.
      return findInTranscript(path, findNeedle(query), before, agentId === undefined ? mainThreadEvents : (entries) => entries.map(timedEvent), FIND_LIMITS, from)
    }),
  ]
}

export default claudeHomeHandlers(new ClaudeHomeRegistry({ home: claudeHome() })) satisfies HandlerModule
