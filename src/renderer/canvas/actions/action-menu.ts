// The "⋯" button of an action and the menu it opens (worfy-week ticket 18: Force stop of Autopilot
// lives there). Written without JSX on purpose, as action-button.ts: the action slot
// (badges/index.ts) collects every .tsx file of this folder as an action, and this is not one.
//
// The button is the common action button (`.w-action`) made a 20×20 square (`.w-action--icon`), or
// with `text` a text button ("Open PR" of a Ticket over several repositories, OpenPr.tsx).
// The menu is the kit's Menu (theme/kit/Menu.tsx, worfy-ui-kit ticket 11) of a Node: drawn into
// document.body under the button, its right edge on the button's, flipped over it near the bottom of
// the window. The kit gives the keys (the arrows round, Home, End, a letter), Esc that closes only the
// menu and is marked handled (the done stack of worfy-week ticket 15 sees the open `[role="menu"]` and
// stays), the focus back on "⋯", and closing on a press outside, the wheel outside and the window
// losing focus. An item that is in flight is inactive; main's refusal of an item is shown in the title
// of "⋯", with the error border of the action button.
import { createElement, useState, type ReactElement } from 'react'
import { Menu, MenuItem } from '../../theme/kit/Menu'
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
  /** Text on the button in place of «⋯»: the button is then a text action button, as «Open PR» is. */
  text?: string
  title: string
  testId: string
  /** The menu's accessible name. */
  menuLabel: string
  items: readonly ActionMenuItem[]
}

export function ActionMenu({ label, text, title, testId, menuLabel, items }: ActionMenuProps): ReactElement {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const choose = (item: ActionMenuItem) => {
    setError(null)
    void item.run().then((failure) => setError(failure ?? null))
  }

  const trigger = createElement(
    'button',
    {
      type: 'button',
      className: text === undefined ? 'w-action w-action--icon nodrag' : 'w-action nodrag',
      'aria-label': label,
      title: error ?? title,
      'data-testid': testId,
      'data-error': error ?? undefined,
      onDoubleClick: (event: { stopPropagation(): void }) => event.stopPropagation(),
    },
    text ?? '⋯',
  )
  return createElement(Menu, {
    open,
    onOpenChange: setOpen,
    trigger,
    label: menuLabel,
    className: 'w-action-menu',
    align: 'end',
    inNode: true,
    children: items.map((item) =>
      createElement(MenuItem, { key: item.testId, className: 'w-row', title: item.title, disabled: item.disabled, 'aria-disabled': item.disabled ? 'true' : 'false', testId: item.testId, onClick: () => choose(item), children: item.label }),
    ),
  })
}
