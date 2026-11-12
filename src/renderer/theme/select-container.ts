import { createContext } from 'react'

/**
 * Where the list of a Select below is drawn (theme/Select.tsx); null — document.body. A window of the
 * kit (theme/kit/Dialog.tsx) provides its own element: for the window's focus trap, for hiding the
 * page from a screen reader and for a press outside, the list is then part of the window
 * (worfy-ui-kit spike, .scratch/worfy-ui-kit/spike-base-ui.md, step 3). `position: fixed` of the list
 * still counts from the window of the app: the kit's windows are not placed with `transform`.
 */
export const SelectListContainer = createContext<HTMLElement | null>(null)
