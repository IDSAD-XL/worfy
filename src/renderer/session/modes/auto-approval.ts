import { useEffect, useState } from 'react'
import type { AutoApprovalState } from '../../../shared/ipc/auto-approve'
import { failureReason } from '../../../shared/ipc/channels'
import type { AutoApprovalMode } from '../../../shared/settings/app-settings'
import { invoke, readableReason, windowMachine } from '../../ipc'
import { showToast } from '../../toast/toasts'

// Auto-approval of the Orchestrator's Project (worfy-auto-approve ticket 06), the group of three
// positions — Off, Shadow, On — in the Modes menu (composer/Modes.tsx, worfy-retry ticket 12). It shows
// the mode as main reads it from app-settings.json of worfy's data folder (`autoApproval.read`,
// src/main/ipc/auto-approve.ts), and choosing another position writes it (`autoApproval.set`). The mode
// is this Machine's setting, not the Profile's (spec of worfy-auto-approve, "decided without the
// owner", item 3): it never goes through the Harness. A window that shows a Linked machine reads and
// writes nothing and says where the mode is set. While worfy runs with a debugging port open, main
// keeps the mode Off and refuses Shadow and On (any local process could script this window then): the
// group shows Off, unavailable, with why and the saved mode.
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

/** The tooltip in a window that shows a Linked machine: the mode is that Machine's setting. */
export const AUTO_APPROVAL_ELSEWHERE = 'Auto-approval is set in worfy on the Machine of the Project'

/** The tooltip while main keeps the mode Off: why, and what applies once the reason is gone. */
export function blockedTitle(blocked: string, saved: AutoApprovalMode): string {
  const why = `Auto-approval is off: ${blocked}, so any program on this Machine could turn it on.`
  return saved === 'off' ? why : `${why} The saved mode, ${AUTO_APPROVAL_LABELS[saved]}, applies once worfy starts without it.`
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
  /** A write runs. */
  busy: boolean
  /** The window shows a Linked machine: nothing is read, and the group says where the mode is set. */
  readOnly: boolean
  /** Writes `mode`; does nothing while unavailable or busy, or when it is the mode in force. */
  choose: (mode: AutoApprovalMode) => void
}

/** What the group knows of the mode of `projectId`: undefined while it is read. */
type Shown = { projectId: string; state: AutoApprovalState } | { projectId: string; error: string } | undefined

/** Auto-approval of Project `projectId`. */
export function useAutoApproval(projectId: string): AutoApproval {
  // A window that shows a Linked machine reads and writes nothing here: the mode lives there. Its
  // `local` channels would reach this Machine's main, which holds no mode of that Project.
  const elsewhere = windowMachine() !== null
  const [shown, setShown] = useState<Shown>(undefined)
  /** The mode being written; null while no write runs. */
  const [writing, setWriting] = useState<AutoApprovalMode | null>(null)
  /** Counts the reads: a write that did not go through asks for one more. */
  const [generation, setGeneration] = useState(0)

  useEffect(() => {
    if (elsewhere) return
    let active = true
    void invoke('autoApproval.read', { projectId }).then((result) => {
      if (!active) return
      setShown(result.ok ? { projectId, state: result.value } : { projectId, error: readableReason(failureReason('autoApproval.read', result.error)) })
    })
    return () => {
      active = false
    }
  }, [projectId, generation, elsewhere])

  const current = shown !== undefined && shown.projectId === projectId ? shown : undefined
  const state = current !== undefined && 'state' in current ? current.state : null
  const unavailable = elsewhere
    ? AUTO_APPROVAL_ELSEWHERE
    : current === undefined
      ? 'Reading the Auto-approval mode…'
      : 'error' in current
        ? `Auto-approval is not available: ${current.error}`
        : current.state.blocked !== null
          ? blockedTitle(current.state.blocked, current.state.saved)
          : null

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
    setGeneration((count) => count + 1)
  }

  return {
    mode: elsewhere ? null : (writing ?? state?.mode ?? null),
    saved: elsewhere ? null : (state?.saved ?? null),
    unavailable,
    busy: writing !== null,
    readOnly: elsewhere,
    choose: (mode) => {
      if (unavailable !== null || writing !== null || state === null || state.mode === mode) return
      void write(mode)
    },
  }
}
