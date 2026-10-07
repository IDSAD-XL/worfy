// Which Nodes the user is looking at — the one under the pointer and the selected ones — and which
// "Blocked by" Edges that lights up (worfy-week ticket 05). overlays/EdgeFocus.tsx writes here; the
// Edge components read here and decide for themselves whether they are pale, lit or not drawn.
//
// The Canvas's list of Edges (`edgesOf`) does not change with the pointer: only the Edges whose
// state changed draw again, because each one subscribes to its own yes/no answer.
import { create } from 'zustand'

/** One "Blocked by" Edge: from the blocker's Node to the Node of the Ticket it blocks. */
export interface ChainEdge {
  id: string
  source: string
  target: string
}

interface EdgeFocusState {
  /** The Nodes under the pointer and selected. */
  focused: ReadonlySet<string>
  /** The ids of the "Blocked by" Edges on the chains of the focused Nodes. */
  lit: ReadonlySet<string>
}

const NONE: ReadonlySet<string> = new Set()

export const useEdgeFocus = create<EdgeFocusState>(() => ({ focused: NONE, lit: NONE }))

/**
 * The Edges on every path through each of `from`: up — who blocks it, who blocks those, to the end;
 * down — whom it blocks, whom those block, to the end. A cycle stops where it has already been.
 */
export function chainOf(from: Iterable<string>, edges: readonly ChainEdge[]): Set<string> {
  const into = new Map<string, ChainEdge[]>()
  const out = new Map<string, ChainEdge[]>()
  const add = (map: Map<string, ChainEdge[]>, key: string, edge: ChainEdge) => {
    const list = map.get(key)
    if (list) list.push(edge)
    else map.set(key, [edge])
  }
  for (const edge of edges) {
    add(into, edge.target, edge)
    add(out, edge.source, edge)
  }
  const lit = new Set<string>()
  const walk = (start: readonly string[], next: (node: string) => readonly ChainEdge[], far: (edge: ChainEdge) => string) => {
    const seen = new Set(start)
    const queue = [...start]
    for (let node = queue.shift(); node !== undefined; node = queue.shift()) {
      for (const edge of next(node)) {
        lit.add(edge.id)
        const other = far(edge)
        if (!seen.has(other)) {
          seen.add(other)
          queue.push(other)
        }
      }
    }
  }
  const start = [...new Set(from)]
  walk(start, (node) => into.get(node) ?? [], (edge) => edge.source)
  walk(start, (node) => out.get(node) ?? [], (edge) => edge.target)
  return lit
}

const sameSet = (a: ReadonlySet<string>, b: ReadonlySet<string>): boolean => a.size === b.size && [...a].every((each) => b.has(each))

/** Focuses `nodes` (the hovered one and the selected ones) over the "Blocked by" Edges `edges`. */
export function setEdgeFocus(nodes: Iterable<string>, edges: readonly ChainEdge[]): void {
  const focused = new Set(nodes)
  const lit = focused.size === 0 ? NONE : chainOf(focused, edges)
  const before = useEdgeFocus.getState()
  // Unchanged sets stay the same objects: no subscriber is asked again for nothing.
  useEdgeFocus.setState({ focused: sameSet(before.focused, focused) ? before.focused : focused, lit: sameSet(before.lit, lit) ? before.lit : lit })
}

/** Nothing focused: the Canvas went away. */
export function clearEdgeFocus(): void {
  useEdgeFocus.setState({ focused: NONE, lit: NONE })
}

/** Whether the Edge `id` is on a focused Node's chain. */
export const useEdgeLit = (id: string): boolean => useEdgeFocus((state) => state.lit.has(id))

/** Whether any of `nodes` is focused; an empty list never is. */
export const useAnyFocused = (nodes: readonly string[] | undefined): boolean =>
  useEdgeFocus((state) => nodes !== undefined && nodes.some((node) => state.focused.has(node)))
