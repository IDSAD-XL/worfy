// Internal toasts (worfy-ui ticket 16): short messages inside the window. One store for the whole
// renderer; one component shows them (ToastRegion.tsx, mounted once in main.tsx). Any code of the renderer
// calls showToast(): the notice of a skipped ⌘Z (canvas/history.ts), "File is on <Machine>"
// (machines/useFileElsewhere.ts), a refused Fix of a Terminal, a copied command, an IPC subscription
// that failed.
//
// The rules:
// - `info` and `success` hide by themselves after TOAST_MS; `error` and `action` stay until closed.
//   A button of an `action` toast runs its handler and closes the toast.
// - One toast per `key`: showing a key again replaces that toast in place and starts its time again.
//   The key is the toast's id, so the caller can close it by its key.
// - A toast with a `projectId` is shown only while that Project is the active one (setToastProject).
// - At most MAX_SHOWN toasts are on screen. A new one pushes out the oldest self-hiding toast on
//   screen; when all on screen stay until closed, the new one waits in a queue and comes out, with
//   its time starting then, once a place frees.
// - The pointer or the keyboard focus on a toast stops its time; when both have left, the time
//   starts again in full.
import { createStore } from 'zustand/vanilla'

/** How long `info` and `success` toasts stay, in ms. */
export const TOAST_MS = 4000

/** How many toasts are on screen at most. */
export const MAX_SHOWN = 3

export type ToastKind = 'info' | 'success' | 'error' | 'action'

/** A button of an `action` toast. */
export interface ToastAction {
  readonly label: string
  readonly run: () => void
}

interface ToastBase {
  readonly text: string
  /** One toast per key: the same key replaces the toast. Without one every call adds a toast. */
  readonly key?: string
  /** Shown only while this Project is active; without one in every Project. */
  readonly projectId?: string
  /** `data-testid` of the toast's element. */
  readonly testId?: string
}

/** What showToast takes: an `action` toast has one to three buttons, the other kinds none. */
export type ToastInput =
  | (ToastBase & { readonly kind: 'info' | 'success' | 'error'; readonly actions?: undefined })
  | (ToastBase & { readonly kind: 'action'; readonly actions: readonly [ToastAction] | readonly [ToastAction, ToastAction] | readonly [ToastAction, ToastAction, ToastAction] })

export type Toast = ToastInput & {
  readonly id: string
  /** Grows each time the key is shown again: the component announces the text afresh. */
  readonly version: number
  /** In the queue behind MAX_SHOWN toasts that stay; its time has not started. */
  readonly waiting: boolean
}

export interface ToastsState {
  /** Every toast, oldest first: on screen, hidden by its Project, or waiting. */
  readonly toasts: readonly Toast[]
  /** The active Project, which decides what a toast with a projectId shows. */
  readonly project: string | undefined
}

export type HoldReason = 'hover' | 'focus'

export const toasts = createStore<ToastsState>(() => ({ toasts: [], project: undefined }))

const hidesItself = (toast: Toast): boolean => toast.kind === 'info' || toast.kind === 'success'
const visibleIn = (toast: Toast, project: string | undefined): boolean => toast.projectId === undefined || toast.projectId === project

/** The toasts on screen now, oldest first. */
export function shownToasts(state: ToastsState): Toast[] {
  return state.toasts.filter((toast) => !toast.waiting && visibleIn(toast, state.project))
}

const timers = new Map<string, ReturnType<typeof setTimeout>>()
const holds = new Map<string, Set<HoldReason>>()
let made = 0

function stopTimer(id: string): void {
  const timer = timers.get(id)
  if (timer === undefined) return
  clearTimeout(timer)
  timers.delete(id)
}

function forget(id: string): void {
  stopTimer(id)
  holds.delete(id)
}

/**
 * Keeps the stack within MAX_SHOWN of the active Project's toasts. While more are on screen, the
 * oldest self-hiding one but the newest leaves; with none, the newest goes to the queue. While fewer
 * are on screen, the oldest waiting toast comes out.
 */
function settle(list: readonly Toast[], project: string | undefined): Toast[] {
  const out = [...list]
  const shown = () => out.filter((toast) => !toast.waiting && visibleIn(toast, project))
  for (let on = shown(); on.length > MAX_SHOWN; on = shown()) {
    const newest = on[on.length - 1]!
    const victim = on.find((toast) => toast !== newest && hidesItself(toast))
    if (victim !== undefined) {
      forget(victim.id)
      out.splice(out.indexOf(victim), 1)
    } else out[out.indexOf(newest)] = { ...newest, waiting: true }
  }
  for (let on = shown(); on.length < MAX_SHOWN; on = shown()) {
    const next = out.find((toast) => toast.waiting && visibleIn(toast, project))
    if (next === undefined) break
    out[out.indexOf(next)] = { ...next, waiting: false }
  }
  return out
}

/** Starts the time of each self-hiding toast that is out of the queue and not held; stops the rest. */
function runTimers(): void {
  for (const toast of toasts.getState().toasts) {
    const runs = hidesItself(toast) && !toast.waiting && (holds.get(toast.id)?.size ?? 0) === 0
    if (!runs) stopTimer(toast.id)
    else if (!timers.has(toast.id)) timers.set(toast.id, setTimeout(() => dismissToast(toast.id), TOAST_MS))
  }
}

function commit(list: readonly Toast[]): void {
  toasts.setState({ toasts: settle(list, toasts.getState().project) })
  runTimers()
}

/** Shows a toast, or replaces the one with the same key; returns its id (its key, when it has one). */
export function showToast(input: ToastInput): string {
  const list = toasts.getState().toasts
  const id = input.key ?? `toast-${(made += 1)}`
  const at = list.findIndex((toast) => toast.id === id)
  if (at === -1) {
    commit([...list, { ...input, id, version: 1, waiting: false }])
    return id
  }
  const old = list[at]!
  // The time starts again: the old timer goes, runTimers() starts a new one.
  stopTimer(id)
  commit(list.with(at, { ...input, id, version: old.version + 1, waiting: old.waiting }))
  return id
}

/** Closes a toast; an id no toast has is ignored. */
export function dismissToast(id: string): void {
  const list = toasts.getState().toasts
  if (!list.some((toast) => toast.id === id)) return
  forget(id)
  commit(list.filter((toast) => toast.id !== id))
}

/** Runs button `index` of an `action` toast and closes the toast, even when the handler throws. */
export function pressToastAction(id: string, index: number): void {
  const toast = toasts.getState().toasts.find((each) => each.id === id)
  const button = toast?.actions?.[index]
  try {
    button?.run()
  } catch (error) {
    console.error(`toast ${id}: the action "${button?.label}" failed`, error)
  } finally {
    dismissToast(id)
  }
}

/**
 * The pointer (`hover`) or the keyboard focus (`focus`) came onto a toast (`held`) or left it. A call
 * that changes nothing (a release without a hold) leaves the time as it runs.
 */
export function holdToast(id: string, reason: HoldReason, held: boolean): void {
  if (!toasts.getState().toasts.some((toast) => toast.id === id)) return
  const reasons = holds.get(id) ?? new Set<HoldReason>()
  if (reasons.has(reason) === held) return
  if (held) reasons.add(reason)
  else reasons.delete(reason)
  holds.set(id, reasons)
  // A hold stops the time; the last release starts it again in full.
  stopTimer(id)
  runTimers()
}

/**
 * The Project now active in this window; undefined with none. ToastRegion.tsx calls it, so the active
 * Project is known only while that component is mounted: without it every toast with a projectId
 * counts as another Project's.
 */
export function setToastProject(projectId: string | undefined): void {
  if (toasts.getState().project === projectId) return
  toasts.setState({ project: projectId })
  commit(toasts.getState().toasts)
}

/** Whether the toast with this key (or id) is in the store: on screen, hidden by its Project or waiting. */
export function isToastShown(key: string): boolean {
  return toasts.getState().toasts.some((toast) => toast.id === key)
}

/** Closes every toast and forgets the active Project; tests start from an empty store. */
export function resetToasts(): void {
  for (const id of timers.keys()) clearTimeout(timers.get(id))
  timers.clear()
  holds.clear()
  toasts.setState({ toasts: [], project: undefined })
}
