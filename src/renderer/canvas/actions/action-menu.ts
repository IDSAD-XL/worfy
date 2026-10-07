// The "⋯" button of an action and the menu it opens (worfy-week ticket 18: Force stop of Autopilot
// lives there). Written without JSX on purpose, as action-button.ts: the action slot
// (badges/index.ts) collects every .tsx file of this folder as an action, and this is not one.
//
// The button is the common action button (`.w-action`) made a 20×20 square (`.w-action--icon`).
// The menu behaves as the Canvas menu (overlays/CanvasMenu.tsx): it is drawn into document.body with
// `position: fixed`, under the button and aligned to its right edge — inside the Node, the
// Canvas's zoom would scale it and the Epic frame would cut it off. The focus goes to its first
// item, the arrows move between items. Esc, a click outside, the window losing focus, the wheel
// outside it and choosing an item close it; the focus then goes back to "⋯" when it was in the
// menu. Esc calls preventDefault: one press, one action (the done stack of worfy-week ticket 15 sees
// the open `[role="menu"]` and stays). An item that is in flight is inactive; main's refusal of
// an item is shown in the title of "⋯", with the error border of the action button.
import { createElement, Fragment, useCallback, useEffect, useLayoutEffect, useState, type CSSProperties, type KeyboardEvent, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import '../../theme/primitives.css'
import './actions.css'

export interface ActionMenuItem {
  label: string
  /** Active: what the item does. Inactive: why not. */
  title: string
  testId: string
  /** Inactive: the item is in flight, or cannot run now. */
  disabled: boolean
  /** The run; resolves to main's reason when it was refused, undefined when it worked. */
  run: () => Promise<string | undefined>
}

export interface ActionMenuProps {
  /** The button's accessible name. */
  label: string
  title: string
  testId: string
  /** The menu's accessible name. */
  menuLabel: string
  items: readonly ActionMenuItem[]
}

/** Where the open menu is drawn, in window coordinates: its top and its right edge's distance from the window's. */
interface Opened {
  top: number
  right: number
}

/** The gap between the button and the menu under it. */
const MENU_GAP = 4

export function ActionMenu({ label, title, testId, menuLabel, items }: ActionMenuProps): ReactElement {
  const [opened, setOpened] = useState<Opened | null>(null)
  const [error, setError] = useState<string | null>(null)
  // The elements as callback refs keep in state: a ref object handed to createElement reads as a
  // ref read during render to the React lint.
  const [button, setButton] = useState<HTMLButtonElement | null>(null)
  const [menu, setMenu] = useState<HTMLDivElement | null>(null)

  const close = useCallback(() => {
    // Back to "⋯" when the focus was in the menu; a click elsewhere keeps the focus where it went.
    const focusIn = menu?.contains(document.activeElement) === true
    setOpened(null)
    if (focusIn) button?.focus()
  }, [button, menu])

  const toggle = () => {
    if (opened !== null) {
      close()
      return
    }
    if (button === null) return
    const rect = button.getBoundingClientRect()
    setOpened({ top: rect.bottom + MENU_GAP, right: Math.max(0, window.innerWidth - rect.right) })
  }

  useLayoutEffect(() => {
    if (opened === null || menu === null) return
    menu.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus()
  }, [opened, menu])

  useEffect(() => {
    if (opened === null) return
    const outside = (event: Event) => {
      const target = event.target as Node | null
      if (menu?.contains(target) === true || button?.contains(target) === true) return
      close()
    }
    document.addEventListener('mousedown', outside)
    window.addEventListener('wheel', outside, true)
    window.addEventListener('blur', close)
    return () => {
      document.removeEventListener('mousedown', outside)
      window.removeEventListener('wheel', outside, true)
      window.removeEventListener('blur', close)
    }
  }, [opened, close, menu, button])

  const choose = (item: ActionMenuItem) => {
    if (item.disabled) return
    close()
    setError(null)
    void item.run().then((failure) => setError(failure ?? null))
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      // The press that closes the menu does nothing else (the Esc of the done stack, of an active Node).
      event.preventDefault()
      close()
      return
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    const entries = [...(menu?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])]
    if (entries.length === 0) return
    const current = entries.indexOf(document.activeElement as HTMLButtonElement)
    const next = (current + (event.key === 'ArrowDown' ? 1 : entries.length - 1)) % entries.length
    entries[next]?.focus()
  }

  const trigger = createElement(
    'button',
    {
      ref: setButton,
      type: 'button',
      className: 'w-action w-action--icon nodrag',
      'aria-label': label,
      'aria-haspopup': 'menu',
      'aria-expanded': opened !== null,
      title: error ?? title,
      'data-testid': testId,
      'data-error': error ?? undefined,
      onClick: toggle,
      onDoubleClick: (event: { stopPropagation(): void }) => event.stopPropagation(),
    },
    '⋯',
  )
  if (opened === null) return createElement(Fragment, null, trigger, null)
  const style: CSSProperties = { top: opened.top, right: opened.right }
  const list = createElement(
    'div',
    { ref: setMenu, role: 'menu', 'aria-label': menuLabel, className: 'w-action-menu', style, onKeyDown },
    items.map((item) =>
      createElement(
        'button',
        {
          key: item.testId,
          type: 'button',
          role: 'menuitem',
          className: 'w-row',
          title: item.title,
          'aria-disabled': item.disabled ? 'true' : 'false',
          'data-testid': item.testId,
          onClick: () => choose(item),
        },
        item.label,
      ),
    ),
  )
  // The same tree shape open or closed: the button is not mounted again, and keeps its focus.
  return createElement(Fragment, null, trigger, createPortal(list, document.body))
}
