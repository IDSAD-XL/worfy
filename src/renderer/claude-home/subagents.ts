// The Subagent trees of Sessions in the renderer (ticket 15). A tree is built by the pure
// src/shared/transcript/subagents.ts from two sources:
//
// - what main reads under ~/.claude (`claudeHome.subagents`): the Agent calls in the Session's
//   transcript and its `subagents/` folder. Asked again when the Session's transcript changes
//   (`claudeHome.changed`), and every POLL_MS while a Subagent runs, by the files or by the live
//   events: a nested Subagent's progress is written to its parent's file, which is not watched,
//   and a file event may come late (FSEvents under load) or not at all while the Session is idle
//   and its Subagent works in the background;
// - the events of a live Session of worfy (session/store.ts), for the fake agent and for the
//   moments before Claude Code has written the files. An event carries no time, so the time worfy
//   first saw it stands in for its start or end.
//
// Several views read one Session — its Node's tree on the Canvas, the rail of the Session view —
// so each (Project, Session) is asked for once and kept while anyone reads it.
import { useEffect, useMemo, useState } from 'react'
import { create } from 'zustand'
import type { AgentEvent, AgentEventEnvelope } from '../../shared/agent/events'
import type { HiddenSubagents } from '../../shared/ipc/claude-home'
import { buildSubagentTree, flattenSubagents, subagentSignals, type SubagentFile, type SubagentInfo, type SubagentSignal } from '../../shared/transcript/subagents'
import { invoke, subscribe } from '../ipc'
import { ensureAgentEvents, useSessionLogs } from '../session/store'
import { useClaudeHome } from './useClaudeHome'

/** How often the files are asked again while a Subagent of the Session runs. */
export const POLL_MS = 2000

export interface SessionFiles {
  signals: readonly SubagentSignal[]
  files: readonly SubagentFile[]
  found: boolean
  /** When the Session's running process started, when main knows it (ADR-0085). */
  processStartedAt?: number | undefined
}

interface SubagentsStore {
  /** By `<root>\0<sessionId>`. */
  bySession: Readonly<Record<string, SessionFiles>>
}

const EMPTY_FILES: SessionFiles = { signals: [], files: [], found: false }
const EMPTY_TREE: readonly SubagentInfo[] = []
const keyOf = (root: string, sessionId: string): string => `${root}\0${sessionId}`

export const useSubagentsStore = create<SubagentsStore>(() => ({ bySession: {} }))

// ── times of live events ────────────────────────────────────────────────────

/** When worfy first saw each live Subagent event, by `<kind>:<id>`. */
const seenAt = new Map<string, number>()
let liveSubscribed = false

function eventKey(event: AgentEvent): string | null {
  if (event.type === 'tool_use') return `call:${event.id}`
  if (event.type === 'tool_result') return `result:${event.toolUseId}`
  if (event.type === 'subagent') return `${event.phase}:${event.taskId}`
  return null
}

function stamp(event: AgentEvent, now: number): number {
  const key = eventKey(event)
  if (key === null) return now
  const known = seenAt.get(key)
  if (known !== undefined) return known
  seenAt.set(key, now)
  return now
}

/** Notes the time of every Subagent event as it arrives, for every Session. */
function ensureLiveTimes(): void {
  if (liveSubscribed) return
  liveSubscribed = true
  try {
    subscribe('agent.event', ({ event }: AgentEventEnvelope) => {
      if (event.type === 'subagent' || event.type === 'tool_use' || event.type === 'tool_result') stamp(event, Date.now())
    })
  } catch (error) {
    liveSubscribed = false
    console.error('agent.event: cannot subscribe', error)
  }
}

const relevantOf = (events: readonly AgentEvent[]): AgentEvent[] =>
  events.filter((event) => event.type === 'subagent' || event.type === 'tool_use' || event.type === 'tool_result')

/** The Subagent signals of a live Session's events; `now` stands in for events not seen before. */
export function liveSignals(events: readonly AgentEvent[], now = Date.now()): SubagentSignal[] {
  return subagentSignals(relevantOf(events).map((event) => ({ event, at: stamp(event, now) })))
}

// ── files from main ─────────────────────────────────────────────────────────

interface Reader {
  users: number
  running: boolean
  again: boolean
  timer: ReturnType<typeof setInterval> | undefined
  /** Whether the Session's tree, live events included, has a running Subagent (noteRunning). */
  live: boolean
}

const readers = new Map<string, Reader>()
let changesSubscribed = false

function setFiles(key: string, files: SessionFiles): void {
  useSubagentsStore.setState(({ bySession }) => ({ bySession: { ...bySession, [key]: files } }))
}

/** Asks main again; a call while one runs makes one more after it, so none overlap and none is lost. */
function refresh(root: string, sessionId: string): void {
  const key = keyOf(root, sessionId)
  const reader = readers.get(key)
  if (reader === undefined) return
  if (reader.running) {
    reader.again = true
    return
  }
  reader.running = true
  void (async () => {
    do {
      reader.again = false
      const result = await invoke('claudeHome.subagents', { projectRoot: root, sessionId })
      if (readers.get(key) !== reader) return
      if (result.ok) setFiles(key, result.value)
      else console.error(`claudeHome.subagents ${sessionId} failed:`, result.error)
    } while (reader.again)
    reader.running = false
    schedule(root, sessionId)
  })()
}

const anyRunning = (tree: readonly SubagentInfo[]): boolean => tree.some((info) => info.status === 'running' || anyRunning(info.children))

/** Polls while the Session's files, or its tree with the live events, say a Subagent runs. */
function schedule(root: string, sessionId: string): void {
  const key = keyOf(root, sessionId)
  const reader = readers.get(key)
  if (reader === undefined) return
  const files = useSubagentsStore.getState().bySession[key] ?? EMPTY_FILES
  const running = reader.live || anyRunning(buildSubagentTree(files))
  if (running && reader.timer === undefined) reader.timer = setInterval(() => refresh(root, sessionId), POLL_MS)
  else if (!running && reader.timer !== undefined) {
    clearInterval(reader.timer)
    reader.timer = undefined
  }
}

function onChanged(change: { projectRoot: string; transcripts: string[] }): void {
  for (const sessionId of change.transcripts) if (readers.has(keyOf(change.projectRoot, sessionId))) refresh(change.projectRoot, sessionId)
}

function acquire(root: string, sessionId: string): void {
  if (!changesSubscribed) {
    changesSubscribed = true
    try {
      subscribe('claudeHome.changed', onChanged)
    } catch (error) {
      changesSubscribed = false
      console.error('claudeHome.changed: cannot subscribe', error)
    }
  }
  const key = keyOf(root, sessionId)
  const reader = readers.get(key)
  if (reader) {
    reader.users += 1
    return
  }
  readers.set(key, { users: 1, running: false, again: false, timer: undefined, live: false })
  refresh(root, sessionId)
}

/** The hooks tell whether a Session's tree, live events included, has a running Subagent. */
function noteRunning(root: string, sessionId: string, running: boolean): void {
  const reader = readers.get(keyOf(root, sessionId))
  if (reader === undefined || reader.live === running) return
  reader.live = running
  // A Subagent that just ended may have written its transcript since the last read, and the file
  // event may be lost: one more read, which then schedules (and stops the poll if nothing runs).
  if (!running) refresh(root, sessionId)
  // While a read is under way, it schedules when it ends.
  else if (!reader.running) schedule(root, sessionId)
}

function release(root: string, sessionId: string): void {
  const key = keyOf(root, sessionId)
  const reader = readers.get(key)
  if (reader === undefined) return
  reader.users -= 1
  if (reader.users > 0) return
  if (reader.timer !== undefined) clearInterval(reader.timer)
  readers.delete(key)
  trees.delete(key)
  useSubagentsStore.setState(({ bySession }) => {
    const rest = { ...bySession }
    delete rest[key]
    return { bySession: rest }
  })
}

// ── hooks ───────────────────────────────────────────────────────────────────

/** The tree of one Session from its files and, for a Session of worfy, its live events. */
export function treeOf(files: SessionFiles | undefined, events: readonly AgentEvent[] | undefined): readonly SubagentInfo[] {
  const live = events && events.length > 0 ? liveSignals(events) : []
  if ((files === undefined || (files.signals.length === 0 && files.files.length === 0)) && live.length === 0) return EMPTY_TREE
  return buildSubagentTree({ signals: [...(files?.signals ?? []), ...live], files: files?.files ?? [], processStartedAt: files?.processStartedAt })
}

/** The last tree of each Session and what it was built from: text streaming in does not rebuild it. */
const trees = new Map<string, { files: SessionFiles | undefined; relevant: readonly AgentEvent[]; tree: readonly SubagentInfo[] }>()
const sameEvents = (a: readonly AgentEvent[], b: readonly AgentEvent[]): boolean => a.length === b.length && a.every((event, index) => event === b[index])

function cachedTree(key: string, files: SessionFiles | undefined, events: readonly AgentEvent[] | undefined): readonly SubagentInfo[] {
  const relevant = events ? relevantOf(events) : []
  const last = trees.get(key)
  if (last && last.files === files && sameEvents(last.relevant, relevant)) return last.tree
  const tree = treeOf(files, events)
  trees.set(key, { files, relevant, tree })
  return tree
}

/**
 * The Subagent trees of several Sessions of the Project at `root`, by Session id, kept current
 * while the calling component is mounted. The same object while nothing changed.
 */
export function useSubagentTrees(root: string | undefined, sessionIds: readonly string[]): ReadonlyMap<string, readonly SubagentInfo[]> {
  useClaudeHome(root)
  const ids = sessionIds.join('\n')
  useEffect(() => {
    ensureAgentEvents()
    ensureLiveTimes()
    if (root === undefined || ids === '') return
    const list = ids.split('\n')
    for (const sessionId of list) acquire(root, sessionId)
    return () => {
      // Released after the next run of this effect has taken its own list: React runs the cleanup
      // and the next effect in one go, so a Session in both lists keeps its reader, its files and
      // its tree instead of dropping them and being read again.
      queueMicrotask(() => {
        for (const sessionId of list) release(root, sessionId)
      })
    }
  }, [root, ids])
  const bySession = useSubagentsStore((store) => store.bySession)
  const logs = useSessionLogs((store) => store.logs)
  const trees = useMemo(() => {
    const trees = new Map<string, readonly SubagentInfo[]>()
    if (root === undefined) return trees
    for (const sessionId of ids === '' ? [] : ids.split('\n')) {
      const key = keyOf(root, sessionId)
      const tree = cachedTree(key, bySession[key], logs[sessionId]?.events)
      if (tree.length > 0) trees.set(sessionId, tree)
    }
    return trees
  }, [root, ids, bySession, logs])
  // After the effect above, so a Session new to the list has its reader by now.
  useEffect(() => {
    if (root === undefined || ids === '') return
    for (const sessionId of ids.split('\n')) noteRunning(root, sessionId, anyRunning(trees.get(sessionId) ?? EMPTY_TREE))
  }, [root, ids, trees])
  return trees
}

/** The Subagent tree of one Session. */
export function useSubagentTree(root: string | undefined, sessionId: string | null | undefined): readonly SubagentInfo[] {
  const ids = useMemo(() => (sessionId ? [sessionId] : []), [sessionId])
  const trees = useSubagentTrees(root, ids)
  return (sessionId ? trees.get(sessionId) : undefined) ?? EMPTY_TREE
}

// ── how a Subagent's time is shown ──────────────────────────────────────────

/** "45s", "6m 05s", "1h 02m". */
export function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`
}

/** The tooltip of an `interrupted` Subagent's status (ADR-0085). */
export const INTERRUPTED_TOOLTIP = "The Session's process restarted after this agent's last record: it was stopped from outside, not by a failure"

/** A Subagent's status with how long it has run (`running 1m 05s`) or ran (`done 2m 55s`, `Interrupted 4m 10s`). */
export function statusLabel(agent: Pick<SubagentInfo, 'status' | 'startedAt' | 'durationMs'>, now: number): string {
  const label = agent.status === 'interrupted' ? 'Interrupted' : agent.status
  if (agent.status === 'running') return agent.startedAt === null ? label : `${label} ${formatElapsed(now - agent.startedAt)}`
  return agent.durationMs === null ? label : `${label} ${formatElapsed(agent.durationMs)}`
}

/** Now, redrawn every second while `ticking`: a running Subagent's time goes on. */
export function useTick(ticking: boolean): number {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!ticking) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [ticking])
  return now
}

// ── hidden Subagents ────────────────────────────────────────────────────────

// The entries the user hid with «Hide» (worfy-polish ticket 45, ADR-0085), kept by main in the
// Project's data folder. Read once per Project while the window runs; each Hide and «Show hidden
// Subagents» answers the whole list again.

interface HiddenStore {
  /** By Project id. */
  byProject: Readonly<Record<string, HiddenSubagents['sessions']>>
}

const NOTHING_HIDDEN: HiddenSubagents['sessions'] = {}
const NO_IDS: ReadonlySet<string> = new Set()
export const useHiddenSubagentsStore = create<HiddenStore>(() => ({ byProject: {} }))
const asked = new Set<string>()
/** How many Hide and Show answers each Project has had: a first read asked before one of them is older than it. */
const changes = new Map<string, number>()

function setHidden(projectId: string, sessions: HiddenSubagents['sessions']): void {
  useHiddenSubagentsStore.setState(({ byProject }) => ({ byProject: { ...byProject, [projectId]: sessions } }))
}

/** A Hide or Show answer: the whole list as main has it after the change. */
function changedHidden(projectId: string, sessions: HiddenSubagents['sessions']): void {
  changes.set(projectId, (changes.get(projectId) ?? 0) + 1)
  setHidden(projectId, sessions)
}

function loadHidden(projectId: string): void {
  if (asked.has(projectId)) return
  asked.add(projectId)
  const before = changes.get(projectId) ?? 0
  void invoke('claudeHome.hiddenSubagents', { projectId }).then((result) => {
    if (result.ok) {
      // A Hide answered while this read was under way already gave a newer list.
      if ((changes.get(projectId) ?? 0) === before) setHidden(projectId, result.value.sessions)
    } else {
      asked.delete(projectId)
      console.error(`claudeHome.hiddenSubagents ${projectId} failed:`, result.error)
    }
  })
}

/** The hidden Subagent entries of a Project, by Session id; none until main has answered. */
export function useHiddenSubagents(projectId: string | undefined): HiddenSubagents['sessions'] {
  useEffect(() => {
    if (projectId !== undefined) loadHidden(projectId)
  }, [projectId])
  return useHiddenSubagentsStore((store) => (projectId === undefined ? NOTHING_HIDDEN : (store.byProject[projectId] ?? NOTHING_HIDDEN)))
}

/** Hides entries of a Session (any status); the list then comes from main's answer. */
export async function hideSubagents(projectId: string, sessionId: string, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return
  const result = await invoke('claudeHome.hideSubagents', { projectId, sessionId, ids: [...ids] })
  if (result.ok) changedHidden(projectId, result.value.sessions)
  else console.error(`claudeHome.hideSubagents ${sessionId} failed:`, result.error)
}

/** «Show hidden Subagents»: every hidden entry of the Session shows again. */
export async function showHiddenSubagents(projectId: string, sessionId: string): Promise<void> {
  const result = await invoke('claudeHome.showSubagents', { projectId, sessionId })
  if (result.ok) changedHidden(projectId, result.value.sessions)
  else console.error(`claudeHome.showSubagents ${sessionId} failed:`, result.error)
}

/** The hidden ids of one Session as a set. */
export const hiddenIdsOf = (hidden: HiddenSubagents['sessions'], sessionId: string | null | undefined): ReadonlySet<string> => {
  const ids = sessionId ? hidden[sessionId] : undefined
  return ids === undefined || ids.length === 0 ? NO_IDS : new Set(ids)
}

/**
 * The tree without the hidden entries. A hidden entry's own Subagents take its place under its
 * parent: hiding a finished entry never hides a running one under it. The same tree when nothing
 * of it is hidden.
 */
export function withoutHidden(tree: readonly SubagentInfo[], hidden: ReadonlySet<string>): readonly SubagentInfo[] {
  if (hidden.size === 0 || !flattenSubagents(tree).some((info) => hidden.has(info.id))) return tree
  const level = (list: readonly SubagentInfo[], depth: number): SubagentInfo[] =>
    list.flatMap((info) => (hidden.has(info.id) ? level(info.children, depth) : [{ ...info, depth, children: level(info.children, depth + 1) }]))
  return level(tree, 1)
}

/** The ids of every entry of `list` and below it that has ended — done, error or interrupted — for «Hide finished». */
export const finishedIds = (list: readonly SubagentInfo[]): string[] => flattenSubagents(list).flatMap((info) => (info.status === 'running' ? [] : [info.id]))

/** Folded with the done ones: ended without a failure (ADR-0085). */
export const folds = (info: Pick<SubagentInfo, 'status'>): boolean => info.status === 'done' || info.status === 'interrupted'

/** What a fold of finished Subagents says: `3 done`, `3 done · 2 interrupted`, `2 interrupted`. */
export function foldLabel(list: readonly Pick<SubagentInfo, 'status'>[]): string {
  const done = list.filter((info) => info.status === 'done').length
  const interrupted = list.filter((info) => info.status === 'interrupted').length
  return [done > 0 || interrupted === 0 ? `${done} done` : null, interrupted > 0 ? `${interrupted} interrupted` : null].filter((part) => part !== null).join(' · ')
}
