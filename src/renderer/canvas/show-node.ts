// Putting a Layout Node back on the Canvas from outside it — "Show" in the history of Sessions, a
// row of the sidebar's Sessions, a "go to" command of the palette — before the Canvas is centered
// on it. An archived Node comes back through `restore` (ADR-0076), a hidden one through `hide`
// false. Both are one step of the Project's undo history (history.ts): ⌘Z takes the Node back
// into the archive, at its old place, or hides it again.
import { EMPTY_LAYOUT, isArchived, type LayoutNode, type LayoutOpInput } from '../../shared/layout/types'
import { applyRecorded, grouped, type LayoutChannel } from './history'
import { screenId } from './screen'
import { currentLayout, sendLayoutOp } from './useLayout'

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

/**
 * Brings the Node back onto the Canvas when it is archived or hidden; nothing for a Node already
 * shown. Resolves to main's refusal (a read-only screen, a Node gone meanwhile), or undefined.
 */
export async function showNode(projectId: string, node: Pick<LayoutNode, 'id' | 'hidden' | 'archived'>): Promise<string | undefined> {
  const ops = showOps(node)
  if (ops.length === 0) return undefined
  const channel: LayoutChannel = {
    // With this screen's id, as the Canvas sends: another screen's history then knows the change is not its own.
    send: (op) => sendLayoutOp(projectId, op, screenId()),
    layout: () => currentLayout(projectId) ?? EMPTY_LAYOUT,
  }
  return grouped(async (group) => {
    for (const op of ops) {
      const refusal = await applyRecorded(projectId, op, channel, group)
      if (refusal !== undefined) return refusal
    }
    return undefined
  })
}
