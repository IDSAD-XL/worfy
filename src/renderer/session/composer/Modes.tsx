import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { AUTO_APPROVAL_MODES } from '../../../shared/settings/app-settings'
import { useOrchestratorViews } from '../../canvas/nodes/orchestrator-view'
import { AUTO_APPROVAL_DETAILS, AUTO_APPROVAL_LABELS, AUTO_APPROVAL_TITLES, useAutoApproval } from '../modes/auto-approval'
import { useEcoMode } from '../modes/eco-mode'
import type { ComposerItemProps } from './index'

// The Modes button (worfy-retry ticket 12), in the bar under the input field of the Orchestrator only:
// a regular Session has none. It holds the Orchestrator modes — Eco mode (modes/eco-mode.ts) and
// Auto-approval (modes/auto-approval.ts) — in one menu, where two switches stood before: a third switch
// would push Send off the pickers' line at the window's usual width (test/e2e/session-controls.spec.ts).
// The button shows the state of every item as an icon, always all of them and in a fixed order: bright
// when on, muted when off, an outline for Auto-approval Shadow, faint while not known. Each icon has a
// slot of a fixed width, so the button is as wide in every combination of states; only its caption
// «Modes» goes when the bar is short of room (Pickers.tsx, the caption step `modes`).
//
// The menu opens over the button, drawn into the page's body like the list of a Select
// (theme/select.css). Choosing an item does not close it: the new state shows in it. A window that shows
// a Linked machine opens the menu too; every item there is unavailable and says where it is set.

/** Right of the pickers (Pickers.tsx, order 10), before the queue (Queue.tsx, order 20). */
export const order = 15

/** The gap between the button and its menu. */
const MENU_GAP = 4
/** The menu keeps this far from the window's edges. */
const WINDOW_MARGIN = 8
/** Every item of the menu, in its order. */
const ITEMS = '[role="menuitemcheckbox"], [role="menuitemradio"]'

/** How an item's icon on the button looks. */
type IconState = 'on' | 'off' | 'shadow' | 'unknown'

function LeafIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M14 2C7 2 2.5 5 2.5 10.5c0 1.2.3 2.2.8 3 .9-3.6 3.6-6.4 7.4-8.2-3.2 2.2-5.4 5-6.2 8.4C11 14 14 9.5 14 2z" />
    </svg>
  )
}

function ShieldIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 1.5 2.5 3.6v4.1c0 3.3 2.3 5.9 5.5 6.8 3.2-.9 5.5-3.5 5.5-6.8V3.6L8 1.5z" />
    </svg>
  )
}

/** The mark in front of a checked item. */
function CheckMark() {
  return (
    <svg width="10" height="10" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 8.5 6.5 12 13 4.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** How the button's name says the state of an item: the state, or why it is not known. */
function stateWords(state: IconState, item: { readOnly: boolean; reading: boolean }): string {
  if (state !== 'unknown') return state
  return item.readOnly ? 'set on the Machine of the Project' : item.reading ? 'being read' : 'not available'
}

/** The menu of the Orchestrator of Project `projectId`. */
function ModesMenu({ projectId }: { projectId: string }) {
  const eco = useEcoMode(projectId)
  const auto = useAutoApproval(projectId)
  /** Where the open menu stands; null while it is closed. */
  const [menu, setMenu] = useState<CSSProperties | null>(null)
  const button = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const heading = useId()

  const ecoState: IconState = eco.on === null ? 'unknown' : eco.on ? 'on' : 'off'
  const autoState: IconState = auto.mode ?? 'unknown'
  const readOnly = eco.readOnly && auto.readOnly
  // The states are in the button's name, not only in its tooltip: a screen reader says them with it.
  const summary = `Modes: Eco mode ${stateWords(ecoState, eco)}, Auto-approval ${stateWords(autoState, auto)}`

  const close = useCallback((focus: boolean) => {
    setMenu(null)
    if (focus) button.current?.focus()
  }, [])

  const open = (): void => {
    const rect = button.current?.getBoundingClientRect()
    if (rect === undefined) return
    // Over the button: the bar stands at the bottom of the Session view.
    setMenu({ position: 'fixed', left: rect.left, bottom: window.innerHeight - rect.top + MENU_GAP })
  }

  // Once the menu shows: it moves left as far as the window's right edge makes it, and its first item
  // takes the focus.
  useLayoutEffect(() => {
    if (menu === null) return
    const element = list.current
    if (element === null) return
    const box = element.getBoundingClientRect()
    const furthest = window.innerWidth - box.width - WINDOW_MARGIN
    if (box.left > furthest) element.style.left = `${Math.max(WINDOW_MARGIN, furthest)}px`
    element.querySelector<HTMLElement>(ITEMS)?.focus()
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

  const onButtonKey = (event: KeyboardEvent<HTMLButtonElement>): void => {
    // Enter and Space are the button's click; ArrowDown opens the menu as well.
    if (event.key !== 'ArrowDown' || menu !== null) return
    event.preventDefault()
    open()
  }

  const onMenuKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      // Taken here: the dialog or the focus mode under the bar does not close on it.
      event.preventDefault()
      event.stopPropagation()
      close(true)
      return
    }
    if (event.key === 'Tab') {
      // The focus goes back to the button before the menu goes, so Tab moves on from there.
      close(true)
      return
    }
    const items = [...(list.current?.querySelectorAll<HTMLElement>(ITEMS) ?? [])]
    const at = items.findIndex((item) => item === document.activeElement)
    if (event.key === 'Enter' || event.key === ' ') {
      // The item's own click, once: the browser's activation of a focused button is held back.
      event.preventDefault()
      items[at]?.click()
      return
    }
    const next = { ArrowDown: Math.min(items.length - 1, at + 1), ArrowUp: Math.max(0, at - 1), Home: 0, End: items.length - 1 }[event.key]
    if (next === undefined) return
    event.preventDefault()
    items[next]?.focus()
  }

  const autoChecked = (mode: string): boolean => auto.mode === mode
  return (
    <>
      <button
        ref={button}
        type="button"
        className="w-modes"
        aria-label={summary}
        aria-haspopup="menu"
        aria-expanded={menu !== null}
        aria-busy={eco.busy || auto.busy ? 'true' : undefined}
        title={summary}
        data-testid="modes"
        data-read-only={readOnly ? '' : undefined}
        onKeyDown={onButtonKey}
        onClick={() => {
          if (menu === null) open()
          else close(false)
        }}
      >
        <span className="w-modes__label">Modes</span>
        <span className="w-modes__slot" data-mode-item="eco" data-state={ecoState}>
          <LeafIcon />
        </span>
        <span className="w-modes__slot" data-mode-item="auto-approval" data-state={autoState} data-saved={auto.saved ?? undefined}>
          <ShieldIcon />
        </span>
      </button>
      {menu === null
        ? null
        : createPortal(
            <div ref={list} role="menu" aria-label="Modes" className="w-modes__menu" style={menu} data-testid="modes-menu" onKeyDown={onMenuKey}>
              <button
                type="button"
                role="menuitemcheckbox"
                className="w-modes__item"
                data-item="eco"
                aria-checked={eco.on === true}
                // aria-disabled rather than disabled: a disabled button shows no tooltip (read-only.ts).
                aria-disabled={eco.unavailable !== null ? 'true' : undefined}
                aria-busy={eco.busy ? 'true' : undefined}
                title={eco.title}
                data-read-only={eco.readOnly ? '' : undefined}
                tabIndex={-1}
                onClick={eco.toggle}
              >
                <span className="w-modes__check">{eco.on === true ? <CheckMark /> : null}</span>
                <span className="w-modes__item-label">Eco mode</span>
                <span className="w-modes__item-detail">Fewer agents, Sonnet</span>
              </button>
              <div role="separator" className="w-modes__separator" />
              <div role="group" aria-labelledby={heading} aria-busy={auto.busy ? 'true' : undefined} className="w-modes__group" data-item="auto-approval">
                <span id={heading} className="w-modes__heading">
                  Auto-approval
                </span>
                {AUTO_APPROVAL_MODES.map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    role="menuitemradio"
                    className="w-modes__item"
                    data-mode={mode}
                    aria-checked={autoChecked(mode)}
                    aria-disabled={auto.unavailable !== null ? 'true' : undefined}
                    title={auto.unavailable ?? AUTO_APPROVAL_TITLES[mode]}
                    data-read-only={auto.readOnly ? '' : undefined}
                    tabIndex={-1}
                    onClick={() => auto.choose(mode)}
                  >
                    <span className="w-modes__check">{autoChecked(mode) ? <CheckMark /> : null}</span>
                    <span className="w-modes__item-label">{AUTO_APPROVAL_LABELS[mode]}</span>
                    <span className="w-modes__item-detail">{AUTO_APPROVAL_DETAILS[mode]}</span>
                  </button>
                ))}
              </div>
            </div>,
            document.body,
          )}
    </>
  )
}

export default function Modes({ sessionId }: ComposerItemProps) {
  // Only the Orchestrator's input field: the live Session of an Orchestrator view of this window. Any
  // other Session gets nothing, and asks main for nothing.
  const views = useOrchestratorViews()
  const projectId = sessionId === null ? undefined : Object.values(views).find((each) => each.sessionId === sessionId)?.projectId
  return projectId === undefined ? null : <ModesMenu key={projectId} projectId={projectId} />
}
