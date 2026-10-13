// The status dot next to the "Machines" heading of the sidebar: what the Linked machines call for.
// A pure function, so that it is tested without a DOM; machines.css draws the dot.
import type { LinkedMachineView } from '../../shared/ipc/link'

export interface MachinesDot {
  /** `online` — green, pulsing; `certificate-changed` — amber, still. */
  kind: 'online' | 'certificate-changed'
  /** What the dot says: its tooltip and its accessible name. The dot has no visible caption. */
  label: string
}

/**
 * The dot for these Linked machines; null — no dot.
 * - A Linked machine answered with another certificate: amber. It has to be linked again, and that
 *   matters more than the others being online.
 * - Otherwise, at least one is online: green, with how many.
 * - Nobody online (unavailable, sleeping) or no Linked machine: no dot.
 */
export function machinesDot(linked: readonly Pick<LinkedMachineView, 'state' | 'certificateChanged'>[]): MachinesDot | null {
  if (linked.some((machine) => machine.certificateChanged)) return { kind: 'certificate-changed', label: 'Certificate changed — link the machine again' }
  const online = linked.filter((machine) => machine.state === 'online').length
  if (online === 0) return null
  return { kind: 'online', label: `${online} linked ${online === 1 ? 'machine' : 'machines'} online` }
}
