// Settings → Machines: the two switches of the link of this Machine. They were under the list of
// the sidebar's Machines section; what they change and where it is kept is the same — main keeps
// them in link/settings.json and answers `link.setAccess` and `link.setKeepAwake` with the link
// state (src/renderer/machines/useMachines.ts), which the sidebar reads too.
import { useRef, useState } from 'react'
import '../machines/machines.css'
import { setKeepAwake, setProjectsAccess, useMachines } from '../machines/useMachines'
import { SettingRow, SettingSwitch } from './controls'

export const order = 40
export const title = 'Machines'

const ACCESS_LABEL = 'Linked machines can work with my Projects'
const KEEP_AWAKE_LABEL = 'Keep this computer awake while linked machines are connected'
// Switching access off closes the way in, not the work: what a Linked machine started before keeps
// running (ADR-0060).
const ACCESS_HINT = 'Work already started from a Linked machine keeps running'
const KEEP_AWAKE_NEEDS_ACCESS = `Turn on "${ACCESS_LABEL}" first`

export default function MachinesSection() {
  const state = useMachines()
  const [error, setError] = useState<string>()
  // Answers can come back out of order: the last click decides what the message says. An answer
  // that comes after Settings was closed still reaches the link state (useMachines.ts); only its
  // message has nowhere to go.
  const clicks = useRef(0)

  const access = state?.projectsAccess ?? false
  const keepAwake = state?.keepAwake ?? false
  // Without this Machine (the link service has not started, or could not) there is nothing to switch.
  const noMachine = state?.machine == null
  // Main keeps this Machine awake only while access is on too (src/main/link/keep-awake.ts,
  // `wanted()`). With access off the switch is disabled and shows "off", which is what happens;
  // the value kept in main is not touched and shows again once access is on.
  const keepAwakeIdle = noMachine || !access

  const run = (work: Promise<string | undefined>): void => {
    const click = ++clicks.current
    void work.then((refused) => {
      if (click === clicks.current) setError(refused)
    })
  }

  return (
    <>
      <SettingRow label={ACCESS_LABEL} description={ACCESS_HINT} testId="settings-machines-access-row">
        <SettingSwitch label={ACCESS_LABEL} testId="link-access-switch" checked={access} disabled={noMachine} onChange={(on) => run(setProjectsAccess(on))} />
      </SettingRow>
      <SettingRow label={KEEP_AWAKE_LABEL} testId="settings-machines-keep-awake-row">
        <SettingSwitch
          label={KEEP_AWAKE_LABEL}
          testId="link-keep-awake-switch"
          checked={keepAwake && !keepAwakeIdle}
          disabled={keepAwakeIdle}
          title={!noMachine && !access ? KEEP_AWAKE_NEEDS_ACCESS : undefined}
          onChange={(on) => run(setKeepAwake(on))}
        />
      </SettingRow>
      {error ? (
        <p role="alert" className="w-machines-settings__error" data-testid="settings-machines-error">
          {error}
        </p>
      ) : null}
    </>
  )
}
