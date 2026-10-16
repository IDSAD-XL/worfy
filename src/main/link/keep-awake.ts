// The Project machine stays awake while Linked machines work with its Projects (worfy-link ticket
// 14; the owner's decision Q5 in .scratch/worfy-link/spec.md).
//
// One Electron powerSaveBlocker of type 'prevent-app-suspension' — the system does not sleep, the
// display may go dark: a Linked machine needs this Machine's Projects, not its screen. It is held
// while all three hold:
// - at least one Linked machine with access is connected, over a connection either side opened (an
//   open connection has passed the token and certificate checks, service.ts);
// - access is on for it: "Linked machines can work with my Projects" is on and its own level is
//   `read` or `all` (worfy-link ticket 18) — a Machine that only reads needs this one awake too;
//   without access a Linked machine has nothing to do here;
// - "Keep this computer awake while linked machines are connected" is on (settings.ts; on by default).
// One blocker for all connections, not one each. It is released in the same turn any of the three
// stops holding — the last connection closed, the Machine revoked, a switch turned off — and on
// `will-quit` (power.ts). An Autopilot run holds its own 'prevent-display-sleep' blocker
// (src/main/autopilot/power.ts); neither touches the other's. With the lid closed the Mac sleeps
// anyway, as for Autopilot.
import { KeepAwake, type KeepAwakeType } from '../autopilot/power'
import type { LinkService } from './service'

export const LINK_KEEP_AWAKE_TYPE: KeepAwakeType = 'prevent-app-suspension'

/** The part of the link service the keep-awake follows. */
type Followed = Pick<LinkService, 'on' | 'off' | 'linkedMachines' | 'settings'>

/** The events after which the three conditions are read again. */
const EVENTS = ['connected', 'disconnected', 'unlinked', 'settings'] as const

/** What holds a blocker: power.ts's KeepAwake, or a test's own. */
export interface Blocker {
  readonly held: boolean
  start(): void
  stop(): void
}

export class LinkKeepAwake {
  private readonly update = (): void => this.apply()
  private stopped = false

  constructor(
    private readonly service: Followed,
    private readonly blocker: Blocker = new KeepAwake(undefined, LINK_KEEP_AWAKE_TYPE),
  ) {
    for (const event of EVENTS) service.on(event, this.update)
    this.apply()
  }

  /** Whether the link holds its blocker now. */
  get held(): boolean {
    return this.blocker.held
  }

  /** Whether the three conditions hold now. */
  wanted(): boolean {
    const { keepAwake } = this.service.settings.get()
    return keepAwake && this.service.linkedMachines().some((machine) => machine.connected && this.service.settings.levelOf(machine.id) !== 'off')
  }

  /** Releases the blocker and follows the service no more (the link stops). */
  stop(): void {
    this.stopped = true
    for (const event of EVENTS) this.service.off(event, this.update)
    this.blocker.stop()
  }

  private apply(): void {
    if (!this.stopped && this.wanted()) this.blocker.start()
    else this.blocker.stop()
  }
}
