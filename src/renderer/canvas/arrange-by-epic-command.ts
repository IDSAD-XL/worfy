// The command "Arrange by Epic" (worfy-canvas ticket 12) for the Canvas of a Project: the Canvas menu
// item runs it, and the palette's command leaves a request the Canvas menu carries out, as it does
// for "Re-pack" (sources/epics.ts). The places come from arrange-by-epic.ts and go through the
// Canvas's LayoutOps as one `moveMany`: one step of ⌘Z puts every Session back, ⇧⌘Z arranges again.
//
// What it reads: the frames and the strip as the Canvas draws them now (session-spot.ts,
// spotInputs), and each Session's Binding from the Bindings' store, resolved as the anchor Nodes of
// sources/workflow-bindings.ts resolve it, once the store has read every Session's
// (whenBindingsRead). Nothing is sent on a read-only screen (ADR-0066): the menu and the palette
// show the command inactive there.
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useStoreApi } from '@xyflow/react'
import { create } from 'zustand'
import type { Rect } from '../../shared/layout/free-place'
import type { Layout, LayoutOpInput } from '../../shared/layout/types'
import { storedBindings, useBindingsStore, whenBindingsRead } from '../binding/store'
import { useSubagentTrees } from '../claude-home/subagents'
import { readOnlyNow } from '../projects/read-only-now'
import { arrangementOf } from './arrangement-record'
import { arrangeByEpic } from './arrange-by-epic'
import type { CanvasFlowNode } from './nodes'
import { frameReserves } from './overlays/session-spots'
import { spotInputs, type DrawnNode } from './session-spot'
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

/** How long the command waits for the Sessions' Bindings to be read before it gives up and moves nothing. */
export const BINDINGS_WAIT_MS = 5000

/** What the command runs on: the Canvas's Nodes now, the Subagent trees, and where the operation goes. */
export interface ArrangeRun {
  projectId: string
  /** The Project's folder, which the Sessions' transcript signals are read for. */
  root: string
  /** React Flow's Nodes now: the frames and the strip are read from them (spotInputs). */
  drawn: () => Iterable<DrawnNode>
  /** The block of each Session's Subagent tree, by its Node id (tidy.ts, naturalTreeBlocks). */
  trees: (layout: Layout) => ReadonlyMap<string, Rect>
  apply: (op: LayoutOpInput) => Promise<void>
  waitMs?: number
}

const sessionIdsOf = (layout: Layout): string[] => sessionParents(layout).map((node) => node.data.sessionId as string)

/** The Epic each Session Node on the plane is bound to, resolved from the Bindings' store as the anchors resolve it (sources/workflow-bindings.ts). */
function sessionEpics(projectId: string, root: string, layout: Layout): Map<string, string> {
  const sessions = sessionParents(layout)
  const manual = useBindingsStore.getState().manual[projectId] ?? []
  const bindings = storedBindings(root, sessionIdsOf(layout), manual, arrangementOf(projectId)?.model)
  return new Map(
    sessions.flatMap((node) => {
      const binding = bindings.get(node.data.sessionId as string)
      return binding === undefined ? [] : [[node.id, binding.target.epic] as const]
    }),
  )
}

/** "Arrange by Epic" runs at most once at a time per Project: a second command while one waits is dropped. */
const running = new Set<string>()

/**
 * Arranges the Sessions of the Project's Layout and sends the places through `apply`. It first
 * waits for the Bindings of every Session on the plane to be read (whenBindingsRead, as Re-pack's
 * first opening does): right after the window opens, a Session whose Binding comes from its
 * transcript would otherwise count as unbound. When they are not read within `waitMs`, nothing is
 * sent; nothing is sent on a read-only screen either. Resolves to the operation sent, if any.
 */
export async function runArrangeByEpic({ projectId, root, drawn, trees, apply, waitMs = BINDINGS_WAIT_MS }: ArrangeRun): Promise<LayoutOpInput | undefined> {
  if (running.has(projectId)) return undefined
  running.add(projectId)
  try {
    let layout = currentLayout(projectId)
    if (layout === undefined || readOnlyNow() !== null) return undefined
    // Sessions that came while the command waited are waited for too.
    for (;;) {
      const sessions = sessionIdsOf(layout)
      if (!(await whenBindingsRead(projectId, { root, sessions }, waitMs))) {
        console.warn('Arrange by Epic: the Bindings of the Sessions were not read in time; nothing was moved')
        return undefined
      }
      const now = currentLayout(projectId)
      if (now === undefined || readOnlyNow() !== null) return undefined
      layout = now
      if (sessionIdsOf(now).every((sessionId) => sessions.includes(sessionId))) break
    }
    const op = arrangeByEpic({ nodes: layout.nodes, epics: sessionEpics(projectId, root, layout), drawn: spotInputs(drawn(), frameReserves(projectId)), trees: trees(layout) })
    if (op !== undefined) await apply(op)
    return op
  } catch (error) {
    // The Sessions keep their places.
    console.error('Arrange by Epic failed', error)
    return undefined
  } finally {
    running.delete(projectId)
  }
}

/**
 * "Arrange by Epic" for the Canvas of `projectId`, for a component inside React Flow and the
 * Canvas's LayoutOps (the Canvas menu): runArrangeByEpic with the Canvas's Nodes and LayoutOps.
 */
export function useArrangeByEpic(projectId: string, root: string | undefined): () => Promise<void> {
  const ops = useLayoutOps()
  const store = useStoreApi<CanvasFlowNode>()
  const layout = useLayout(projectId).state?.layout
  const sessionIds = useMemo(() => (layout ? sessionIdsOf(layout) : []), [layout])
  const trees = useSubagentTrees(root, sessionIds)
  const treesNow = useRef(trees)
  useEffect(() => {
    treesNow.current = trees
  }, [trees])

  return useCallback(async () => {
    if (root === undefined) return
    await runArrangeByEpic({
      projectId,
      root,
      drawn: () => store.getState().nodeLookup.values(),
      trees: (now) => naturalTreeBlocks(projectId, now, treesNow.current),
      apply: (op) => ops.apply(op),
    })
  }, [projectId, root, ops, store])
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
