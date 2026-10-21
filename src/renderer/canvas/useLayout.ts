// The renderer's copy of each Project's Layout. main owns it (src/main/layout/store.ts): the
// renderer only asks for it, listens to `layout.changed` and sends operations. One subscription
// serves every Canvas.
import { createContext, useContext, useEffect, useState } from 'react'
import { create } from 'zustand'
import type { LayoutChangeEvent } from '../../shared/ipc/layout'
import { EMPTY_LAYOUT, type Layout, type LayoutOpInput, type LayoutState } from '../../shared/layout/types'
import { invoke, showSubscribeError, subscribe } from '../ipc'
import { readOnlyNow } from '../projects/read-only-now'
import { noteLayoutChange, type LayoutChannel, type SendAnswer } from './history'
import type { LayoutOps } from './layout-ops'
import { screenId } from './screen'

export type { LayoutOps } from './layout-ops'

interface LayoutsStore {
  byProject: Readonly<Record<string, LayoutState>>
}

const useLayoutsStore = create<LayoutsStore>(() => ({ byProject: {} }))

/**
 * Takes a Layout from main unless a newer one of the same Project is already here: an answer to
 * an operation and the broadcast of a later one can arrive in either order.
 */
export function acceptLayoutState(state: LayoutState): void {
  const current = useLayoutsStore.getState().byProject[state.projectId]
  if (current && state.revision < current.revision) return
  useLayoutsStore.setState(({ byProject }) => ({ byProject: { ...byProject, [state.projectId]: state } }))
}

/**
 * What the renderer does with every `layout.changed`: the undo history hears who made the change
 * (history.ts, worfy-link ticket 07), then the Layout is taken unless a newer one is here.
 */
export function acceptLayoutChange(change: LayoutChangeEvent): void {
  noteLayoutChange(change)
  acceptLayoutState({ projectId: change.projectId, layout: change.layout, revision: change.revision })
}

let subscribed = false

function ensureSubscribed(): void {
  if (subscribed) return
  subscribed = true
  try {
    subscribe('layout.changed', acceptLayoutChange)
  } catch (error) {
    showSubscribeError('layout.changed', error)
  }
}

export interface UseLayout {
  state: LayoutState | undefined
  /** Why the Layout could not be loaded. */
  error: string | undefined
}

/** The Project's Layout; `state` is undefined until main has answered once. */
export function useLayout(projectId: string): UseLayout {
  const state = useLayoutsStore((store) => store.byProject[projectId])
  const [error, setError] = useState<{ projectId: string; message: string }>()

  useEffect(() => {
    ensureSubscribed()
    let active = true
    void invoke('layout.get', { projectId }).then((result) => {
      if (!active) return
      if (result.ok) acceptLayoutState(result.value)
      else {
        console.error('layout.get failed:', result.error)
        setError({ projectId, message: result.error })
      }
    })
    return () => {
      active = false
    }
  }, [projectId])

  return { state, error: error?.projectId === projectId ? error.message : undefined }
}

/** Sends one operation; resolves to the error text when main refused it. */
export async function applyLayoutOp(projectId: string, op: LayoutOpInput): Promise<string | undefined> {
  const answer = await sendLayoutOp(projectId, op)
  return typeof answer === 'string' ? answer : undefined
}

/**
 * Sends one operation, with the screen it comes from when it is a recorded gesture or its undo
 * (screen.ts); resolves to the error text when main refused it, else to the Layout's revision after it.
 * On the screen of a Linked machine that shares its Projects read-only (worfy-link ticket 25) nothing
 * is sent: the answer is the read-only hint, which main would refuse with anyway.
 */
export async function sendLayoutOp(projectId: string, op: LayoutOpInput, screen?: string): Promise<SendAnswer> {
  const readOnly = readOnlyNow()
  if (readOnly !== null) return readOnly
  const result = await invoke('layout.apply', screen === undefined ? { projectId, op } : { projectId, op, screen })
  if (result.ok) {
    acceptLayoutState(result.value)
    return { revision: result.value.revision }
  }
  console.error(`layout.apply ${op.op} failed:`, result.error)
  return result.error
}

/** What the Canvas adds to a screen channel: its own answer to a refusal, and its Layout before main's first answer. */
export interface ScreenChannelOptions {
  /** Called when main refuses an operation, before the refusal goes back to the history. */
  onRefused?: () => void
  /** The Layout until main has answered; an empty one when absent. */
  fallback?: () => Layout
}

/**
 * The channel of this screen's recorded gestures, on the Canvas (Canvas.tsx) and outside it
 * (canvas/show-node.ts, canvas/archive-now.ts): sent with this screen's id, so another screen's
 * history knows the change is not its own (history.ts, worfy-link ticket 07); the Layout is main's
 * latest answer, which sendLayoutOp() stores before it resolves, so the next operation of a gesture,
 * and an undo, see what the previous one did.
 */
export function screenChannel(projectId: string, { onRefused, fallback }: ScreenChannelOptions = {}): LayoutChannel {
  return {
    send: (op) =>
      sendLayoutOp(projectId, op, screenId()).then((answer) => {
        if (typeof answer === 'string') onRefused?.()
        return answer
      }),
    layout: () => currentLayout(projectId) ?? fallback?.() ?? EMPTY_LAYOUT,
  }
}

/** The Layout of a Project as main last sent it, or undefined before main has answered. */
export function currentLayout(projectId: string): Layout | undefined {
  return useLayoutsStore.getState().byProject[projectId]?.layout
}

export const LayoutOpsContext = createContext<LayoutOps>({
  apply: (op) => {
    console.error(`layout operation ${op.op} sent outside a Canvas`)
    return Promise.resolve()
  },
})

export function useLayoutOps(): LayoutOps {
  return useContext(LayoutOpsContext)
}
