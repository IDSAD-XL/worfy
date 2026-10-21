// The record of the strip of Epic frames (ADR-0075, epic-arrangement.ts) as the Canvas keeps it up
// to date: what the last build of a Project's frames knew (sources/epics.ts publishes it), the
// activity "active first" reads, the write of the `epic-arrangement` Node, and the upkeep that
// writes it on its own, past the ⌘Z history (ADR-0016) — the first opening of the Project in a
// day, after the Bindings of its Sessions are read, and a K the hysteresis let change — and
// "Re-pack", the user's gesture (useRepack). The palette's request for it goes through the frames'
// UI state in sources/epics.ts.
import { useCallback, useEffect, useRef } from 'react'
import { useStoreApi } from '@xyflow/react'
import { EPIC_ARRANGEMENT_ID, EPIC_ARRANGEMENT_KIND } from '../../shared/layout/derived'
import type { Ticket, WorkflowModel } from '../../shared/workflow/types'
import { storedBindings, useBindingsStore, whenBindingsRead } from '../binding/store'
import { liveSessionsNow } from '../claude-home/useClaudeHome'
import { invoke } from '../ipc'
import { readOnlyNow } from '../projects/read-only-now'
import { readArrangement, repack, sameDay, type ArrangedFrame, type ArrangementRecord } from './epic-arrangement'
import type { CanvasFlowNode } from './nodes'
import { BINDING_ANCHOR_KIND, type BindingAnchorData } from './sources/workflow-bindings'
import { applyLayoutOp, currentLayout, useLayoutOps, type LayoutOps } from './useLayout'

/** What the last build of a Project's frames knew: what the record is written from. */
export interface ArrangementState {
  /** Every frame's size, by Epic. */
  frames: ReadonlyMap<string, ArrangedFrame>
  /** The Epics with a frame, in the workflow model's order. */
  epics: readonly string[]
  /** The record as the Layout has it; null when there is none or it is not whole. */
  record: ArrangementRecord | null
  /** K the frames are drawn with now. */
  columns: number
  /**
   * True when every open frame with Tickets shows ELK's answer for its current inputs (or the
   * window has no ELK): the sizes are the ones drawn, not those of the synchronous layout before it.
   */
  settled: boolean
  /** The Epics on the done shelf (ADR-0075, point 5). */
  shelf: readonly string[]
  /** Those of them collapsed by default: the Layout has no `collapsed` of theirs, no gesture put them there. */
  defaultShelf: readonly string[]
  /** The Project's workflow model: its folder (`root`), its Tickets, and what the Bindings of its Sessions resolve against. */
  model: WorkflowModel
  /** The Sessions on the plane that can be bound (sources/workflow-bindings.ts agentNodes). */
  sessions: readonly string[]
}

/** Per Project, the last build's arrangement. */
const arrangements = new Map<string, ArrangementState>()
/** Per Project, what waits for the next build of its arrangement (`whenSettled`). */
const arrangementWaiters = new Map<string, Set<() => void>>()

/** Keeps the last build's arrangement of the Project (sources/epics.ts buildEpicNodes); undefined drops it. */
export function setArrangement(projectId: string, state: ArrangementState | undefined): void {
  if (state === undefined) arrangements.delete(projectId)
  else arrangements.set(projectId, state)
  const waiters = arrangementWaiters.get(projectId)
  if (waiters !== undefined) for (const waiter of [...waiters]) waiter()
}

/**
 * Resolves once the Project's frames show ELK's answers for their current inputs, or once there is
 * no arrangement for it any more. No limit: ELK answers every request, a failed one with the
 * synchronous layout (elk/client.ts).
 */
function whenSettled(projectId: string): Promise<void> {
  return new Promise((resolve) => {
    const check = () => {
      if (arrangements.get(projectId)?.settled === false) return
      arrangementWaiters.get(projectId)?.delete(check)
      resolve()
    }
    const waiters = arrangementWaiters.get(projectId) ?? new Set()
    arrangementWaiters.set(projectId, waiters)
    waiters.add(check)
    check()
  })
}

/** What the Project's frames were last drawn from, or undefined before its workflow model was read. */
export function arrangementOf(projectId: string): ArrangementState | undefined {
  return arrangements.get(projectId)
}

/**
 * The Epics with work now (ADR-0075, point 4): a claimed Ticket (`work`), a live agent bound to the
 * Epic or to one of its Tickets, the Epic of the Project's running Autopilot.
 */
export function epicsWithWork(tickets: readonly Pick<Ticket, 'epic' | 'state'>[], liveBound: Iterable<string>, autopilot: string | null): Set<string> {
  const epics = new Set<string>(liveBound)
  for (const ticket of tickets) if (ticket.state === 'work') epics.add(ticket.epic)
  if (autopilot !== null) epics.add(autopilot)
  return epics
}

/** What the activity reads of React Flow's Nodes: the Binding anchors (sources/workflow-bindings.ts). */
type AnchorLookup = ReadonlyMap<string, { type?: string | undefined; data: Record<string, unknown> }>

/** What the activity reads of the Project without React Flow: its Tickets, and its Sessions' Bindings in binding/store.ts. */
type ActivityInput = Pick<ArrangementState, 'model' | 'sessions'>

/**
 * The Epics of the live Sessions with a Binding: resolved from the Bindings' store as the anchors
 * are (sources/workflow-bindings.ts), with main's list of the live Sessions now (liveSessionsNow).
 */
async function liveBoundSessions(projectId: string, { model, sessions }: ActivityInput): Promise<string[]> {
  const { root } = model
  const bindings = storedBindings(root, sessions, useBindingsStore.getState().manual[projectId] ?? [], model)
  const bound = sessions.filter((sessionId) => bindings.has(sessionId))
  if (bound.length === 0) return []
  const found = await liveSessionsNow(root)
  // Without the live list the order goes by the rest of the activity.
  if (found === undefined) return []
  const live = new Set(found.map((session) => session.sessionId))
  return bound.filter((sessionId) => live.has(sessionId)).map((sessionId) => bindings.get(sessionId)!.target.epic)
}

/**
 * The Epics with work at this moment: the claimed Tickets, the live bound agents and the Project's
 * Autopilot as main reports it. A live Session counts by its Binding in the Bindings' store and by
 * its anchor on the Canvas.
 * A Subagent's status is known only to the Subagent tree's Nodes (sources/subagents.ts), so:
 * shortcut: a live Subagent counts only once its Binding anchor is drawn, redo when the Subagents' status gets a store this source can read without React Flow.
 */
export async function activityNow(projectId: string, input: ActivityInput, nodes: AnchorLookup): Promise<Set<string>> {
  const live: string[] = []
  for (const node of nodes.values()) {
    if (node.type !== BINDING_ANCHOR_KIND) continue
    const data = (node.data as Partial<CanvasFlowNode['data']>).node?.data as BindingAnchorData | undefined
    if (data?.variant === 'agent' && data.live) live.push(data.binding.target.epic)
  }
  live.push(...(await liveBoundSessions(projectId, input)))
  let autopilot: string | null = null
  try {
    const state = await invoke('autopilot.state', { projectId })
    if (state.ok && state.value.status !== 'stopped') autopilot = state.value.epic
  } catch (error) {
    // Without the Autopilot's state the order goes by the rest of the activity.
    console.error('autopilot.state failed:', error)
  }
  return epicsWithWork(input.model.tickets, live, autopilot)
}

/**
 * Writes the record. `ops` makes it the user's gesture ("Re-pack"): a `patchData` recorded as one
 * step of ⌘Z, after a `create` of an empty record that is no step of its own (as saveEpicChange
 * does). Without `ops` it is automatic and goes past the history (ADR-0016): a `create` with the
 * data, or a `patchData` when the record is there.
 */
export async function saveArrangement(projectId: string, record: ArrangementRecord, ops?: LayoutOps): Promise<void> {
  const exists = currentLayout(projectId)?.nodes.some((node) => node.id === EPIC_ARRANGEMENT_ID) ?? false
  const data = { order: record.order, columns: record.columns, at: record.at }
  if (!exists) {
    const node = { id: EPIC_ARRANGEMENT_ID, kind: EPIC_ARRANGEMENT_KIND, x: 0, y: 0, w: 1, h: 1, locked: true, data: ops === undefined ? data : {} }
    const refused = await applyLayoutOp(projectId, { op: 'create', node })
    // A create refused because another screen's came first: the data goes to that record below.
    if (ops === undefined && refused === undefined) return
  }
  if (ops !== undefined) await ops.apply({ op: 'patchData', id: EPIC_ARRANGEMENT_ID, data }, undefined, { data: true })
  else await applyLayoutOp(projectId, { op: 'patchData', id: EPIC_ARRANGEMENT_ID, data })
}

/**
 * "Re-pack" for the Canvas of `projectId` (ADR-0075, point 4): the order "active first" and K
 * without hysteresis, written as one step of ⌘Z through the Canvas's LayoutOps. For a component
 * inside React Flow and the Canvas's LayoutOps (the Canvas menu). Nothing is sent on a read-only
 * screen.
 */
export function useRepack(projectId: string): () => Promise<void> {
  const ops = useLayoutOps()
  const store = useStoreApi()
  return useCallback(async () => {
    const state = arrangements.get(projectId)
    if (state === undefined || state.epics.length === 0 || readOnlyNow() !== null) return
    const activity = await activityNow(projectId, state, store.getState().nodeLookup)
    const now = arrangements.get(projectId) ?? state
    await saveArrangement(projectId, { ...repack(now.epics, now.frames, activity), at: new Date().toISOString() }, ops)
  }, [projectId, ops, store])
}

/** Per Project, the K an automatic write has sent and the Layout does not show yet: it is not sent twice. */
const pendingColumns = new Map<string, number>()
/** Per Project, the order without the shelf's Epics an automatic write has sent and the Layout does not show yet. */
const pendingOrders = new Map<string, string>()

/**
 * How long the first opening of the day waits for the Bindings of the Project's Sessions to be read
 * (`whenBindingsRead`) before it writes the day's order without them.
 */
export const FIRST_OPENING_WAIT_MS = 3000

/**
 * Per Project, the first-opening write under way (writeFirstOpening) and its calendar day: from its
 * start until it ends, sent or failed. No other automatic write goes out meanwhile, so the first
 * opening makes one write, not two. Each write removes only its own mark: a write of the day before
 * that ends after midnight leaves the next day's.
 */
const dayWrites = new Map<string, { day: string }>()

const dayKey = (now: Date): string => now.toDateString()
const today = (record: ArrangementRecord | null): boolean => record !== null && sameDay(record.at, new Date())
const recordInLayout = (projectId: string): ArrangementRecord | null => readArrangement(currentLayout(projectId)?.nodes.find((node) => node.id === EPIC_ARRANGEMENT_ID))

/**
 * The first opening's write: the order "active first" and K afresh, once the Bindings of the
 * Project's Sessions are read, so a live bound agent counts though its anchor is not drawn yet (at
 * the latest after FIRST_OPENING_WAIT_MS, with one line in the log, from what is known by then),
 * and once the frames show ELK's answers, so K is counted from the sizes drawn. Nothing is written
 * when the Layout has a record of today by then: another screen's, or "Re-pack" during the wait.
 */
async function writeFirstOpening(projectId: string, start: ArrangementState, nodes: () => AnchorLookup): Promise<void> {
  const mark = { day: dayKey(new Date()) }
  dayWrites.set(projectId, mark)
  try {
    if (!(await whenBindingsRead(projectId, { root: start.model.root, sessions: start.sessions }, FIRST_OPENING_WAIT_MS)))
      console.warn(`epic arrangement: the Bindings of Project ${projectId} were not read in ${FIRST_OPENING_WAIT_MS} ms; the day's order counts the live agents known by then`)
    const now = arrangements.get(projectId) ?? start
    const activity = await activityNow(projectId, now, nodes())
    // The frames may have changed while the Bindings were read: K waits for ELK's answers again.
    await whenSettled(projectId)
    if (today(recordInLayout(projectId))) return
    // Midnight passed during the wait: the record of the new day is that day's first opening's.
    if (dayKey(new Date()) !== mark.day) return
    const last = arrangements.get(projectId) ?? now
    await saveArrangement(projectId, { ...repack(last.epics, last.frames, activity), at: new Date().toISOString() })
  } finally {
    if (dayWrites.get(projectId) === mark) dayWrites.delete(projectId)
  }
}

/**
 * Keeps the record up to date on a screen that may change the Layout, past the ⌘Z history: once
 * per opening of the Project's Canvas, a record from another calendar day (or none) is computed
 * again, active first; afterwards, a K the hysteresis let change is written, so the next build
 * keeps it. Both wait until the frames show ELK's answers, so K is counted from the sizes drawn.
 * A frame whose ELK request failed counts as answered: elk/client.ts answers it with the
 * synchronous layout. The day's write also waits for the Bindings (writeFirstOpening), and nothing
 * else is written before it: the first opening makes one automatic write.
 *
 * An Epic on the done shelf by default (all its Tickets done, its frame never collapsed or
 * expanded by the user) leaves the record's order with one more write past ⌘Z: no gesture of the
 * user put it there, so there is no step to undo. An Epic the collapse button put on the shelf
 * left the order in that button's ⌘Z step (toggleFrame), and undoing it must give the order back,
 * so this write leaves it alone. A frame out of the order comes back last, by whatever way it
 * leaves the shelf: a click on its chip (expandFromShelf), or a Ticket reopened or added, which
 * makes it an Epic the order lacks (epic-arrangement.ts orderFor: new Epics go to the end). A
 * read-only screen writes nothing.
 */
export function useArrangementUpkeep(projectId: string, nodes: readonly CanvasFlowNode[]): void {
  const store = useStoreApi()
  const checkedDay = useRef(false)
  useEffect(() => {
    const state = arrangements.get(projectId)
    if (state === undefined || readOnlyNow() !== null) return
    if (!checkedDay.current && state.epics.length > 0) {
      if (!today(state.record)) {
        if (!state.settled) return
        checkedDay.current = true
        // Another mount of this Canvas may have started today's write already.
        if (dayWrites.get(projectId)?.day !== dayKey(new Date()))
          writeFirstOpening(projectId, state, () => store.getState().nodeLookup).catch((error: unknown) => console.error('epic arrangement: the day\'s write failed:', error))
        return
      }
      if (state.settled) checkedDay.current = true
    }
    // Any day's write under way, also one that started before midnight: its record comes first.
    if (dayWrites.has(projectId)) return
    // main has a record of today and this build has not read it yet: it is drawn from the one before.
    if (!today(state.record) && today(recordInLayout(projectId))) return
    const shelved = new Set(state.defaultShelf)
    const kept = state.record?.order.filter((epic) => !shelved.has(epic))
    if (state.record !== null && kept !== undefined && kept.length < state.record.order.length) {
      const key = JSON.stringify(kept)
      if (pendingOrders.get(projectId) === key) return
      pendingOrders.set(projectId, key)
      void applyLayoutOp(projectId, { op: 'patchData', id: EPIC_ARRANGEMENT_ID, data: { order: kept } })
      return
    }
    pendingOrders.delete(projectId)
    if (state.epics.length === 0 || !state.settled) return
    if (state.record === null || state.record.columns === state.columns) {
      pendingColumns.delete(projectId)
      return
    }
    if (pendingColumns.get(projectId) === state.columns) return
    pendingColumns.set(projectId, state.columns)
    void applyLayoutOp(projectId, { op: 'patchData', id: EPIC_ARRANGEMENT_ID, data: { columns: state.columns } })
  }, [projectId, nodes, store])
}
