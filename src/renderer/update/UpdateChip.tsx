import type { UpdateSnapshot } from '../../shared/ipc/update'
import { buildVersionTooltip, numberedVersion } from '../../shared/version-number'
import { Button } from '../theme/Button'
import { RESTART_LABEL, updateVersionLabel } from './store'
import { primaryOf, restart, updateSignal, type Signal } from './update-signal'

// The Update of worfy on the version chip (worfy-update ticket 06; spec items 5 and 6, R11, R12). Since
// worfy-layout ticket 03 the chip is the footer's (src/renderer/shell/footer/VersionChip.tsx): a button with
// the app version and a dot, which opens a popover. The Update gives the chip three parts of it:
// - `useChipFace` (useChipFace.tsx) — what the chip shows. The version, numbered `v<major>.<minor>.<N>` where the build number
//   is known (worfy-update ticket 14, src/shared/version-number.ts); while an Update is under way (ticket 16)
//   a spinner and the step without a hover: "Starting update…" from the press until the build reaches its
//   first step, then "Updating · 2/3 Installing dependencies", the whole step in the tooltip, which adds the
//   time since the build began, counting each second while the pointer or the focus is on the chip. Once a
//   restart began, "Restarting…" until the window closes.
// - `AppLine` (this file) — the first row of the popover: the version, what the Update waits for, and the actions the
//   chip's menu had — "Update worfy" (`update.install`), once built "Restart now", or while something works
//   "Restart when idle" and "Restart now" next to it (`update.restart`, worfy-continuity ticket 08), while it
//   builds an inactive "Building worfy <version>…" —, and "What's new" (ticket 10, src/renderer/update/WhatsNew.tsx).
//   Esc closes the popover, so the menu's "Later" is gone.
// - `updateSignal` (update-signal.ts) — whether the Update gives the chip its dot (src/renderer/shell/footer/version-dot.ts).
// Texts: .scratch/worfy-update/spec.md, its section of the draft texts. Main answers each press with
// `update.changed`, which the store (src/renderer/update/store.ts) takes; the chip draws the snapshot it is given.
// A refused press is a toast (store.ts, tellInstallRefusal).

export interface AppLineProps {
  version: string
  number?: number | undefined
  update: UpdateSnapshot | null
  /** Opens "What's new" in place of the popover. */
  onWhatsNew: () => void
  /** Closes the popover once an action ran, as a press on an item closed the chip's menu. */
  onDone?: () => void
}

/** The first row of the version popover: the app version, the Update it waits for, and its actions. */
export function AppLine({ version, number, update, onWhatsNew, onDone }: AppLineProps) {
  const signal = updateSignal(update)
  const restarting = update?.enabled === true && update.restarting
  const said = restarting ? 'restarting…' : signal === null ? undefined : updateStatus(signal, update)
  const primary = signal === null || restarting ? undefined : primaryOf(signal, update)
  const done = (run: () => void) => (): void => {
    onDone?.()
    run()
  }
  return (
    <div className="w-version-popover__row" role="group" aria-label="worfy" data-testid="version-app-line" data-update={restarting ? 'restarting' : signal?.phase}>
      <span className="w-version-popover__text" title={buildVersionTooltip(version, number)}>
        <span className="w-mono">worfy v{numberedVersion(version, number)}</span>
        {said === undefined ? null : <span> · {said}</span>}
      </span>
      {primary === undefined || signal === null ? null : (
        <span className="w-version-popover__buttons">
          {primary.run === undefined ? (
            <Button aria-disabled="true" data-testid="update-primary">
              {primary.label}
            </Button>
          ) : (
            <Button variant={signal.dot ? 'primary' : 'secondary'} onClick={done(primary.run)} data-testid="update-primary">
              {primary.label}
            </Button>
          )}
          {signal.phase === 'ready' && update?.idle !== true ? (
            <Button onClick={done(() => restart('now'))} data-testid="update-restart-now">
              {RESTART_LABEL.now}
            </Button>
          ) : null}
          <Button onClick={onWhatsNew} data-testid="update-whats-new">
            What's new
          </Button>
        </span>
      )}
    </div>
  )
}

/** The short state of the Update after the version on the app row, as the sketch of the spec says it. */
function updateStatus(signal: Signal, update: UpdateSnapshot | null): string {
  const version = updateVersionLabel(update, signal.version)
  switch (signal.phase) {
    case 'available':
      return `update ${version} available`
    case 'building':
      return `building ${version}…`
    case 'ready':
      return `update ${version} ready`
    case 'failed':
      return `the update to ${version} failed — see Settings → Health`
  }
}
