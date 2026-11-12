import { createContext } from 'react'

/** Spike worfy-ui-kit 01 (never merged): where the Select list is drawn; null — document.body, as on main. */
export const SelectPortalContext = createContext<HTMLElement | null>(null)
