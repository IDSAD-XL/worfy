import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { failureReason } from '../../../shared/ipc/channels'
import { AUTO_APPROVAL_MODES, type AutoApprovalMode } from '../../../shared/settings/app-settings'
import { useOrchestratorViews } from '../../canvas/nodes/orchestrator-view'
import { invoke, readableReason, windowMachine } from '../../ipc'
import { showToast } from '../../toast/toasts'
import type { ComposerItemProps } from './index'

// The Auto-approval switch (worfy-auto-approve ticket 06), in the bar under the input field of the
// Orchestrator only: a regular Session has none. It shows the mode of the Project — Off, Shadow or
// On — as main reads it from app-settings.json of worfy's data folder (`autoApproval.read`,
// src/main/ipc/auto-approve.ts); a click opens a menu of the three positions, and choosing another
// one writes it (`autoApproval.set`). The mode is this Machine's setting, not the Profile's (spec of
// the Epic, "decided without the owner", item 3): the switch never goes through the Harness. A window
// that shows a Linked machine reads and writes nothing and says where the mode is set.
//
// The look is Eco mode's (EcoMode.tsx, class `w-eco`) with a modifier of its own, `w-eco--three`
// (session.css): the same frame and as narrow, a track whose knob stands in one of three places. The
// bar under the input field has room for little more than Eco mode at the window's usual width
// (test/e2e/session-controls.spec.ts keeps Send on the pickers' line), so the three positions open
// as a menu rather than standing side by side. Its caption has a class of its own and hides with
// Eco mode's when the bar is short of room.

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

/** The line under each position in the menu. */
const DETAILS: Readonly<Record<AutoApprovalMode, string>> = { off: 'Refuse every request', shadow: 'Refuse, and log what would pass', on: 'Answer by the Approval policy' }

/** The tooltip in a window that shows a Linked machine: the mode is that Machine's setting. */
export const AUTO_APPROVAL_ELSEWHERE = 'Auto-approval is set in worfy on the Machine of the Project'

/** What the switch knows of the mode: undefined while it is read. */
type Shown = { mode: AutoApprovalMode } | { error: string } | undefined

const TOAST_KEY = 'auto-approval'
/** The gap between the button and its menu. */
const MENU_GAP = 4
/** The menu keeps this far from the window's edges. */
const WINDOW_MARGIN = 8

/** The knob's mark: an empty ring for Off, a half-filled one for Shadow, a tick for On. */
function KnobIcon({ mode }: { mode: AutoApprovalMode | null }) {
  return (
    <svg width="8" height="8" viewBox="0 0 16 16" aria-hidden="true" data-testid="auto-approval-icon" data-icon={mode ?? 'none'}>
      {mode === 'on' ? (
        <path d="M3 8.5 6.5 12 13 4.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      ) : (
        <>
          <circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" strokeWidth="2" />
          {mode === 'shadow' ? <path d="M8 2.5a5.5 5.5 0 0 1 0 11z" fill="currentColor" /> : null}
        </>
      )}
    </svg>
  )
}

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
  /** Where the open menu stands; null while it is closed. */
  const [menu, setMenu] = useState<CSSProperties | null>(null)
  const button = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLDivElement>(null)

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

  const current = writing ?? (shown !== undefined && 'mode' in shown ? shown.mode : null)
  const unavailable = elsewhere
    ? AUTO_APPROVAL_ELSEWHERE
    : shown === undefined
      ? 'Reading the Auto-approval mode…'
      : 'error' in shown
        ? `Auto-approval is not available: ${shown.error}`
        : null

  const close = useCallback((focus: boolean) => {
    setMenu(null)
    if (focus) button.current?.focus()
  }, [])

  const choose = async (mode: AutoApprovalMode): Promise<void> => {
    close(true)
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

  const open = (): void => {
    const rect = button.current?.getBoundingClientRect()
    if (rect === undefined) return
    // Over the button: the bar stands at the bottom of the Session view.
    setMenu({ position: 'fixed', left: rect.left, bottom: window.innerHeight - rect.top + MENU_GAP })
  }

  // Once the menu shows: it moves left as far as the window's right edge makes it, and the checked
  // position takes the focus.
  useLayoutEffect(() => {
    if (menu === null) return
    const element = list.current
    if (element !== null) {
      const box = element.getBoundingClientRect()
      const furthest = window.innerWidth - box.width - WINDOW_MARGIN
      if (box.left > furthest) element.style.left = `${Math.max(WINDOW_MARGIN, furthest)}px`
    }
    const items = [...(list.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? [])]
    ;(items.find((item) => item.getAttribute('aria-checked') === 'true') ?? items[0])?.focus()
  }, [menu])

  // A press outside, a resize and the window losing focus close the menu.
  useEffect(() => {
    if (menu === null) return
    const outside = (event: PointerEvent): void => {
      const target = event.target as Node | null
      if (target !== null && (list.current?.contains(target) === true || button.current?.contains(target) === true)) return
      close(false)
    }
    const away = (): void => close(false)
    document.addEventListener('pointerdown', outside, true)
    window.addEventListener('resize', away)
    window.addEventListener('blur', away)
    return () => {
      document.removeEventListener('pointerdown', outside, true)
      window.removeEventListener('resize', away)
      window.removeEventListener('blur', away)
    }
  }, [menu, close])

  const onMenuKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      // Taken here: the dialog or the focus mode under the bar does not close on it.
      event.preventDefault()
      event.stopPropagation()
      close(true)
      return
    }
    if (event.key === 'Tab') {
      close(false)
      return
    }
    const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0
    if (step === 0) return
    event.preventDefault()
    const items = [...(list.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? [])]
    const at = items.findIndex((item) => item === document.activeElement)
    items[Math.min(items.length - 1, Math.max(0, at + step))]?.focus()
  }

  return (
    <>
      <button
        ref={button}
        type="button"
        className="w-eco w-eco--three"
        aria-label="Auto-approval"
        aria-haspopup="menu"
        aria-expanded={menu !== null}
        // aria-disabled rather than disabled: a disabled button shows no tooltip (read-only.ts).
        aria-disabled={unavailable !== null ? 'true' : undefined}
        aria-busy={writing !== null ? 'true' : undefined}
        title={unavailable ?? (current === null ? undefined : TITLES[current])}
        data-testid="auto-approval"
        data-mode={elsewhere ? undefined : (current ?? undefined)}
        data-read-only={elsewhere ? '' : undefined}
        onClick={() => {
          if (unavailable !== null || writing !== null) return
          if (menu === null) open()
          else close(false)
        }}
      >
        <span className="w-auto-approval__label">Auto-approval</span>
        <span className="w-eco__track" aria-hidden="true">
          <span className="w-eco__knob">
            <KnobIcon mode={elsewhere ? null : current} />
          </span>
        </span>
      </button>
      {menu === null
        ? null
        : createPortal(
            <div ref={list} role="menu" aria-label="Auto-approval" className="w-auto-approval__menu" style={menu} data-testid="auto-approval-menu" onKeyDown={onMenuKey}>
              {AUTO_APPROVAL_MODES.map((mode) => (
                <button
                  key={mode}
                  type="button"
                  role="menuitemradio"
                  className="w-auto-approval__option"
                  data-mode={mode}
                  aria-checked={current === mode}
                  title={TITLES[mode]}
                  tabIndex={-1}
                  onClick={() => void choose(mode)}
                >
                  <span className="w-auto-approval__option-label">{LABELS[mode]}</span>
                  <span className="w-auto-approval__option-detail">{DETAILS[mode]}</span>
                </button>
              ))}
            </div>,
            document.body,
          )}
    </>
  )
}

export default function AutoApprove({ sessionId }: ComposerItemProps) {
  // Only the Orchestrator's input field: the live Session of an Orchestrator view of this window. Any
  // other Session gets nothing, and asks main for nothing.
  const views = useOrchestratorViews()
  const projectId = sessionId === null ? undefined : Object.values(views).find((each) => each.sessionId === sessionId)?.projectId
  return projectId === undefined ? null : <AutoApprovalSwitch key={projectId} projectId={projectId} />
}
