// The Update check (worfy-update ticket 01, ADR-0089 points 1 and 2, spec R2–R4): is the head of
// `main` an Available update for the copy that runs? And the schedule of the checks: 10 s after the
// start, then every hour, one at a time.
//
// The reads go in the order that spends the fewest requests (GitHub allows 60 an hour without
// sign-in): a head that is the running commit ends the check after one.
import type { AvailableUpdate, UpdateLastCheck } from '../../shared/ipc/update'
import type { UpdateGitHub } from './github'

export type { UpdateGitHub } from './github'

/** How many files GitHub lists in a comparison at most: a list this long may be cut. */
export const COMPARE_FILES_MAX = 300

/** The paths that change neither the app nor the Harness (spec R2). */
const NOT_THE_APP = [/^docs\//u, /^\.scratch\//u, /^test\//u, /^\.github\//u, /^[^/]+\.md$/u]

/**
 * Whether the changed paths change the app or the Harness: one path outside docs/, .scratch/,
 * test/, .github/ and the Markdown files of the root. A list of 300 counts as changing it: GitHub
 * cuts the list there, and a build too many is cheaper than an Update missed.
 */
export function changesApp(files: readonly string[]): boolean {
  if (files.length >= COMPARE_FILES_MAX) return true
  return files.some((file) => !NOT_THE_APP.some((pattern) => pattern.test(file)))
}

export interface CheckInput {
  client: UpdateGitHub
  /** The commit the copy runs, full or short; empty when not known. */
  running: string
  /** The SHA the user rolled back from (ticket 04). */
  rolledBackFrom: string | null
  /** Asked for (`update.check`, "Check now"): its Update is never quiet. */
  manual: boolean
  now?: () => Date
}

/** The last check, and, when it was done, the Available update or null. A skipped check leaves the one known before. */
export interface CheckOutcome {
  lastCheck: UpdateLastCheck
  available?: AvailableUpdate | null
}

export async function checkForUpdate({ client, running, rolledBackFrom, manual, now = () => new Date() }: CheckInput): Promise<CheckOutcome> {
  const skipped = (reason: string): CheckOutcome => ({ lastCheck: { at: now().toISOString(), result: 'skipped', reason } })
  const none = (): CheckOutcome => ({ lastCheck: { at: now().toISOString(), result: 'ok' }, available: null })
  const commit = running.toLowerCase()
  if (!/^[0-9a-f]{7,40}$/u.test(commit)) return skipped('the commit this copy runs is not known')

  const head = await client.headOfMain()
  if (!head.ok) return skipped(head.reason)
  if (head.value.startsWith(commit)) return none()

  // Spec R3: only a head whose ci-ok is green; pending, red or no check waits for the next check.
  const ciOk = await client.ciOk(head.value)
  if (!ciOk.ok) return skipped(ciOk.reason)
  if (ciOk.value !== 'success') return none()

  // behind, diverged, identical or unknown to GitHub (a copy built from a branch it does not have): no Update.
  const comparison = await client.compare(commit, head.value)
  if (!comparison.ok) return skipped(comparison.reason)
  if (comparison.value === null || comparison.value.status !== 'ahead') return none()
  if (!changesApp(comparison.value.files)) return none()

  // Spec R4: the version as a build version shows it.
  const version = await client.packageVersion(head.value)
  if (!version.ok) return skipped(version.reason)
  return {
    lastCheck: { at: now().toISOString(), result: 'ok' },
    available: { sha: head.value, version: `${version.value}+${head.value.slice(0, 7)}`, quiet: !manual && rolledBackFrom === head.value },
  }
}

/** The first check after the start. */
export const FIRST_CHECK_MS = 10_000
/** The checks after it. */
export const CHECK_EVERY_MS = 60 * 60 * 1000

/**
 * The schedule: `run` 10 s after start() and then every hour. One check at a time: a check asked for
 * while one runs gets that one. `onChange` hears a check begin and end, after `checking` changed.
 */
export class UpdateChecks {
  private current: Promise<void> | null = null

  constructor(
    private readonly run: (manual: boolean) => Promise<void>,
    private readonly onChange: () => void = () => undefined,
  ) {}

  get checking(): boolean {
    return this.current !== null
  }

  /** Checks now, or joins the check that runs; never rejects. */
  now(manual = false): Promise<void> {
    if (this.current !== null) return this.current
    const done = Promise.resolve()
      .then(() => this.run(manual))
      .catch((error: unknown) => console.error('[update] the check failed', error))
      .finally(() => {
        this.current = null
        this.onChange()
      })
    this.current = done
    this.onChange()
    return done
  }

  /** Starts the timers; the function returned stops them. */
  start(): () => void {
    let every: ReturnType<typeof setInterval> | undefined
    const first = setTimeout(() => {
      void this.now()
      every = setInterval(() => void this.now(), CHECK_EVERY_MS)
    }, FIRST_CHECK_MS)
    return () => {
      clearTimeout(first)
      if (every !== undefined) clearInterval(every)
    }
  }
}
