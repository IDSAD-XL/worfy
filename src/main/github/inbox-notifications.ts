// The notifications trigger of the PR inbox (worfy-pr-inbox ticket 08): GitHub's own notifications of the user tell
// the reader (src/main/github/inbox.ts) which PR moved, so its details are read at once instead of at the next
// search. The inbox works without it: a token that may not read notifications leaves the 5-minute search alone.
//
// - Call: `gh api -i "notifications?participating=true" -H "If-Modified-Since: <Last-Modified>"`, one per GitHub
//   account, with GH_TOKEN of that account, through the GhRunner in output mode `all`, so a non-zero exit still
//   brings the status line and the headers `-i` prints.
// - 304: gh prints `gh: HTTP 304` and exits 1 on any status above 299. That is "nothing changed", not a failure: no
//   error, no doubled interval, no details read. GitHub does not count a 304 against the rate limit.
// - 200: the PR threads of the account's Projects' repositories updated after the previous `Last-Modified` — each
//   PR is refreshed once. The new `Last-Modified` goes into pr-inbox.json of every Project of the account.
// - 403 (a fine-grained token, a GitHub App, a token without the `notifications` or `repo` scope) or 404 (a token
//   GitHub serves no notifications to): the trigger is off for that account until worfy restarts; the snapshot's
//   notice says so. A 403 of a rate limit — its message names one, or `Retry-After` or the rate limit headers say
//   so — and any 429 are a pause: until `Retry-After` or `X-Ratelimit-Reset`, at least a minute.
// - Any other status, or gh that does not answer: the trigger's interval doubles up to 30 minutes.
// - Pace: with a focused window, GitHub's `X-Poll-Interval` (60 s when it gives none); without, every 5 minutes.
//   Less than 10 % of the REST rate limit left: no call until `X-Ratelimit-Reset`.
//
// Read-only: only GET, never `--method`, never PATCH of a thread — marking a notification read would change the
// user's own inbox on github.com (spec decision Q4, ADR-0105).
import { z } from 'zod'
import { readNotificationsCursor, writeNotificationsCursor } from '../projects/pr-inbox-state'
import { GhExitError, type GhEnv, type GhRunner } from './prs'

export const NOTIFICATIONS_PATH = 'notifications?participating=true'
/** The pace when GitHub's answer has no `X-Poll-Interval`. */
export const DEFAULT_POLL_MS = 60_000
export const NOTIFICATIONS_IDLE_MS = 5 * 60_000
export const NOTIFICATIONS_MAX_MS = 30 * 60_000
/** Below this share of the REST rate limit left, the trigger waits for `X-Ratelimit-Reset`. */
export const NOTIFICATIONS_RATE_FLOOR = 0.1
/** The pause after a refusal of a rate limit that names no time (GitHub: wait at least a minute). */
export const RATE_LIMIT_PAUSE_MS = 60_000
/** gh's line of a refusal by the primary or the secondary rate limit, e.g. "You have exceeded a secondary rate limit". */
const RATE_LIMITED = /\brate limit\b/iu
export const NOTIFICATIONS_OFF_NOTICE = 'GitHub notifications unavailable for this token — checking every 5 minutes'

/** The arguments of one poll: `If-Modified-Since` only once a `Last-Modified` is known. */
export function notificationsArgs(lastModified: string | null): string[] {
  return ['api', '-i', NOTIFICATIONS_PATH, ...(lastModified === null ? [] : ['-H', `If-Modified-Since: ${lastModified}`])]
}

/** What `gh api -i` printed: the HTTP status, the headers by lower-case name, and the body. */
export interface NotificationsAnswer {
  status: number | null
  headers: ReadonlyMap<string, string>
  body: string
}

/**
 * Reads the output of `gh api -i` (stdout, then stderr): the status line `HTTP/2.0 304 Not Modified`, the headers
 * up to the first blank line, the rest as the body. Without a status line (gh failed before the answer), the status
 * comes from gh's `HTTP <code>` on stderr, if it printed one.
 */
export function parseNotificationsAnswer(output: string): NotificationsAnswer {
  const text = output.replace(/^\s+/u, '')
  const statusLine = /^HTTP\/[\d.]+ (\d{3})\b[^\n]*\n/u.exec(text)
  if (statusLine === null) {
    const fromGh = /\bHTTP (\d{3})\b/u.exec(output)
    return { status: fromGh ? Number(fromGh[1]) : null, headers: new Map(), body: '' }
  }
  const rest = text.slice(statusLine[0].length)
  const end = /\r?\n\r?\n|^\r?\n/u.exec(rest)
  const head = end === null ? rest : rest.slice(0, end.index)
  const headers = new Map<string, string>()
  for (const line of head.split(/\r?\n/u)) {
    const colon = line.indexOf(':')
    if (colon > 0) headers.set(line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim())
  }
  return { status: Number(statusLine[1]), headers, body: end === null ? '' : rest.slice(end.index + end[0].length) }
}

/** The first JSON value of `text`: on success gh's stderr follows the body in output mode `all`. */
function firstJson(text: string): unknown {
  const start = text.search(/[[{]/u)
  if (start < 0) throw new Error('no JSON in the answer')
  let depth = 0
  let quoted = false
  for (let at = start; at < text.length; at++) {
    const char = text[at]
    if (quoted) {
      if (char === '\\') at++
      else if (char === '"') quoted = false
    } else if (char === '"') quoted = true
    else if (char === '[' || char === '{') depth++
    else if ((char === ']' || char === '}') && --depth === 0) return JSON.parse(text.slice(start, at + 1))
  }
  throw new Error('the answer ends inside its JSON')
}

const threadSchema = z.object({
  updated_at: z.string().catch(''),
  subject: z.object({ type: z.string(), url: z.string().nullish() }),
  repository: z.object({ full_name: z.string() }).nullish(),
})

/** A PR by its repository `owner/name` and number. */
export interface NotifiedPull {
  repo: string
  number: number
}

/**
 * The PRs of `repos` whose notification threads changed after `since` (a `Last-Modified`), each once, in the order
 * GitHub listed them. Threads of issues, releases, discussions and other repositories are left out; without `since`
 * none counts, since the search reads every PR anyway.
 */
export function notifiedPulls(threads: unknown, repos: readonly string[], since: string | null): NotifiedPull[] {
  const after = since === null ? Number.NaN : Date.parse(since)
  if (Number.isNaN(after) || !Array.isArray(threads)) return []
  const ours = new Map(repos.map((repo) => [repo.toLowerCase(), repo]))
  const found = new Map<string, NotifiedPull>()
  for (const raw of threads) {
    const thread = threadSchema.safeParse(raw)
    if (!thread.success || thread.data.subject.type !== 'PullRequest') continue
    if (!(Date.parse(thread.data.updated_at) > after)) continue
    const url = /\/repos\/([^/]+\/[^/]+)\/pulls\/(\d+)$/u.exec(thread.data.subject.url ?? '')
    if (url === null) continue
    const repo = ours.get((thread.data.repository?.full_name ?? url[1]!).toLowerCase())
    if (repo === undefined) continue
    const key = `${repo.toLowerCase()}#${url[2]}`
    if (!found.has(key)) found.set(key, { repo, number: Number(url[2]) })
  }
  return [...found.values()]
}

/** A GitHub account the trigger polls for, as the reader knows it now. */
export interface NotificationsAccount {
  /** The reader's account key: the login, '' for gh's own account. */
  key: string
  /** Where gh runs: the root of a Project of the account. */
  root: string
  /** The repositories of the account's Projects. */
  repos: readonly string[]
  /** The data folders of the account's Projects, where the cursor is kept. */
  dataDirs: readonly string[]
  env: () => Promise<GhEnv>
}

export interface NotificationsOptions {
  run: GhRunner
  accounts: () => readonly NotificationsAccount[]
  /** Reads one PR's details at once (PrInbox.refresh). */
  refresh: (repo: string, number: number) => Promise<void>
  /** Whether a window of worfy has the focus: then GitHub's poll interval, else every 5 minutes. */
  focused: () => boolean
  /** The trigger of `account` (its key) turned off: its notice changed. */
  onOff?: (account: string) => void
  now: () => number
  idleMs?: number
  maxMs?: number
}

interface TriggerState {
  /** The last `Last-Modified`; undefined until read from pr-inbox.json. */
  lastModified: string | null | undefined
  lastAt: number
  pollMs: number
  /** After failures: the doubled wait; null when the last poll answered. */
  backoffMs: number | null
  pausedUntil: number
  off: boolean
}

const seconds = (value: string | undefined): number | null => {
  const number = value === undefined || !/^\d+$/u.test(value) ? Number.NaN : Number(value)
  return Number.isNaN(number) ? null : number
}

export class NotificationsTrigger {
  private readonly states = new Map<string, TriggerState>()
  private readonly idle: number
  private readonly max: number

  constructor(private readonly options: NotificationsOptions) {
    this.idle = options.idleMs ?? NOTIFICATIONS_IDLE_MS
    this.max = options.maxMs ?? NOTIFICATIONS_MAX_MS
  }

  /** Polls every account whose turn has come, one after another. */
  async tick(): Promise<void> {
    for (const account of this.options.accounts()) {
      if (account.repos.length > 0 && this.due(account.key)) await this.poll(account)
    }
  }

  /** The `notice` of the inbox snapshot: why the notifications of `account` are not read, or null. */
  notice(account: string): string | null {
    return this.states.get(account)?.off === true ? NOTIFICATIONS_OFF_NOTICE : null
  }

  private stateOf(key: string): TriggerState {
    let state = this.states.get(key)
    if (state === undefined) {
      state = { lastModified: undefined, lastAt: -Infinity, pollMs: DEFAULT_POLL_MS, backoffMs: null, pausedUntil: -Infinity, off: false }
      this.states.set(key, state)
    }
    return state
  }

  /** The wait after a poll that answered: GitHub's interval with the focus, at least 5 minutes without. */
  private paceOf(state: TriggerState): number {
    return this.options.focused() ? state.pollMs : Math.max(this.idle, state.pollMs)
  }

  private due(key: string): boolean {
    const state = this.stateOf(key)
    const now = this.options.now()
    if (state.off || now < state.pausedUntil) return false
    return now >= state.lastAt + (state.backoffMs ?? this.paceOf(state))
  }

  private async poll(account: NotificationsAccount): Promise<void> {
    const state = this.stateOf(account.key)
    state.lastAt = this.options.now()
    if (state.lastModified === undefined) state.lastModified = newest(account.dataDirs.map((dir) => readNotificationsCursor(dir, account.key)))
    let output: string
    try {
      output = await this.options.run(notificationsArgs(state.lastModified), account.root, await account.env(), 'all')
    } catch (error) {
      // A non-zero exit carries the answer; gh that did not start, ran out of time or has no login does not.
      if (!(error instanceof GhExitError)) return this.failed(state)
      output = error.output
    }
    const answer = parseNotificationsAnswer(output)
    const limited = this.noteRate(state, answer.headers) || ((answer.status === 403 || answer.status === 429) && this.notePause(state, answer.status, output))
    const interval = seconds(answer.headers.get('x-poll-interval'))
    if (answer.status === 304 || answer.status === 200) {
      state.backoffMs = null
      state.pollMs = interval === null || interval === 0 ? DEFAULT_POLL_MS : interval * 1000
    }
    if (answer.status === 304) return
    if (answer.status === 200) return this.answered(account, state, answer)
    if ((answer.status === 403 || answer.status === 429) && limited) return
    if (answer.status === 403 || answer.status === 404) {
      state.off = true
      this.options.onOff?.(account.key)
      return
    }
    this.failed(state)
  }

  private async answered(account: NotificationsAccount, state: TriggerState, answer: NotificationsAnswer): Promise<void> {
    let threads: unknown
    try {
      threads = firstJson(answer.body)
    } catch {
      return this.failed(state)
    }
    const pulls = notifiedPulls(threads, account.repos, state.lastModified ?? null)
    const lastModified = answer.headers.get('last-modified')
    if (lastModified !== undefined && lastModified !== state.lastModified) {
      state.lastModified = lastModified
      for (const dir of account.dataDirs) {
        try {
          writeNotificationsCursor(dir, account.key, lastModified)
        } catch (error) {
          // The PRs of this answer are still read; the cursor is kept in memory until worfy restarts.
          console.warn('[pr-inbox] the notifications cursor was not saved', error)
        }
      }
    }
    for (const pull of pulls) await this.options.refresh(pull.repo, pull.number)
  }

  /** A refusal of a rate limit without its headers: any 429, or a 403 whose message names a rate limit. */
  private notePause(state: TriggerState, status: number, output: string): boolean {
    if (status !== 429 && !RATE_LIMITED.test(output)) return false
    state.pausedUntil = Math.max(state.pausedUntil, this.options.now() + RATE_LIMIT_PAUSE_MS)
    return true
  }

  private failed(state: TriggerState): void {
    state.backoffMs = Math.min((state.backoffMs ?? this.paceOf(state)) * 2, this.max)
  }

  /**
   * A pause until the reset when the REST rate limit is below the floor, or for `Retry-After` seconds. Returns
   * whether the answer was the rate limit's.
   */
  private noteRate(state: TriggerState, headers: ReadonlyMap<string, string>): boolean {
    const now = this.options.now()
    const retry = seconds(headers.get('retry-after'))
    if (retry !== null) {
      state.pausedUntil = Math.max(state.pausedUntil, now + retry * 1000)
      return true
    }
    const limit = seconds(headers.get('x-ratelimit-limit'))
    const remaining = seconds(headers.get('x-ratelimit-remaining'))
    const reset = seconds(headers.get('x-ratelimit-reset'))
    if (limit === null || remaining === null || reset === null || limit === 0 || remaining >= limit * NOTIFICATIONS_RATE_FLOOR) return false
    state.pausedUntil = Math.max(state.pausedUntil, reset * 1000)
    return true
  }
}

/** The latest of the saved `Last-Modified`s of an account's Projects; null when none has one. */
function newest(cursors: readonly (string | null)[]): string | null {
  let best: string | null = null
  for (const cursor of cursors) if (cursor !== null && (best === null || Date.parse(cursor) > Date.parse(best))) best = cursor
  return best
}
