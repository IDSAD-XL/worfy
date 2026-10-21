// The toast of a batch of the automatic archive (ADR-0076, point 8; worfy-canvas ticket 10): after
// each batch of main's archive timer (`layout.archived`, src/main/layout/archive.ts) every window
// of the Project shows «Archived N finished sessions» with Undo. Undo asks main to bring back that
// batch alone (`layout.restoreBatch`): not a step of ⌘Z — the timer works outside the undo history,
// and ⌘Z must not undo it either. On a read-only screen (ADR-0066) the toast has no Undo.
//
// The toast is the shared one of worfy-ui ticket 16 (src/renderer/toast/toasts.ts): keyed by the
// batch, so a batch is one toast; with the batch's Project, so it shows only while that Project is
// active; an `action` toast stays until it is closed. Draws nothing on the Canvas itself.
import { useEffect } from 'react'
import type { ArchiveBatchEvent } from '../../../shared/ipc/layout'
import { invoke, showSubscribeError, subscribe } from '../../ipc'
import { readOnlyNow } from '../../projects/read-only-now'
import { showToast } from '../../toast/toasts'

export const order = 40

/** `data-testid` of the toast. */
export const ARCHIVE_TOAST_TEST_ID = 'archive-toast'

/** «Archived 1 finished session», «Archived 3 finished sessions». */
const archivedText = (count: number): string => `Archived ${count} finished session${count === 1 ? '' : 's'}`

/** Asks main to bring the batch back; a refusal (a read-only access given meanwhile, a failed write) is told in an error toast. */
async function undoBatch({ projectId, batch }: ArchiveBatchEvent): Promise<void> {
  const answer = await invoke('layout.restoreBatch', { projectId, batch })
  if (!answer.ok) showToast({ kind: 'error', key: `archive-undo:${batch}`, projectId, text: `Could not undo the archive: ${answer.error}` })
}

/** The toast of one batch: with Undo, or without it on a read-only screen. */
function showArchiveToast(event: ArchiveBatchEvent, readOnly: boolean): void {
  const toast = { key: `archive:${event.batch}`, projectId: event.projectId, text: archivedText(event.count), testId: ARCHIVE_TOAST_TEST_ID }
  if (readOnly) showToast({ ...toast, kind: 'info' })
  else showToast({ ...toast, kind: 'action', actions: [{ label: 'Undo', run: () => void undoBatch(event) }] })
}

export default function ArchiveToast() {
  useEffect(() => {
    try {
      return subscribe('layout.archived', (event) => showArchiveToast(event, readOnlyNow() !== null))
    } catch (error) {
      showSubscribeError('layout.archived', error)
      return undefined
    }
  }, [])
  return null
}
