// The renderer's copy of each Project's workflow model (Epics and Tickets, read by main through
// epic-status; ADR-0002). Several views read one Project — the Canvas's Epic frames, the sidebar's
// Epics section — so the copy is shared: the first user opens the Project in main
// (`workflow.open`), the last one to leave closes it (`workflow.close`), and every
// `workflow.changed` delta is applied here once.
//
// A delta replaces only the Epics and Tickets it carries; every other object keeps its identity,
// so a view can tell cheaply which Epic changed.
import { useEffect } from 'react'
import { create } from 'zustand'
import { ticketKey, type WorkflowDelta, type WorkflowModel } from '../../shared/workflow/types'
import { invoke, showSubscribeError, subscribe } from '../ipc'

export interface WorkflowEntry {
  /** Undefined until main has answered `workflow.open`. */
  model: WorkflowModel | undefined
  /** Why `workflow.open` failed. */
  error: string | undefined
}

interface WorkflowStore {
  byRoot: Readonly<Record<string, WorkflowEntry>>
}

const useWorkflowStore = create<WorkflowStore>(() => ({ byRoot: {} }))

const EMPTY: WorkflowEntry = { model: undefined, error: undefined }

/** Applies a delta to a model; objects that the delta does not name are kept as they are. */
export function applyWorkflowDelta(model: WorkflowModel, delta: WorkflowDelta): WorkflowModel {
  const changedEpics = new Map(delta.epics.map((epic) => [epic.epic, epic]))
  const removedEpics = new Set(delta.removedEpics)
  const epics = model.epics.filter((epic) => !removedEpics.has(epic.epic)).map((epic) => changedEpics.get(epic.epic) ?? epic)
  for (const epic of delta.epics) if (!model.epics.some((known) => known.epic === epic.epic)) epics.push(epic)

  const changedTickets = new Map(delta.tickets.map((ticket) => [ticketKey(ticket), ticket]))
  const removedTickets = new Set(delta.removedTickets.map(ticketKey))
  const known = new Set(model.tickets.map(ticketKey))
  const tickets = model.tickets
    .filter((ticket) => !removedTickets.has(ticketKey(ticket)))
    .map((ticket) => changedTickets.get(ticketKey(ticket)) ?? ticket)
  for (const ticket of delta.tickets) if (!known.has(ticketKey(ticket))) tickets.push(ticket)

  return { root: model.root, epics, tickets, error: delta.error, branchErrors: delta.branchErrors }
}

function setEntry(root: string, entry: WorkflowEntry): void {
  useWorkflowStore.setState(({ byRoot }) => ({ byRoot: { ...byRoot, [root]: entry } }))
}

let subscribed = false
const users = new Map<string, number>()
/**
 * Deltas that arrived while `workflow.open` was still on its way. They are applied on top of its
 * answer: applying a delta the answer already contains changes nothing, so none is lost.
 */
const early = new Map<string, WorkflowDelta[]>()

function onChanged(delta: WorkflowDelta): void {
  if (!users.has(delta.root)) return
  const entry = useWorkflowStore.getState().byRoot[delta.root]
  if (!entry?.model) {
    early.set(delta.root, [...(early.get(delta.root) ?? []), delta])
    return
  }
  setEntry(delta.root, { model: applyWorkflowDelta(entry.model, delta), error: undefined })
}

function ensureSubscribed(): void {
  if (subscribed) return
  subscribed = true
  try {
    subscribe('workflow.changed', onChanged)
  } catch (error) {
    showSubscribeError('workflow.changed', error)
  }
}

function acquire(root: string): void {
  ensureSubscribed()
  const count = users.get(root) ?? 0
  users.set(root, count + 1)
  if (count > 0) return
  void invoke('workflow.open', { root }).then((result) => {
    // Everyone left while main was reading; the close below already went out.
    if (!users.has(root)) return
    const pending = early.get(root) ?? []
    early.delete(root)
    if (result.ok) setEntry(root, { model: pending.reduce(applyWorkflowDelta, result.value), error: undefined })
    else {
      console.error(`workflow.open ${root} failed:`, result.error)
      setEntry(root, { model: undefined, error: result.error })
    }
  })
}

function release(root: string): void {
  const count = users.get(root) ?? 0
  if (count > 1) {
    users.set(root, count - 1)
    return
  }
  users.delete(root)
  early.delete(root)
  useWorkflowStore.setState(({ byRoot }) => {
    const rest = { ...byRoot }
    delete rest[root]
    return { byRoot: rest }
  })
  void invoke('workflow.close', { root })
}

/** The workflow model of the Project at `root`, kept current while the calling component is mounted. */
export function useWorkflow(root: string | undefined): WorkflowEntry {
  useEffect(() => {
    if (root === undefined) return
    acquire(root)
    return () => release(root)
  }, [root])
  return useWorkflowStore((store) => (root === undefined ? EMPTY : (store.byRoot[root] ?? EMPTY)))
}
