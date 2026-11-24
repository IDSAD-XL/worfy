// The Acceptance queue in the window (worfy-acceptance ticket 05): main's `acceptance.get`, then every
// `acceptance.changed` (src/shared/ipc/acceptance.ts). main computes the groups, the Stable copy line and the Sent
// marks; the window keeps only what is its own: the selected row, the groups opened or closed, and the decisions it is
// sending now. AcceptanceView.tsx draws it; the toolbar tab reads the count of Ready to check from here.
import { useEffect, useState } from 'react'
import { create } from 'zustand'
import { failureReason } from '../../shared/ipc/channels'
import type { AcceptanceGroupName, AcceptanceItemRow, AcceptanceRow, AcceptanceSent, AcceptanceState } from '../../shared/ipc/acceptance'
import type { OwnerCheckCopy, OwnerCheckPlatform, OwnerCheckVerdict } from '../../shared/projects/action-templates'
import { invoke, readableReason, subscribe } from '../ipc'

export interface AcceptanceStore {
  /** main's queue; null until it has answered once. */
  state: AcceptanceState | null
  /** Why the queue could not be read; null when it was. */
  error: string | null
  /** The key of the selected row (rowKey); null before there is one. */
  selected: string | null
  /** The groups the owner opened (In work, Older) or closed. */
  open: Readonly<Record<AcceptanceGroupName, boolean>>
  /** Rows whose decision main has not answered yet: their Pass and Fail are inactive, so no second one goes. */
  sending: Readonly<Record<string, OwnerCheckVerdict>>
  /** Decisions sent from this window that the queue does not mark Sent yet: the row reads "Sent" meanwhile. */
  sentHere: Readonly<Record<string, OwnerCheckVerdict>>
  /** main's refusal of the last decision of a row ("reload the Acceptance view", Autopilot). */
  refused: Readonly<Record<string, string>>
}

/** In work and Older stay closed until the owner opens them (spec, "Groups"). */
const OPEN: Readonly<Record<AcceptanceGroupName, boolean>> = { ready: true, update: true, waits: true, failed: true, work: false, older: false }

export const useAcceptanceStore = create<AcceptanceStore>(() => ({ state: null, error: null, selected: null, open: OPEN, sending: {}, sentHere: {}, refused: {} }))

/** One row of the queue: an item of a Ticket, or a Ticket that waits for the owner (Waits for you). */
export function rowKey(row: AcceptanceRow): string {
  const { projectId, epic, num } = row.ticket
  return row.kind === 'item' ? `${projectId}\n${epic}\n${num}\n${row.item.index}` : `${projectId}\n${epic}\n${num}`
}

/** The rows ↑ and ↓ move along: those of the open groups, in the order the list shows them. */
export function shownRows(state: AcceptanceState | null, open: Readonly<Record<AcceptanceGroupName, boolean>>): AcceptanceRow[] {
  return (state?.groups ?? []).flatMap((group) => (open[group.group] ? group.rows : []))
}

/** The number on the tab: the items of Ready to check not Sent yet, by main's mark or by this window. */
export function readyCount(state: AcceptanceState | null, sentHere: Readonly<Record<string, OwnerCheckVerdict>>): number {
  const rows = state?.groups.find((group) => group.group === 'ready')?.rows ?? []
  return rows.filter((row) => row.kind !== 'item' || sentOf(row, sentHere) === null).length
}

/** The Sent mark a row shows: main's, else one this window has just sent. */
export function sentOf(row: AcceptanceItemRow, sentHere: Readonly<Record<string, OwnerCheckVerdict>>): AcceptanceSent | null {
  if (row.sent !== null) return row.sent
  const verdict = sentHere[rowKey(row)]
  return verdict === undefined ? null : { verdict, at: new Date().toISOString(), state: 'sent' }
}

/**
 * The row to select in `state`: the one selected while it is still shown; when it went (a decision recorded, its group
 * closed), the row that now stands where it stood; with none chosen yet, the first of Ready to check, else the first.
 */
function reselect(before: readonly AcceptanceRow[], after: readonly AcceptanceRow[], selected: string | null): string | null {
  if (after.length === 0) return null
  if (selected !== null && after.some((row) => rowKey(row) === selected)) return selected
  const at = selected === null ? -1 : before.findIndex((row) => rowKey(row) === selected)
  if (at >= 0) return rowKey(after[Math.min(at, after.length - 1)]!)
  return rowKey(after[0]!)
}

function accept(state: AcceptanceState): void {
  useAcceptanceStore.setState((store) => {
    const before = shownRows(store.state, store.open)
    const after = shownRows(state, store.open)
    const keys = new Map(state.groups.flatMap((group) => group.rows.map((row) => [rowKey(row), row] as const)))
    // A decision sent from here stays "Sent" until main marks the row, or the row goes.
    const sentHere = Object.fromEntries(Object.entries(store.sentHere).filter(([key]) => {
      const row = keys.get(key)
      return row?.kind === 'item' && row.sent === null
    }))
    return { state, error: null, sentHere, selected: reselect(before, after, store.selected) }
  })
}

let started = false

/** Subscribes to the changes and reads the queue, once per window load: the tab's count needs it before the view opens. */
function start(): void {
  if (started) return
  started = true
  let changed = false
  try {
    subscribe('acceptance.changed', (state) => {
      changed = true
      accept(state)
    })
  } catch (error) {
    console.error('acceptance.changed: cannot subscribe', error)
  }
  void invoke('acceptance.get').then((result) => {
    if (!result.ok) useAcceptanceStore.setState({ error: readableReason(result.error) })
    // A change that came first is newer than this answer.
    else if (!changed) accept(result.value)
  })
}

/** The queue and the window's own state; the first call starts the reading. */
export function useAcceptance(): AcceptanceStore {
  useEffect(start, [])
  return useAcceptanceStore()
}

/** The count of Ready to check, for the tab; starts the reading too. */
export function useReadyCount(): number {
  useEffect(start, [])
  return useAcceptanceStore((store) => readyCount(store.state, store.sentHere))
}

export function selectRow(key: string): void {
  useAcceptanceStore.setState({ selected: key })
}

/** ↑ (-1) or ↓ (1) along the shown rows; stops at the ends. */
export function moveSelection(step: 1 | -1): void {
  const { state, open, selected } = useAcceptanceStore.getState()
  const rows = shownRows(state, open)
  const at = rows.findIndex((row) => rowKey(row) === selected)
  const next = rows[at < 0 ? 0 : Math.max(0, Math.min(rows.length - 1, at + step))]
  if (next !== undefined) selectRow(rowKey(next))
}

export function toggleGroup(group: AcceptanceGroupName): void {
  useAcceptanceStore.setState((store) => {
    const open = { ...store.open, [group]: !store.open[group] }
    const rows = shownRows(store.state, open)
    // A group closed over the selected row hands the selection to the row now in its place.
    return { open, selected: reselect(shownRows(store.state, store.open), rows, store.selected) }
  })
}

/** Selects the row of `target` (its item, or the Ticket's first row) and opens its group. False when the queue has none. */
export function focusAcceptance(target: { projectId: string; epic: string; num: number; item?: number }): boolean {
  const { state } = useAcceptanceStore.getState()
  for (const group of state?.groups ?? []) {
    const row = group.rows.find((each) => each.ticket.projectId === target.projectId && each.ticket.epic === target.epic && each.ticket.num === target.num && (target.item === undefined || (each.kind === 'item' && each.item.index === target.item)))
    if (row === undefined) continue
    useAcceptanceStore.setState((store) => ({ open: { ...store.open, [group.group]: true }, selected: rowKey(row) }))
    return true
  }
  return false
}

/** Where the owner checked: the platform, the copy and its commit (`-` when not known). */
export interface CheckedIn {
  platform: OwnerCheckPlatform
  copy: OwnerCheckCopy
  sha: string
}

/**
 * Pass or Fail of an item: `actions.ownerCheck` with the item's text as the owner saw it, so main refuses a decision on
 * an item rewritten meanwhile. While main answers, the row's buttons are inactive; once sent, the row reads "Sent" and
 * the next row is selected; a refusal stays under the row's buttons.
 */
export async function sendDecision(row: AcceptanceItemRow, verdict: OwnerCheckVerdict, where: CheckedIn, words: string): Promise<void> {
  const key = rowKey(row)
  const { sending } = useAcceptanceStore.getState()
  if (sending[key] !== undefined) return
  useAcceptanceStore.setState((store) => ({ sending: { ...store.sending, [key]: verdict }, refused: without(store.refused, key) }))
  const { projectId, epic, num } = row.ticket
  const result = await invoke('actions.ownerCheck', { projectId, epic, num, item: row.item.index, itemText: row.item.text, verdict, ...where, words })
  useAcceptanceStore.setState((store) => {
    const rest = { sending: without(store.sending, key) }
    if (!result.ok) return { ...rest, refused: { ...store.refused, [key]: failureReason('actions.ownerCheck', result.error) } }
    const rows = shownRows(store.state, store.open)
    const at = rows.findIndex((each) => rowKey(each) === key)
    const next = at >= 0 && at + 1 < rows.length ? rowKey(rows[at + 1]!) : store.selected
    return { ...rest, sentHere: { ...store.sentHere, [key]: verdict }, selected: store.selected === key ? next : store.selected }
  })
}

function without<T>(record: Readonly<Record<string, T>>, key: string): Record<string, T> {
  const rest = { ...record }
  delete rest[key]
  return rest
}

/**
 * Whether Autopilot runs in Project `projectId` now: then Pass and Fail are inactive with the reason (spec Q6 (a)), as
 * main would refuse them. Asks nothing while `projectId` is null.
 */
export function useAutopilotRuns(projectId: string | null): boolean {
  const [state, setState] = useState<{ projectId: string; revision: number; runs: boolean } | null>(null)
  useEffect(() => {
    if (projectId === null) return
    let current = true
    const take = (next: { projectId: string; revision: number; status: string }): void => {
      if (!current || next.projectId !== projectId) return
      setState((known) => (known !== null && known.projectId === projectId && known.revision > next.revision ? known : { projectId, revision: next.revision, runs: next.status !== 'stopped' }))
    }
    const off = subscribe('autopilot.changed', take)
    void invoke('autopilot.state', { projectId }).then((result) => {
      if (result.ok) take(result.value)
    })
    return () => {
      current = false
      off()
    }
  }, [projectId])
  return state !== null && state.projectId === projectId && state.runs
}

/** The mode of the Project at `root` (`checks.repos`): in Full mode the owner's words go into the repository. */
export function useProjectMode(root: string | undefined): 'full' | 'silent' | null {
  const [mode, setMode] = useState<{ root: string; mode: 'full' | 'silent' } | null>(null)
  useEffect(() => {
    if (root === undefined) return
    let current = true
    void invoke('checks.repos', { root }).then((result) => {
      if (current && result.ok) setMode({ root, mode: result.value.mode })
    })
    return () => {
      current = false
    }
  }, [root])
  return mode !== null && mode.root === root ? mode.mode : null
}
