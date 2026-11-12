import { useState } from 'react'
import { AUTO_APPROVAL_MODES, type AutoApprovalMode } from '../../../shared/settings/app-settings'
import { useOrchestratorViews } from '../../canvas/nodes/orchestrator-view'
import { Menu, MenuCheckboxItem, MenuRadioGroup, MenuRadioItem, MenuSeparator } from '../../theme/kit/Menu'
import { AUTO_APPROVAL_DETAILS, AUTO_APPROVAL_LABELS, AUTO_APPROVAL_TITLES, useAutoApproval } from '../modes/auto-approval'
import { useAutoContinue } from '../modes/auto-continue'
import { useEcoMode } from '../modes/eco-mode'
import type { ComposerItemProps } from './index'

// The Modes button (worfy-retry ticket 12), in the bar under the input field of the Orchestrator only:
// a regular Session has none. It holds the Orchestrator modes — Eco mode (modes/eco-mode.ts),
// Auto-approval (modes/auto-approval.ts) and Auto-continue (modes/auto-continue.ts, worfy-retry ticket
// 02) — in one menu, where two switches stood before: a third switch would push Send off the pickers'
// line at the window's usual width (test/e2e/session-controls.spec.ts).
// The button shows the state of every item as an icon, always all of them and in a fixed order: bright
// when on, muted when off, an outline for Auto-approval Shadow, faint while not known. Each icon has a
// slot of a fixed width, so the button is as wide in every combination of states; only its caption
// «Modes» goes when the bar is short of room (Pickers.tsx, the caption step `modes`).
//
// The menu is the kit's Menu (theme/kit/Menu.tsx, worfy-ui-kit ticket 11): over the button, drawn into
// the page's body and slid left along the window's right edge, on the layer of a menu over a dialog.
// The arrows stop at the ends. Choosing an item does not close it: the new state shows in it. A window that shows
// a Linked machine shows the modes of that Machine's Project (worfy-retry ticket 13): with full access
// every item changes them there, with read-only access every item shows its state and is unavailable with
// the read-only hint. A change made on either Machine shows in an open menu at once.

/** Right of the pickers (Pickers.tsx, order 10), before the queue (Queue.tsx, order 20). */
export const order = 15

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

/** Auto-continue: an arrow that comes round and goes on. */
function ContinueIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 2a6 6 0 1 0 5.7 7.9l-1.9-.6A4 4 0 1 1 8 4c1 0 2 .4 2.7 1L9 6.7h5V1.7l-1.9 1.9A6 6 0 0 0 8 2z" />
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
function stateWords(state: IconState, item: { reading: boolean }): string {
  if (state !== 'unknown') return state
  return item.reading ? 'being read' : 'not available'
}

/** The menu of the Orchestrator of Project `projectId`. */
function ModesMenu({ projectId }: { projectId: string }) {
  const eco = useEcoMode(projectId)
  const auto = useAutoApproval(projectId)
  const cont = useAutoContinue(projectId)
  const [open, setOpen] = useState(false)

  const ecoState: IconState = eco.on === null ? 'unknown' : eco.on ? 'on' : 'off'
  const autoState: IconState = auto.mode ?? 'unknown'
  const contState: IconState = cont.on === null ? 'unknown' : cont.on ? 'on' : 'off'
  const readOnly = eco.readOnly && auto.readOnly && cont.readOnly
  // The states are in the button's name, not only in its tooltip: a screen reader says them with it.
  const summary = `Modes: Eco mode ${stateWords(ecoState, eco)}, Auto-approval ${stateWords(autoState, auto)}, Auto-continue ${stateWords(contState, cont)}`

  const autoChecked = (mode: string): boolean => auto.mode === mode
  const trigger = (
    <button type="button" className="w-modes" aria-label={summary} aria-busy={eco.busy || auto.busy || cont.busy ? 'true' : undefined} title={summary} data-testid="modes" data-read-only={readOnly ? '' : undefined}>
      <span className="w-modes__label">Modes</span>
      <span className="w-modes__slot" data-mode-item="eco" data-state={ecoState}>
        <LeafIcon />
      </span>
      <span className="w-modes__slot" data-mode-item="auto-approval" data-state={autoState} data-saved={auto.saved ?? undefined}>
        <ShieldIcon />
      </span>
      <span className="w-modes__slot" data-mode-item="auto-continue" data-state={contState}>
        <ContinueIcon />
      </span>
    </button>
  )
  // Over the button: the bar stands at the bottom of the Session view. On the layer of a menu over a
  // dialog: the composer is in a Session window and in focus mode too.
  return (
    <Menu open={open} onOpenChange={setOpen} trigger={trigger} label="Modes" className="w-modes__menu" testId="modes-menu" side="top" align="start" loopFocus={false} layer="dialogMenu">
      <MenuCheckboxItem
        className="w-modes__item"
        data-item="eco"
        checked={eco.on === true}
        onCheckedChange={eco.toggle}
        // Inactive, not disabled: the item keeps the focus and its tooltip (aria-disabled, read-only.ts).
        disabled={eco.unavailable !== null}
        aria-busy={eco.busy ? 'true' : undefined}
        title={eco.title}
        data-read-only={eco.readOnly ? '' : undefined}
      >
        <span className="w-modes__check">{eco.on === true ? <CheckMark /> : null}</span>
        <span className="w-modes__item-label">Eco mode</span>
        <span className="w-modes__item-detail">Fewer agents, Sonnet</span>
      </MenuCheckboxItem>
      <MenuSeparator className="w-modes__separator" />
      <MenuRadioGroup
        heading="Auto-approval"
        headingClassName="w-modes__heading"
        value={auto.mode}
        onValueChange={(mode) => auto.choose(mode as AutoApprovalMode)}
        aria-busy={auto.busy ? 'true' : undefined}
        className="w-modes__group"
        data-item="auto-approval"
      >
        {AUTO_APPROVAL_MODES.map((mode) => (
          <MenuRadioItem
            key={mode}
            value={mode}
            className="w-modes__item"
            data-mode={mode}
            disabled={auto.unavailable !== null}
            title={auto.unavailable ?? AUTO_APPROVAL_TITLES[mode]}
            data-read-only={auto.readOnly ? '' : undefined}
          >
            <span className="w-modes__check">{autoChecked(mode) ? <CheckMark /> : null}</span>
            <span className="w-modes__item-label">{AUTO_APPROVAL_LABELS[mode]}</span>
            <span className="w-modes__item-detail">{AUTO_APPROVAL_DETAILS[mode]}</span>
          </MenuRadioItem>
        ))}
      </MenuRadioGroup>
      <MenuSeparator className="w-modes__separator" />
      <MenuCheckboxItem
        className="w-modes__item"
        data-item="auto-continue"
        checked={cont.on === true}
        onCheckedChange={cont.toggle}
        disabled={cont.unavailable !== null}
        aria-busy={cont.busy ? 'true' : undefined}
        title={cont.title}
        data-read-only={cont.readOnly ? '' : undefined}
      >
        <span className="w-modes__check">{cont.on === true ? <CheckMark /> : null}</span>
        <span className="w-modes__item-label">Auto-continue</span>
        <span className="w-modes__item-detail">Retry after API errors and Limits</span>
      </MenuCheckboxItem>
    </Menu>
  )
}

export default function Modes({ sessionId }: ComposerItemProps) {
  // Only the Orchestrator's input field: the live Session of an Orchestrator view of this window. Any
  // other Session gets nothing, and asks main for nothing.
  const views = useOrchestratorViews()
  const projectId = sessionId === null ? undefined : Object.values(views).find((each) => each.sessionId === sessionId)?.projectId
  return projectId === undefined ? null : <ModesMenu key={projectId} projectId={projectId} />
}
