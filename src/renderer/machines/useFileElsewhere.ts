// "Open in editor" in a window on a Linked machine (worfy-link ticket 12; ADR-0053). The file lies on
// the Project's Machine, and its editor would open on a screen nobody here sees; `shell.openInEditor`
// is closed to a Linked machine anyway (`desktop`). So a window on Linked machine M does not call it:
// the Ticket Node, the ADR panel and a file link in markdown show the hint "File is on <M>"
// (FileElsewhereHint.tsx) for a few seconds instead. A window on this Machine opens the file as before.
import { createElement, useEffect, useState, type ReactNode } from 'react'
import { windowMachine } from '../ipc'
import { FileElsewhereHint, type HintLook } from './FileElsewhereHint'

/** How long the hint stays, in ms. */
export const HINT_MS = 4000

export interface FileElsewhere {
  /** The window shows a Linked machine: its Project files are not opened here. */
  readonly elsewhere: boolean
  /** The hint while it is shown, else null; the caller puts it where it belongs. */
  readonly hint: ReactNode
  /** Shows the hint for HINT_MS; another call starts the time again. */
  show(): void
}

/** Whether a Project file opens in this window, and the hint shown when it does not. */
export function useFileElsewhere(look: HintLook = {}): FileElsewhere {
  // The window's Machine never changes: another Machine loads the window again (useProjects.ts).
  const [elsewhere] = useState(() => windowMachine() !== null)
  // The count of show() calls since the hint last went away; 0 — hidden.
  const [shows, setShows] = useState(0)
  useEffect(() => {
    if (shows === 0) return
    const timer = setTimeout(() => setShows(0), HINT_MS)
    return () => clearTimeout(timer)
  }, [shows])
  return { elsewhere, hint: shows > 0 ? createElement(FileElsewhereHint, look) : null, show: () => setShows((count) => count + 1) }
}
