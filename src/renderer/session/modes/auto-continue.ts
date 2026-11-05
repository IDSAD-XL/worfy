import { useEffect, useState } from 'react'
import { failureReason } from '../../../shared/ipc/channels'
import { invoke, readableReason, subscribe } from '../../ipc'
import { readOnlyNow } from '../../projects/read-only-now'
import { useReadOnly } from '../../projects/useProjects'
import { showToast } from '../../toast/toasts'

// Auto-continue of the Orchestrator's Project (worfy-retry ticket 02), the third item of the Modes menu
// (composer/Modes.tsx). It shows whether main reads it on for the Project from app-settings.json of
// worfy's data folder (`autoContinue.read`, src/main/ipc/auto-continue.ts), and a choice writes the
// other value (`autoContinue.set`). It is this Machine's setting, as Auto-approval is: off by default, on
// only for a Project the person turned it on for. A change made in another window, or on another Machine,
// shows at once (`autoContinue.changed`). A window that shows a Linked machine reads and writes the setting
// of that Machine through the link (worfy-retry ticket 13): with full access the item changes it, with
// read-only access it shows it, unavailable with the read-only hint. What the setting does — the retry of
// the Orchestrator's turn — is tickets 04–06; this item only keeps it.
//
// No `order` here: every .tsx of composer/ is an item of the bar (src/renderer/shell/registry.ts).

/** The tooltip of the working item: what Auto-continue does (spec of worfy-retry, «What the owner sees», item 1). */
export const AUTO_CONTINUE_TITLE =
  'Auto-continue: after a temporary API error (500, 529, connection lost) worfy sends the Orchestrator "continue" up to 5 times with growing pauses; after the Limits refuse, it waits for the reset and continues. Never resends your message or the Wave command.'
const TOAST_KEY = 'auto-continue'

/** What the Modes menu shows of Auto-continue, and the one thing it does. */
export interface AutoContinue {
  /** On or off as shown — the value being written while a write runs; null while it is not known. */
  on: boolean | null
  /** Why the item cannot be used, as its tooltip; null when it can. */
  unavailable: string | null
  /** The item's tooltip. */
  title: string
  /** The setting is being read. */
  reading: boolean
  /** A write runs. */
  busy: boolean
  /** The window has read-only access to the Machine of the Project: the item shows the setting and changes nothing. */
  readOnly: boolean
  /** Writes the other value; does nothing while unavailable or busy. */
  toggle: () => void
}

/** What the item knows of the setting of `projectId`: undefined while it is read. */
type Shown = { projectId: string; on: boolean } | { projectId: string; error: string } | undefined

/** Auto-continue of Project `projectId`; its toasts stay with that Project. */
export function useAutoContinue(projectId: string): AutoContinue {
  // A window that shows a Linked machine asks that Machine: the channels are `project` (src/renderer/ipc.ts).
  const readOnly = useReadOnly()
  const [shown, setShown] = useState<Shown>(undefined)
  /** The value being written; null while no write runs. */
  const [writing, setWriting] = useState<boolean | null>(null)
  /** Counts the reads: a write that did not go through asks for one more. */
  const [generation, setGeneration] = useState(0)

  useEffect(() => {
    let active = true
    void invoke('autoContinue.read', { projectId }).then((result) => {
      if (!active) return
      setShown(result.ok ? { projectId, on: result.value.on } : { projectId, error: readableReason(failureReason('autoContinue.read', result.error)) })
    })
    return () => {
      active = false
    }
  }, [projectId, generation])

  // A change made in another window or on another Machine (or by this one: the same value again).
  useEffect(
    () =>
      subscribe('autoContinue.changed', (change) => {
        if (change.projectId === projectId) setShown({ projectId, on: change.on })
      }),
    [projectId],
  )

  const current = shown !== undefined && shown.projectId === projectId ? shown : undefined
  const read = current !== undefined && 'on' in current ? current.on : null

  const write = async (next: boolean): Promise<void> => {
    setWriting(next)
    const result = await invoke('autoContinue.set', { projectId, on: next })
    setWriting(null)
    if (result.ok) {
      setShown({ projectId, on: result.value.on })
      return
    }
    showToast({
      kind: 'error',
      key: TOAST_KEY,
      projectId,
      text: `Auto-continue was not turned ${next ? 'on' : 'off'}: ${readableReason(failureReason('autoContinue.set', result.error))}`,
      testId: 'auto-continue-toast',
    })
    // The write may have gone through on the Machine of the Project with its answer lost: no guess
    // until the setting is read again.
    setShown(undefined)
    setGeneration((count) => count + 1)
  }

  const unavailable =
    readOnly ?? (current === undefined ? 'Reading the Auto-continue setting…' : 'error' in current ? `Auto-continue is not available: ${current.error}` : null)
  return {
    on: writing ?? read,
    unavailable,
    title: unavailable ?? AUTO_CONTINUE_TITLE,
    reading: current === undefined,
    busy: writing !== null,
    readOnly: readOnly !== null,
    toggle: () => {
      // readOnlyNow: the level may have gone read-only since the item was drawn.
      if (unavailable !== null || writing !== null || read === null || readOnlyNow() !== null) return
      void write(!read)
    },
  }
}
