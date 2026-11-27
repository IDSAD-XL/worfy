import { useEffect, useState } from 'react'
import type { UpdateSnapshot } from '../../../shared/ipc/update'
import { numberedVersion } from '../../../shared/version-number'
import { codexPartOf } from '../../harness/harness-lines'
import { CodexLine, HarnessLine } from '../../harness/HarnessStatus'
import { useHarnessStatus, type HarnessStatusState } from '../../harness/useHarnessStatus'
import { invoke } from '../../ipc'
import AppMemory from '../../memory/AppMemory'
import { useAppSettings } from '../../settings/useAppSettings'
import { Popover } from '../../theme/kit/Popover'
import { updateVersionLabel, useUpdate } from '../../update/store'
import { primaryOf, updateSignal } from '../../update/update-signal'
import { AppLine } from '../../update/UpdateChip'
import { useChipFace } from '../../update/useChipFace'
import WhatsNew from '../../update/WhatsNew'
import { versionDot } from './version-dot'

// The version chip at the right end of the footer (worfy-layout ticket 03; the spec's section on the version chip;
// owner's decisions Q10 and Q14). The Harness column of the toolbar did not fit a 28 px strip, so the chip is
// the app version with one dot (version-dot.ts: red — the Harness needs the user, amber — an update waits),
// and a click opens a popover above it with four rows:
// 1. worfy: the version and the Update's actions (update/UpdateChip.tsx, AppLine);
// 2. the Harness line with its buttons (harness/HarnessStatus.tsx, HarnessLine);
// 3. the Codex line with its button, while the Harness is in Claude Code (CodexLine, codexPartOf);
// 4. worfy's memory, while Settings → General has "Memory in the version popover" on (memory/AppMemory.tsx).
// Esc and a press outside close it (theme/kit/Popover.tsx). The chip, mounted for the life of the window,
// holds the Harness state (`useHarnessStatus`), so the consent dialog, the move form and the Codex hooks
// step open as before, and the hooks step still opens by itself while the popover is closed (the spec's risks).
// The Harness and Update channels are `local`: in a Linked machine's window the chip shows this computer.

/** The rows of the popover after the first are put apart by a thin line. */
function Separator() {
  return <div className="w-version-popover__separator" role="separator" />
}

/** The chip and its popover, mounted with the window (Footer.tsx): the app version, the Update, the Harness and the memory setting. */
export function VersionChip() {
  const harness = useHarnessStatus({ opensHooksStep: true })
  const update = useUpdate()
  const memoryShown = useAppSettings((settings) => settings.memoryIndicator)
  const [version, setVersion] = useState<AppVersion>()

  useEffect(() => {
    let active = true
    void invoke('app.version').then((result) => {
      if (!active) return
      if (result.ok) setVersion({ version: result.value.version, number: result.value.number })
      else console.error('app.version failed:', result.error)
    })
    return () => {
      active = false
    }
  }, [])

  return <VersionChipView version={version} update={update} harness={harness} memoryShown={memoryShown} />
}

/** The app version (`app.version`) and its build number (worfy-update ticket 14). */
export interface AppVersion {
  version: string
  number?: number | undefined
}

export interface VersionChipViewProps {
  /** Nothing until main answered: then only the Harness's windows can be open. */
  version: AppVersion | undefined
  /** Main's Update snapshot; null until it has answered. */
  update: UpdateSnapshot | null
  harness: HarnessStatusState
  /** Settings → General, "Memory in the version popover". */
  memoryShown: boolean
  /** The clock of a build's elapsed time; tests give their own. */
  now?: () => number
}

/** The chip for given states; exported for tests. */
export function VersionChipView({ version, update, harness, memoryShown, now }: VersionChipViewProps) {
  // What is open over the chip: its popover, "What's new" (in the popover's place), or nothing.
  const [view, setView] = useState<'closed' | 'popover' | 'whatsNew'>('closed')
  const [chip, setChip] = useState<HTMLButtonElement | null>(null)
  const face = useChipFace({ version: version?.version ?? '', number: version?.number, update, ...(now === undefined ? {} : { now }) })
  const signal = updateSignal(update)
  // While its own install runs the Harness line says "Installing Harness…": its dot waits for the answer.
  const dot = versionDot(update, harness.busy ? undefined : harness.status, harness.migration, harness.failure)

  // A What's new without an Update to show goes with it, as the chip's menu did.
  if (view === 'whatsNew' && signal === null) setView('closed')

  const close = (): void => setView('closed')
  // The move form and the Codex hooks step are windows of their own: the popover closes as they open.
  const closingFirst = (action: () => void) => (): void => {
    close()
    action()
  }
  const lineProps = { ...harness, onMigrate: harness.onMigrate === undefined ? undefined : closingFirst(harness.onMigrate), onApproveHooks: closingFirst(harness.onApproveHooks) }
  const codexShown = codexPartOf(harness) !== null

  const dialogs = (
    <>
      {harness.dialogs}
      {view === 'whatsNew' && chip !== null && signal !== null ? (
        <WhatsNew version={signal.version} label={(each) => updateVersionLabel(update, each)} anchor={chip} action={primaryOf(signal, update)} onClose={close} />
      ) : null}
    </>
  )
  if (version === undefined) return dialogs

  const name = `worfy v${numberedVersion(version.version, version.number)}${dot === null ? '' : ` — ${dot.reason}`}`
  const title = [name, ...(face.tooltip ?? '').split('\n').filter((line) => line !== '' && line !== dot?.reason)].join('\n')
  const trigger = (
    <button ref={setChip} type="button" className="w-mono w-footer__chip" aria-label={name} title={title} data-testid="app-version" data-update={face.phase} data-dot={dot?.tone} {...face.handlers}>
      {face.content}
      {dot !== null && face.dotShown ? <span className={`w-version-dot w-version-dot--${dot.tone}`} aria-hidden="true" data-testid="version-dot" /> : null}
    </button>
  )
  return (
    <>
      <Popover
        open={view === 'popover'}
        // A press on the chip while "What's new" is open closes it, as the press that opened the popover would.
        onOpenChange={(open) => setView((was) => (open ? (was === 'whatsNew' ? 'closed' : 'popover') : was === 'popover' ? 'closed' : was))}
        trigger={trigger}
        label="worfy version"
        testId="version-popover"
        className="w-version-popover"
        side="top"
        align="end"
        // Over the toasts, as the chip's menu was: the sticky Update toast of the start lies next to the chip.
        layer="top"
      >
        <AppLine version={version.version} number={version.number} update={update} onWhatsNew={() => setView('whatsNew')} onDone={close} />
        {harness.status === undefined && harness.failure === undefined ? null : (
          <>
            <Separator />
            <div className="w-version-popover__row">
              <HarnessLine {...lineProps} />
            </div>
            {codexShown ? (
              <div className="w-version-popover__row">
                <CodexLine {...lineProps} />
              </div>
            ) : null}
          </>
        )}
        {memoryShown ? (
          <>
            <Separator />
            <div className="w-version-popover__row" data-testid="version-memory-line">
              <span className="w-version-popover__text">Memory</span>
              <AppMemory />
            </div>
          </>
        ) : null}
      </Popover>
      {dialogs}
    </>
  )
}
