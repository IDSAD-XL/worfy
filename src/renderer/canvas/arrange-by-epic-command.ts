// The command "Arrange by Epic" (worfy-canvas ticket 12) for the Canvas of a Project: the Canvas menu
// item runs it, and the palette's command leaves a request (requestArrangeByEpic,
// find/canvas-requests.ts) the Canvas menu carries out. The places come from arrange-by-epic.ts and
// go through the Canvas's LayoutOps as one `moveMany`: one step of ⌘Z puts every Session back, ⇧⌘Z
// arranges again.
//
// What it reads: the frames, the strip and the Subagent Nodes as the Canvas draws them now
// (session-spot.ts, spotInputs), and each Session's Binding from the Bindings' store, resolved as the
// anchor Nodes of sources/workflow-bindings.ts resolve it, once the store has read every Session's
// (whenBindingsRead) or BINDINGS_WAIT_MS passed. Nothing is sent on a read-only screen (ADR-0066):
// the menu and the palette show the command inactive there.
import { useCallback, useEffect, useRef } from 'react'
import { useStoreApi } from '@xyflow/react'
import { SUBAGENT_KIND } from '../../shared/layout/derived'
import type { Rect } from '../../shared/layout/free-place'
import type { Layout, LayoutOpInput } from '../../shared/layout/types'
import { manualRead, storedBindings, useBindingsStore, whenBindingsRead } from '../binding/store'
import { useCanvasRequests } from '../find/canvas-requests'
import { readOnlyNow } from '../projects/read-only-now'
import { arrangementOf } from './arrangement-record'
import { arrangeByEpic } from './arrange-by-epic'
import type { CanvasFlowNode } from './nodes'
import { frameReserves } from './overlays/session-spots'
import { spotInputs, type DrawnNode } from './session-spot'
import { sessionParents } from './sources/subagents'
import type { TreeBlocks } from './tidy'
import { currentLayout, useLayoutOps } from './useLayout'

/**
 * How long the command waits for the Sessions' Bindings to be read. After it the Sessions are
 * placed by the Bindings known by then, as the first opening of the day does (arrangement-record.ts):
 * a Session whose transcript cannot be read must not keep the command from moving anything. The
 * manual Bindings must be read, though: without them nothing is moved.
 */
export const BINDINGS_WAIT_MS = 5000

/** A Node React Flow draws, with the Node it hangs from: a Subagent Node's is its Session's. */
export type DrawnFlowNode = DrawnNode & { parentId?: string | undefined }

/** What the command runs on: the Canvas's Nodes now, the Subagent trees, and where the operation goes. */
export interface ArrangeRun {
  projectId: string
  /** The Project's folder, which the Sessions' transcript signals are read for. */
  root: string
  /** React Flow's Nodes now: the frames, the strip (spotInputs) and the Subagent Nodes are read from them. */
  drawn: () => Iterable<DrawnFlowNode>
  /** The block of each Session's Subagent tree, by its Node id (tidy.ts, naturalTreeBlocks). */
  trees: TreeBlocks
  apply: (op: LayoutOpInput) => Promise<void>
  waitMs?: number
}

const sessionIdsOf = (layout: Layout): string[] => sessionParents(layout).map((node) => node.data.sessionId as string)

/** The Epic each Session Node on the plane is bound to, resolved from the Bindings' store as the anchors resolve it (sources/workflow-bindings.ts). */
function sessionEpics(projectId: string, root: string, layout: Layout): Map<string, string> {
  const sessions = sessionParents(layout)
  const bindings = storedBindings(projectId, root, sessionIdsOf(layout), arrangementOf(projectId)?.model)
  return new Map(
    sessions.flatMap((node) => {
      const binding = bindings.get(node.data.sessionId as string)
      return binding === undefined ? [] : [[node.id, binding.target.epic] as const]
    }),
  )
}

/** The Subagent Nodes as drawn, on the plane, by their Session's Node id; the anchor of a tree (1 × 1, not drawn) takes no room. */
function drawnTreesOf(nodes: readonly DrawnFlowNode[]): Map<string, Rect[]> {
  const trees = new Map<string, Rect[]>()
  for (const node of nodes) {
    if (node.type !== SUBAGENT_KIND || node.parentId === undefined || node.data.node?.data?.variant === 'anchor') continue
    const { x, y } = node.internals.positionAbsolute
    trees.set(node.parentId, [...(trees.get(node.parentId) ?? []), { x, y, w: node.width ?? 0, h: node.height ?? 0 }])
  }
  return trees
}

/** "Arrange by Epic" runs at most once at a time per Project: a second command while one waits is dropped. */
const running = new Set<string>()

/**
 * Arranges the Sessions of the Project's Layout and sends the places through `apply`. It first
 * waits for the Bindings of every Session on the plane to be read (whenBindingsRead, as Re-pack's
 * first opening does): right after the window opens, a Session whose Binding comes from its
 * transcript would otherwise count as unbound. When they are not read within `waitMs`, the
 * Sessions are placed by the Bindings known by then, with one line in the log — once main has
 * answered `bindings.get`: without the manual Bindings nothing is sent. Nothing is sent on a
 * read-only screen either. Resolves to the operation sent, if any.
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
      const read = await whenBindingsRead(projectId, { root, sessions }, waitMs)
      const now = currentLayout(projectId)
      if (now === undefined || readOnlyNow() !== null) return undefined
      layout = now
      if (!read) {
        // Without main's manual Bindings a Session bound by hand would go by its transcript alone.
        if (!manualRead(useBindingsStore.getState(), projectId)) {
          console.warn(`Arrange by Epic: main did not answer bindings.get in ${waitMs} ms; nothing was moved`)
          return undefined
        }
        console.warn(`Arrange by Epic: the transcripts of the Sessions were not read in ${waitMs} ms; the Sessions are placed by the Bindings known by then`)
        break
      }
      if (sessionIdsOf(now).every((sessionId) => sessions.includes(sessionId))) break
    }
    const flow = [...drawn()]
    const op = arrangeByEpic({
      nodes: layout.nodes,
      epics: sessionEpics(projectId, root, layout),
      drawn: spotInputs(flow, frameReserves(projectId)),
      trees: trees(layout),
      drawnTrees: drawnTreesOf(flow),
    })
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
 * Canvas's LayoutOps (the Canvas menu): runArrangeByEpic with the Canvas's Nodes and LayoutOps, and
 * the Subagent trees of useTreeBlocks (tidy.ts), which "Tidy up" reads too.
 */
export function useArrangeByEpic(projectId: string, root: string | undefined, trees: TreeBlocks): () => Promise<void> {
  const ops = useLayoutOps()
  const store = useStoreApi<CanvasFlowNode>()
  return useCallback(async () => {
    if (root === undefined) return
    await runArrangeByEpic({
      projectId,
      root,
      drawn: () => store.getState().nodeLookup.values(),
      trees,
      apply: (op) => ops.apply(op),
    })
  }, [projectId, root, trees, ops, store])
}

/** Carries out the palette's "Arrange by Epic" (find/canvas-requests.ts) for the Project with `run`, once per request. */
export function useArrangeByEpicRequests(projectId: string, run: () => Promise<void>): void {
  const request = useCanvasRequests((state) => state.arrange)
  const handled = useRef(useCanvasRequests.getState().arrange?.seq ?? 0)
  useEffect(() => {
    if (!request || request.projectId !== projectId || request.seq <= handled.current) return
    handled.current = request.seq
    void run()
  }, [request, projectId, run])
}
