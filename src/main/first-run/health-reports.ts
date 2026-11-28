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
// - A live row (registerLiveRows; worfy-harness-guarantees ticket 09: the contract set of the Harness on Claude Code)
//   is the feature's own: Health reads it at each merge and never waits for it, and the feature says when it changed.
//   A row of the same id and Project a check made comes first.
//
// - A row may have a `subject` (worfy-integrations ticket 09: an Integration): one id and Project then
//   hold a row per subject, each kept and taken back to `ok` on its own.
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
  integration: { group: 'Projects', title: 'Integration' },
} as const satisfies Partial<Record<CheckId, { group: CheckGroup; title: string }>>
export type ReportedCheckId = keyof typeof REPORTED_ROWS

/** The row checked again, or null when it is no longer there (the Project lost its GitHub origin). */
export type Recheck = (project: CheckProject | undefined) => Promise<Check | null>

/** At most one re-check after a failure message per Project in this time (spec, when to check). */
export const RECHECK_AFTER_FAILURE_MS = 60_000
/** On the focus of a window, a row not in `ok` is checked again only when its last check is older (Q8). */
export const RECHECK_ON_FOCUS_MS = 5 * 60_000

/** What a row is about when one id and Project hold several: an Integration (Check.subject). */
export type CheckSubject = NonNullable<Check['subject']>

interface Message {
  id: ReportedCheckId
  project: CheckProject | undefined
  subject: CheckSubject | undefined
  reason: string
  step: string
  /** The buttons of the row the message makes; none given — those of the checked row, or none. */
  actions: Check['actions'] | undefined
  at: number
}

interface Stored {
  check: Check
  at: number
  /** Among the extra rows: `network` — a source's row, which the next network run replaces; `recheck` — a row only a re-check made, which stays. */
  from?: 'network' | 'recheck'
}

const keyOf = (id: CheckId, project: CheckProject | undefined, subject?: CheckSubject): string => `${id}\u0000${project?.id ?? ''}${subject === undefined ? '' : `\u0000${subject.id}`}`
const keyOfCheck = (check: Check): string => keyOf(check.id, check.project, check.subject)
/** The Machine's rows share one re-check budget, as if they were one Project. */
const budgetOf = (project: CheckProject | undefined): string => project?.id ?? ''

export class HealthReports {
  /** The rows of the last checks, in their order; null before the first. */
  private checked: Stored[] | null = null
  private checkedAt: string | null = null
  /** The rows checked over the network or again one by one, not among the local ones. */
  private extra = new Map<string, Stored>()
  private messages = new Map<string, Message>()
  private rechecks = new Map<CheckId, Recheck>()
  private networkSources: (() => Promise<Check[]>)[] = []
  private liveSources: (() => readonly Check[])[] = []
  private lastRecheck = new Map<string, number>()
  /** The rows whose re-check is running, with its end: a second one waits for nothing and starts nothing. */
  private inFlight = new Map<string, Promise<void>>()
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

  /**
   * Rows a feature keeps itself and answers for at once (`read`); nothing here awaits it, so a slow one holds back no
   * other row. Returns what the feature calls after each change of them: the report goes to the listeners.
   */
  registerLiveRows(read: () => readonly Check[]): () => void {
    this.liveSources.push(read)
    return () => this.changed()
  }

  /**
   * A feature failed on its row: the row is out of `ok` now, and one re-check of that Project follows. `subject` — the
   * row of one Integration among several of the same Project (worfy-integrations ticket 09).
   */
  reportFailure(id: ReportedCheckId, project: CheckProject | undefined, reason: string, step: string, actions?: Check['actions'], subject?: CheckSubject): void {
    const at = this.now()
    this.messages.set(keyOf(id, project, subject), { id, project, subject, reason: redactSecrets(reason), step: redactSecrets(step), actions, at })
    this.changed()
    const recheck = this.rechecks.get(id)
    const budget = budgetOf(project)
    const last = this.lastRecheck.get(budget)
    if (recheck === undefined || (last !== undefined && at - last < RECHECK_AFTER_FAILURE_MS)) return
    this.lastRecheck.set(budget, at)
    void this.recheck(id, project, recheck)
  }

  /** The feature worked on its row again: the message goes, and the row is `ok` without a check. */
  reportOk(id: ReportedCheckId, project: CheckProject | undefined, subject?: CheckSubject): void {
    const key = keyOf(id, project, subject)
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
    this.checked = report.checks.map((check) => ({ check, at }))
    this.checkedAt = report.checkedAt
    for (const check of report.checks) this.supersede(keyOfCheck(check), startedAt)
    this.changed()
    return this.current() ?? report
  }

  /**
   * Runs the network rows; they replace the earlier rows of the sources. A row only a re-check made
   * (a feature's failure, re-checked) stays unless a source answers for it now. Never rejects: a
   * source that throws adds nothing.
   */
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
    const checkedKeys = new Set((this.checked ?? []).map((stored) => keyOfCheck(stored.check)))
    const before = this.extra
    this.extra = new Map()
    for (const check of answers.flat()) {
      const key = keyOfCheck(check)
      if (checkedKeys.has(key)) continue
      this.extra.set(key, { check, at, from: 'network' })
      this.supersede(key, startedAt)
    }
    for (const [key, stored] of before) if (stored.from === 'recheck' && !this.extra.has(key)) this.extra.set(key, stored)
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

  /**
   * Checks the row `id` of `project` again now, out of any budget, with `recheck` or the one registered (worfy-polish
   * 172: the Harness row after an install). Only a row the report holds: one no check made yet is the first check's,
   * and a row made here would stand beside the one that check makes. A re-check of the row that is running may have
   * read the state before the change: this one waits for its end, then runs.
   */
  async recheckNow(id: CheckId, project: CheckProject | undefined, recheck: Recheck | undefined = this.rechecks.get(id)): Promise<void> {
    const key = keyOf(id, project)
    if (recheck === undefined || this.storedAt(key) === undefined) return
    await this.inFlight.get(key)
    await this.recheck(id, project, recheck)
  }

  /** The merged report; null before the first check and the first message. */
  current(): FirstRunReport | null {
    const rows = this.rows().map(({ check }) => check)
    if (this.checkedAt === null && rows.length === 0) return null
    return { checks: rows, checkedAt: this.checkedAt ?? new Date(this.now()).toISOString() }
  }

  /** Checks one row again; a row whose re-check is still running is not checked a second time. */
  private async recheck(id: CheckId, project: CheckProject | undefined, recheck: Recheck): Promise<void> {
    const key = keyOf(id, project)
    if (this.inFlight.has(key)) return
    let done = (): void => undefined
    this.inFlight.set(
      key,
      new Promise<void>((resolve) => {
        done = resolve
      }),
    )
    const startedAt = this.now()
    let fresh: Check | null
    try {
      fresh = await recheck(project)
    } catch (error) {
      console.warn(`[health] the re-check of ${id} failed:`, error instanceof Error ? error.name : 'error')
      return
    } finally {
      this.inFlight.delete(key)
      done()
    }
    const at = this.now()
    const ofChecks = this.checked?.find((stored) => keyOfCheck(stored.check) === key)
    const extra = this.extra.get(key)
    if (fresh === null) {
      this.extra.delete(key)
      if (ofChecks !== undefined) this.checked = (this.checked ?? []).filter((stored) => stored !== ofChecks)
    } else if (ofChecks !== undefined) {
      ofChecks.check = fresh
      ofChecks.at = at
    } else this.extra.set(key, { check: fresh, at, from: extra?.from ?? 'recheck' })
    this.supersede(key, startedAt)
    this.changed()
  }

  /** Drops the message of `key` when the check that just answered started after it. */
  private supersede(key: string, startedAt: number): void {
    const message = this.messages.get(key)
    if (message !== undefined && message.at <= startedAt) this.messages.delete(key)
  }

  private storedAt(key: string): Stored | undefined {
    return this.checked?.find((stored) => keyOfCheck(stored.check) === key) ?? this.extra.get(key)
  }

  /** The local rows, then the network ones, then those only a message made; each with when it was last seen. */
  private rows(): Stored[] {
    const merged: Stored[] = []
    const seen = new Set<string>()
    for (const stored of [...(this.checked ?? []), ...this.extra.values()]) {
      const key = keyOfCheck(stored.check)
      seen.add(key)
      const message = this.messages.get(key)
      const network = this.extra.has(key)
      const check = message === undefined ? stored.check : fromMessage(message, stored.check)
      merged.push({ check: network || check.project !== undefined ? { ...check, opensFirstRun: false } : check, at: Math.max(stored.at, message?.at ?? 0) })
    }
    for (const [key, message] of this.messages) if (!seen.has(key)) merged.push({ check: fromMessage(message, undefined), at: message.at })
    for (const check of this.liveSources.flatMap(readLive)) {
      const key = keyOfCheck(check)
      if (seen.has(key)) continue
      seen.add(key)
      merged.push({ check: { ...check, opensFirstRun: false }, at: this.now() })
    }
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

/** The rows of a live source; one that throws has none. */
function readLive(read: () => readonly Check[]): readonly Check[] {
  try {
    return read()
  } catch (error) {
    console.warn('[health] live rows could not be read:', error instanceof Error ? error.name : 'error')
    return []
  }
}

/** The row a failure message makes, over the checked row of the same id and Project when there is one. */
function fromMessage(message: Message, checked: Check | undefined): Check {
  const base = checked ?? {
    id: message.id,
    ...REPORTED_ROWS[message.id],
    command: null,
    actions: [],
    ...(message.project === undefined ? {} : { project: message.project }),
    // A row per subject (worfy-integrations ticket 09: an Integration) is named by its reason, which starts with the
    // subject's label — «Jira — client A: sign-in needed», read whole, as the prototype has it; two rows of one Project
    // read apart.
    ...(message.subject === undefined ? {} : { subject: message.subject, title: message.reason }),
  }
  // A feature that reports a GitHub failure works with GitHub: gh counts as needed.
  const severity = checked !== undefined && checked.status !== 'unknown' ? checked.severity : severityOf({ id: message.id, status: 'fail' }, { githubProject: true })
  return { ...base, status: 'fail', severity, detail: message.reason, hint: message.step, actions: message.actions ?? base.actions, opensFirstRun: false }
}

let shared: HealthReports | undefined

/** The app's one report: the features call reportFailure and reportOk on it. */
export function healthReports(): HealthReports {
  shared ??= new HealthReports()
  return shared
}
