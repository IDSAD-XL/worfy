// Putting a Layout Node back on the Canvas from outside it — "Show" in the history of Sessions, a
// row of the sidebar's Sessions, a "go to" command of the palette — before the Canvas is centered
// on it. An archived Node comes back through `restore` (ADR-0076), a hidden one through `hide`
// false. Both are one step of the Project's undo history (history.ts): ⌘Z takes the Node back
// into the archive, at its old place, or hides it again.
import { EMPTY_LAYOUT, type LayoutNode } from '../../shared/layout/types'
import { applyRecorded, grouped, type LayoutChannel } from './history'
import { screenId } from './screen'
import { showOps } from './show-ops'
import { currentLayout, sendLayoutOp } from './useLayout'

export { showOps }

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
