// The PR search of the Pull requests tab, in main (worfy-pr-review ticket 04; spec, implementation decisions 1, 2, 9
// and 10): a search the user runs on Enter, one PR of its results that is not in the PR inbox, and the saved
// searches of a Project.
//
// - Account: the Project's (accountAuth of src/main/github/prs.ts), as the PR inbox reads; the global gh account is
//   never switched. Every call goes through a GhRunner, which takes WORFY_GH, so tests run a stand-in.
// - Read-only: `gh api graphql -i` with a `query`, never `--method`, never a `mutation` (ADR-0105). A search and a PR
//   opened from it may name any repository the account sees (ADR-0105, point 1, amended 2026-11-20); the inbox's
//   background reads stay in the Project's repositories.
// - Search: the strings of src/shared/pr-search/query.ts, each `search(type: ISSUE, query: $q, first: 30, after:
//   $cursor)` with `issueCount`, only the number, `updatedAt` and repository of each PR; "Load more" sends the cursor
//   back. GitHub stops at 1,000 results a search. The same search less than 60 s ago answers from memory: GitHub's
//   search has a limit of its own (30 a minute for REST; GraphQL's is not documented).
// - Rows: a PR the Project's inbox holds takes the inbox's row, a PR read before with the same `updatedAt` takes the
//   one in memory, and only the rest is read with the inbox's details query (detailsArgs, PULL_FIELDS) and made into
//   a row by its rowOf: one PR is never read twice. Up to PR_SEARCH_PULLS_MAX PRs stay in memory, never on disk
//   (ADR-0105, point 6), and Mark seen is never written for them.
// - Rate limit: the pause is the PR inbox's (RATE_LIMIT_FLOOR, 10 % left): a search of a paused account makes no
//   call, and a search that finds the limit low pauses the inbox as well.
// - Errors (spec, implementation decisions 10) become `notices`: 404, 403 with `X-GitHub-SSO`, its `partial-results`,
//   an answer GitHub cut short, 422 with GitHub's words, 401, the rate limit.
//
// Saved searches: `<Project data folder>/pr-searches.json` beside `pr-inbox.json` (ADR-0005, amended 2026-11-20): a
// name, the text and the scope of each, at most PR_SEARCHES_MAX; two built-in ones are never stored or forgotten.
import { createHash, randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { z } from 'zod'
import type { PrInboxRow } from '../../shared/ipc/pr-inbox'
import type { PrSearchNotice, PrSearchPull, PrSearchResult, PrSearchRow, SavedSearch } from '../../shared/ipc/pr-search'
import { PR_SEARCH_SCOPES, buildSearch, type PrSearchScope } from '../../shared/pr-search/query'
import { redactSecrets } from '../../shared/terminal-ai/redact'
import { readJsonFile, writeJsonFile } from '../storage/json-file'
import { isSignInFailure } from './github-health'
import { INBOX_DETAILS_PAGE, RATE_LIMIT_FLOOR, detailsArgs, readPull, rowOf, type PullRef } from './inbox'
import { RATE_LIMIT_PAUSE_MS, firstJson, parseNotificationsAnswer } from './inbox-notifications'
import { GhExitError, accountAuth, type GhEnv, type GhRunner } from './prs'

/** PRs a page of results. */
export const PR_SEARCH_PAGE = 30
/** The most results GitHub gives a search, page after page. */
export const PR_SEARCH_RESULTS_MAX = 1000
/** How long the same search answers from memory. */
export const PR_SEARCH_MEMORY_MS = 60_000
/** The PRs outside the inbox kept in memory. */
export const PR_SEARCH_PULLS_MAX = 200

export const PR_SEARCH_QUERY = `query($q: String!, $cursor: String) { viewer { login } rateLimit { limit remaining resetAt } search(type: ISSUE, query: $q, first: ${PR_SEARCH_PAGE}, after: $cursor) { issueCount pageInfo { hasNextPage endCursor } nodes { ... on PullRequest { number updatedAt repository { nameWithOwner } } } } }`

/** The arguments of one page of a search: `-i`, so the status and the headers (X-GitHub-SSO) come too. */
export function prSearchArgs(q: string, cursor: string | null): string[] {
  return ['api', 'graphql', '-i', '-f', `query=${PR_SEARCH_QUERY}`, '-f', `q=${q}`, ...(cursor === null ? [] : ['-f', `cursor=${cursor}`])]
}

/** The inbox's details query of `page`, with `-i`. */
function pullArgs(page: readonly PullRef[]): string[] {
  const [api = 'api', graphql = 'graphql', ...rest] = detailsArgs(page)
  return [api, graphql, '-i', ...rest]
}

// ── the answers ──────────────────────────────────────────────────────────────

const rateSchema = z.object({ limit: z.number(), remaining: z.number(), resetAt: z.string() })
const errorsSchema = z.array(z.object({ type: z.string().optional(), message: z.string().catch('') }).catch({ message: '' })).optional().catch(undefined)
const searchSchema = z.object({
  data: z.object({
    viewer: z.object({ login: z.string() }).nullish().catch(null),
    rateLimit: rateSchema.nullish().catch(null),
    search: z.object({
      issueCount: z.number().int().nonnegative(),
      pageInfo: z.object({ hasNextPage: z.boolean().catch(false), endCursor: z.string().nullish().catch(null) }).nullish().catch(null),
      nodes: z.array(z.unknown()).catch([]),
    }),
  }),
  errors: errorsSchema,
})
const foundSchema = z.object({ number: z.number().int().positive(), updatedAt: z.string(), repository: z.object({ nameWithOwner: z.string() }) })
const detailsSchema = z.object({ data: z.record(z.string(), z.unknown()).nullish().catch(null), errors: errorsSchema })
const messageSchema = z.object({ message: z.string(), errors: z.array(z.object({ message: z.string() }).catch({ message: '' })).optional().catch(undefined) })

/** What `gh api -i` answered: the HTTP status (null when none came), the headers, the JSON body, and gh's reason on a failure. */
interface GhAnswer {
  status: number | null
  headers: ReadonlyMap<string, string>
  json: unknown
  /** gh's words when it exited with a code other than 0; '' when it did not. */
  reason: string
}

const messageOf = (error: unknown): string => redactSecrets(error instanceof Error ? error.message : String(error))

function answerOf(output: string, reason: string): GhAnswer {
  const answer = parseNotificationsAnswer(output)
  let json: unknown
  try {
    json = firstJson(answer.body)
  } catch {
    json = undefined
  }
  return { status: answer.status, headers: answer.headers, json, reason: redactSecrets(reason) }
}

const notice = (kind: PrSearchNotice['kind'], text: string, url: string | null = null): PrSearchNotice => ({ kind, text, url })

/** `HH:MM` of a time, as the notice of the rate limit says it. */
function clockOf(time: number): string {
  const at = new Date(time)
  return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
}

/** GitHub's words of a refusal: the message of the body and of its errors, else gh's. */
function githubWords(answer: GhAnswer): string {
  const body = messageSchema.safeParse(answer.json)
  if (body.success) return [body.data.message, ...(body.data.errors ?? []).map((each) => each.message).filter((each) => each !== '')].join(': ')
  const errors = detailsSchema.safeParse(answer.json)
  const first = errors.success ? errors.data.errors?.find((each) => each.message !== '')?.message : undefined
  return first ?? (answer.reason || `HTTP ${answer.status ?? '?'}`)
}

/** The organization of an SSO authorization link (`…/orgs/<org>/sso?…`); null when it names none. */
const ssoOrg = (url: string | null): string | null => (url === null ? null : (/\/orgs\/([^/?#]+)\/sso\b/u.exec(url)?.[1] ?? null))

/**
 * Why an answer brought no results, as a notice, and until when the account waits when it is GitHub's rate limit; null
 * when it brought them. `who` names the Project's account in the 404.
 */
function failureOf(answer: GhAnswer, now: number, who: string, repo: string | null): { notice: PrSearchNotice; pauseUntil: number | null } | null {
  const errors = detailsSchema.safeParse(answer.json).data?.errors ?? []
  const ok = answer.status !== null && answer.status < 300 && answer.reason === ''
  if (ok) return null
  const words = githubWords(answer)
  // Single sign-on before the rate limit: a 403 of SSO may come while little of the limit is left, and its link is what
  // the user needs (review round 1).
  const sso = answer.headers.get('x-github-sso') ?? ''
  if (sso.startsWith('required') || (answer.status === 403 && /\bSAML\b/u.test(words)) || errors.some((each) => /\bSAML\b/u.test(each.message))) {
    const url = /\burl=(\S+)/u.exec(sso)?.[1] ?? null
    return { notice: notice('sso', `Authorize your token for ${ssoOrg(url) ?? 'the organization'} single sign-on`, url), pauseUntil: null }
  }
  const remaining = Number(answer.headers.get('x-ratelimit-remaining'))
  const limit = Number(answer.headers.get('x-ratelimit-limit'))
  const low = answer.headers.has('x-ratelimit-remaining') && limit > 0 && remaining < limit * RATE_LIMIT_FLOOR
  const rateLimited =
    errors.some((each) => each.type === 'RATE_LIMITED') || ((answer.status === 403 || answer.status === 429) && (answer.headers.has('retry-after') || low || /\brate limit\b/iu.test(words)))
  if (rateLimited) {
    const retry = Number(answer.headers.get('retry-after'))
    const reset = Number(answer.headers.get('x-ratelimit-reset'))
    const until = Number.isFinite(retry) && retry > 0 ? now + retry * 1000 : low && Number.isFinite(reset) && reset * 1000 > now ? reset * 1000 : now + RATE_LIMIT_PAUSE_MS
    return { notice: notice('rate-limit', `Search paused until ${clockOf(until)} (GitHub rate limit)`), pauseUntil: until }
  }
  if (answer.status === 401 || (answer.status === null && isSignInFailure(answer.reason))) return { notice: notice('sign-in', `GitHub refused the sign-in: ${words}`), pauseUntil: null }
  if (answer.status === 404 || errors.some((each) => each.type === 'NOT_FOUND')) return { notice: notice('not-visible', `${repo ?? 'The repository'} is not visible to ${who}`), pauseUntil: null }
  if (answer.status === 422) return { notice: notice('invalid', words), pauseUntil: null }
  return { notice: notice('failed', words), pauseUntil: null }
}

/** The notice of `X-GitHub-SSO: partial-results; organizations=…`: GitHub names the organizations by id only. */
function partialOf(answer: GhAnswer): PrSearchNotice | null {
  const sso = answer.headers.get('x-github-sso') ?? ''
  if (!sso.startsWith('partial-results')) return null
  const count = (/\borganizations=([^;\s]+)/u.exec(sso)?.[1] ?? '').split(',').filter((each) => each !== '').length
  const whose = count > 1 ? `${count} organizations are hidden: authorize your token for their` : 'an organization are hidden: authorize your token for its'
  return notice('sso-partial', `Results from ${whose} single sign-on`)
}

// ── the cursor ───────────────────────────────────────────────────────────────

/** Per search string: the cursor of its next page, null for its first, false when it has no more. */
type Pages = (string | null | false)[]
/**
 * The cursor as the view gets it: the pages, and a hash of the search strings they belong to. GitHub's cursors are
 * offsets, so one of another search would answer that search from the middle.
 */
const cursorSchema = z.object({ of: z.string(), pages: z.array(z.union([z.string(), z.null(), z.literal(false)])) })

const hashOf = (queries: readonly string[]): string => createHash('sha256').update(JSON.stringify(queries)).digest('base64url').slice(0, 22)

function pagesOf(cursor: string | null | undefined, queries: readonly string[]): Pages {
  if (cursor == null) return queries.map(() => null)
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
  } catch {
    parsed = undefined
  }
  const decoded = cursorSchema.safeParse(parsed)
  if (!decoded.success || decoded.data.of !== hashOf(queries) || decoded.data.pages.length !== queries.length) throw new Error('the cursor is not of this search; search again')
  return decoded.data.pages
}

const cursorOf = (pages: Pages, queries: readonly string[]): string | null =>
  pages.some((page) => typeof page === 'string') ? Buffer.from(JSON.stringify({ of: hashOf(queries), pages })).toString('base64url') : null

// ── the reader ───────────────────────────────────────────────────────────────

/** The rate-limit pause the PR inbox keeps per account (PrInbox): the search reads and sets the same one. */
export interface AccountRates {
  accountPause(account: string | null): { until: number; reason: string } | null
  noteAccountRate(account: string | null, rate: unknown): void
  pauseAccount(account: string | null, until: number, reason: string): void
}

export interface PrSearchProject {
  id: string
  root: string
}

export interface PrSearchOptions {
  run: GhRunner
  /** The Project's GitHub account (readGithubAccount); null — gh's own account. */
  account: (root: string) => Promise<string | null>
  /** The Project's repositories on GitHub, `owner/name` (remoteRepos). */
  repos: (root: string) => Promise<readonly string[]>
  /** The row of the PR in the Project's PR inbox as last read; null when the inbox has none. */
  inboxRow: (projectId: string, repo: string, number: number) => PrInboxRow | null
  rates: AccountRates
  now?: () => number
  /** The PRs kept in memory; PR_SEARCH_PULLS_MAX by default. */
  pullsMax?: number
}

export interface PrSearchInput {
  text: string
  scope: PrSearchScope
  cursor?: string | null
}

export interface PrPullInput {
  repo: string
  number: number
  /** The `updatedAt` the results gave: the PR in memory answers when it is the same. */
  updatedAt?: string | null
  /** Read it again whatever memory holds. */
  refresh?: boolean
}

interface KeptPull {
  row: PrInboxRow
  readAt: number
}

interface Found {
  repo: string
  number: number
  updatedAt: string
}

const keyOf = (repo: string, number: number): string => `${repo.toLowerCase()}#${number}`
/**
 * A PR in memory by the account that read it as well: another account may not see it, and its row counts the comments
 * new to that account's viewer (review round 1).
 */
const pullKeyOf = (account: string | null, repo: string, number: number): string => JSON.stringify([account ?? '', keyOf(repo, number)])

export class PrSearch {
  private readonly now: () => number
  private readonly pulls = new Map<string, KeptPull>()
  private readonly memory = new Map<string, { result: PrSearchResult; at: number }>()
  /** The login of each account (its key) as the last search answered it, for the rows of a PR read alone. */
  private readonly viewers = new Map<string, string>()

  constructor(private readonly options: PrSearchOptions) {
    this.now = options.now ?? (() => Date.now())
  }

  /** One page of a search: the first, or the next of `cursor`. */
  async run(project: PrSearchProject, input: PrSearchInput): Promise<PrSearchResult> {
    const now = this.now()
    const repos = input.scope === 'github' ? [] : [...(await this.options.repos(project.root).catch(() => []))]
    const built = buildSearch({ text: input.text, scope: input.scope, repos })
    const pages = pagesOf(input.cursor, built.queries)
    const notices: PrSearchNotice[] = []
    if (built.dropped.length > 0) notices.push(notice('issue-dropped', `${built.dropped.join(' ')} left out: this search finds pull requests only`))
    if (built.ownScope && input.scope !== 'github') notices.push(notice('own-scope', 'The search names its own repo:, org: or user:, so the scope adds none'))
    const empty = (more: PrSearchNotice[], pausedUntil: number | null = null): PrSearchResult => ({
      queries: built.queries,
      rows: [],
      issueCount: 0,
      cursor: null,
      viewer: null,
      rate: null,
      pausedUntil: pausedUntil === null ? null : new Date(pausedUntil).toISOString(),
      searchedAt: new Date(now).toISOString(),
      fromMemory: false,
      notices: [...notices, ...more],
    })
    // No repository on GitHub: the scope would add nothing, and the search would become one of All of GitHub.
    if (input.scope !== 'github' && repos.length === 0 && !built.ownScope) return empty([notice('failed', 'No repository of this Project is on GitHub: search All of GitHub instead')])
    const account = await this.options.account(project.root)
    const accountKey = account ?? ''
    const memoryKey = JSON.stringify([project.id, accountKey, built.queries, pages])
    for (const [key, kept] of this.memory) if (now - kept.at >= PR_SEARCH_MEMORY_MS) this.memory.delete(key)
    const kept = this.memory.get(memoryKey)
    if (kept !== undefined) return { ...kept.result, fromMemory: true }
    const paused = this.options.rates.accountPause(account)
    if (paused !== null) return empty([notice('rate-limit', `Search paused until ${clockOf(paused.until)} (GitHub rate limit)`)], paused.until)
    let env: GhEnv
    try {
      env = await this.envOf(project.root, account)
    } catch (error) {
      return empty([notice('sign-in', `GitHub refused the sign-in: ${messageOf(error)}`)])
    }
    const found: Found[] = []
    const next: Pages = [...pages]
    let issueCount = 0
    let viewer: string | null = null
    let rate: z.output<typeof rateSchema> | null = null
    for (const [index, query] of built.queries.entries()) {
      const page = pages[index]
      if (page === false || page === undefined) continue
      const answer = await this.call(prSearchArgs(query, page), project.root, env)
      const parsed = searchSchema.safeParse(answer.json)
      // GitHub cut the search short (a timeout) but gave what it found: those, with a notice.
      const partly = parsed.success && (parsed.data.errors ?? []).length > 0 && !(parsed.data.errors ?? []).some((each) => each.type === 'RATE_LIMITED')
      if (!parsed.success || !(partly || answer.reason === '')) {
        const failure = failureOf(answer, this.now(), this.who(account), null) ?? { notice: notice('failed', githubWords(answer)), pauseUntil: null }
        if (failure.pauseUntil !== null) this.pauseFor(account, failure.pauseUntil)
        return empty([failure.notice], failure.pauseUntil)
      }
      const { data } = parsed.data
      if (partly && !notices.some((each) => each.kind === 'incomplete')) notices.push(notice('incomplete', 'GitHub returned part of the results — search again or narrow it'))
      const partial = partialOf(answer)
      if (partial !== null && !notices.some((each) => each.kind === 'sso-partial')) notices.push(partial)
      if (data.rateLimit != null) {
        rate = data.rateLimit
        this.options.rates.noteAccountRate(account, data.rateLimit)
      }
      if (data.viewer != null) {
        viewer = data.viewer.login
        this.viewers.set(accountKey, viewer)
      }
      issueCount += data.search.issueCount
      if (data.search.issueCount > PR_SEARCH_RESULTS_MAX && !notices.some((each) => each.kind === 'first-1000')) notices.push(notice('first-1000', 'Showing the first 1,000 — narrow the search'))
      for (const node of data.search.nodes) {
        const each = foundSchema.safeParse(node)
        // An issue of the search (the user's `-is:pr`) or a node GitHub could not give.
        if (each.success) found.push({ repo: each.data.repository.nameWithOwner, number: each.data.number, updatedAt: each.data.updatedAt })
      }
      next[index] = data.search.pageInfo?.hasNextPage === true && data.search.pageInfo.endCursor != null ? data.search.pageInfo.endCursor : false
    }
    const unique = [...new Map(found.map((each) => [keyOf(each.repo, each.number), each])).values()]
    // Several searches of one list: newest first across them, as `sort:updated-desc` orders each one.
    if (built.queries.length > 1 && !/(?:^|\s)sort:/iu.test(input.text)) unique.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    const rows = await this.rowsOf(project, unique, viewer, env, account, notices)
    const result: PrSearchResult = {
      queries: built.queries,
      rows,
      issueCount,
      cursor: cursorOf(next, built.queries),
      viewer,
      rate,
      pausedUntil: null,
      searchedAt: new Date(now).toISOString(),
      fromMemory: false,
      notices,
    }
    this.memory.set(memoryKey, { result, at: now })
    return result
  }

  /** One PR of the results: the inbox's row, the one in memory, or a read of it. */
  async pull(project: PrSearchProject, input: PrPullInput): Promise<PrSearchPull> {
    const inbox = this.options.inboxRow(project.id, input.repo, input.number)
    if (inbox !== null) return { row: { ...inbox, inInbox: true }, readAt: null, notices: [] }
    const account = await this.options.account(project.root)
    const key = pullKeyOf(account, input.repo, input.number)
    const cached = this.pulls.get(key)
    const fresh = input.updatedAt == null ? cached !== undefined && this.now() - cached.readAt < PR_SEARCH_MEMORY_MS : cached?.row.updatedAt === input.updatedAt
    if (cached !== undefined && fresh && input.refresh !== true) {
      this.keep(key, cached)
      return { row: { ...cached.row, inInbox: false }, readAt: new Date(cached.readAt).toISOString(), notices: [] }
    }
    const before = { row: cached === undefined ? null : { ...cached.row, inInbox: false }, readAt: cached === undefined ? null : new Date(cached.readAt).toISOString() }
    const paused = this.options.rates.accountPause(account)
    if (paused !== null) return { ...before, notices: [notice('rate-limit', `Search paused until ${clockOf(paused.until)} (GitHub rate limit)`)] }
    let env: GhEnv
    try {
      env = await this.envOf(project.root, account)
    } catch (error) {
      return { ...before, notices: [notice('sign-in', `GitHub refused the sign-in: ${messageOf(error)}`)] }
    }
    const notices: PrSearchNotice[] = []
    await this.read([{ repo: input.repo, number: input.number }], project.root, env, account, this.viewers.get(account ?? '') ?? null, notices)
    const read = this.pulls.get(key)
    if (read === undefined) return { row: null, readAt: null, notices }
    return { row: { ...read.row, inInbox: false }, readAt: new Date(read.readAt).toISOString(), notices }
  }

  /** The rows of `found` in its order: the inbox's, the ones in memory, and the rest read, a details page at a time. */
  private async rowsOf(project: PrSearchProject, found: readonly Found[], viewer: string | null, env: GhEnv, account: string | null, notices: PrSearchNotice[]): Promise<PrSearchRow[]> {
    const wanted = found.filter((each) => {
      if (this.options.inboxRow(project.id, each.repo, each.number) !== null) return false
      return this.pulls.get(pullKeyOf(account, each.repo, each.number))?.row.updatedAt !== each.updatedAt
    })
    for (let at = 0; at < wanted.length; at += INBOX_DETAILS_PAGE) {
      if (!(await this.read(wanted.slice(at, at + INBOX_DETAILS_PAGE), project.root, env, account, viewer, notices))) break
    }
    const rows: PrSearchRow[] = []
    for (const each of found) {
      const inbox = this.options.inboxRow(project.id, each.repo, each.number)
      if (inbox !== null) {
        rows.push({ ...inbox, inInbox: true })
        continue
      }
      const kept = this.pulls.get(pullKeyOf(account, each.repo, each.number))
      if (kept !== undefined) rows.push({ ...kept.row, inInbox: false })
    }
    return rows
  }

  /**
   * Reads `page` with the inbox's details query into memory; a PR GitHub gives none of leaves it. False, with a
   * notice, when the call brought nothing (the rest of the page is not asked then).
   */
  private async read(page: readonly Omit<Found, 'updatedAt'>[], root: string, env: GhEnv, account: string | null, viewer: string | null, notices: PrSearchNotice[]): Promise<boolean> {
    const refs = page.map(({ repo, number }): PullRef => {
      const [owner = '', name = ''] = repo.split('/')
      return { owner, name, number }
    })
    const answer = await this.call(pullArgs(refs), root, env)
    const parsed = detailsSchema.safeParse(answer.json)
    const data = parsed.success ? parsed.data.data : null
    if (data == null) {
      const failure = failureOf(answer, this.now(), this.who(account), page.length === 1 ? page[0]!.repo : null) ?? { notice: notice('failed', githubWords(answer)), pauseUntil: null }
      if (failure.pauseUntil !== null) this.pauseFor(account, failure.pauseUntil)
      if (!notices.some((each) => each.kind === failure.notice.kind && each.text === failure.notice.text)) notices.push(failure.notice)
      return false
    }
    this.options.rates.noteAccountRate(account, data.rateLimit)
    const errors = parsed.success ? (parsed.data.errors ?? []) : []
    for (const [n, each] of page.entries()) {
      const key = pullKeyOf(account, each.repo, each.number)
      const pull = readPull(each.repo, (data[`p${n}`] as { pullRequest?: unknown } | null | undefined)?.pullRequest)
      if (pull === null) {
        this.pulls.delete(key)
        if (page.length === 1) notices.push(this.unreadable(answer, errors.map((error) => error.message).join(' '), each, account))
        continue
      }
      this.keep(key, { row: rowOf(pull, false, viewer, null), readAt: this.now() })
    }
    return true
  }

  /**
   * Why GitHub gave no PR (its alias null), from the words of its error: an organization's single sign-on, or a
   * repository or PR the account cannot see (GitHub answers so for a private one too).
   */
  private unreadable(answer: GhAnswer, words: string, pull: Omit<Found, 'updatedAt'>, account: string | null): PrSearchNotice {
    if (/\bSAML\b/u.test(words)) return failureOf({ ...answer, status: 403 }, this.now(), this.who(account), pull.repo)!.notice
    const what = /\bCould not resolve to a PullRequest\b/u.test(words) ? `${pull.repo}#${pull.number}` : pull.repo
    return notice('not-visible', `${what} is not visible to ${this.who(account)}`)
  }

  /** Keeps a PR in memory as the newest; the oldest goes past `pullsMax`. */
  private keep(key: string, pull: KeptPull): void {
    this.pulls.delete(key)
    this.pulls.set(key, pull)
    const max = this.options.pullsMax ?? PR_SEARCH_PULLS_MAX
    for (const oldest of this.pulls.keys()) {
      if (this.pulls.size <= max) break
      this.pulls.delete(oldest)
    }
  }

  /** GitHub refused a call for the rate limit: the account's search and PR inbox wait until `until`. */
  private pauseFor(account: string | null, until: number): void {
    this.options.rates.pauseAccount(account, until, `GitHub rate limit; the PR inbox and the search wait until ${new Date(until).toISOString()}`)
  }

  private who(account: string | null): string {
    return account ?? this.viewers.get('') ?? 'the account gh signs in with'
  }

  private async envOf(root: string, account: string | null): Promise<GhEnv> {
    return accountAuth({ account: () => Promise.resolve(account), run: this.options.run })(root)
  }

  private async call(args: readonly string[], root: string, env: GhEnv): Promise<GhAnswer> {
    try {
      return answerOf(await this.options.run(args, root, env, 'all'), '')
    } catch (error) {
      if (error instanceof GhExitError) return answerOf(error.output, error.message || 'gh failed')
      return { status: null, headers: new Map(), json: undefined, reason: messageOf(error) }
    }
  }
}

// ── saved searches ───────────────────────────────────────────────────────────

export const PR_SEARCHES_FILE = 'pr-searches.json'
/** The searches a user may save in a Project, the built-in ones aside. */
export const PR_SEARCHES_MAX = 20

/** The two searches every Project has (spec, implementation decisions 1); never stored, never forgotten. */
export const BUILT_IN_SEARCHES: readonly SavedSearch[] = [
  { id: 'built-in:review-requested', name: 'Review requested from me · All of GitHub', query: 'review-requested:@me is:open', scope: 'github', builtIn: true },
  { id: 'built-in:reviewed-by-me', name: 'Reviewed by me · open', query: 'reviewed-by:@me is:open', scope: 'project', builtIn: true },
]

const storedSearchSchema = z.object({ id: z.string().min(1), name: z.string().min(1), query: z.string(), scope: z.enum(PR_SEARCH_SCOPES) })
const storedSchema = z.object({ searches: z.array(storedSearchSchema) })

export function prSearchesPath(projectDataDir: string): string {
  return join(projectDataDir, PR_SEARCHES_FILE)
}

function stored(projectDataDir: string): z.output<typeof storedSchema>['searches'] {
  return readJsonFile(prSearchesPath(projectDataDir), storedSchema)?.searches ?? []
}

/** The built-in searches, then the user's in the order saved. */
export function savedSearches(projectDataDir: string): SavedSearch[] {
  return [...BUILT_IN_SEARCHES, ...stored(projectDataDir).map((each) => ({ ...each, builtIn: false }))]
}

/** Saves a search under `name`; one of the same name (any case) is replaced in its place. Throws past PR_SEARCHES_MAX. */
export function saveSearch(projectDataDir: string, search: { name: string; query: string; scope: PrSearchScope }, newId: () => string = randomUUID): SavedSearch[] {
  const name = search.name.trim()
  if (BUILT_IN_SEARCHES.some((each) => each.name.toLowerCase() === name.toLowerCase())) throw new Error(`"${name}" is the name of a built-in search`)
  const searches = stored(projectDataDir)
  const at = searches.findIndex((each) => each.name.toLowerCase() === name.toLowerCase())
  if (at < 0 && searches.length >= PR_SEARCHES_MAX) throw new Error(`a Project keeps at most ${PR_SEARCHES_MAX} saved searches; forget one first`)
  const entry = { id: at < 0 ? newId() : searches[at]!.id, name, query: search.query, scope: search.scope }
  const next = at < 0 ? [...searches, entry] : searches.map((each, index) => (index === at ? entry : each))
  writeJsonFile(prSearchesPath(projectDataDir), storedSchema, { searches: next })
  return savedSearches(projectDataDir)
}

/** Forgets a saved search of the user; a built-in one is refused, an unknown id changes nothing. */
export function forgetSearch(projectDataDir: string, id: string): SavedSearch[] {
  if (BUILT_IN_SEARCHES.some((each) => each.id === id)) throw new Error('a built-in search cannot be forgotten')
  const searches = stored(projectDataDir)
  if (searches.some((each) => each.id === id)) writeJsonFile(prSearchesPath(projectDataDir), storedSchema, { searches: searches.filter((each) => each.id !== id) })
  return savedSearches(projectDataDir)
}
