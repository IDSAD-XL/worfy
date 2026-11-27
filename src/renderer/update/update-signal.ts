import type { UpdateSnapshot } from '../../shared/ipc/update'
import { invoke } from '../ipc'
import { installUpdateTelling, RESTART_LABEL, updateVersionLabel } from './store'
import type { WhatsNewAction } from './WhatsNew'

// What the Update of worfy offers for a snapshot (worfy-update ticket 06): its phase, its text, whether
// it gives the version chip its dot, and its first action. The chip (shell/footer/VersionChip.tsx), its
// popover's app row (UpdateChip.tsx) and the dot (shell/footer/version-dot.ts) read it.

export type Phase = 'available' | 'building' | 'ready' | 'failed'

export interface Signal {
  phase: Phase
  version: string
  /** The accent dot: anything but a quiet Available update (the commit the user rolled back from). */
  dot: boolean
}

/** What the Update offers for a snapshot, or null when there is nothing to install. */
export function updateSignal(update: UpdateSnapshot | null): Signal | null {
  if (update === null || !update.enabled) return null
  const { available, build } = update
  if (build.phase !== 'idle') {
    const version = build.version ?? available?.version
    if (version !== undefined) return { phase: build.phase, version, dot: true }
  }
  if (available !== null) return { phase: 'available', version: available.version, dot: !available.quiet }
  return null
}

export const UPDATE_TEXT: Record<Phase, (version: string) => string> = {
  available: (version) => `worfy ${version} is available`,
  building: (version) => `Building worfy ${version}…`,
  ready: (version) => `worfy ${version} is ready — restart to update`,
  failed: (version) => `The update to ${version} failed — see Settings → Health`,
}

/** What the Update of a snapshot says, versions as the chip shows them; undefined when there is none. */
export function updateText(update: UpdateSnapshot | null): string | undefined {
  const signal = updateSignal(update)
  return signal === null ? undefined : UPDATE_TEXT[signal.phase](updateVersionLabel(update, signal.version))
}

function install(update: UpdateSnapshot | null): void {
  void installUpdateTelling(update)
}

export function restart(when: 'now' | 'idle'): void {
  void invoke('update.restart', { when }).then((result) => {
    if (!result.ok) console.error('update.restart failed:', result.error)
    else if (result.value.outcome === 'refused') console.warn(`update.restart (${when}) refused: ${result.value.reason}`)
  })
}

/** The first action of the app row and the button of "What's new": without `run`, inactive. */
export function primaryOf(signal: Signal, update: UpdateSnapshot | null): WhatsNewAction {
  const idle = update?.idle ?? false
  if (signal.phase === 'building') return { label: UPDATE_TEXT.building(updateVersionLabel(update, signal.version)) }
  if (signal.phase === 'ready') return idle ? { label: RESTART_LABEL.now, run: () => restart('now') } : { label: RESTART_LABEL.idle, run: () => restart('idle') }
  return { label: 'Update worfy', run: () => install(update) }
}
