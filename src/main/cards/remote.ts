// The second source of Card files (worfy-link ticket 10; ADR-0052, ADR-0053): the Cards of Linked
// machines that a window of this Machine shows. Their address carries the machine label of the
// Linked machine (worfy-card://<card id>.<project label>.<machine label>/<path>,
// src/main/cards/protocol.ts); this module finds the Linked machine with that label and asks it for
// the file with `cards.file` (src/shared/ipc/cards.ts) over the link, piece by piece
// (src/main/link/file-chunks.ts, which the images of a Linked machine share). The Linked machine
// finds and checks the file itself (readCardFileChunk there); what comes back is held to the
// channel's schema by the link (src/main/link/remote-calls.ts) and to the size limit.
import { CARD_FILE_LIMIT_BYTES } from '../../shared/ipc/cards'
import { appLinkFiles, fetchLinkedFile, type LinkedFileDeps } from '../link/file-chunks'
import type { LinkedCardSource } from './protocol'

/** What the source needs of the link. */
export type LinkedCardDeps = LinkedFileDeps

/** The second source over `deps`; protocol.ts's createCardHandler takes it. */
export function createLinkedCardSource(deps: LinkedCardDeps): LinkedCardSource {
  return (request) =>
    fetchLinkedFile(deps, {
      machineLabel: request.machineLabel,
      channel: 'cards.file',
      input: (offset, length) => ({ projectLabel: request.projectLabel, cardId: request.cardId, path: request.pathname, offset, length }),
      head: request.head,
      limit: CARD_FILE_LIMIT_BYTES,
    })
}

/** The app's second source: the Linked machines of the app's link service, called from main (worfy-link ticket 09). */
export const appLinkedCardSource: LinkedCardSource = createLinkedCardSource(appLinkFiles)
