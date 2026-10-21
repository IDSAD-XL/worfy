// "Open in editor" in a window on a Linked machine (worfy-link ticket 12; ADR-0053). The file lies on
// the Project's Machine, and its editor would open on a screen nobody here sees; `shell.openInEditor`
// is closed to a Linked machine anyway (`desktop`). So a window on Linked machine M does not call it:
// the Ticket Node, the ADR panel and a file link in markdown show the toast "File is on <M>"
// (toast/toasts.ts, worfy-ui ticket 16) instead. A window on this Machine opens the file as before.
import { useState } from 'react'
import { windowMachine } from '../ipc'
import { showToast, toasts } from '../toast/toasts'
import { linkStateNow, refreshLinkState } from './useMachines'

export interface FileElsewhere {
  /** The window shows a Linked machine: its Project files are not opened here. */
  readonly elsewhere: boolean
  /** Shows the toast "File is on <Machine>"; another call replaces it and starts its time again. */
  show(): void
}

const KEY = 'file-elsewhere'

/** The name of Linked machine `machine` in the link state the renderer has now. */
const nameNow = (machine: string): string | undefined => linkStateNow()?.linked.find((candidate) => candidate.id === machine)?.name

function showElsewhere(name: string | undefined): void {
  showToast({ kind: 'info', key: KEY, text: `File is on ${name ?? 'the Linked machine'}`, testId: 'file-elsewhere' })
}

/**
 * Whether a Project file opens in this window, and the toast shown when it does not. The name of the
 * Machine comes from this Machine's link state, read when the toast is shown: "the Linked machine"
 * until the state names it, then the toast, if still up, names it. A window on this Machine never
 * asks for the link state on its account, nor does a window on a Linked machine before a toast.
 */
export function useFileElsewhere(): FileElsewhere {
  // The window's Machine never changes: another Machine loads the window again (useProjects.ts).
  const [machine] = useState(() => windowMachine())
  return {
    elsewhere: machine !== null,
    show: () => {
      if (machine === null) return
      const name = nameNow(machine)
      showElsewhere(name)
      if (name !== undefined) return
      void refreshLinkState().then(() => {
        const later = nameNow(machine)
        if (later !== undefined && toasts.getState().toasts.some((toast) => toast.id === KEY)) showElsewhere(later)
      })
    },
  }
}
