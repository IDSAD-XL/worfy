// The command "Arrange by Epic" (worfy-canvas ticket 12) for the Canvas of a Project: the Canvas menu
// item runs it, and the palette's command leaves a request the Canvas menu carries out, as it does
// for "Re-pack" (sources/epics.ts). The places come from arrange-by-epic.ts and go through the
// Canvas's LayoutOps as one `moveMany`: one step of ⌘Z puts every Session back, ⇧⌘Z arranges again.
//
// What it reads is what the Canvas draws now: the frames and the strip (session-spot.ts,
// spotInputs) and each Session's Binding from the anchor Nodes of sources/workflow-bindings.ts
// (family.ts, familyLinksOf), so the Sessions go where their Binding lines end. Nothing is sent on
// a read-only screen (ADR-0066): the menu and the palette show the command inactive there.
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useStoreApi } from '@xyflow/react'
import { create } from 'zustand'
import { useSubagentTrees } from '../claude-home/subagents'
import { readOnlyNow } from '../projects/read-only-now'
import { arrangeByEpic } from './arrange-by-epic'
import { familyLinksOf } from './family'
import type { CanvasFlowNode } from './nodes'
import { frameReserves } from './overlays/session-spots'
import { spotInputs } from './session-spot'
import { sessionParents } from './sources/subagents'
import { naturalTreeBlocks } from './tidy'
import { currentLayout, useLayout, useLayoutOps } from './useLayout'

const useArrangeRequests = create<{ request: { projectId: string; seq: number } | null }>(() => ({ request: null }))

/** Asks the Canvas of `projectId` to arrange its Sessions by Epic (the palette's command). */
export function requestArrangeByEpic(projectId: string): void {
  useArrangeRequests.setState(({ request }) => ({ request: { projectId, seq: (request?.seq ?? 0) + 1 } }))
}

/**
 * Calls `listener` at every request of requestArrangeByEpic from now on, a repeated one too. Returns
 * the function that unsubscribes. Focus mode leaves on such a request (overlays/FocusEntry.tsx).
 */
export function onArrangeByEpicRequest(listener: () => void): () => void {
  return useArrangeRequests.subscribe((state, previous) => {
    if (state.request !== previous.request) listener()
  })
}

/**
 * "Arrange by Epic" for the Canvas of `projectId`, for a component inside React Flow and the
 * Canvas's LayoutOps (the Canvas menu). Resolves once the operation is sent, or at once when there
 * is nothing to move.
 */
export function useArrangeByEpic(projectId: string, root: string | undefined): () => Promise<void> {
  const ops = useLayoutOps()
  const store = useStoreApi<CanvasFlowNode>()
  const layout = useLayout(projectId).state?.layout
  const sessionIds = useMemo(() => (layout ? sessionParents(layout).map((node) => node.data.sessionId as string) : []), [layout])
  const trees = useSubagentTrees(root, sessionIds)
  const treesNow = useRef(trees)
  useEffect(() => {
    treesNow.current = trees
  }, [trees])

  return useCallback(async () => {
    const now = currentLayout(projectId)
    if (now === undefined || readOnlyNow() !== null) return
    const drawn = [...store.getState().nodeLookup.values()]
    const epics = new Map(familyLinksOf(drawn).bindings.map(({ agentNodeId, target }) => [agentNodeId, target.epic]))
    const op = arrangeByEpic({ nodes: now.nodes, epics, drawn: spotInputs(drawn, frameReserves(projectId)), trees: naturalTreeBlocks(projectId, now, treesNow.current) })
    if (op === undefined) return
    try {
      await ops.apply(op)
    } catch (error) {
      // The Sessions keep their places.
      console.error('Arrange by Epic failed', error)
    }
  }, [projectId, ops, store])
}

/** Carries out the palette's "Arrange by Epic" for the Project with `run`, once per request. */
export function useArrangeByEpicRequests(projectId: string, run: () => Promise<void>): void {
  const request = useArrangeRequests((state) => state.request)
  const handled = useRef(useArrangeRequests.getState().request?.seq ?? 0)
  useEffect(() => {
    if (!request || request.projectId !== projectId || request.seq <= handled.current) return
    handled.current = request.seq
    void run()
  }, [request, projectId, run])
}
