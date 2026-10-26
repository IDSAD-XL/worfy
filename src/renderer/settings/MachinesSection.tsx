// Settings → Machines: the switches of the link of this Machine, and the access level of each
// Linked machine (worfy-link ticket 18; ADR-0066). The switches were under the list of the
// sidebar's Machines section; main keeps all of it in link/settings.json and answers
// `link.setAccess`, `link.setMachineAccess`, `link.setKeepAwake` and `link.setTailscale` with the link state
// (src/renderer/machines/useMachines.ts), which the sidebar reads too.
//
// The levels apply while "Linked machines can work with my Projects" is on: off turns access off for
// every Linked machine, whatever its own level, and the level rows are disabled. A Linked machine
// linked anew starts at Off. Read only still means trust: the hint says so (the owner's answer 2).
//
// "Link through Tailscale" (worfy-link ticket 27; ADR-0070, point 3) is off by default and does not
// depend on access: it decides who may reach the link server at all, linking included.
import { useRef, useState } from 'react'
import type { AccessLevel } from '../../shared/ipc/link'
import '../machines/machines.css'
import { Select, type SelectOption } from '../theme/Select'
import { setKeepAwake, setMachineAccess, setProjectsAccess, setTailscale, useMachines } from '../machines/useMachines'
import { SettingRow, SettingSwitch } from './controls'

export const order = 40
export const title = 'Machines'

const ACCESS_LABEL = 'Linked machines can work with my Projects'
const KEEP_AWAKE_LABEL = 'Keep this computer awake while linked machines are connected'
// Switching access off closes the way in, not the work: what a Linked machine started before keeps
// running (ADR-0060).
const ACCESS_HINT = 'Work already started from a Linked machine keeps running'
const NEEDS_ACCESS = `Turn on "${ACCESS_LABEL}" first`
const TAILSCALE_LABEL = 'Link through Tailscale'
const TAILSCALE_HINT = 'Lets a Linked machine reach this computer at its Tailscale address. Turn it on on both computers. Off closes the links that came through Tailscale'

const LEVEL_OPTIONS: readonly SelectOption<AccessLevel>[] = [
  { value: 'off', label: 'Off' },
  { value: 'read', label: 'Read only' },
  { value: 'all', label: 'Full access' },
]

/** What each level lets the Linked machine do, under its name. */
const LEVEL_HINTS: Readonly<Record<AccessLevel, string>> = {
  off: 'Cannot see or change your Projects',
  read: 'Sees your Projects, Sessions and notifications, not Terminal output, and changes nothing. Read only still means trust: a Session transcript can show a secret',
  all: 'Works with your Projects as you do: Sessions, Terminal, Autopilot',
}

export default function MachinesSection() {
  const state = useMachines()
  const [error, setError] = useState<string>()
  // Answers can come back out of order: the last click decides what the message says. An answer
  // that comes after Settings was closed still reaches the link state (useMachines.ts); only its
  // message has nowhere to go.
  const clicks = useRef(0)

  const access = state?.projectsAccess ?? false
  const keepAwake = state?.keepAwake ?? false
  const tailscale = state?.tailscale ?? false
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
      <SettingRow label={ACCESS_LABEL} description={ACCESS_HINT} disabled={noMachine} testId="settings-machines-access-row">
        <SettingSwitch label={ACCESS_LABEL} testId="link-access-switch" checked={access} disabled={noMachine} onChange={(on) => run(setProjectsAccess(on))} />
      </SettingRow>
      {(state?.linked ?? []).map((machine) => {
        // Off for everyone shows Off for each; the level kept in main shows again once access is on.
        const level = access ? machine.access : 'off'
        const idle = noMachine || !access
        return (
          <SettingRow key={machine.id} label={machine.name} description={LEVEL_HINTS[level]} disabled={idle} testId={`settings-machines-level-row-${machine.id}`}>
            <Select
              aria-label={`Access of ${machine.name} to my Projects`}
              data-testid={`link-machine-access-${machine.id}`}
              value={level}
              options={LEVEL_OPTIONS}
              disabled={idle}
              title={!noMachine && !access ? NEEDS_ACCESS : undefined}
              onChange={(next) => run(setMachineAccess(machine.id, next))}
            />
          </SettingRow>
        )
      })}
      <SettingRow label={KEEP_AWAKE_LABEL} disabled={keepAwakeIdle} testId="settings-machines-keep-awake-row">
        <SettingSwitch
          label={KEEP_AWAKE_LABEL}
          testId="link-keep-awake-switch"
          checked={keepAwake && !keepAwakeIdle}
          disabled={keepAwakeIdle}
          title={!noMachine && !access ? NEEDS_ACCESS : undefined}
          onChange={(on) => run(setKeepAwake(on))}
        />
      </SettingRow>
      <SettingRow label={TAILSCALE_LABEL} description={TAILSCALE_HINT} disabled={noMachine} testId="settings-machines-tailscale-row">
        <SettingSwitch label={TAILSCALE_LABEL} testId="link-tailscale-switch" checked={tailscale} disabled={noMachine} onChange={(on) => run(setTailscale(on))} />
      </SettingRow>
      {error ? (
        <p role="alert" className="w-machines-settings__error" data-testid="settings-machines-error">
          {error}
        </p>
      ) : null}
    </>
  )
}
