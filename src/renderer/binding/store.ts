// The renderer's copy of what Bindings are made of (ticket 16), shared by the Canvas (its Binding
// lines, sources/workflow-bindings.ts and edges/bindings.ts) and the Session rail
// (session/rail/BindingRail.tsx):
//
// - the stored Bindings of each Project (`bindings.get`, then `bindings.changed`): the manual ones
//   and those of the agents worfy launched (ticket 23, `source: 'launch'`);
// - the signals of each Session's transcript and of its Subagents' (`bindings.signals`), asked
//   again when the Session's transcript changes (`claudeHome.changed`) and every POLL_MS while the
//   Session is live: a Subagent's file is not watched.
//
// The Binding itself is resolved here by the pure src/shared/binding/resolve.ts, with the workflow
// model, so a change of any of the three shows at once.
import { useEffect, useMemo } from 'react'
import { create } from 'zustand'
import { bindingWorkflowOf, resolveBinding, type Binding, type BindingTarget, type BindingWorkflow } from '../../shared/binding/resolve'
import { agentKey, isLaunchBinding, type BindingAgent, type ManualBinding, type SessionBindingSignals } from '../../shared/ipc/bindings'
import type { WorkflowModel } from '../../shared/workflow/types'
import { invoke, subscribe } from '../ipc'
import { readOnlyNow } from '../projects/read-only-now'

/** How often the signals of a live Session are asked again. */
export const POLL_MS = 3000

interface BindingsStore {
  /** By projectId; undefined until main has answered. */
  manual: Readonly<Record<string, readonly ManualBinding[]>>
  /** By projectId: main's error when `bindings.get` failed, until the Bindings arrive. */
  manualError: Readonly<Record<string, string>>
  /** By `<root>\0<sessionId>`. */
  signals: Readonly<Record<string, SessionBindingSignals>>
}

export const useBindingsStore = create<BindingsStore>(() => ({ manual: {}, manualError: {}, signals: {} }))

const signalsKey = (root: string, sessionId: string): string => `${root}\0${sessionId}`

// ── manual Bindings ─────────────────────────────────────────────────────────

const asked = new Set<string>()
let changesSubscribed = false

function setManual(projectId: string, bindings: readonly ManualBinding[]): void {
  useBindingsStore.setState(({ manual, manualError }) => {
    const errors = { ...manualError }
    delete errors[projectId]
    return { manual: { ...manual, [projectId]: bindings }, manualError: errors }
  })
}

function ensureManual(projectId: string): void {
  if (!changesSubscribed) {
    changesSubscribed = true
    try {
      subscribe('bindings.changed', ({ projectId: changed, bindings }) => setManual(changed, bindings))
    } catch (error) {
      changesSubscribed = false
      console.error('bindings.changed: cannot subscribe', error)
    }
  }
  if (asked.has(projectId)) return
  asked.add(projectId)
  void invoke('bindings.get', { projectId }).then((result) => {
    if (result.ok) setManual(projectId, result.value.bindings)
    else {
      asked.delete(projectId)
      useBindingsStore.setState(({ manualError }) => ({ manualError: { ...manualError, [projectId]: result.error } }))
      console.error('bindings.get failed:', result.error)
    }
  })
}

const NO_MANUAL: readonly ManualBinding[] = []

/** The Project's manual Bindings; empty until main has answered. */
export function useManualBindings(projectId: string | undefined): readonly ManualBinding[] {
  useEffect(() => {
    if (projectId !== undefined) ensureManual(projectId)
  }, [projectId])
  return useBindingsStore((state) => (projectId === undefined ? NO_MANUAL : (state.manual[projectId] ?? NO_MANUAL)))
}

/** Binds an agent by hand; resolves to the error, or undefined when it worked. */
export async function bindManually(projectId: string, agent: BindingAgent, target: BindingTarget): Promise<string | undefined> {
  // A read-only screen (worfy-link ticket 25) sends nothing.
  const readOnly = readOnlyNow()
  if (readOnly !== null) return readOnly
  const result = await invoke('bindings.set', { projectId, ...agent, target })
  if (!result.ok) return result.error
  setManual(projectId, result.value.bindings)
  return undefined
}

/** "Remove binding": the agent's automatic Binding applies again. */
export async function removeManualBinding(projectId: string, agent: BindingAgent): Promise<string | undefined> {
  const readOnly = readOnlyNow()
  if (readOnly !== null) return readOnly
  const result = await invoke('bindings.remove', { projectId, ...agent })
  if (!result.ok) return result.error
  setManual(projectId, result.value.bindings)
  return undefined
}

// ── signals ─────────────────────────────────────────────────────────────────

/** Readers of each `<root>\0<sessionId>`. */
const readers = new Map<string, number>()
const inFlight = new Map<string, Promise<void>>()
const again = new Set<string>()
let homeSubscribed = false

/**
 * Reads the signals of one Session of the Project at `root` again into the store; one read at a
 * time per Session, with one more after it when asked meanwhile. Resolves when the store has them
 * (or the read failed, which it logs).
 */
export async function refreshSessionSignals(root: string, sessionId: string): Promise<void> {
  return refresh(root, sessionId)
}

/** The signals the store holds for one Session of the Project at `root`, if read. */
export function sessionSignalsOf(root: string, sessionId: string): SessionBindingSignals | undefined {
  return useBindingsStore.getState().signals[signalsKey(root, sessionId)]
}

async function refresh(root: string, sessionId: string): Promise<void> {
  const key = signalsKey(root, sessionId)
  const running = inFlight.get(key)
  if (running) {
    // One more read after the running one: what changed meanwhile is not lost.
    again.add(key)
    return running
  }
  const read = (async () => {
    do {
      again.delete(key)
      const result = await invoke('bindings.signals', { projectRoot: root, sessionId })
      if (!result.ok) {
        console.error(`bindings.signals ${sessionId} failed:`, result.error)
        break
      }
      useBindingsStore.setState(({ signals }) => ({ signals: { ...signals, [key]: result.value } }))
    } while (again.has(key))
  })().finally(() => inFlight.delete(key))
  inFlight.set(key, read)
  return read
}

function ensureHomeSubscription(): void {
  if (homeSubscribed) return
  homeSubscribed = true
  try {
    subscribe('claudeHome.changed', ({ projectRoot, transcripts }) => {
      for (const sessionId of transcripts) if (readers.has(signalsKey(projectRoot, sessionId))) void refresh(projectRoot, sessionId)
    })
  } catch (error) {
    homeSubscribed = false
    console.error('claudeHome.changed: cannot subscribe', error)
  }
}

/**
 * Keeps the signals of these Sessions of the Project at `root` (and of their Subagents) and
 * returns them by Session id. `liveIds` are asked again every POLL_MS.
 */
export function useSessionSignals(root: string | undefined, sessionIds: readonly string[], liveIds: readonly string[] = []): ReadonlyMap<string, SessionBindingSignals> {
  const ids = sessionIds.join('\n')
  const live = liveIds.join('\n')
  useEffect(() => {
    if (root === undefined || ids === '') return
    ensureHomeSubscription()
    const keys = ids.split('\n')
    for (const sessionId of keys) {
      const key = signalsKey(root, sessionId)
      const count = readers.get(key) ?? 0
      readers.set(key, count + 1)
      if (count === 0) void refresh(root, sessionId)
    }
    return () => {
      for (const sessionId of keys) {
        const key = signalsKey(root, sessionId)
        const count = (readers.get(key) ?? 1) - 1
        if (count <= 0) readers.delete(key)
        else readers.set(key, count)
      }
    }
  }, [root, ids])
  useEffect(() => {
    if (root === undefined || live === '') return
    const wanted = new Set(ids.split('\n'))
    const timer = setInterval(() => {
      for (const sessionId of live.split('\n')) if (wanted.has(sessionId)) void refresh(root, sessionId)
    }, POLL_MS)
    return () => clearInterval(timer)
  }, [root, ids, live])
  const all = useBindingsStore((state) => state.signals)
  return useMemo(() => {
    const map = new Map<string, SessionBindingSignals>()
    if (root === undefined) return map
    for (const sessionId of ids === '' ? [] : ids.split('\n')) {
      const found = all[signalsKey(root, sessionId)]
      if (found) map.set(sessionId, found)
    }
    return map
  }, [all, root, ids])
}

// ── resolving ───────────────────────────────────────────────────────────────

export interface AgentBindingsInput {
  sessionIds: readonly string[]
  signals: ReadonlyMap<string, SessionBindingSignals>
  manual: readonly ManualBinding[]
  workflow: BindingWorkflow | undefined
}

/**
 * The Binding of every agent of these Sessions, by agentKey(): each Session, each Subagent that
 * has a transcript, and each Subagent the user bound by hand. Agents without a Binding are left out.
 */
export function resolveAgentBindings({ sessionIds, signals, manual, workflow }: AgentBindingsInput): Map<string, Binding> {
  const byKey = (launch: boolean) =>
    new Map(manual.filter((binding) => isLaunchBinding(binding) === launch).map((binding) => [agentKey(binding.sessionId, binding.agentId), binding.target]))
  const manualByKey = byKey(false)
  const launchByKey = byKey(true)
  const result = new Map<string, Binding>()
  const add = (key: string, binding: Binding | null) => {
    if (binding) result.set(key, binding)
  }
  for (const sessionId of sessionIds) {
    const found = signals.get(sessionId)
    add(sessionId, resolveBinding({ manual: manualByKey.get(sessionId), launch: launchByKey.get(sessionId), signals: found?.session }, workflow))
    for (const { agentId, signals: own } of found?.subagents ?? []) {
      const key = agentKey(sessionId, agentId)
      add(key, resolveBinding({ manual: manualByKey.get(key), launch: launchByKey.get(key), signals: own, subagent: true }, workflow))
    }
    for (const binding of manual) {
      const key = agentKey(binding.sessionId, binding.agentId)
      if (binding.sessionId === sessionId && binding.agentId !== null && !result.has(key))
        add(key, resolveBinding({ manual: manualByKey.get(key), launch: launchByKey.get(key), subagent: true }, workflow))
    }
  }
  return result
}

/** True once main has answered `bindings.get` for the Project, with its Bindings or with an error. */
export const manualRead = (state: Pick<BindingsStore, 'manual' | 'manualError'>, projectId: string): boolean =>
  state.manual[projectId] !== undefined || state.manualError[projectId] !== undefined

/**
 * The Bindings of these Sessions of the Project from what the store has now: the Project's manual
 * Bindings (none before main answered `bindings.get`), and the transcript signals read so far (a
 * Session whose signals are not read binds only by hand), against the workflow model.
 */
export function storedBindings(projectId: string, root: string, sessionIds: readonly string[], model: WorkflowModel | undefined): Map<string, Binding> {
  const signals = new Map<string, SessionBindingSignals>()
  for (const sessionId of sessionIds) {
    const found = sessionSignalsOf(root, sessionId)
    if (found !== undefined) signals.set(sessionId, found)
  }
  const manual = useBindingsStore.getState().manual[projectId] ?? NO_MANUAL
  return resolveAgentBindings({ sessionIds, signals, manual, workflow: bindingWorkflowOf(model) })
}

/** The Sessions on a Project's plane whose Bindings are waited for, and the folder their transcript signals are read for. */
interface SessionsToRead {
  root: string
  sessions: readonly string[]
}

/**
 * True when the Bindings of the Project's Sessions on the plane are read: main has answered
 * `bindings.get` (with the Bindings or with an error) and the store has the transcript signals of
 * every such Session. A Project without a Session on the plane has none to read.
 */
function bindingsRead(projectId: string, { root, sessions }: SessionsToRead): boolean {
  if (sessions.length === 0) return true
  return manualRead(useBindingsStore.getState(), projectId) && sessions.every((sessionId) => sessionSignalsOf(root, sessionId) !== undefined)
}

/** Resolves to true once the Bindings of these Sessions are read (bindingsRead), or to false when `limitMs` passed without it. */
export function whenBindingsRead(projectId: string, input: SessionsToRead, limitMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    if (bindingsRead(projectId, input)) {
      resolve(true)
      return
    }
    const stop = (read: boolean) => {
      clearTimeout(timer)
      unsubscribe()
      resolve(read)
    }
    const timer = setTimeout(() => stop(false), limitMs)
    const unsubscribe = useBindingsStore.subscribe(() => {
      if (bindingsRead(projectId, input)) stop(true)
    })
  })
}

/** The manual Binding of one agent, if it has one; a launch Binding (ticket 23) is not one. */
export function manualOf(manual: readonly ManualBinding[], agent: BindingAgent): ManualBinding | undefined {
  return manual.find((binding) => !isLaunchBinding(binding) && binding.sessionId === agent.sessionId && (binding.agentId ?? null) === (agent.agentId ?? null))
}

/** The launch Binding of one agent ("Ship ticket", "Run wave"), if it has one. */
export function launchOf(manual: readonly ManualBinding[], agent: BindingAgent): ManualBinding | undefined {
  return manual.find((binding) => isLaunchBinding(binding) && binding.sessionId === agent.sessionId && (binding.agentId ?? null) === (agent.agentId ?? null))
}

/** The title of what a Binding points at, from the workflow model. */
export function bindingTargetTitle(binding: Binding | null, model: WorkflowModel | undefined): string | null {
  if (binding === null || model === undefined) return null
  const { target } = binding
  if (target.kind === 'ticket') return model.tickets.find((ticket) => ticket.epic === target.epic && ticket.num === target.num)?.title ?? null
  return model.epics.find((epic) => epic.epic === target.epic)?.title ?? null
}
