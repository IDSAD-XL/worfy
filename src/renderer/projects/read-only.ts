// How a write action looks on the screen of a Linked machine that shares its Projects read-only
// (worfy-link ticket 25, ADR-0066): it stays on screen, inactive, and its tooltip says why. Which
// screen is read-only is decided in useProjects.ts (useReadOnly, readOnlyNow); this module only
// draws the answer. The tooltip is the Tooltip kit's (worfy-ui-kit ticket 13): it shows under the
// pointer and on the keyboard focus, and a screen reader hears it as the action's description. Main refuses such a call anyway (src/main/link/ipc-adapter.ts); the inactive
// action saves the user the round trip and the refusal.
import { hintProps, type HintProps } from '../theme/kit/hint'
import './read-only.css'

/** The tooltip of every inactive write action; `name` — the Machine of the Project. */
export function readOnlyHint(name: string | undefined): string {
  return `${name ?? 'This Linked machine'} gives this Machine read-only access`
}

/** What a write action's element gets: inactive and focusable, with the hint, on a read-only screen. */
export interface WriteActionProps<E> extends Partial<HintProps> {
  onClick: (event: E) => void
  title: string | undefined
  'aria-disabled'?: 'true'
  'data-read-only'?: ''
}

/**
 * The props of a write action's button: `onClick` and `title` as given, or — when `hint` is set —
 * a click that does nothing and the hint as the Tooltip kit's tooltip (`hintProps`, shown by
 * HintTooltips), with no native `title`: the two would show one over the other. `aria-disabled`
 * rather than `disabled`: a disabled button takes no focus and no hover, so it shows no tooltip (as
 * action-button.ts does).
 */
export function writeAction<E = unknown>(hint: string | null, onClick: (event: E) => void, title?: string): WriteActionProps<E> {
  if (hint === null) return { onClick, title }
  return { onClick: () => undefined, title: undefined, 'aria-disabled': 'true', 'data-read-only': '', ...hintProps(hint) }
}

/** What a write action's item of a kit menu gets (theme/kit/Menu.tsx MenuItem). */
export interface WriteItemProps extends Partial<HintProps> {
  onClick: () => void
  disabled: boolean
  'data-read-only'?: ''
}

/**
 * The props of a write action's menu item: `onClick` as given, or — when `hint` is set — an inactive
 * item with the hint as its tooltip. An inactive item of the kit keeps the focus and the hover, so its
 * tooltip shows, and a choice of it neither runs nor closes the menu.
 */
export function writeItem(hint: string | null, onClick: () => void): WriteItemProps {
  if (hint === null) return { onClick, disabled: false }
  return { onClick: () => undefined, disabled: true, 'data-read-only': '', ...hintProps(hint) }
}
