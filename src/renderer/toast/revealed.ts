// What the window says when main showed a file in the file manager instead of opening it
// (`shell.openInEditor` answers `revealed` with `revealedIn`; worfy-polish ticket 35): the file is
// not a document, and the user chose "Show in Finder" in main's box. A Markdown link shows the text
// next to itself; the ADR panel and the Ticket card, which have no link to put it by, show it as a toast.
import type { RevealPlatform } from '../../shared/ipc/shell'
import { showToast } from './toasts'

const FILE_MANAGER: Record<RevealPlatform, string> = { darwin: 'Finder', win32: 'Explorer', other: 'the file manager' }

/** "Shown in Finder: not a document", with the file manager of `platform`. */
export function revealedNote(platform: RevealPlatform): string {
  return `Shown in ${FILE_MANAGER[platform]}: not a document`
}

/** The same reason as a toast; another call replaces it and starts its time again. */
export function showRevealed(platform: RevealPlatform): void {
  showToast({ kind: 'info', key: 'file-revealed', text: revealedNote(platform), testId: 'file-revealed' })
}
