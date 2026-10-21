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
import type { HistorySession, LiveSession } from '../../shared/ipc/claude-home'
import { invoke, readableReason, subscribe } from '../ipc'
import { errorText, showIpcError } from '../toast/toasts'

/** How often the live list is asked again while a Session is live. */
export const LIVE_POLL_MS = 2000
/** Events kept per transcript; older ones are dropped first. */
const KEEP_EVENTS = 5000
/** Bytes asked for in one `claudeHome.transcript` call. */
const CHUNK_BYTES = 1024 * 1024

export interface ClaudeHomeEntry {
  /** Undefined until main has answered once. */
  live: readonly LiveSession[] | undefined
  history: readonly HistorySession[]
  error: string | undefined
}

export interface TranscriptState {
  events: readonly AgentEvent[]
  /** Position of `events[0]` in the whole transcript (older events were dropped). */
  first: number
  /** False until the first read; then whether the file was found. */
  loaded: boolean
  found: boolean
  error: string | undefined
}

interface ClaudeHomeStore {
  byRoot: Readonly<Record<string, ClaudeHomeEntry>>
  /** By `<root>\0<sessionId>`. */
  transcripts: Readonly<Record<string, TranscriptState>>
}

const useClaudeHomeStore = create<ClaudeHomeStore>(() => ({ byRoot: {}, transcripts: {} }))

const EMPTY: ClaudeHomeEntry = { live: undefined, history: [], error: undefined }
const EMPTY_TRANSCRIPT: TranscriptState = { events: [], first: 0, loaded: false, found: false, error: undefined }
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
/** Readers of each transcript, by transcriptKey. */
const readers = new Map<string, () => void>()
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

async function refreshLive(root: string): Promise<void> {
  const request = (lastRequest += 1)
  const result = await invoke('claudeHome.live', { projectRoot: root })
  if (!users.has(root)) return
  if (!result.ok) {
    console.error(`claudeHome.live ${root} failed:`, result.error)
    showIpcError('claudeHome.live', `Live Sessions not read: ${readableReason(result.error)}`)
    return
  }
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
    readers.get(transcriptKey(root, sessionId))?.()
  }
}

function ensureSubscribed(): void {
  if (subscribed) return
  subscribed = true
  try {
    subscribe('claudeHome.changed', onChanged)
  } catch (error) {
    subscribed = false
    console.error('claudeHome.changed: cannot subscribe', error)
    showIpcError('claudeHome.changed', `Updates stopped: cannot subscribe to claudeHome.changed (${errorText(error)})`)
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

function capped(events: readonly AgentEvent[], first: number): Pick<TranscriptState, 'events' | 'first'> {
  const over = events.length - KEEP_EVENTS
  return over > 0 ? { events: events.slice(over), first: first + over } : { events, first }
}

/**
 * Reads a transcript from where the last read stopped, until the end of the file. A change that
 * arrives during a read starts one more read after it, so none is lost and reads never overlap.
 */
function transcriptReader(root: string, sessionId: string, agentId?: string): () => void {
  const key = transcriptKey(root, sessionId, agentId)
  let cursor: { offset: number; fileId: string | null } | undefined
  let running = false
  let again = false

  const read = async (): Promise<void> => {
    for (let round = 0; round < 1000; round += 1) {
      const request = { projectRoot: root, sessionId, maxBytes: CHUNK_BYTES, ...(cursor ? { cursor } : {}) }
      const result = agentId === undefined ? await invoke('claudeHome.transcript', request) : await invoke('claudeHome.subagentTranscript', { ...request, agentId })
      if (readers.get(key) !== start) return // closed while reading
      const current = useClaudeHomeStore.getState().transcripts[key] ?? EMPTY_TRANSCRIPT
      if (!result.ok) {
        console.error(`claudeHome.transcript ${sessionId}${agentId === undefined ? '' : `/${agentId}`} failed:`, result.error)
        setTranscript(key, { ...current, loaded: true, error: result.error })
        return
      }
      const { found, events, reset, more } = result.value
      cursor = result.value.cursor
      const base = reset ? EMPTY_TRANSCRIPT : current
      const next = events.length > 0 ? capped([...base.events, ...events], base.first) : { events: base.events, first: base.first }
      setTranscript(key, { ...next, loaded: true, found, error: undefined })
      if (!found || !more) return
    }
  }

  const start = (): void => {
    if (running) {
      again = true
      return
    }
    running = true
    void (async () => {
      do {
        again = false
        await read()
      } while (again && readers.get(key) === start)
      running = false
    })()
  }
  return start
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
    const start = transcriptReader(root, sessionId, agentId)
    readers.set(key, start)
    setTranscript(key, EMPTY_TRANSCRIPT)
    start()
    // A Subagent's file is not watched: read on while it is shown.
    const timer = agentId === undefined ? undefined : setInterval(start, SUBAGENT_POLL_MS)
    return () => {
      if (timer !== undefined) clearInterval(timer)
      if (readers.get(key) === start) readers.delete(key)
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
