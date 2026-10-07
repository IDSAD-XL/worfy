// Which Nodes the user is looking at, for the Edges (worfy-week ticket 05): the Node under the
// pointer and the selected Nodes go to edge-focus.ts, together with the "Blocked by" Edges whose
// chains they light up. The Edge components read that store and decide for themselves whether they
// are pale, lit or not drawn; this overlay draws nothing.
import { useEffect, useMemo, useState } from 'react'
import { useStore, type ReactFlowState } from '@xyflow/react'
import { clearEdgeFocus, setEdgeFocus, type ChainEdge } from '../edge-focus'

export const order = 5

/** The ids of the selected Nodes as one string, so the selector's result compares by value. */
const selectedKey = (state: ReactFlowState): string => JSON.stringify(state.nodes.filter((node) => node.selected === true).map((node) => node.id))

/** The Node an element belongs to; React Flow draws a child Node next to its parent, not inside it. */
const nodeIdAt = (target: EventTarget | null): string | null => {
  if (!(target instanceof Element)) return null
  return target.closest('.react-flow__node')?.getAttribute('data-id') ?? null
}

export default function EdgeFocus() {
  const domNode = useStore((state) => state.domNode)
  const edges = useStore((state) => state.edges)
  const selected = useStore(selectedKey)
  const [hovered, setHovered] = useState<string | null>(null)

  useEffect(() => {
    if (domNode === null) return
    const over = (event: PointerEvent) => setHovered(nodeIdAt(event.target))
    const leave = () => setHovered(null)
    domNode.addEventListener('pointerover', over)
    domNode.addEventListener('pointerleave', leave)
    return () => {
      domNode.removeEventListener('pointerover', over)
      domNode.removeEventListener('pointerleave', leave)
    }
  }, [domNode])

  // The "Blocked by" Edges, the same array while the Canvas's Edges are the same.
  const chainEdges = useMemo<ChainEdge[]>(
    () => edges.filter((edge) => (edge.data as { kind?: unknown } | undefined)?.kind === 'blocking').map(({ id, source, target }) => ({ id, source, target })),
    [edges],
  )

  useEffect(() => {
    const focused = JSON.parse(selected) as string[]
    setEdgeFocus(hovered === null ? focused : [...focused, hovered], chainEdges)
  }, [hovered, selected, chainEdges])

  useEffect(() => clearEdgeFocus, [])

  return null
}
