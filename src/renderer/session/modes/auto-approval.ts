import { useEffect, useState } from 'react'
import type { AutoApprovalState } from '../../../shared/ipc/auto-approve'
import { failureReason } from '../../../shared/ipc/channels'
import type { AutoApprovalMode } from '../../../shared/settings/app-settings'
import { invoke, readableReason, subscribe, windowMachine } from '../../ipc'
import { readOnlyNow } from '../../projects/read-only-now'
import { useReadOnly } from '../../projects/useProjects'
import { showToast } from '../../toast/toasts'

// Auto-approval of the Orchestrator's Project (worfy-auto-approve ticket 06), the group of three
// positions — Off, Shadow, On — in the Modes menu (composer/Modes.tsx, worfy-retry ticket 12). It shows
// the mode as main reads it from app-settings.json of worfy's data folder (`autoApproval.read`,
// src/main/ipc/auto-approve.ts), and choosing another position writes it (`autoApproval.set`). The mode
// is this Machine's setting, not the Profile's (spec of worfy-auto-approve, "decided without the
// owner", item 3): it never goes through the Harness. A change made in another window or on another
// Machine shows at once (`autoApproval.changed`). A window that shows a Linked machine reads and sets the
// mode of that Machine through the link (worfy-retry ticket 13): with full access the group changes it,
// with read-only access it shows it, unavailable with the read-only hint. While worfy runs with a
// debugging port open, main keeps the mode Off and refuses Shadow and On (any local process could script
// this window then): the group shows Off, unavailable, with why and the saved mode. The same port open on
// this Machine while its window shows a Linked machine: `linked.invoke` lets only Off out
// (src/main/ipc/linked.ts), and the group is unavailable with why (`autoApproval.blockedHere`).
//
// No `order` here: every .tsx of composer/ is an item of the bar (src/renderer/shell/registry.ts).

/** The caption of each position. */
export const AUTO_APPROVAL_LABELS: Readonly<Record<AutoApprovalMode, string>> = { off: 'Off', shadow: 'Shadow', on: 'On' }

/** The tooltip of Off: what an unattended Run does with a permission request in it. */
export const AUTO_APPROVAL_OFF = 'Auto-approval off: in an unattended Run every permission request is refused, as before.'
/** The tooltip of Shadow. */
export const AUTO_APPROVAL_SHADOW = 'Auto-approval shadow: requests are still refused; worfy only writes to the Journal what the Approval policy would have done.'
/** The tooltip of On. */
export const AUTO_APPROVAL_ON =
  'Auto-approval on: in an unattended Run worfy answers permission requests by the Approval policy — allows what stays inside the Project, denies with a hint or parks the rest. Hard deny always applies.'

/** The tooltip of each position. */
export const AUTO_APPROVAL_TITLES: Readonly<Record<AutoApprovalMode, string>> = { off: AUTO_APPROVAL_OFF, shadow: AUTO_APPROVAL_SHADOW, on: AUTO_APPROVAL_ON }

/** The line under each position in the menu. */
export const AUTO_APPROVAL_DETAILS: Readonly<Record<AutoApprovalMode, string>> = { off: 'Refuse every request', shadow: 'Refuse, and log what would pass', on: 'Answer by the Approval policy' }


/** The tooltip while main keeps the mode Off: why, and what applies once the reason is gone. */
export function blockedTitle(blocked: string, saved: AutoApprovalMode): string {
  const why = `Auto-approval is off: ${blocked}, so any program on this Machine could turn it on.`
  return saved === 'off' ? why : `${why} The saved mode, ${AUTO_APPROVAL_LABELS[saved]}, applies once worfy starts without it.`
}

/** The tooltip in a window on a Linked machine while this Machine's worfy runs with a debugging port open. */
export function blockedHereTitle(blocked: string): string {
  return `Auto-approval cannot be set from this Machine: ${blocked}, so any program on this Machine could set it through this window.`
}

const TOAST_KEY = 'auto-approval'

/** What the Modes menu shows of Auto-approval, and the one thing it does. */
export interface AutoApproval {
  /** The mode shown — the one being written while a write runs, Off under a debugging port; null while it is not known. */
  mode: AutoApprovalMode | null
  /** The mode saved for the Project; null while it is not known. */
  saved: AutoApprovalMode | null
  /** Why the positions cannot be chosen, as their tooltip; null when they can. */
  unavailable: string | null
  /** The mode is being read. */
  reading: boolean
  /** A write runs. */
  busy: boolean
  /** The window has read-only access to the Machine of the Project: the group shows the mode and changes nothing. */
  readOnly: boolean
  /** Writes `mode`; does nothing while unavailable or busy, or when it is the mode in force. */
  choose: (mode: AutoApprovalMode) => void
}

/** What the group knows of the mode of `projectId`: undefined while it is read. */
type Shown = { projectId: string; state: AutoApprovalState } | { projectId: string; error: string } | undefined

/** Auto-approval of Project `projectId`. */
export function useAutoApproval(projectId: string): AutoApproval {
  // A window that shows a Linked machine asks that Machine: the channels are `project` (src/renderer/ipc.ts).
  const readOnly = useReadOnly()
  const elsewhere = windowMachine() !== null
  const [shown, setShown] = useState<Shown>(undefined)
  /** Why this Machine lets no Shadow or On out to a Linked machine; null — nothing, or a window on this Machine. */
  const [blockedHere, setBlockedHere] = useState<string | null>(null)
  /** The mode being written; null while no write runs. */
  const [writing, setWriting] = useState<AutoApprovalMode | null>(null)
  /** Counts the reads: a write that did not go through asks for one more. */
  const [generation, setGeneration] = useState(0)

  useEffect(() => {
    let active = true
    void invoke('autoApproval.read', { projectId }).then((result) => {
      if (!active) return
      setShown(result.ok ? { projectId, state: result.value } : { projectId, error: readableReason(failureReason('autoApproval.read', result.error)) })
    })
    return () => {
      active = false
    }
  }, [projectId, generation])

  // A window on this Machine learns its debugging port from the read; one on a Linked machine asks here.
  // Not known — nothing shown: `linked.invoke` refuses on its own.
  useEffect(() => {
    if (!elsewhere) return
    let active = true
    void invoke('autoApproval.blockedHere').then((result) => {
      if (active) setBlockedHere(result.ok ? result.value.blocked : null)
    })
    return () => {
      active = false
    }
  }, [elsewhere])

  // A change made in another window or on another Machine (or by this one: the same mode again).
  useEffect(
    () =>
      subscribe('autoApproval.changed', (change) => {
        if (change.projectId === projectId) setShown({ projectId, state: change.state })
      }),
    [projectId],
  )

  const current = shown !== undefined && shown.projectId === projectId ? shown : undefined
  const state = current !== undefined && 'state' in current ? current.state : null
  const unavailable =
    readOnly ??
    (current === undefined
      ? 'Reading the Auto-approval mode…'
      : 'error' in current
        ? `Auto-approval is not available: ${current.error}`
        : current.state.blocked !== null
          ? blockedTitle(current.state.blocked, current.state.saved)
          : blockedHere !== null
            ? blockedHereTitle(blockedHere)
            : null)

  const write = async (mode: AutoApprovalMode): Promise<void> => {
    setWriting(mode)
    const result = await invoke('autoApproval.set', { projectId, mode })
    setWriting(null)
    if (result.ok) {
      setShown({ projectId, state: result.value })
      return
    }
    showToast({
      kind: 'error',
      key: TOAST_KEY,
      projectId,
      text: `Auto-approval was not set to ${AUTO_APPROVAL_LABELS[mode]}: ${readableReason(failureReason('autoApproval.set', result.error))}`,
      testId: 'auto-approval-toast',
    })
    // The write may have gone through on the Machine of the Project with its answer lost: no guess
    // until the mode is read again.
    setShown(undefined)
    setGeneration((count) => count + 1)
  }

  return {
    mode: writing ?? state?.mode ?? null,
    saved: state?.saved ?? null,
    unavailable,
    reading: current === undefined,
    busy: writing !== null,
    readOnly: readOnly !== null,
    choose: (mode) => {
      // readOnlyNow: the level may have gone read-only since the group was drawn.
      if (unavailable !== null || writing !== null || state === null || state.mode === mode || readOnlyNow() !== null) return
      void write(mode)
    },
  }
}
