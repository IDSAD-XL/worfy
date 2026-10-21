// «Archive finished sessions now» (worfy-canvas ticket 08, ADR-0076, point 9): the palette's command
// asks main which Session Nodes the archive rule takes now (`layout.archiveCandidates`) and sends
// one `archive` with a new batch through the screen's recorded channel, as the Canvas's LayoutOps
// do (history.ts): one step of ⌘Z, whose undo brings every Node of the batch back.
import { failureReason } from '../../shared/ipc/channels'
import { EMPTY_LAYOUT } from '../../shared/layout/types'
import { invoke } from '../ipc'
import { applyRecorded, type LayoutChannel } from './history'
import { screenId } from './screen'
import { currentLayout, sendLayoutOp } from './useLayout'

/** The channel of this screen's recorded gestures, outside the Canvas (as canvas/show-node.ts sends). */
const screenChannel = (projectId: string): LayoutChannel => ({
  send: (op) => sendLayoutOp(projectId, op, screenId()),
  layout: () => currentLayout(projectId) ?? EMPTY_LAYOUT,
})

/**
 * Archives the finished Sessions of the Project now, as one step of its undo history. Resolves to
 * the reason when main could not tell the candidates or refused the archive (a read-only screen), to
 * undefined when it worked or there was nothing to archive.
 */
export async function archiveFinishedNow(projectId: string, channel: LayoutChannel = screenChannel(projectId)): Promise<string | undefined> {
  const result = await invoke('layout.archiveCandidates', { projectId })
  if (!result.ok) return failureReason('layout.archiveCandidates', result.error)
  if (result.value.length === 0) return undefined
  return applyRecorded(projectId, { op: 'archive', batch: crypto.randomUUID(), nodes: result.value.map(({ id, rule }) => ({ id, rule })) }, channel)
}
