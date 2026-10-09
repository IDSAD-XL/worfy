// The hint "File is on <Machine>" a window on a Linked machine shows in place of opening a Project
// file (worfy-link ticket 12; useFileElsewhere.ts decides when).
import type { CSSProperties } from 'react'
import { windowMachine } from '../ipc'
import { useMachines } from './useMachines'

/** How the hint looks where it is shown. */
export interface HintLook {
  className?: string
  style?: CSSProperties
}

/**
 * The hint, with the name of the window's Linked machine from this Machine's link state; "the
 * Linked machine" until the state names it. Rendered only while it is shown, so a window on this
 * Machine never asks for the link state on its account.
 */
export function FileElsewhereHint({ className, style }: HintLook) {
  const machine = windowMachine()
  const link = useMachines()
  const name = link?.linked.find((candidate) => candidate.id === machine)?.name ?? 'the Linked machine'
  const text = `File is on ${name}`
  // The title holds the whole text where the row cuts a long Machine name (a Ticket Node).
  return (
    <span role="status" className={className} style={style} title={text} data-testid="file-elsewhere">
      {text}
    </span>
  )
}
