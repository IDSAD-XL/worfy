// Park (worfy-auto-approve ticket 07; the Epic spec, how it works, item 1; decided without the owner,
// item 6; Q3, Q5): a request the approval policy leaves to the owner, in On, waits on the Session's own
// gate (src/main/agent/permissions.ts) as an attended request does — the Session shows
// `needs_permission`, the notification goes out (src/main/notify.ts, "Parked: <tool> in <Project>"), and
// the other Subagents of the Wave go on: only this one tool call waits.
//
// A parked request is marked `parked` with the rule and the targets; its card shows them. It answers this
// one request only: "Always allow" is not offered, and an "Always allow" given to another request of the
// Session lets no parked request through (PermissionGate). The owner's pick ends it as `answered`.
//
// It waits at most PARK_LIMIT_MS (60 min, Q3): the night goes on, and the request ends as `expired`, which
// the driver answers with a deny and PARK_EXPIRED_HINT and reports as `park-expired`. A stop of the run
// ends it the same way: a Force stop through Session.halt (the gate's cancelAll), a graceful one through
// the gate's releaseParked (orchestrator.ts, setUnattended). So does every other end without the owner's
// answer — an Interrupt, the Session's close, the Vendor withdrawing the request.
import type { PermissionOption, PermissionOptionKind } from '../../../shared/agent/events'
import type { PermissionAsker } from '../../vendors/session'

/** How long a parked request waits for the owner (Q3). */
export const PARK_LIMIT_MS = 60 * 60 * 1000

/** What the agent reads after Claude Code's reason when a parked request ended without the owner's answer. */
export const PARK_EXPIRED_HINT =
  'Only the owner can approve this request; it waited for the owner and got no answer (worfy Autopilot). Go on without it, or write what you need into the owner questions of the Ticket.'

/** What the agent reads after Claude Code's reason when the policy would park a request while the run is stopping. */
export const PARK_STOPPED_HINT =
  'Only the owner can approve this request, and the Autopilot run is stopping, so it does not wait for the owner (worfy Autopilot). Go on without it, or write what you need into the owner questions of the Ticket.'

/** The timers a park waits with; tests pass their own. */
export interface ParkClock {
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

const realClock: ParkClock = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

/** One tool call the policy parked, as the driver knows it. */
export interface ParkRequest {
  toolName: string
  toolUseId: string | null
  input: Record<string, unknown>
  blockedPath: string | null
  /** The id of the rule that parked it. */
  rule: string
  /** The paths the policy judged. */
  targets: readonly string[]
  /** The options the Vendor offers; the park offers them without `allow_always`. */
  options: readonly PermissionOption[]
  /** What the card says after the rule and the targets (Codex: its reason, the host, why Accept is missing); none: nothing. */
  note?: string | null | undefined
  /** The Vendor's own withdrawal of the request. */
  signal: AbortSignal
  /**
   * Whether a parked request may wait for the owner now: false once the run is stopping or stopped. Asked
   * once the request is open on the gate, so a Stop that came after the policy's decision takes it off.
   */
  waits?: (() => boolean) | undefined
}

/** How a park ended: the owner picked an option, or it ended without an answer (the limit, a stop, a cancel). */
export type ParkEnd = { outcome: 'answered'; option: string; kind: PermissionOptionKind } | { outcome: 'expired' } | { outcome: 'stopped' }

export type Parker = (request: ParkRequest) => Promise<ParkEnd>

/** What the card of a parked request says: the rule and the targets. */
export function parkDescription(rule: string, targets: readonly string[]): string {
  const where = targets.length === 0 ? '' : `: ${targets.join(', ')}`
  return `Parked by Auto-approval, rule ${rule}${where}. The answer is for this one request.`
}

/** Parks requests on `asker`, the Session's gate, for at most `limitMs`. */
export function createParker(asker: PermissionAsker, { limitMs = PARK_LIMIT_MS, clock = realClock }: { limitMs?: number; clock?: ParkClock } = {}): Parker {
  return async (request) => {
    const options = request.options.filter((option) => option.kind !== 'allow_always')
    const wait = new AbortController()
    const withdraw = (): void => wait.abort()
    request.signal.addEventListener('abort', withdraw, { once: true })
    if (request.signal.aborted) wait.abort()
    const timer = clock.setTimeout(withdraw, limitMs)
    let stopped = false
    try {
      const asked = asker.ask({
        subject: request.toolName,
        toolName: request.toolName,
        toolUseId: request.toolUseId,
        input: request.input,
        title: null,
        description: request.note === null || request.note === undefined ? parkDescription(request.rule, request.targets) : `${parkDescription(request.rule, request.targets)}\n${request.note}`,
        blockedPath: request.blockedPath,
        suggestions: [],
        options: options.map((option) => ({ ...option })),
        parked: { rule: request.rule, targets: [...request.targets] },
        signal: wait.signal,
      })
      // The gate opened it synchronously: a run that began to stop since the policy decided takes it off now.
      if (request.waits?.() === false) {
        stopped = true
        wait.abort()
      }
      const picked = await asked
      const option = picked === null ? undefined : options.find((each) => each.id === picked)
      if (option !== undefined) return { outcome: 'answered', option: option.id, kind: option.kind }
      return stopped ? { outcome: 'stopped' } : { outcome: 'expired' }
    } finally {
      clock.clearTimeout(timer)
      request.signal.removeEventListener('abort', withdraw)
    }
  }
}
