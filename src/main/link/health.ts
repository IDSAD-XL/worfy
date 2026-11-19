// The Linked machine row of Health check (worfy-auth-check ticket 08): one row of this Machine, failed
// while a Linked machine answers with another certificate than the one remembered at linking, or while
// the link secrets file is set aside as unreadable (secrets.ts) — its tokens are gone, so every Linked
// machine needs linking again. The step is the same for both: link again by code, with «Link a machine…».
//
// What takes a problem off: a Machine linked again by code, or a connection that opens to it; a Machine
// that is no longer linked. The secrets problem goes with the first Machine linked again or connected
// after it: the store holds a working token again. Non-critical (src/shared/health/severity.ts): one
// Linked machine is gone, the rest of worfy works. The row names Machines and a file name, never a token.
import type { HealthReports } from '../first-run/health-reports'

/** The part of the Health check report the link tells. */
export type LinkHealthReports = Pick<HealthReports, 'reportFailure' | 'reportOk'>

/** The one key of the secrets problem among the Machine ids. */
const SECRETS = '\u0000secrets'

export const LINK_AGAIN_STEP = 'Link it again by code: open Link a machine… on both computers'

export class LinkHealth {
  private readonly problems = new Map<string, string>()

  constructor(private readonly reports: LinkHealthReports | undefined) {}

  /** The secrets file could not be read and was set aside as `name`. */
  secretsSetAside(name: string): void {
    this.set(SECRETS, `the link secrets file could not be read and was set aside as ${name}: the tokens of the Linked machines are gone`)
  }

  /** Machine `machine` answered with another certificate than the one remembered at linking. */
  certificateChanged(machine: { id: string; name: string }): void {
    this.set(machine.id, `${machine.name} answered with another certificate than the one remembered at linking`)
  }

  /** Machine `id` was linked again by code, or a connection to it opened: it works, and so do the secrets. */
  linkedAgain(id: string): void {
    const had = this.problems.delete(id)
    if (this.problems.delete(SECRETS) || had) this.tell()
  }

  /** Machine `id` is no longer linked: nothing to fix there any more. */
  forgotten(id: string): void {
    if (this.problems.delete(id)) this.tell()
  }

  private set(key: string, reason: string): void {
    if (this.problems.get(key) === reason) return
    this.problems.set(key, reason)
    this.tell()
  }

  private tell(): void {
    if (this.reports === undefined) return
    if (this.problems.size === 0) {
      this.reports.reportOk('linked-machine', undefined)
      return
    }
    this.reports.reportFailure('linked-machine', undefined, [...this.problems.values()].join('; '), LINK_AGAIN_STEP, [{ id: 'link-machine', label: 'Link a machine…' }])
  }
}
