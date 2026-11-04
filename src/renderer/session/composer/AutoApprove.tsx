import { useEffect, useState } from 'react'
import { failureReason } from '../../../shared/ipc/channels'
import { AUTO_APPROVAL_MODES, type AutoApprovalMode } from '../../../shared/settings/app-settings'
import { useOrchestratorViews } from '../../canvas/nodes/orchestrator-view'
import { invoke, readableReason, windowMachine } from '../../ipc'
import { showToast } from '../../toast/toasts'
import type { ComposerItemProps } from './index'

// The Auto-approval switch (worfy-auto-approve ticket 06), in the bar under the input field of the
// Orchestrator only: a regular Session has none. Three positions — Off, Shadow, On — show the mode of
// the Project as main reads it from app-settings.json of worfy's data folder (`autoApproval.read`,
// src/main/ipc/auto-approve.ts), and a click on another position writes it (`autoApproval.set`). The
// mode is this Machine's setting, not the Profile's (spec of the Epic, "decided without the owner", item 3):
// the switch never goes through the Harness. A window that shows a Linked machine reads and writes
// nothing and says where the mode is set. Its look follows Eco mode (EcoMode.tsx, class `w-eco`)
// with a modifier of its own for the three positions (`w-eco--three`, session.css).

/** Right of Eco mode (EcoMode.tsx, order 15) and of worfy-retry's Auto-continue (order 16). */
export const order = 17

/** The caption of each position. */
const LABELS: Readonly<Record<AutoApprovalMode, string>> = { off: 'Off', shadow: 'Shadow', on: 'On' }

/** The tooltip of Off: what an unattended Run does with a permission request in it. */
export const AUTO_APPROVAL_OFF = 'Auto-approval off: in an unattended Run every permission request is refused, as before.'
/** The tooltip of Shadow. */
export const AUTO_APPROVAL_SHADOW = 'Auto-approval shadow: requests are still refused; worfy only writes to the Journal what the Approval policy would have done.'
/** The tooltip of On. */
export const AUTO_APPROVAL_ON =
  'Auto-approval on: in an unattended Run worfy answers permission requests by the Approval policy — allows what stays inside the Project, denies with a hint or parks the rest. Hard deny always applies.'

const TITLES: Readonly<Record<AutoApprovalMode, string>> = { off: AUTO_APPROVAL_OFF, shadow: AUTO_APPROVAL_SHADOW, on: AUTO_APPROVAL_ON }

/** The tooltip in a window that shows a Linked machine: the mode is that Machine's setting. */
export const AUTO_APPROVAL_ELSEWHERE = 'Auto-approval is set in worfy on the Machine of the Project'

/** What the switch knows of the mode: undefined while it is read. */
type Shown = { mode: AutoApprovalMode } | { error: string } | undefined

const TOAST_KEY = 'auto-approval'

/** The switch for Project `projectId`. */
function AutoApprovalSwitch({ projectId }: { projectId: string }) {
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
      setShown(result.ok ? { mode: result.value.mode } : { error: readableReason(failureReason('autoApproval.read', result.error)) })
    })
    return () => {
      active = false
    }
  }, [projectId, generation, elsewhere])

  const choose = async (mode: AutoApprovalMode): Promise<void> => {
    if (shown === undefined || !('mode' in shown) || shown.mode === mode || writing !== null) return
    setWriting(mode)
    const result = await invoke('autoApproval.set', { projectId, mode })
    setWriting(null)
    if (result.ok) {
      setShown({ mode: result.value.mode })
      return
    }
    showToast({ kind: 'error', key: TOAST_KEY, projectId, text: `Auto-approval was not set to ${LABELS[mode]}: ${readableReason(failureReason('autoApproval.set', result.error))}`, testId: 'auto-approval-toast' })
    setGeneration((count) => count + 1)
  }

  const current = writing ?? (shown !== undefined && 'mode' in shown ? shown.mode : null)
  const unavailable = elsewhere
    ? AUTO_APPROVAL_ELSEWHERE
    : shown === undefined
      ? 'Reading the Auto-approval mode…'
      : 'error' in shown
        ? `Auto-approval is not available: ${shown.error}`
        : null
  return (
    <span
      role="group"
      className="w-eco w-eco--three"
      aria-label="Auto-approval"
      // aria-disabled rather than disabled: a disabled button shows no tooltip (read-only.ts).
      aria-disabled={unavailable !== null ? 'true' : undefined}
      aria-busy={writing !== null ? 'true' : undefined}
      title={unavailable ?? undefined}
      data-testid="auto-approval"
      data-mode={elsewhere ? undefined : (current ?? undefined)}
      data-read-only={elsewhere ? '' : undefined}
    >
      <span className="w-eco__label">Auto-approval</span>
      <span className="w-eco__positions">
        {AUTO_APPROVAL_MODES.map((mode) => (
          <button
            key={mode}
            type="button"
            className="w-eco__position"
            data-mode={mode}
            aria-pressed={!elsewhere && current === mode}
            aria-disabled={unavailable !== null ? 'true' : undefined}
            title={unavailable ?? TITLES[mode]}
            onClick={() => {
              if (unavailable === null) void choose(mode)
            }}
          >
            {LABELS[mode]}
          </button>
        ))}
      </span>
    </span>
  )
}

export default function AutoApprove({ sessionId }: ComposerItemProps) {
  // Only the Orchestrator's input field: the live Session of an Orchestrator view of this window. Any
  // other Session gets nothing, and asks main for nothing.
  const views = useOrchestratorViews()
  const projectId = sessionId === null ? undefined : Object.values(views).find((each) => each.sessionId === sessionId)?.projectId
  return projectId === undefined ? null : <AutoApprovalSwitch key={projectId} projectId={projectId} />
}
