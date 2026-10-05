// The renderer's copy of each Project's Sessions as Claude Code records them under ~/.claude
// (src/shared/ipc/claude-home.ts): the live ones and the history, and the events of a Session's
// transcript file. Several views read one Project — the Session Nodes, the sidebar's Sessions
// section, a read-only Session view — so the copy is shared: the first user asks main for the
// Sessions (`claudeHome.sessions`, which also subscribes this window to `claudeHome.changed`), the
// last one to leave closes the subscription (`claudeHome.close`).
//
// The live list is asked again (`claudeHome.live`) when the registry changes and every
// LIVE_POLL_MS while a Session is live: a process that dies without removing its registry file
// changes no file, and only asking again shows that it is gone. The history (titles) is read again
// once for a Session that is new to the renderer, and then on the next poll after its transcript
// changed while it still has no title: the registry file can appear before the first prompt
// creates the transcript. worfy never writes under ~/.claude.
import { useEffect } from 'react'
import { create } from 'zustand'
import type { AgentEvent } from '../../shared/agent/events'
import type { HistorySession, LiveSession } from '../../shared/ipc/claude-home'
import { invoke, subscribe } from '../ipc'

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
/** Live Sessions the history was read again for, by root: one more read each, not one per poll. */
const reread = new Map<string, Set<string>>()
/** Live Sessions without a title whose transcript changed since the history was read, by root. */
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

async function refreshAll(root: string): Promise<void> {
  const result = await invoke('claudeHome.sessions', { projectRoot: root })
  if (!users.has(root)) return
  if (result.ok) setEntry(root, { live: result.value.live, history: result.value.history, error: undefined })
  else {
    console.error(`claudeHome.sessions ${root} failed:`, result.error)
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

async function refreshLive(root: string): Promise<void> {
  const result = await invoke('claudeHome.live', { projectRoot: root })
  if (!users.has(root)) return
  if (!result.ok) {
    console.error(`claudeHome.live ${root} failed:`, result.error)
    return
  }
  const entry = useClaudeHomeStore.getState().byRoot[root] ?? EMPTY
  const known = new Set(entry.history.map((session) => session.sessionId))
  const asked = reread.get(root) ?? new Set<string>()
  reread.set(root, asked)
  setEntry(root, { live: result.value.live, error: undefined })
  // A Session that started since the history was read: read it again once, for its title.
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
    if (wantsTitle(root, sessionId)) untitled.set(root, (untitled.get(root) ?? new Set()).add(sessionId))
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
