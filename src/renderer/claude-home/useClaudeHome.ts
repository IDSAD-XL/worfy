// The renderer's copy of each Project's Sessions as Claude Code records them under ~/.claude
// (src/shared/ipc/claude-home.ts): the live ones and the history, and the events of a Session's
// transcript file. Several views read one Project — the Session Nodes, the sidebar's Sessions
// section, a read-only Session view — so the copy is shared: the first user asks main for the
// Sessions (`claudeHome.sessions`, which also subscribes this window to `claudeHome.changed`), the
// last one to leave closes the subscription (`claudeHome.close`).
//
// The live list is asked again (`claudeHome.live`) when the registry changes and every
// LIVE_POLL_MS while a Session is live: a process that dies without removing its registry file
// changes no file, and only asking again shows that it is gone.
//
// The history (titles) is read once for a Session that appears in a live list and that no history
// read has covered yet, and then on the next poll after its transcript changed while it still has
// no title. The second read exists because Claude Code writes the registry file before the first
// prompt creates the transcript: the read made when the Session appears finds no transcript, so the
// title can only come from a later one. A Session that a `claudeHome.sessions` answer already
// listed as live counts as read: the history in that same answer covered it (ticket worfy-daily/09
// removed the second read that followed it).
//
// Answers can arrive out of order (a slow history read, then a quick live one). Each request takes
// a number; an answer older than the one already shown for its part (live list or history) is
// dropped. worfy never writes under ~/.claude.
import { useEffect } from 'react'
import { create } from 'zustand'
import type { AgentEvent } from '../../shared/agent/events'
import { TRANSCRIPT_WINDOW_BYTES, type HistorySession, type LiveSession } from '../../shared/ipc/claude-home'
import type { InvokeOutput } from '../../shared/ipc/channels'
import { invoke, readableReason, showSubscribeError, subscribe } from '../ipc'
import { dismissToast, showToast, toasts } from '../toast/toasts'

/** How often the live list is asked again while a Session is live. */
export const LIVE_POLL_MS = 2000
/**
 * Events kept per transcript while the reader has not asked for older ones; older ones are
 * dropped first. Events brought by «Load earlier» stay: the reader asked for them (ticket 21).
 */
export const KEEP_EVENTS = 5000
/** Bytes asked for in one forward `claudeHome.transcript` call, after the window at the end. */
const CHUNK_BYTES = TRANSCRIPT_WINDOW_BYTES

export interface ClaudeHomeEntry {
  /** Undefined until main has answered once. */
  live: readonly LiveSession[] | undefined
  history: readonly HistorySession[]
  error: string | undefined
}

export interface TranscriptState {
  events: readonly AgentEvent[]
  /**
   * Position of `events[0]`, counted from the first event the view opened on: negative once
   * «Load earlier» put older events in front, higher once old events were dropped. Row keys come
   * from it (fold.ts), so a row keeps its key as events come and go at either end.
   */
  first: number
  /** False until the first read; then whether the file was found. */
  loaded: boolean
  found: boolean
  error: string | undefined
  /**
   * Byte offset where the line of `events[0]` starts: the end of the window «Load earlier» reads.
   * 0 when the events start at the beginning of the file; null before the first read or without a file.
   */
  earlier: number | null
  /** True while «Load earlier» reads. */
  loadingEarlier: boolean
  /** For the reader: the byte offset of the line each of `events` came from. */
  offsets: readonly number[]
  /** For the reader: true once «Load earlier» brought events, which KEEP_EVENTS then never drops. */
  pinned: boolean
}

interface ClaudeHomeStore {
  byRoot: Readonly<Record<string, ClaudeHomeEntry>>
  /** By `<root>\0<sessionId>`. */
  transcripts: Readonly<Record<string, TranscriptState>>
}

const useClaudeHomeStore = create<ClaudeHomeStore>(() => ({ byRoot: {}, transcripts: {} }))

const EMPTY: ClaudeHomeEntry = { live: undefined, history: [], error: undefined }
const EMPTY_TRANSCRIPT: TranscriptState = { events: [], first: 0, loaded: false, found: false, error: undefined, earlier: null, loadingEarlier: false, offsets: [], pinned: false }
const transcriptKey = (root: string, sessionId: string, agentId?: string): string => (agentId === undefined ? `${root}\0${sessionId}` : `${root}\0${sessionId}\0${agentId}`)
/** How often a Subagent's transcript is read again while it is shown: its file is not watched. */
export const SUBAGENT_POLL_MS = 2000

function setEntry(root: string, change: Partial<ClaudeHomeEntry>): void {
  useClaudeHomeStore.setState(({ byRoot }) => ({ byRoot: { ...byRoot, [root]: { ...(byRoot[root] ?? EMPTY), ...change } } }))
}

// ── live Sessions and history ───────────────────────────────────────────────

const users = new Map<string, number>()
const polls = new Map<string, ReturnType<typeof setInterval>>()
/**
 * Live Sessions whose history was read since they appeared, by root: listed live by a
 * `claudeHome.sessions` answer, or given their one read by `refreshLive`.
 */
const reread = new Map<string, Set<string>>()
/** Number of the latest `claudeHome.sessions` or `claudeHome.live` request, for every root. */
let lastRequest = 0
/** The newest request whose answer is shown, by root and part; older answers are dropped. */
const applied = new Map<string, { live: number; history: number }>()
const NONE_APPLIED = { live: 0, history: 0 }
/** Sessions without a title whose transcript changed since the history was read, by root. */
const untitled = new Map<string, Set<string>>()
interface TranscriptReader {
  /** Reads what was written since the last read: the window at the end of the file first. */
  follow: () => void
  /** Reads the window before the shown events and puts it in front of them. */
  earlier: () => Promise<void>
}
/** Readers of each transcript, by transcriptKey. */
const readers = new Map<string, TranscriptReader>()
let subscribed = false

function schedulePoll(root: string): void {
  const live = useClaudeHomeStore.getState().byRoot[root]?.live ?? []
  const timer = polls.get(root)
  if (live.length > 0 && timer === undefined && users.has(root)) {
    polls.set(
      root,
      setInterval(() => void refreshLive(root), LIVE_POLL_MS),
    )
  } else if (live.length === 0 && timer !== undefined) {
    clearInterval(timer)
    polls.delete(root)
  }
}

function readFor(root: string): Set<string> {
  const read = reread.get(root) ?? new Set<string>()
  reread.set(root, read)
  return read
}

async function refreshAll(root: string): Promise<void> {
  const request = (lastRequest += 1)
  const result = await invoke('claudeHome.sessions', { projectRoot: root })
  if (!users.has(root)) return
  const shown = applied.get(root) ?? NONE_APPLIED
  if (request < shown.history) return // a newer answer is on screen
  if (result.ok) {
    const newerLive = request < shown.live
    applied.set(root, { live: newerLive ? shown.live : request, history: request })
    const read = readFor(root)
    for (const session of result.value.live) read.add(session.sessionId)
    setEntry(root, { ...(newerLive ? {} : { live: result.value.live }), history: result.value.history, error: undefined })
  } else {
    console.error(`claudeHome.sessions ${root} failed:`, result.error)
    applied.set(root, { ...shown, history: request })
    setEntry(root, { error: result.error })
  }
  schedulePoll(root)
}

/** A live Session that has neither a name in the registry nor a title in the history. */
function wantsTitle(root: string, sessionId: string): boolean {
  const entry = useClaudeHomeStore.getState().byRoot[root]
  if (entry?.live?.some((session) => session.sessionId === sessionId && session.name === undefined) !== true) return false
  return entry.history.find((session) => session.sessionId === sessionId)?.title === undefined
}

/**
 * A Session that may still need a title: no name in the registry, no title in the history. Unlike
 * `wantsTitle` it does not ask for the Session to be in the live list yet, so a transcript change
 * that arrives before the answer listing the Session as live is kept until the next poll.
 */
function mayWantTitle(root: string, sessionId: string): boolean {
  const entry = useClaudeHomeStore.getState().byRoot[root]
  if (entry?.live?.some((session) => session.sessionId === sessionId && session.name !== undefined) === true) return false
  return entry?.history.find((session) => session.sessionId === sessionId)?.title === undefined
}

/** The key of the toast of a failed `claudeHome.live`, one for every Project root. */
const LIVE_ERROR = 'ipc:claudeHome.live'
/** The reason last shown for each root whose `claudeHome.live` failed; a success takes the root out. */
const liveErrors = new Map<string, string>()

/**
 * A failed `claudeHome.live` of `root`: an `error` toast, unless the same reason for the root is
 * already shown — a poll that fails again neither announces it again nor brings back a closed toast.
 */
function liveFailed(root: string, error: string): void {
  const text = `Live Sessions not read: ${readableReason(error)}`
  if (liveErrors.get(root) === text) return
  liveErrors.set(root, text)
  showToast({ kind: 'error', key: LIVE_ERROR, text })
}

/**
 * A `claudeHome.live` of `root` that answered: the toast goes once no root fails any more. While
 * another root still fails, a toast that shows the reason of `root` shows that root's reason instead;
 * a toast the user closed stays closed.
 */
function liveAnswered(root: string): void {
  const answered = liveErrors.get(root)
  if (answered === undefined) return
  liveErrors.delete(root)
  const left = [...liveErrors.values()].at(-1)
  if (left === undefined) {
    dismissToast(LIVE_ERROR)
    return
  }
  const shown = toasts.getState().toasts.find((toast) => toast.id === LIVE_ERROR)?.text
  if (shown === answered && left !== answered) showToast({ kind: 'error', key: LIVE_ERROR, text: left })
}

async function refreshLive(root: string): Promise<void> {
  const request = (lastRequest += 1)
  const result = await invoke('claudeHome.live', { projectRoot: root })
  if (!users.has(root)) return
  if (!result.ok) {
    console.error(`claudeHome.live ${root} failed:`, result.error)
    liveFailed(root, result.error)
    return
  }
  liveAnswered(root)
  const shown = applied.get(root) ?? NONE_APPLIED
  if (request < shown.live) return // a newer live list is on screen
  applied.set(root, { ...shown, live: request })
  const entry = useClaudeHomeStore.getState().byRoot[root] ?? EMPTY
  const known = new Set(entry.history.map((session) => session.sessionId))
  const asked = readFor(root)
  setEntry(root, { live: result.value.live, error: undefined })
  // A Session that started since the history was read: read it once, for its title.
  const fresh = result.value.live.filter((session) => !known.has(session.sessionId) && !asked.has(session.sessionId))
  for (const session of fresh) asked.add(session.sessionId)
  // A Session whose transcript changed while it had no title: its first prompt may be there now.
  const changed = [...(untitled.get(root) ?? [])].filter((sessionId) => wantsTitle(root, sessionId))
  untitled.delete(root)
  if (fresh.length > 0 || changed.length > 0) void refreshAll(root)
  else schedulePoll(root)
}

function onChanged(change: { projectRoot: string; sessions: boolean; transcripts: string[] }): void {
  const root = change.projectRoot
  if (!users.has(root)) return
  if (change.sessions) void refreshLive(root)
  for (const sessionId of change.transcripts) {
    if (mayWantTitle(root, sessionId)) untitled.set(root, (untitled.get(root) ?? new Set()).add(sessionId))
    readers.get(transcriptKey(root, sessionId))?.follow()
  }
}

function ensureSubscribed(): void {
  if (subscribed) return
  subscribed = true
  try {
    subscribe('claudeHome.changed', onChanged)
  } catch (error) {
    subscribed = false
    showSubscribeError('claudeHome.changed', error)
  }
}

function acquire(root: string): void {
  ensureSubscribed()
  const count = users.get(root) ?? 0
  users.set(root, count + 1)
  if (count === 0) void refreshAll(root)
}

function release(root: string): void {
  const count = users.get(root) ?? 0
  if (count > 1) {
    users.set(root, count - 1)
    return
  }
  users.delete(root)
  reread.delete(root)
  applied.delete(root)
  untitled.delete(root)
  // Nobody shows this root any more: its failure is not news; the toast goes with the last one.
  liveAnswered(root)
  const timer = polls.get(root)
  if (timer !== undefined) clearInterval(timer)
  polls.delete(root)
  useClaudeHomeStore.setState(({ byRoot }) => {
    const rest = { ...byRoot }
    delete rest[root]
    return { byRoot: rest }
  })
  void invoke('claudeHome.close', { projectRoot: root })
}

/**
 * main's list of the live Sessions of `root` at this moment, read past the store and its polls, for
 * a decision that cannot wait for the next poll (the epic arrangement's first opening of the day,
 * canvas/arrangement-record.ts). Undefined when main could not read it; the reason goes to the log.
 */
export async function liveSessionsNow(root: string): Promise<readonly LiveSession[] | undefined> {
  try {
    const result = await invoke('claudeHome.live', { projectRoot: root })
    if (result.ok) return result.value.live
    console.error('claudeHome.live failed:', result.error)
  } catch (error) {
    console.error('claudeHome.live failed:', error)
  }
  return undefined
}

/**
 * Reads the live Sessions and the history of `root` again, for a view that needs Sessions that
 * ended or started since (the history popover, ticket 18). Does nothing while nothing uses `root`.
 */
export function refreshClaudeHome(root: string): void {
  if (users.has(root)) void refreshAll(root)
}

/** The Sessions of the Project at `root`, kept current while the calling component is mounted. */
export function useClaudeHome(root: string | undefined): ClaudeHomeEntry {
  useEffect(() => {
    if (root === undefined) return
    acquire(root)
    return () => release(root)
  }, [root])
  return useClaudeHomeStore((store) => (root === undefined ? EMPTY : (store.byRoot[root] ?? EMPTY)))
}

// ── one Session's transcript ────────────────────────────────────────────────

function setTranscript(key: string, state: TranscriptState): void {
  useClaudeHomeStore.setState(({ transcripts }) => ({ transcripts: { ...transcripts, [key]: state } }))
}

/**
 * Drops the oldest events beyond KEEP_EVENTS, unless the reader asked for older ones. It drops
 * whole lines, and `earlier` moves to the first line kept, so «Load earlier» brings the dropped
 * events back with no gap. Without the lines (a main that sends no offsets) it keeps the newest
 * KEEP_EVENTS events and offers no «Load earlier».
 */
function capped(state: TranscriptState): TranscriptState {
  const over = state.events.length - KEEP_EVENTS
  if (state.pinned || over <= 0) return state
  let cut = over
  if ((state.offsets[cut] ?? -1) >= 0) while (cut < state.offsets.length && state.offsets[cut] === state.offsets[cut - 1]) cut += 1
  const offset = state.offsets[cut]
  return {
    ...state,
    events: state.events.slice(cut),
    offsets: state.offsets.slice(cut),
    first: state.first + cut,
    earlier: offset === undefined || offset < 0 ? null : offset,
  }
}

/** The offsets of an answer's events; -1 for each when main sent none (the cap then cuts by events and hides «Load earlier»). */
const offsetsOf = (events: readonly AgentEvent[], offsets: readonly number[] | undefined): readonly number[] =>
  offsets !== undefined && offsets.length === events.length ? offsets : events.map(() => -1)

/** The current state of a transcript's view, outside React. */
function transcriptNow(key: string): TranscriptState {
  return useClaudeHomeStore.getState().transcripts[key] ?? EMPTY_TRANSCRIPT
}

type TranscriptAnswer = InvokeOutput<'claudeHome.transcript'>

type TranscriptRequest = {
  cursor?: { offset: number; fileId: string | null }
  maxBytes?: number
  back?: { bytes: number; before?: { offset: number; fileId: string | null } }
}

/**
 * Reads a transcript for the view (ticket 21). The first read takes the window of
 * TRANSCRIPT_WINDOW_BYTES at the end of the file and draws it with one state update; later reads
 * go forward from where it ended, until the end of the file, and draw what they found with one
 * update. A change that arrives during a read starts one more read after it, so none is lost and
 * reads never overlap. «Load earlier» reads the window before the shown events; a read of the
 * end of the file started meanwhile (the file was replaced) makes its answer stale.
 */
function transcriptReader(root: string, sessionId: string, agentId?: string): TranscriptReader {
  const key = transcriptKey(root, sessionId, agentId)
  const label = `${sessionId}${agentId === undefined ? '' : `/${agentId}`}`
  let cursor: { offset: number; fileId: string | null } | undefined
  let running = false
  let again = false
  /** Counts the reads of the end of the file: an older window from before one is not put in front. */
  let opened = 0

  const ask = (request: TranscriptRequest) => {
    const input = { projectRoot: root, sessionId, ...request }
    return agentId === undefined ? invoke('claudeHome.transcript', input) : invoke('claudeHome.subagentTranscript', { ...input, agentId })
  }
  const closed = () => readers.get(key) !== reader
  const current = () => transcriptNow(key)
  const failed = (error: string) => {
    console.error(`claudeHome.transcript ${label} failed:`, error)
    setTranscript(key, { ...current(), loaded: true, error })
  }

  /** The window at the end of the file, drawn in place of whatever was shown. */
  const openEnd = async (): Promise<void> => {
    opened += 1
    const result = await ask({ back: { bytes: TRANSCRIPT_WINDOW_BYTES } })
    if (closed()) return
    if (!result.ok) return failed(result.error)
    const { found, events } = result.value
    if (found && result.value.earlier === undefined) return readFromStart(result.value)
    // Without a file the next read looks at the end again; with one, it follows from this window.
    cursor = found ? result.value.cursor : undefined
    const offsets = offsetsOf(events, result.value.offsets)
    setTranscript(key, { ...capped({ ...EMPTY_TRANSCRIPT, events, offsets, earlier: found ? (result.value.earlier ?? 0) : null }), loaded: true, found })
  }

  /**
   * A main that does not know `back` (an older build on a Linked machine: LINK_PROTOCOL_VERSION
   * did not change) drops it, reads forward from the start of the file and answers without
   * `earlier`. Read on to the end the old way and draw the newest KEEP_EVENTS events once, with no
   * «Load earlier». Only the newest KEEP_EVENTS are held between chunks: a long file costs one
   * chunk of memory above them, not the whole file.
   */
  const readFromStart = async (first: TranscriptAnswer): Promise<void> => {
    let answer = first
    // The events before `events`, dropped while reading: rows stay counted from the start of the file.
    let dropped = 0
    let events: AgentEvent[] = []
    const keepNewest = (more: readonly AgentEvent[]): void => {
      const all = [...events, ...more]
      const over = Math.max(0, all.length - KEEP_EVENTS)
      dropped += over
      events = over === 0 ? all : all.slice(over)
    }
    keepNewest(first.events)
    for (let round = 0; answer.more && round < 1000; round += 1) {
      const result = await ask({ cursor: answer.cursor, maxBytes: CHUNK_BYTES })
      if (closed()) return
      if (!result.ok) return failed(result.error)
      answer = result.value
      if (!answer.found) {
        cursor = undefined
        setTranscript(key, { ...EMPTY_TRANSCRIPT, loaded: true })
        return
      }
      if (answer.reset) {
        dropped = 0
        events = []
      }
      keepNewest(answer.events)
    }
    cursor = answer.cursor
    setTranscript(key, { ...EMPTY_TRANSCRIPT, events, offsets: events.map(() => -1), first: dropped, loaded: true, found: true })
  }

  /** Everything written after `cursor`, read forward and drawn once. */
  const readOn = async (from: { offset: number; fileId: string | null }): Promise<void> => {
    let at = from
    const events: AgentEvent[] = []
    const offsets: number[] = []
    for (let round = 0; round < 1000; round += 1) {
      const result = await ask({ cursor: at, maxBytes: CHUNK_BYTES })
      if (closed()) return
      // «Load earlier» found the file replaced while this read ran, and cleared `cursor` to open it
      // again from its end: this read joins events that are gone, and setting `cursor` here would
      // undo that request. follow() opens the file next (it was asked again meanwhile).
      if (cursor === undefined) return
      if (!result.ok) return failed(result.error)
      const answer = result.value
      if (!answer.found) {
        cursor = undefined
        setTranscript(key, { ...current(), loaded: true, found: false, error: undefined })
        return
      }
      // Truncated or replaced: what was shown no longer matches the file. Open it again from its end.
      if (answer.reset) return openEnd()
      events.push(...answer.events)
      offsets.push(...offsetsOf(answer.events, answer.offsets))
      at = answer.cursor
      if (!answer.more) break
    }
    cursor = at
    const shown = current()
    if (events.length === 0 && shown.found && shown.error === undefined) return
    setTranscript(key, { ...capped({ ...shown, events: [...shown.events, ...events], offsets: [...shown.offsets, ...offsets] }), loaded: true, found: true, error: undefined })
  }

  const follow = (): void => {
    if (running) {
      again = true
      return
    }
    running = true
    void (async () => {
      do {
        again = false
        await (cursor === undefined ? openEnd() : readOn(cursor))
      } while (again && !closed())
      running = false
    })()
  }

  /**
   * One window before the shown events. 'moved' when the shown events changed their start while it
   * was read (the cap dropped old ones as new ones came): the answer no longer joins them.
   */
  const earlierOnce = async (): Promise<'done' | 'moved'> => {
    const shown = current()
    if (shown.earlier === null || shown.earlier === 0 || shown.loadingEarlier || !shown.found) return 'done'
    const before = { offset: shown.earlier, fileId: cursor?.fileId ?? null }
    const generation = opened
    setTranscript(key, { ...shown, loadingEarlier: true })
    const result = await ask({ back: { bytes: TRANSCRIPT_WINDOW_BYTES, before } })
    if (closed()) return 'done'
    const now = current()
    // The file was opened again from its end meanwhile: its window replaced what this one would join.
    if (generation !== opened) {
      setTranscript(key, { ...now, loadingEarlier: false })
      return 'done'
    }
    if (now.earlier !== before.offset) {
      setTranscript(key, { ...now, loadingEarlier: false })
      return 'moved'
    }
    if (!result.ok) {
      console.error(`claudeHome.transcript ${label} (earlier) failed:`, result.error)
      setTranscript(key, { ...now, loadingEarlier: false })
      showToast({ kind: 'error', text: `Earlier messages could not be read: ${readableReason(result.error)}` })
      return 'done'
    }
    const answer = result.value
    if (answer.reset || !answer.found || answer.earlier === undefined) {
      // The file was replaced, cut or removed under the shown events: open it again from its end.
      setTranscript(key, { ...now, loadingEarlier: false })
      cursor = undefined
      follow()
      return 'done'
    }
    setTranscript(key, {
      ...now,
      events: [...answer.events, ...now.events],
      offsets: [...offsetsOf(answer.events, answer.offsets), ...now.offsets],
      first: now.first - answer.events.length,
      earlier: answer.earlier,
      loadingEarlier: false,
      pinned: true,
    })
    return 'done'
  }

  /** «Load earlier»: asks again from the new start when the shown events moved while it read. */
  const earlier = async (): Promise<void> => {
    for (let attempt = 0; attempt < 5; attempt += 1) if ((await earlierOnce()) === 'done') return
  }

  const reader: TranscriptReader = { follow, earlier }
  return reader
}

/**
 * Puts the window of the transcript before the shown events in front of them («Load earlier»,
 * ticket 21). Does nothing while no view shows the transcript, while a read of it runs, or once
 * the events start at the beginning of the file.
 */
export function loadEarlierTranscript(root: string, sessionId: string, agentId?: string): Promise<void> {
  return readers.get(transcriptKey(root, sessionId, agentId))?.earlier() ?? Promise.resolve()
}

/**
 * «Load earlier» until `grew()` says the view shows more, the start of the file is reached, or a
 * press moves nothing. The Session view shows the turns written since Resume from its live events
 * (joinPastAndLive), so a window that holds only those turns adds no row: it reads on.
 */
export async function loadEarlierUntil(root: string, sessionId: string, grew: () => boolean): Promise<void> {
  const key = transcriptKey(root, sessionId)
  for (let round = 0; round < 100; round += 1) {
    const before = transcriptNow(key).earlier
    await loadEarlierTranscript(root, sessionId)
    const after = transcriptNow(key).earlier
    if (grew() || after === null || after === 0 || after === before) return
  }
}

/** The state of a transcript's view now, outside React (for loadEarlierUntil's `grew`). */
export function sessionTranscriptNow(root: string, sessionId: string): TranscriptState {
  return transcriptNow(transcriptKey(root, sessionId))
}

/**
 * «Load earlier» for a view of a transcript read from its end (src/renderer/session/Transcript.tsx,
 * `earlier`): none before the first read and none once the shown events start at the beginning of
 * the file. `load` replaces the plain press (the Session view reads on past its live turns).
 */
export function earlierControl(
  state: TranscriptState,
  root: string | undefined,
  sessionId: string | undefined,
  agentId?: string,
  load?: () => void,
): { load: () => void; loading: boolean } | undefined {
  if (root === undefined || sessionId === undefined || state.earlier === null || state.earlier === 0) return undefined
  return { load: load ?? (() => void loadEarlierTranscript(root, sessionId, agentId)), loading: state.loadingEarlier }
}

/**
 * The events of a Session's transcript file (the Session's own thread, src/shared/transcript/parse.ts),
 * followed while the calling component is mounted: new records show up as Claude Code writes them.
 * With `agentId`, the transcript of that Subagent of the Session instead (ticket 15).
 */
export function useSessionTranscript(root: string | undefined, sessionId: string | undefined, agentId?: string): TranscriptState {
  useEffect(() => {
    if (root === undefined || sessionId === undefined) return
    acquire(root)
    const key = transcriptKey(root, sessionId, agentId)
    const reader = transcriptReader(root, sessionId, agentId)
    readers.set(key, reader)
    setTranscript(key, EMPTY_TRANSCRIPT)
    reader.follow()
    // A Subagent's file is not watched: read on while it is shown.
    const timer = agentId === undefined ? undefined : setInterval(reader.follow, SUBAGENT_POLL_MS)
    return () => {
      if (timer !== undefined) clearInterval(timer)
      if (readers.get(key) === reader) readers.delete(key)
      useClaudeHomeStore.setState(({ transcripts }) => {
        const rest = { ...transcripts }
        delete rest[key]
        return { transcripts: rest }
      })
      release(root)
    }
  }, [root, sessionId, agentId])
  return useClaudeHomeStore((store) =>
    root === undefined || sessionId === undefined ? EMPTY_TRANSCRIPT : (store.transcripts[transcriptKey(root, sessionId, agentId)] ?? EMPTY_TRANSCRIPT),
  )
}
