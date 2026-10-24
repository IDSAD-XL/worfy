// The toast of the automatic archive (ADR-0076, point 8; worfy-canvas ticket 10): after a batch of
// main's archive timer (`layout.archived`, src/main/layout/archive.ts) every window of the Project
// shows «Archived N finished sessions» with Undo. Undo asks main to bring back that batch alone
// (`layout.restoreBatch`): not a step of ⌘Z — the timer works outside the undo history, and ⌘Z must
// not undo it either. On a read-only screen (ADR-0066), as it is when the batch comes, the toast has
// no Undo.
//
// - Subscribed once per window, before the first render (main.tsx), so no batch is missed while the
//   Canvas loads or another Project is shown; each toast carries its Project and shows only while
//   that Project is active (src/renderer/toast/toasts.ts).
// - A batch can come before the page listens: main's first read of the active Project's Layout, as
//   the first window is created, runs the archive, and IPC drops a message the page does not listen
//   to yet. So right after subscribing the window asks main once for the latest recent batches
//   (`layout.recentBatches`); a batch that came as the event too is shown once.
// - One toast per Project: a later batch replaces the toast of the one before, so the toasts that stay
//   until closed never fill the stack. An earlier batch stays reachable in the Archive popover and
//   the histories of its Tickets (worfy-canvas ticket 09).
// - The toast closes by itself once none of its batch is archived any more: Undo in another window,
//   Restore of each of its Sessions, or their Sessions resumed (`layout.changed`).
import type { ArchiveBatchEvent, LayoutChangeEvent } from '../../shared/ipc/layout'
import { stillInBatch } from '../../shared/layout/derived'
import { invoke, showSubscribeError, subscribe } from '../ipc'
import { readOnlyNow } from '../projects/read-only-now'
import { dismissToast, showToast } from '../toast/toasts'

/** The key of a Project's archive toast: one per Project. */
export const archiveToastKey = (projectId: string): string => `archive:${projectId}`

/** «Archived 1 finished session», «Archived 3 finished sessions». */
const archivedText = (count: number): string => `Archived ${count} finished session${count === 1 ? '' : 's'}`

/** The batch whose toast each Project shows now. */
const shownBatch = new Map<string, string>()

/** Asks main to bring the batch back; a refusal (read-only access given meanwhile, a failed write) is told in an error toast. */
async function undoBatch({ projectId, batch }: ArchiveBatchEvent): Promise<void> {
  const answer = await invoke('layout.restoreBatch', { projectId, batch })
  if (!answer.ok) showToast({ kind: 'error', key: `archive-undo:${projectId}`, projectId, text: `Could not undo the archive: ${answer.error}` })
}

/** The toast of one batch, in place of the Project's toast before it: with Undo, or without it on a read-only screen. */
function showBatch(event: ArchiveBatchEvent): void {
  if (shownBatch.get(event.projectId) === event.batch) return
  shownBatch.set(event.projectId, event.batch)
  const toast = { key: archiveToastKey(event.projectId), projectId: event.projectId, text: archivedText(event.count), testId: 'archive-toast' }
  if (readOnlyNow() !== null) showToast({ ...toast, kind: 'info' })
  else showToast({ ...toast, kind: 'action', actions: [{ label: 'Undo', run: () => void undoBatch(event) }] })
}

/** Closes a Project's toast once nothing of its batch is archived any more. */
function noteChange({ projectId, layout }: Pick<LayoutChangeEvent, 'projectId' | 'layout'>): void {
  const batch = shownBatch.get(projectId)
  if (batch === undefined || stillInBatch(layout.nodes, batch).length > 0) return
  shownBatch.delete(projectId)
  dismissToast(archiveToastKey(projectId))
}

/**
 * Shows the batches main announced before this window listened. A Project that has shown a batch
 * since the subscription keeps it: that one came later, or is the same batch.
 */
async function showMissedBatches(isCurrent: () => boolean): Promise<void> {
  const answer = await invoke('layout.recentBatches')
  if (!isCurrent()) return
  if (!answer.ok) {
    console.warn('layout.recentBatches: the batches announced before this window listened are not known', answer.error)
    return
  }
  for (const event of answer.value) if (!shownBatch.has(event.projectId)) showBatch(event)
}

/** Subscribes the window to the archive's batches and to the changes that close their toasts; returns the unsubscribe. */
export function installArchiveToasts(): () => void {
  const stops: (() => void)[] = []
  let installed = true
  try {
    stops.push(subscribe('layout.archived', showBatch))
  } catch (error) {
    showSubscribeError('layout.archived', error)
  }
  try {
    stops.push(subscribe('layout.changed', noteChange))
  } catch (error) {
    showSubscribeError('layout.changed', error)
  }
  // After the subscriptions: a batch announced between the two still comes as the event.
  void showMissedBatches(() => installed)
  return () => {
    installed = false
    for (const stop of stops) stop()
    shownBatch.clear()
  }
}
