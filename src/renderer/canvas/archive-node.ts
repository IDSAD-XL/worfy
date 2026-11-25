// Archive on a Session Node (worfy-product-session ticket 37; ADR-0076, Amendments): the user's own
// archive of that Node alone, as one step of the Project's undo history, through the same screen
// `archive` as «Archive finished sessions now» (archive-now.ts). Main still drops a Node the rule never
// takes at the write — kept, pinned, or naming a Session that is live by then (src/main/layout/archive.ts,
// archiveFromScreen) — and the threshold does not apply: the user asks for this Node. It is the only
// way a Product Session's Node goes into the Archive, since the automatic archive never takes it.
// A module without React, so the contract test of the archive (tsconfig.test.node.json) can load it.
import { applyRecorded, type LayoutChannel } from './history'

/**
 * Archives Session Node `nodeId` of Project `projectId` through `channel`, the screen's recorded
 * channel (useLayout.ts, screenChannel). The record keeps the rule `idle`: a new rule value would
 * make the layout.json unreadable for an older worfy, which sets such a file aside and starts from an
 * empty Layout (src/main/storage/json-file.ts). Resolves to main's reason when it refused, else undefined.
 */
export function archiveSessionNode(projectId: string, nodeId: string, channel: LayoutChannel): Promise<string | undefined> {
  return applyRecorded(projectId, { op: 'archive', batch: crypto.randomUUID(), nodes: [{ id: nodeId, rule: 'idle' }] }, channel)
}
