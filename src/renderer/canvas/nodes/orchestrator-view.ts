// main's view of each Orchestrator (src/shared/ipc/orchestrator.ts, OrchestratorView) in the
// renderer, by Node: asked for once per Node with `orchestrator.view`, then followed on
// `orchestrator.changed`. One subscription serves every Canvas.
import { useEffect } from 'react'
import { create } from 'zustand'
import type { OrchestratorView } from '../../../shared/ipc/orchestrator'
import { invoke, subscribe } from '../../ipc'

interface ViewsStore {
  byNode: Readonly<Record<string, OrchestratorView>>
}

const useViewsStore = create<ViewsStore>(() => ({ byNode: {} }))

/**
 * Takes a view from main unless a newer one of the same Node is already here: the answer to
 * `orchestrator.view` and a later `orchestrator.changed` can arrive in either order.
 */
export function acceptOrchestratorView(view: OrchestratorView): void {
  const current = useViewsStore.getState().byNode[view.nodeId]
  if (current && view.version <= current.version) return
  useViewsStore.setState(({ byNode }) => ({ byNode: { ...byNode, [view.nodeId]: view } }))
}

let subscribed = false

function ensureSubscribed(): void {
  if (subscribed) return
  subscribed = true
  try {
    subscribe('orchestrator.changed', acceptOrchestratorView)
  } catch (error) {
    subscribed = false
    console.error('orchestrator.changed: cannot subscribe', error)
  }
}

/** main's view of the Orchestrator behind a Node; undefined until main has one. */
export function useOrchestratorView(nodeId: string): OrchestratorView | undefined {
  const view = useViewsStore((store) => store.byNode[nodeId])
  useEffect(() => {
    // Subscribed before asking, so no change falls between the answer and the first event.
    ensureSubscribed()
    void invoke('orchestrator.view', { nodeId }).then((result) => {
      if (!result.ok) console.error('orchestrator.view failed:', result.error)
      else if (result.value.view) acceptOrchestratorView(result.value.view)
    })
  }, [nodeId])
  return view
}

/** Every Orchestrator view this window has, by Node; a new object on each change (ticket 21). */
export function useOrchestratorViews(): Readonly<Record<string, OrchestratorView>> {
  return useViewsStore((store) => store.byNode)
}

/** The Orchestrator whose live Session is `sessionId`, among the views this window has now (ticket 21). */
export function orchestratorViewOf(sessionId: string): OrchestratorView | undefined {
  return Object.values(useViewsStore.getState().byNode).find((view) => view.sessionId === sessionId)
}
