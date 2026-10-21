// The operations that put a Layout Node back on the Canvas (show-node.ts), apart from the code that
// sends them: the Archive's Restore and Show (archive-list.ts) send them through the Canvas's
// LayoutOps, and tests in node read them without the renderer's Layout store.
import { isArchived, type LayoutNode, type LayoutOpInput } from '../../shared/layout/types'

/**
 * The operations that put a Layout Node back on the Canvas: `restore` for an archived one (at its
 * old place or the nearest clear one, ADR-0038), then `hide` false for a hidden one. None for a
 * Node already shown. A `restore` is sent only for an archived Node: main counts it as the user's
 * work with the Node (`touchedAt`), which moves the Node's turn in the automatic archive.
 */
export function showOps(node: Pick<LayoutNode, 'id' | 'hidden' | 'archived'>): LayoutOpInput[] {
  const ops: LayoutOpInput[] = []
  if (isArchived(node)) ops.push({ op: 'restore', ids: [node.id] })
  if (node.hidden) ops.push({ op: 'hide', id: node.id, hidden: false })
  return ops
}
