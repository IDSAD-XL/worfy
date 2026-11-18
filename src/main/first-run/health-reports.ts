// The Health check report as the app keeps it (worfy-auth-check ticket 03; spec: the solution, point 4, and
// when to check): the rows of the last checks, the rows checked over the network after them,
// and what the features said since — "this failed for me" (reportFailure) and "it works again"
// (reportOk). Every change of the merged report goes to the listeners: main sends it to the
// renderer as `firstRun.reportChanged` (src/main/ipc/first-run.ts).
//
// - A failure message puts its row out of `ok` at once, with no request to the network; then one
//   re-check of the row of that Project runs, at most once a minute per Project, when the Ticket of
//   the row registered one (registerRecheck). reportOk takes the row back to `ok` without a check.
// - The newest word on a row wins: a check that started after a message replaces it.
// - A row of a Project, a row checked over the network and a row a message made never open First
//   run at the start (owner's decision Q7): the network rows are not even in the report the start
//   decides by — checkNetwork() adds them after it.
// - On the focus of a worfy window (Q8) only rows not in `ok`, last checked over 5 minutes ago, are
//   checked again, each through its registered re-check. No timer, no polling.
//
// The reason and the step of a message pass through redactSecrets(): a token a feature let slip
// does not reach the report. This module logs neither of them. No Electron here: the features of
// main import it, and contract tests run it as it is.
import { severityOf } from '../../shared/health/severity'
import type { Check, CheckGroup, CheckId, CheckProject, FirstRunReport } from '../../shared/ipc/first-run'
import { redactSecrets } from '../../shared/terminal-ai/redact'

/** The rows a feature reports on, with the group and the title of a row only a message made. */
export const REPORTED_ROWS = {
  'github-access': { group: 'Projects', title: 'GitHub access' },
  'codex-login': { group: 'Codex', title: 'Codex sign-in' },
  'browser-profile': { group: 'Projects', title: 'Browser profile' },
  'linked-machine': { group: 'Linked machines', title: 'Linked machine' },
} as const satisfies Partial<Record<CheckId, { group: CheckGroup; title: string }>>
export type ReportedCheckId = keyof typeof REPORTED_ROWS

/** The row checked again, or null when it is no longer there (the Project lost its GitHub origin). */
export type Recheck = (project: CheckProject | undefined) => Promise<Check | null>

/** At most one re-check after a failure message per Project in this time (spec, when to check). */
export const RECHECK_AFTER_FAILURE_MS = 60_000
/** On the focus of a window, a row not in `ok` is checked again only when its last check is older (Q8). */
export const RECHECK_ON_FOCUS_MS = 5 * 60_000

interface Message {
  id: ReportedCheckId
  project: CheckProject | undefined
  reason: string
  step: string
  at: number
}

interface Stored {
  check: Check
  at: number
}

const keyOf = (id: CheckId, project: CheckProject | undefined): string => `${id}\u0000${project?.id ?? ''}`
const keyOfCheck = (check: Check): string => keyOf(check.id, check.project)
/** The Machine's rows share one re-check budget, as if they were one Project. */
const budgetOf = (project: CheckProject | undefined): string => project?.id ?? ''

export class HealthReports {
  /** The rows of the last checks, in their order; null before the first. */
  private local: Stored[] | null = null
  private localCheckedAt: string | null = null
  /** The rows checked over the network or again one by one, not among the local ones. */
  private extra = new Map<string, Stored>()
  private messages = new Map<string, Message>()
  private rechecks = new Map<CheckId, Recheck>()
  private networkSources: (() => Promise<Check[]>)[] = []
  private lastRecheck = new Map<string, number>()
  private listeners = new Set<(report: FirstRunReport) => void>()
  private sent: string | null = null

  constructor(private readonly now: () => number = Date.now) {}

  /** Follows every change of the merged report; returns the unsubscribe. */
  subscribe(listener: (report: FirstRunReport) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** The Ticket of a row checks that row alone here: after a failure message and on focus. */
  registerRecheck(id: CheckId, recheck: Recheck): void {
    this.rechecks.set(id, recheck)
  }

  /** Rows checked over the network (`gh api` on a repo): checkNetwork() runs them after the local checks. */
  registerNetworkRows(source: () => Promise<Check[]>): void {
    this.networkSources.push(source)
  }

  /** A feature failed on its row: the row is out of `ok` now, and one re-check of that Project follows. */
  reportFailure(id: ReportedCheckId, project: CheckProject | undefined, reason: string, step: string): void {
    const at = this.now()
    this.messages.set(keyOf(id, project), { id, project, reason: redactSecrets(reason), step: redactSecrets(step), at })
    this.changed()
    const recheck = this.rechecks.get(id)
    const budget = budgetOf(project)
    const last = this.lastRecheck.get(budget)
    if (recheck === undefined || (last !== undefined && at - last < RECHECK_AFTER_FAILURE_MS)) return
    this.lastRecheck.set(budget, at)
    void this.recheck(id, project, recheck)
  }

  /** The feature worked on its row again: the message goes, and the row is `ok` without a check. */
  reportOk(id: ReportedCheckId, project: CheckProject | undefined): void {
    const key = keyOf(id, project)
    this.messages.delete(key)
    const stored = this.storedAt(key)
    if (stored !== undefined && stored.check.status !== 'ok') {
      stored.check = { ...stored.check, status: 'ok', detail: 'works again since the last check', hint: '', command: null, actions: [] }
    }
    this.changed()
  }

  /**
   * The local checks finished (the start, "Check again", an action): their rows replace the last
   * ones; a message older than `startedAt` gives way to the row its check made.
   */
  setChecks(report: FirstRunReport, startedAt: number = this.now()): FirstRunReport {
    const at = this.now()
    this.local = report.checks.map((check) => ({ check, at }))
    this.localCheckedAt = report.checkedAt
    for (const check of report.checks) this.supersede(keyOfCheck(check), startedAt)
    this.changed()
    return this.current() ?? report
  }

  /** Runs the network rows; they replace the earlier ones. Never rejects: a source that throws adds nothing. */
  async checkNetwork(): Promise<void> {
    if (this.networkSources.length === 0) return
    const startedAt = this.now()
    const answers = await Promise.all(
      this.networkSources.map((source) =>
        source().catch((error: unknown) => {
          console.warn('[health] network rows could not be checked:', error instanceof Error ? error.name : 'error')
          return []
        }),
      ),
    )
    const at = this.now()
    const localKeys = new Set((this.local ?? []).map((stored) => keyOfCheck(stored.check)))
    this.extra = new Map()
    for (const check of answers.flat()) {
      const key = keyOfCheck(check)
      if (localKeys.has(key)) continue
      this.extra.set(key, { check, at })
      this.supersede(key, startedAt)
    }
    this.changed()
  }

  /** On the focus of a worfy window: each row not in `ok`, checked over 5 minutes ago, with a re-check. */
  async focus(): Promise<void> {
    const now = this.now()
    const due = new Map<string, { id: CheckId; project: CheckProject | undefined; recheck: Recheck }>()
    for (const { check, at } of this.rows()) {
      const recheck = this.rechecks.get(check.id)
      if (check.status === 'ok' || recheck === undefined || now - at <= RECHECK_ON_FOCUS_MS) continue
      due.set(keyOfCheck(check), { id: check.id, project: check.project, recheck })
    }
    await Promise.all([...due.values()].map(({ id, project, recheck }) => this.recheck(id, project, recheck)))
  }

  /** The merged report; null before the first check and the first message. */
  current(): FirstRunReport | null {
    const rows = this.rows().map(({ check }) => check)
    if (this.localCheckedAt === null && rows.length === 0) return null
    return { checks: rows, checkedAt: this.localCheckedAt ?? new Date(this.now()).toISOString() }
  }

  private async recheck(id: CheckId, project: CheckProject | undefined, recheck: Recheck): Promise<void> {
    const startedAt = this.now()
    let fresh: Check | null
    try {
      fresh = await recheck(project)
    } catch (error) {
      console.warn(`[health] the re-check of ${id} failed:`, error instanceof Error ? error.name : 'error')
      return
    }
    const key = keyOf(id, project)
    const at = this.now()
    const local = this.local?.find((stored) => keyOfCheck(stored.check) === key)
    if (fresh === null) {
      this.extra.delete(key)
      if (local !== undefined) this.local = (this.local ?? []).filter((stored) => stored !== local)
    } else if (local !== undefined) {
      local.check = fresh
      local.at = at
    } else this.extra.set(key, { check: fresh, at })
    this.supersede(key, startedAt)
    this.changed()
  }

  /** Drops the message of `key` when the check that just answered started after it. */
  private supersede(key: string, startedAt: number): void {
    const message = this.messages.get(key)
    if (message !== undefined && message.at <= startedAt) this.messages.delete(key)
  }

  private storedAt(key: string): Stored | undefined {
    return this.local?.find((stored) => keyOfCheck(stored.check) === key) ?? this.extra.get(key)
  }

  /** The local rows, then the network ones, then those only a message made; each with when it was last seen. */
  private rows(): Stored[] {
    const merged: Stored[] = []
    const seen = new Set<string>()
    for (const stored of [...(this.local ?? []), ...this.extra.values()]) {
      const key = keyOfCheck(stored.check)
      seen.add(key)
      const message = this.messages.get(key)
      const network = this.extra.has(key)
      const check = message === undefined ? stored.check : fromMessage(message, stored.check)
      merged.push({ check: network || check.project !== undefined ? { ...check, opensFirstRun: false } : check, at: Math.max(stored.at, message?.at ?? 0) })
    }
    for (const [key, message] of this.messages) if (!seen.has(key)) merged.push({ check: fromMessage(message, undefined), at: message.at })
    return merged
  }

  private changed(): void {
    const report = this.current()
    if (report === null) return
    const text = JSON.stringify(report)
    if (text === this.sent) return
    this.sent = text
    for (const listener of this.listeners) {
      try {
        listener(report)
      } catch (error) {
        console.warn('[health] a listener of the report failed:', error instanceof Error ? error.name : 'error')
      }
    }
  }
}

/** The row a failure message makes, over the checked row of the same id and Project when there is one. */
function fromMessage(message: Message, checked: Check | undefined): Check {
  const base = checked ?? { id: message.id, ...REPORTED_ROWS[message.id], command: null, actions: [], ...(message.project === undefined ? {} : { project: message.project }) }
  // A feature that reports a GitHub failure works with GitHub: gh counts as needed.
  const severity = checked !== undefined && checked.status !== 'unknown' ? checked.severity : severityOf({ id: message.id, status: 'fail' }, { githubProject: true })
  return { ...base, status: 'fail', severity, detail: message.reason, hint: message.step, opensFirstRun: false }
}

let shared: HealthReports | undefined

/** The app's one report: the features call reportFailure and reportOk on it. */
export function healthReports(): HealthReports {
  shared ??= new HealthReports()
  return shared
}
