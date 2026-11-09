// The PR inbox of a Project (worfy-pr-inbox ticket 02): the open PRs of the user and the review requests to the user in
// the Project's repositories, read in main with gh, grouped by whose move it is. A reader of its own, beside the PR
// tracker of Ticket branches (src/main/github/prs.ts), which stays as it is.
//
// - Repositories: only the Project's — its layout's repositories, or its root for a Project of one — whose `origin`
//   is on github.com. Another repository of the same account is never named in a call.
// - Account: the Project's GitHub account (readGithubAccount → accountAuth): GH_TOKEN only in the environment of
//   the gh child. The global gh account is never switched. Every call goes through a GhRunner, which takes WORFY_GH,
//   so tests run a stand-in.
// - Search: one `gh api graphql` call with two `search(type: ISSUE)` fields, `review-requested:@me` and
//   `involves:@me`, over `repo:` of every repository; one page, only number, updatedAt, headRefOid and the
//   repository of each PR; with them the viewer's login and the rate limit.
// - Details: a second query only for the PRs whose `updatedAt` moved past what the cache holds, 10 PRs a call, without
//   `diffHunk` or `files` (large pages timed out with 504 on a big repository). CI finishing or a new conflict does
//   not move `updatedAt`, so a cached PR whose CI runs or whose mergeability GitHub had not computed yet is read again
//   too, at most one page of them per search. HTTP 502 or 504 — the same PRs again in two halves; HTTP 503 — the
//   same call again, at most twice; as harness/bin/review-history does. A PR GitHub cannot resolve (deleted, or
//   moved) fails the whole page in gh: the page's PRs are then read one by one, and that PR leaves the cache.
// - Pace: a search per Project every 5 minutes, focused or not. A failed read doubles the interval up to 30 minutes;
//   the first success brings back 5. An answer whose rate limit has less than 10 % left stops every call of that
//   account until its `resetAt`. `refresh(repo, number)` reads one PR's details out of turn (the notifications
//   trigger of ticket 08 calls it).
// - Cache: per account. Two Projects of one account never read the details of one PR twice. A PR no Project's last
//   search found, and every PR of a Project that left the list, leave it.
// - Off: `"prInbox": false` in the Project's settings.json, or no repository on GitHub — not one gh call.
//
// Read-only: a read runs only `gh auth token -u <account>` and `gh api graphql` with a `query`, never `--method`,
// never a `mutation` (ADR-0105: nothing reaches GitHub without the user's click). Texts of comments stay in this
// memory; `pr-inbox.json` (src/main/projects/pr-inbox-state.ts) gets ids, a sha and a time, and only on a mark.
import { setTimeout as sleep } from 'node:timers/promises'
import { z } from 'zod'
import type { CiState } from '../../shared/ipc/checks'
import { PR_INBOX_GROUPS, type PrInboxRow, type PrInboxSnapshot } from '../../shared/ipc/pr-inbox'
import { readPrInboxState, writeSeenPull } from '../projects/pr-inbox-state'
import { gitRunner, type GitRunner } from '../workflow/stages'
import { commentsOf, decisionOf, groupPulls, lastActivityOf, same, timeOf, type InboxComment, type InboxMember, type InboxPull } from './inbox-groups'
import { accountAuth, type GhEnv, type GhRunner } from './prs'
import { parseRemote } from './remote'

export const INBOX_SEARCH_INTERVAL_MS = 5 * 60_000
export const INBOX_MAX_INTERVAL_MS = 30 * 60_000
/** How often the app's timer looks for a Project whose search is due. */
export const INBOX_TICK_MS = 30_000
export const INBOX_SEARCH_LIMIT = 100
export const INBOX_DETAILS_PAGE = 10
/** Below this share of the rate limit left, the account's calls wait for `resetAt`. */
export const RATE_LIMIT_FLOOR = 0.1
/** Retries of one call after HTTP 503, or after 502/504 on a page of one PR. */
const RETRIES = 2
const RETRY_WAIT_MS = 5_000

// ── the queries ──────────────────────────────────────────────────────────────

const RATE = 'rateLimit { limit remaining resetAt }'
const FOUND = '... on PullRequest { number updatedAt headRefOid repository { nameWithOwner } }'
export const SEARCH_QUERY = `query($review: String!, $involves: String!) { viewer { login } ${RATE} review: search(query: $review, type: ISSUE, first: ${INBOX_SEARCH_LIMIT}) { nodes { ${FOUND} } } involves: search(query: $involves, type: ISSUE, first: ${INBOX_SEARCH_LIMIT}) { nodes { ${FOUND} } } }`

const COMMENT = 'id databaseId author { login } body createdAt url'
export const PULL_FIELDS = [
  'number title url state isDraft createdAt updatedAt headRefName headRefOid reviewDecision mergeable mergeStateStatus',
  'author { login }',
  'commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }',
  'reviewRequests(first: 10) { nodes { requestedReviewer { __typename ... on User { login } ... on Team { slug } } } }',
  'latestOpinionatedReviews(first: 10) { nodes { author { login } state submittedAt } }',
  `reviewThreads(first: 50) { nodes { id isResolved isOutdated path line viewerCanReply comments(last: 3) { nodes { ${COMMENT} } } } }`,
  `comments(last: 5) { nodes { ${COMMENT} } }`,
].join(' ')

/** The search strings of a Project over `repos` (`owner/name`). */
// shortcut: one search names every repository, so a Project of very many repositories may pass GitHub's 256-character limit of a search; split `repos` into several searches when such a Project appears.
export function searchTerms(repos: readonly string[]): { review: string; involves: string } {
  const scope = `is:pr is:open archived:false ${repos.map((repo) => `repo:${repo}`).join(' ')}`
  return { review: `${scope} review-requested:@me`, involves: `${scope} involves:@me` }
}

export function searchArgs(repos: readonly string[]): string[] {
  const terms = searchTerms(repos)
  return ['api', 'graphql', '-f', `query=${SEARCH_QUERY}`, '-f', `review=${terms.review}`, '-f', `involves=${terms.involves}`]
}

/** A PR by its repository and number; `key` is `owner/name#N` in lower case. */
export interface PullRef {
  owner: string
  name: string
  number: number
}

const keyOf = (repo: string, number: number): string => `${repo.toLowerCase()}#${number}`

/** The details query of up to INBOX_DETAILS_PAGE PRs: alias `pN` from the variables `oN`, `nN`, `kN`. */
export function detailsArgs(page: readonly PullRef[]): string[] {
  const declared = page.map((_, n) => `$o${n}: String!, $n${n}: String!, $k${n}: Int!`).join(', ')
  const fields = page.map((_, n) => `p${n}: repository(owner: $o${n}, name: $n${n}) { pullRequest(number: $k${n}) { ${PULL_FIELDS} } }`).join(' ')
  const vars = page.flatMap((ref, n) => ['-f', `o${n}=${ref.owner}`, '-f', `n${n}=${ref.name}`, '-F', `k${n}=${ref.number}`])
  return ['api', 'graphql', '-f', `query=query(${declared}) { ${RATE} ${fields} }`, ...vars]
}

// ── the answers ──────────────────────────────────────────────────────────────

const rateSchema = z.object({ limit: z.number(), remaining: z.number(), resetAt: z.string() }).nullish().catch(null)
const loginSchema = z
  .object({ login: z.string() })
  .nullish()
  .catch(null)
  .transform((actor) => actor?.login ?? null)
const nodes = <T extends z.ZodType>(item: T) =>
  z
    .object({ nodes: z.array(item.nullable().catch(null)).nullish() })
    .nullish()
    .transform((connection) => (connection?.nodes ?? []).filter((node): node is NonNullable<z.output<T>> => node != null))

const commentSchema = z
  .object({ id: z.string(), databaseId: z.number().int().nullish().catch(null), author: loginSchema, body: z.string().catch(''), createdAt: z.string(), url: z.string().catch('') })
  .transform((comment): InboxComment => ({ ...comment, databaseId: comment.databaseId ?? null }))

const ROLLUP: Record<string, CiState> = { SUCCESS: 'passing', FAILURE: 'failing', ERROR: 'failing', PENDING: 'running', EXPECTED: 'running' }

const pullSchema = z.object({
  number: z.number().int().positive(),
  title: z.string(),
  url: z.string(),
  state: z.enum(['OPEN', 'CLOSED', 'MERGED']),
  isDraft: z.boolean().catch(false),
  createdAt: z.string(),
  updatedAt: z.string(),
  headRefName: z.string().catch(''),
  headRefOid: z.string().nullish().catch(null),
  reviewDecision: z.string().nullish().catch(null),
  mergeable: z.string().nullish().catch(null),
  mergeStateStatus: z.string().nullish().catch(null),
  author: loginSchema,
  commits: nodes(z.object({ commit: z.object({ statusCheckRollup: z.object({ state: z.string() }).nullish().catch(null) }) })),
  reviewRequests: nodes(z.object({ requestedReviewer: z.object({ __typename: z.string().optional(), login: z.string().optional(), slug: z.string().optional() }).nullish() })),
  latestOpinionatedReviews: nodes(z.object({ author: loginSchema, state: z.string(), submittedAt: z.string().nullish().catch(null) })),
  reviewThreads: nodes(
    z.object({
      id: z.string(),
      isResolved: z.boolean().catch(false),
      isOutdated: z.boolean().catch(false),
      path: z.string().nullish().catch(null),
      line: z.number().int().nullish().catch(null),
      viewerCanReply: z.boolean().catch(false),
      comments: nodes(commentSchema),
    }),
  ),
  comments: nodes(commentSchema),
})

function toPull(repo: string, raw: z.output<typeof pullSchema>): InboxPull {
  const rollup = raw.commits.at(-1)?.commit.statusCheckRollup?.state
  return {
    repo,
    number: raw.number,
    title: raw.title,
    url: raw.url,
    state: raw.state,
    isDraft: raw.isDraft,
    author: raw.author,
    headRefName: raw.headRefName,
    headRefOid: raw.headRefOid ?? null,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    reviewDecision: raw.reviewDecision ?? null,
    mergeable: raw.mergeable ?? null,
    mergeStateStatus: raw.mergeStateStatus ?? null,
    ci: rollup === undefined ? null : (ROLLUP[rollup] ?? null),
    reviewRequests: raw.reviewRequests.map(({ requestedReviewer: who }) => ({ login: who?.login ?? null, team: who?.slug ?? null })),
    reviews: raw.latestOpinionatedReviews.map((review) => ({ author: review.author, state: review.state, submittedAt: review.submittedAt ?? null })),
    threads: raw.reviewThreads.map((thread) => ({ ...thread, path: thread.path ?? null, line: thread.line ?? null })),
    comments: raw.comments,
  }
}

const foundSchema = z.object({ number: z.number().int().positive(), updatedAt: z.string(), repository: z.object({ nameWithOwner: z.string() }) })
const searchSchema = z.object({
  data: z.object({
    viewer: z.object({ login: z.string() }),
    rateLimit: rateSchema,
    review: z.object({ nodes: z.array(z.unknown()).catch([]) }),
    involves: z.object({ nodes: z.array(z.unknown()).catch([]) }),
  }),
})

type Rate = z.output<typeof rateSchema>

/** What a failure of gh says about GitHub's side: a timeout a lighter page may get past, a 503, or neither. */
function failureOf(reason: string): 'timeout' | 'unavailable' | null {
  if (/\bHTTP 50[24]\b|may be the result of a timeout|unexpected end of JSON input/iu.test(reason)) return 'timeout'
  if (/\bHTTP 503\b/u.test(reason)) return 'unavailable'
  return null
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** gh's reason for a GraphQL NOT_FOUND: a PR or repository of the page GitHub cannot resolve, which fails the whole call. */
const UNRESOLVED = /\bCould not resolve to a (?:PullRequest|Repository)\b/u

/** Whether GitHub may give a cached PR another answer without moving its `updatedAt`: CI runs, or mergeability is not computed yet. */
const unsettled = (pull: InboxPull): boolean => pull.ci === 'running' || pull.mergeStateStatus === null || pull.mergeStateStatus === 'UNKNOWN'

// ── the reader ───────────────────────────────────────────────────────────────

/** A Project of this Machine as the reader sees it. */
export interface PrInboxProject {
  id: string
  root: string
  /** The Project's data folder: settings.json and pr-inbox.json. */
  dataDir: string
}

export interface PrInboxOptions {
  run: GhRunner
  /** The Projects of this Machine. */
  projects: () => readonly PrInboxProject[]
  /** Whether the Project's settings let the inbox read (prInboxSetting of src/main/projects/pr-inbox-state.ts). */
  enabled: (project: PrInboxProject) => boolean
  /** The Project's GitHub account (readGithubAccount); null — gh's own account. */
  account: (root: string) => Promise<string | null>
  /** The Project's repositories on GitHub, `owner/name` (remoteRepos). */
  repos: (root: string) => Promise<readonly string[]>
  /** A Project's inbox changed: a read answered, a PR was refreshed or marked seen. */
  onChange?: (projectId: string) => void
  now?: () => number
  /** The pause before the n-th retry is n times this; 5 s by default. */
  retryWaitMs?: number
  searchIntervalMs?: number
  maxIntervalMs?: number
}

interface CachedPull {
  pull: InboxPull
}

interface AccountCache {
  viewer: string | null
  pulls: Map<string, CachedPull>
  /** No call of this account before this time: set by a rate limit below RATE_LIMIT_FLOOR. */
  pausedUntil: number
  pauseReason: string | null
}

interface ProjectState {
  /** The account's cache key: its login, '' for gh's own account. */
  account: string | null
  repos: string[]
  /** The PRs the last search found, by key, with their `updatedAt` then and whether a review is asked. */
  members: Map<string, { updatedAt: string; reviewRequested: boolean }>
  enabled: boolean
  readAt: number | null
  nextAt: number
  intervalMs: number
  error: string | null
  running: Promise<void> | null
}

export class PrInbox {
  private readonly states = new Map<string, ProjectState>()
  private readonly accounts = new Map<string, AccountCache>()
  private readonly now: () => number
  private readonly base: number
  private readonly max: number
  private ticking = false

  constructor(private readonly options: PrInboxOptions) {
    this.now = options.now ?? Date.now
    this.base = options.searchIntervalMs ?? INBOX_SEARCH_INTERVAL_MS
    this.max = options.maxIntervalMs ?? INBOX_MAX_INTERVAL_MS
  }

  /** Reads every Project whose search is due, one after another, so a second Project of an account finds the first one's details. */
  async tick(): Promise<void> {
    if (this.ticking) return
    this.ticking = true
    try {
      const projects = this.options.projects()
      this.forget(new Set(projects.map((project) => project.id)))
      for (const project of projects) await this.pollIfDue(project)
    } finally {
      this.ticking = false
    }
  }

  /** Reads the Project now if it was never read, as the first `prInbox.get` asks. */
  async ensureRead(projectId: string): Promise<void> {
    const project = this.projectOf(projectId)
    const state = this.states.get(projectId)
    if (state?.running) return state.running
    if (state === undefined) await this.pollIfDue(project)
  }

  /** The timer of the app: a look every `everyMs`; returns its stop. */
  start(everyMs = INBOX_TICK_MS): () => void {
    const timer = setInterval(() => void this.tick().catch((error: unknown) => console.warn('[pr-inbox] a read failed', error)), everyMs)
    timer.unref?.()
    return () => clearInterval(timer)
  }

  /**
   * Reads the details of one PR now, outside the search queue, for every account whose Projects read `repo`; a PR the
   * last search did not find joins those Projects until the next search. Nothing for a repository no Project reads,
   * a Project that is off or never read, or an account waiting for its rate limit.
   */
  async refresh(repo: string, number: number): Promise<void> {
    const key = keyOf(repo, number)
    const [owner = '', name = ''] = repo.split('/')
    const byAccount = new Map<string, { project: PrInboxProject; state: ProjectState }[]>()
    for (const project of this.options.projects()) {
      const state = this.states.get(project.id)
      if (state === undefined || !state.enabled || !this.options.enabled(project)) continue
      if (!state.repos.some((each) => each.toLowerCase() === repo.toLowerCase())) continue
      const account = state.account ?? ''
      byAccount.set(account, [...(byAccount.get(account) ?? []), { project, state }])
    }
    for (const [account, readers] of byAccount) {
      const cache = this.cacheOf(account)
      if (cache.pausedUntil > this.now()) continue
      const [first] = readers
      try {
        const env = await this.envOf(first!.project.root, first!.state.account)
        await this.readPage([{ owner, name, number }], first!.project.root, env, cache, new Map([[key, repo]]))
      } catch (error) {
        for (const { state } of readers) state.error = messageOf(error)
      }
      const pull = cache.pulls.get(key)?.pull
      for (const { project, state } of readers) {
        if (pull === undefined || pull.state !== 'OPEN') state.members.delete(key)
        else if (!state.members.has(key)) state.members.set(key, { updatedAt: pull.updatedAt, reviewRequested: cache.viewer !== null && pull.reviewRequests.some((request) => same(request.login, cache.viewer!)) })
        this.options.onChange?.(project.id)
      }
    }
  }

  /** The Project's inbox as last read. */
  snapshot(projectId: string): PrInboxSnapshot {
    const project = this.projectOf(projectId)
    const state = this.states.get(projectId)
    const on = this.options.enabled(project) && (state?.enabled ?? true)
    const cache = state ? this.accounts.get(state.account ?? '') : undefined
    const viewer = cache?.viewer ?? null
    const members: InboxMember[] = []
    if (on && state && cache) {
      for (const [key, member] of state.members) {
        const cached = cache.pulls.get(key)
        if (cached) members.push({ pull: cached.pull, reviewRequested: member.reviewRequested })
      }
    }
    const seen = members.length > 0 ? readPrInboxState(project.dataDir).pulls : {}
    const grouped = groupPulls(members, viewer ?? '')
    return {
      projectId,
      enabled: on,
      viewer,
      groups: PR_INBOX_GROUPS.map((group) => ({ group, rows: grouped.get(group)!.map(({ pull, viaTeam }) => rowOf(pull, viaTeam, viewer, seen[keyOf(pull.repo, pull.number)]?.seenAt ?? null)) })),
      readAt: state?.readAt == null ? null : new Date(state.readAt).toISOString(),
      nextSearchAt: on && state ? new Date(state.nextAt).toISOString() : null,
      error: on ? (state?.error ?? null) : null,
      notice: null,
    }
  }

  /** The user has seen the PR now: its head commit and newest comment go into pr-inbox.json, with the time. */
  markSeen(projectId: string, repo: string, number: number): PrInboxSnapshot {
    const project = this.projectOf(projectId)
    const key = keyOf(repo, number)
    const state = this.states.get(projectId)
    const pull = state?.members.has(key) ? this.accounts.get(state.account ?? '')?.pulls.get(key)?.pull : undefined
    if (pull === undefined) throw new Error(`${repo}#${number} is not in the PR inbox of this Project`)
    const newest = commentsOf(pull).sort((a, b) => timeOf(a.createdAt) - timeOf(b.createdAt)).at(-1)
    writeSeenPull(project.dataDir, key, { seenAt: new Date(this.now()).toISOString(), seenHeadOid: pull.headRefOid, lastSeenCommentId: newest?.id ?? null })
    this.options.onChange?.(projectId)
    return this.snapshot(projectId)
  }

  private projectOf(projectId: string): PrInboxProject {
    const project = this.options.projects().find((each) => each.id === projectId)
    if (project === undefined) throw new Error(`${projectId} is not a Project of this Machine`)
    return project
  }

  private stateOf(projectId: string): ProjectState {
    let state = this.states.get(projectId)
    if (state === undefined) {
      state = { account: null, repos: [], members: new Map(), enabled: true, readAt: null, nextAt: -Infinity, intervalMs: this.base, error: null, running: null }
      this.states.set(projectId, state)
    }
    return state
  }

  private cacheOf(account: string): AccountCache {
    let cache = this.accounts.get(account)
    if (cache === undefined) {
      cache = { viewer: null, pulls: new Map(), pausedUntil: -Infinity, pauseReason: null }
      this.accounts.set(account, cache)
    }
    return cache
  }

  private async pollIfDue(project: PrInboxProject): Promise<void> {
    const state = this.stateOf(project.id)
    if (!this.options.enabled(project)) {
      state.enabled = false
      state.members.clear()
      // Read at once when it is turned on again.
      state.nextAt = -Infinity
      return
    }
    if (state.running) return state.running
    if (this.now() < state.nextAt) return
    state.running = this.poll(project, state).finally(() => {
      state.running = null
    })
    return state.running
  }

  private async envOf(root: string, account: string | null): Promise<GhEnv> {
    return accountAuth({ account: () => Promise.resolve(account), run: this.options.run })(root)
  }

  private async poll(project: PrInboxProject, state: ProjectState): Promise<void> {
    const now = this.now()
    try {
      state.repos = [...new Set(await this.options.repos(project.root))]
    } catch {
      state.repos = []
    }
    if (state.repos.length === 0) {
      // No repository on GitHub: off until the next look, without a gh call.
      state.enabled = false
      state.members.clear()
      state.nextAt = now + this.base
      this.options.onChange?.(project.id)
      return
    }
    state.enabled = true
    let cache: AccountCache | undefined
    try {
      state.account = await this.options.account(project.root)
      cache = this.cacheOf(state.account ?? '')
      if (cache.pausedUntil > now) {
        state.error = cache.pauseReason
      } else {
        const env = await this.envOf(project.root, state.account)
        await this.search(project.root, state, env, cache)
        state.readAt = now
        const moved = [...state.members].filter(([key, member]) => {
          const cached = cache!.pulls.get(key)
          return cached === undefined || timeOf(member.updatedAt) > timeOf(cached.pull.updatedAt)
        })
        // CI finishing or a new conflict does not move updatedAt: such PRs are read again too, one page at most.
        const movedKeys = new Set(moved.map(([key]) => key))
        const settling = [...state.members].filter(([key]) => !movedKeys.has(key) && unsettled(cache!.pulls.get(key)!.pull)).slice(0, INBOX_DETAILS_PAGE)
        const stale = [...moved, ...settling]
        const repos = new Map(stale.map(([key]) => [key, this.repoOfKey(key, state)]))
        const refs = stale.map(([key]) => refOf(key, repos.get(key)!))
        for (let at = 0; at < refs.length && cache.pausedUntil <= now; at += INBOX_DETAILS_PAGE) {
          await this.readPage(refs.slice(at, at + INBOX_DETAILS_PAGE), project.root, env, cache, repos)
        }
        state.intervalMs = this.base
        state.error = cache.pausedUntil > now ? cache.pauseReason : null
      }
    } catch (error) {
      state.error = messageOf(error)
      state.intervalMs = Math.min(state.intervalMs * 2, this.max)
    }
    state.nextAt = Math.max(now + state.intervalMs, cache?.pausedUntil ?? -Infinity)
    this.prune()
    this.options.onChange?.(project.id)
  }

  /** The repository of a found PR as GitHub spelled it. */
  private repoOfKey(key: string, state: ProjectState): string {
    const slug = key.slice(0, key.lastIndexOf('#'))
    return state.repos.find((repo) => repo.toLowerCase() === slug) ?? slug
  }

  /** Runs a call; on HTTP 503 or a timeout, again after a pause, at most RETRIES times. */
  private async withRetries(call: () => Promise<string>, retryOn: (kind: 'timeout' | 'unavailable') => boolean): Promise<string> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await call()
      } catch (error) {
        const kind = failureOf(messageOf(error))
        if (kind === null || !retryOn(kind) || attempt >= RETRIES) throw error
        await sleep((this.options.retryWaitMs ?? RETRY_WAIT_MS) * (attempt + 1))
      }
    }
  }

  private async search(root: string, state: ProjectState, env: GhEnv, cache: AccountCache): Promise<void> {
    const stdout = await this.withRetries(() => this.options.run(searchArgs(state.repos), root, env), () => true)
    const { data } = searchSchema.parse(JSON.parse(stdout))
    cache.viewer = data.viewer.login
    this.noteRate(cache, data.rateLimit)
    const ours = new Set(state.repos.map((repo) => repo.toLowerCase()))
    const members = new Map<string, { updatedAt: string; reviewRequested: boolean }>()
    for (const [nodes, reviewRequested] of [
      [data.involves.nodes, false],
      [data.review.nodes, true],
    ] as const) {
      for (const node of nodes) {
        const found = foundSchema.safeParse(node)
        // An issue of the search, or a repository outside the Project.
        if (!found.success || !ours.has(found.data.repository.nameWithOwner.toLowerCase())) continue
        const key = keyOf(found.data.repository.nameWithOwner, found.data.number)
        members.set(key, { updatedAt: found.data.updatedAt, reviewRequested: reviewRequested || (members.get(key)?.reviewRequested ?? false) })
      }
    }
    state.members = members
  }

  /**
   * The details of `page` into the cache. A timeout (HTTP 502 or 504) asks the same PRs again in two halves, down to
   * one PR, which is then asked again like a 503: at most RETRIES times. A PR GitHub cannot resolve fails the whole
   * call in gh: the page's PRs are asked one by one, and the one that cannot be resolved leaves the cache.
   */
  private async readPage(page: readonly PullRef[], root: string, env: GhEnv, cache: AccountCache, repos: ReadonlyMap<string, string>): Promise<void> {
    let stdout: string
    try {
      stdout = await this.withRetries(() => this.options.run(detailsArgs(page), root, env), (kind) => kind === 'unavailable' || page.length === 1)
    } catch (error) {
      const reason = messageOf(error)
      if (UNRESOLVED.test(reason)) {
        if (page.length === 1) cache.pulls.delete(keyOf(`${page[0]!.owner}/${page[0]!.name}`, page[0]!.number))
        else for (const ref of page) await this.readPage([ref], root, env, cache, repos)
        return
      }
      if (failureOf(reason) !== 'timeout' || page.length === 1) throw error
      const half = Math.ceil(page.length / 2)
      await this.readPage(page.slice(0, half), root, env, cache, repos)
      await this.readPage(page.slice(half), root, env, cache, repos)
      return
    }
    const json = z.object({ data: z.record(z.string(), z.unknown()) }).parse(JSON.parse(stdout))
    this.noteRate(cache, rateSchema.parse(json.data.rateLimit))
    for (const [n, ref] of page.entries()) {
      const key = keyOf(`${ref.owner}/${ref.name}`, ref.number)
      const raw = (json.data[`p${n}`] as { pullRequest?: unknown } | null | undefined)?.pullRequest
      const parsed = pullSchema.safeParse(raw)
      if (parsed.success) cache.pulls.set(key, { pull: toPull(repos.get(key) ?? `${ref.owner}/${ref.name}`, parsed.data) })
      else cache.pulls.delete(key)
    }
  }

  private noteRate(cache: AccountCache, rate: Rate): void {
    if (rate == null || rate.limit <= 0 || rate.remaining >= rate.limit * RATE_LIMIT_FLOOR) return
    const reset = timeOf(rate.resetAt)
    if (Number.isNaN(reset)) return
    cache.pausedUntil = reset
    cache.pauseReason = `GitHub rate limit: ${rate.remaining} of ${rate.limit} left; the PR inbox waits until ${rate.resetAt}`
  }

  /** Drops the state of every Project not in `listed` (removed from the list), and with it the details only it kept. */
  private forget(listed: ReadonlySet<string>): void {
    const before = this.states.size
    for (const id of this.states.keys()) if (!listed.has(id)) this.states.delete(id)
    if (this.states.size !== before) this.prune()
  }

  /** Drops the details no Project's last search found, account by account. */
  private prune(): void {
    for (const [account, cache] of this.accounts) {
      const wanted = new Set([...this.states.values()].filter((state) => (state.account ?? '') === account).flatMap((state) => [...state.members.keys()]))
      for (const key of cache.pulls.keys()) if (!wanted.has(key)) cache.pulls.delete(key)
    }
  }
}

function refOf(key: string, repo: string): PullRef {
  const [owner = '', name = ''] = repo.split('/')
  return { owner, name, number: Number(key.slice(key.lastIndexOf('#') + 1)) }
}

function rowOf(pull: InboxPull, viaTeam: boolean, viewer: string | null, seenAt: string | null): PrInboxRow {
  const since = timeOf(seenAt)
  const fresh = commentsOf(pull).filter((comment) => (viewer === null || !same(comment.author, viewer)) && (Number.isNaN(since) || timeOf(comment.createdAt) > since))
  return {
    repo: pull.repo,
    number: pull.number,
    title: pull.title,
    url: pull.url,
    isDraft: pull.isDraft,
    author: pull.author,
    headRefName: pull.headRefName,
    headRefOid: pull.headRefOid,
    createdAt: pull.createdAt,
    updatedAt: pull.updatedAt,
    ci: pull.ci,
    reviewDecision: decisionOf(pull),
    mergeStateStatus: pull.mergeStateStatus,
    viaTeam,
    unresolvedThreads: pull.threads.filter((thread) => !thread.isResolved).length,
    newSinceSeen: fresh.length,
    lastActivityAt: lastActivityOf(pull),
    threads: pull.threads,
    comments: pull.comments,
  }
}

/**
 * The repositories on github.com among `folders`, as `owner/name` of their `origin`, each once. A folder without
 * `origin`, or with one elsewhere, is left out.
 */
// shortcut: github.com only; a GitHub Enterprise remote is left out, since its gh calls would need `--hostname`; add it when a Project on such a server asks for the inbox.
export async function remoteRepos(folders: readonly string[], git: GitRunner = gitRunner): Promise<string[]> {
  const repos: string[] = []
  for (const folder of folders) {
    const origin = await git(folder, ['remote', 'get-url', 'origin']).catch(() => null)
    const remote = origin?.code === 0 ? parseRemote(origin.stdout) : null
    if (remote === null || remote.host !== 'github.com') continue
    const slug = `${remote.owner}/${remote.repo}`
    if (!repos.some((repo) => repo.toLowerCase() === slug.toLowerCase())) repos.push(slug)
  }
  return repos
}
