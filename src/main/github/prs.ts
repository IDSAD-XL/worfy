// Pull requests and CI of a Project's Ticket branches, read with `gh` (ticket 17).
//
// One `gh pr list --state all --limit 100` per interval (60 s) in the Project's root: without
// `--limit`, gh returns only the 30 latest PRs, which is too few for a busy repository. A Ticket
// branch missing from that list is looked up on its own with `--head <branch> --limit 1`, at most
// once per 5 minutes per branch. `--head` matches the branch name exactly; a `--search head:<branch>`
// query would match by prefix (`demo/1` finds `demo/18`), and with `--limit 1` that other branch's PR
// would hide the one sought. When gh fails (not installed, not logged in, no network)
// the answer is "gh unavailable" and the interval doubles, up to MAX_INTERVAL_MS; the first
// success brings it back to the base interval. Failures are not logged one by one.
//
// When the Project's Profile names its GitHub account (ADR-0020, worfy-week ticket 01), every gh
// call of a read goes with GH_TOKEN of that account, taken once per read with
// `gh auth token -u <account>`: the global gh account belongs to the user and other sessions and
// is never switched. The token lives only in the environment of the gh child processes of that
// read; it is not kept between reads, logged or put into an answer.
//
// Read-only: the only gh commands ever run are `gh pr list` and `gh auth token -u <account>`.
// Nothing is written to GitHub, to the Project, to the gh config or to the Claude home.
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { z } from 'zod'
import { NARROW_TEXT_MAX, type CiState, type GhStatus, type NarrowState, type PullRequest } from '../../shared/ipc/checks'
import { programStart } from '../program'

export const BASE_INTERVAL_MS = 60_000
export const SEARCH_INTERVAL_MS = 5 * 60_000
export const MAX_INTERVAL_MS = 32 * 60_000
export const LIST_LIMIT = 100
/** Branch searches started in one read, so a Project with many branches does not burst gh. */
export const SEARCHES_PER_READ = 10

const FIELDS = 'number,headRefName,state,url,statusCheckRollup,comments'

/** Variables a gh call gets on top of the runner's environment, e.g. GH_TOKEN of the Project's account. */
export type GhEnv = Readonly<Record<string, string>>

/** Runs `gh <args>` in `cwd`, with `env` added to its environment, and resolves its stdout; rejects with a short reason. */
export type GhRunner = (args: readonly string[], cwd: string, env?: GhEnv) => Promise<string>

export interface GhRunnerOptions {
  /** The gh executable; `gh` from PATH by default. WORFY_GH points tests at a stub. */
  command?: string
  /** Environment for gh, e.g. the login shell's (src/main/agent/env.ts) so PATH and auth are found. */
  env?: () => Promise<Record<string, string | undefined>>
  timeoutMs?: number
}

const firstLine = (text: string): string => text.trim().split('\n')[0]?.trim() ?? ''
const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/**
 * The default runner: gh as a child process, never through a shell. A `command` that is a `.mjs`
 * script (a stand-in in tests) runs under worfy's own Node (src/main/program.ts).
 */
export function ghRunner(options: GhRunnerOptions = {}): GhRunner {
  const command = options.command ?? 'gh'
  const start = programStart(options.command, 'gh')
  return async (args, cwd, extra = {}) => {
    const env = options.env ? await options.env() : process.env
    // A script started under worfy's own Node: the system cannot say it is missing, Node would.
    const [script] = start.args
    if (script !== undefined && !existsSync(script)) throw new Error(`gh not found (${command})`)
    return new Promise((resolve, reject) => {
      execFile(
        start.file,
        [...start.args, ...args],
        { cwd, env: { ...env, ...extra, GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1', NO_COLOR: '1', ...start.env }, encoding: 'utf8', timeout: options.timeoutMs ?? 30_000, maxBuffer: 32 * 1024 * 1024 },
        (error, stdout, stderr) => {
          if (!error) return resolve(stdout)
          const code = (error as NodeJS.ErrnoException).code
          if (code === 'ENOENT') return reject(new Error(`gh not found (${command})`))
          reject(new Error(firstLine(stderr) || error.message))
        },
      )
    })
  }
}

// ── the Project's account ────────────────────────────────────────────────────

/**
 * The extra environment gh gets for the Project at `root`; rejects when gh cannot be run as the
 * Project's account, and then no gh command of that read runs.
 */
export type GhAuth = (root: string) => Promise<GhEnv>

export interface AccountAuthOptions {
  /** The Project's GitHub account, or null when it has none (src/main/workflow/profile.ts). */
  account: (root: string) => Promise<string | null>
  /** The runner `gh auth token -u <account>` goes through: the same gh and environment as pr list. */
  run: GhRunner
}

/** A token as gh prints it: one word, no whitespace. */
const TOKEN_SHAPE = /^\S+$/u

/**
 * GH_TOKEN of the Project's account, from `gh auth token -u <account>`. Without an account, no
 * extra environment: gh runs as before, with the login shell's own account. With an account gh has
 * no login for, the read fails with a reason naming the account — falling back to the global
 * account would show another account's answer or the same refusal.
 */
export function accountAuth(options: AccountAuthOptions): GhAuth {
  return async (root): Promise<GhEnv> => {
    const account = await options.account(root)
    if (account === null) return {}
    const how = `run \`gh auth login\` and sign in as ${account}`
    let printed: string
    try {
      printed = await options.run(['auth', 'token', '-u', account], root)
    } catch (error) {
      // gh's own reason (no login, gh not found); it never contains a token.
      throw new Error(`no gh login for ${account}, the Project's GitHub account: ${messageOf(error)}; ${how}`, { cause: error })
    }
    const token = printed.trim()
    // The output is not quoted in the reason: it may be a token in an unexpected shape.
    if (!TOKEN_SHAPE.test(token)) throw new Error(`gh auth token -u ${account} printed no token; ${how}`)
    return { GH_TOKEN: token }
  }
}

// ── the answer of gh ─────────────────────────────────────────────────────────

const checkSchema = z
  .object({
    __typename: z.string().optional(),
    context: z.string().nullish(),
    status: z.string().nullish(),
    conclusion: z.string().nullish(),
    state: z.string().nullish(),
  })
  .loose()

const commentSchema = z.object({ body: z.string().catch(''), createdAt: z.string().optional().catch(undefined) }).loose()

const ghPullSchema = z
  .object({
    number: z.number().int().positive(),
    headRefName: z.string(),
    state: z.enum(['OPEN', 'CLOSED', 'MERGED']),
    url: z.string(),
    statusCheckRollup: z.array(checkSchema).nullish().catch(null),
    comments: z.array(commentSchema).nullish().catch(null),
  })
  .loose()

const FAILED = new Set(['FAILURE', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE', 'ERROR'])
const PENDING_STATES = new Set(['PENDING', 'EXPECTED'])

/**
 * The contexts of the agents' marks (ADR-0067): commit statuses that are not CI. `check/*` is every
 * `check/<name>`. The same list `harness/bin/ticket mark --contexts` prints; a contract test holds the two together.
 */
export const MARK_CONTEXTS = ['review', 'check/*', 'deploy'] as const

const isMark = (context: string | null | undefined): boolean =>
  context != null && MARK_CONTEXTS.some((mark) => (mark.endsWith('/*') ? context.startsWith(mark.slice(0, -1)) && context.length > mark.length - 1 : context === mark))

/**
 * CI of a PR in three words: failing if any check failed, else running if any is not done, else passing.
 * The agents' marks are left out: a `review` failure is a verdict, not red CI.
 */
export function ciOf(rollup: readonly z.infer<typeof checkSchema>[] | null | undefined): CiState | null {
  const checks = (rollup ?? []).filter((check) => !(check.state != null && check.status == null && isMark(check.context)))
  if (checks.length === 0) return null
  let running = false
  for (const check of checks) {
    if (check.state != null && check.status == null) {
      // A commit status (StatusContext): SUCCESS | PENDING | EXPECTED | FAILURE | ERROR.
      if (FAILED.has(check.state)) return 'failing'
      if (PENDING_STATES.has(check.state)) running = true
      continue
    }
    // A check run: status QUEUED | IN_PROGRESS | COMPLETED | …, conclusion when completed.
    if (check.status !== 'COMPLETED') {
      running = true
      continue
    }
    if (check.conclusion != null && FAILED.has(check.conclusion)) return 'failing'
  }
  return running ? 'running' : 'passing'
}

// The narrow round's verdicts (worfy-harness ticket 20) carry the prefix `NARROW: `; the gate's
// own verdict word follows it.
const VERDICT = /^(?:NARROW:\s*)?(VERIFIED|REJECTED)\b/u

/**
 * The reviewer's verdict: the last comment whose first line starts with VERIFIED or REJECTED, or
 * with the narrow round's NARROW: VERIFIED or NARROW: REJECTED.
 */
export function verdictOf(comments: readonly { body: string }[] | null | undefined): 'VERIFIED' | 'REJECTED' | null {
  let verdict: 'VERIFIED' | 'REJECTED' | null = null
  for (const comment of comments ?? []) {
    const match = VERDICT.exec(firstLine(comment.body))
    if (match) verdict = match[1] as 'VERIFIED' | 'REJECTED'
  }
  return verdict
}

const NARROW = /^NARROW:(.*)$/u

/** The first line kept to NARROW_TEXT_MAX UTF-16 units, without half of a surrogate pair at the cut. */
function clipLine(line: string): string {
  if (line.length <= NARROW_TEXT_MAX) return line
  const cut = line.slice(0, NARROW_TEXT_MAX)
  const last = cut.charCodeAt(cut.length - 1)
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut
}

/**
 * Every state of the narrow fix rounds of a PR, oldest first (worfy-harness ticket 20, ADR-0046):
 * each comment whose first line starts with `NARROW:` — `NARROW: VERIFIED` is `verified`,
 * `NARROW: REJECTED…` is `rejected`, anything else (`NARROW: <findings>`) is `started` — with that
 * first line and the comment's `createdAt`. worfy reads only the prefix the /epic-wave skill writes
 * its verdicts with; the findings are not parsed.
 */
export function narrowRoundsOf(comments: readonly { body: string; createdAt?: string | undefined }[] | null | undefined): NarrowState[] {
  const states: NarrowState[] = []
  for (const comment of comments ?? []) {
    const line = firstLine(comment.body)
    const match = NARROW.exec(line)
    if (!match) continue
    const rest = match[1]!.trim()
    const outcome = /^VERIFIED\b/u.test(rest) ? 'verified' : /^REJECTED\b/u.test(rest) ? 'rejected' : 'started'
    states.push({ outcome, text: clipLine(line), at: comment.createdAt ?? null })
  }
  return states
}

/** The last state of the narrow round of a PR, or null when it has had none. */
export function narrowOf(comments: readonly { body: string; createdAt?: string | undefined }[] | null | undefined): NarrowState | null {
  return narrowRoundsOf(comments).at(-1) ?? null
}

/** Parses the JSON of `gh pr list --json …`; entries that are not PRs are dropped one by one. */
export function parsePrList(stdout: string): PullRequest[] {
  const raw: unknown = JSON.parse(stdout)
  if (!Array.isArray(raw)) throw new Error('gh pr list did not print a list')
  const result: PullRequest[] = []
  for (const item of raw) {
    const parsed = ghPullSchema.safeParse(item)
    if (!parsed.success) continue
    const pull = parsed.data
    const narrow = narrowRoundsOf(pull.comments)
    result.push({
      number: pull.number,
      url: pull.url,
      state: pull.state,
      branch: pull.headRefName,
      ci: ciOf(pull.statusCheckRollup),
      verdict: verdictOf(pull.comments),
      ...(narrow.length > 0 ? { narrow } : {}),
    })
  }
  return result
}

// ── the tracker ──────────────────────────────────────────────────────────────

export interface PrTrackerOptions {
  run: GhRunner
  /** The environment gh needs for the Project (accountAuth); asked once per read that runs gh. None by default. */
  auth?: GhAuth
  now?: () => number
  baseIntervalMs?: number
  searchIntervalMs?: number
  maxIntervalMs?: number
}

export interface PrRead {
  pulls: PullRequest[]
  gh: GhStatus
}

interface ProjectState {
  /** When `gh pr list` last ran; -Infinity before the first time. */
  listedAt: number
  intervalMs: number
  error: string | null
  listed: PullRequest[]
  /** Results of `--head <branch>` by branch. */
  searched: Map<string, { at: number; pulls: PullRequest[] }>
  running: Promise<PrRead> | null
}


/** Keeps the pull requests of each Project and decides when gh may run again. */
export class PrTracker {
  private readonly projects = new Map<string, ProjectState>()
  private readonly now: () => number
  private readonly base: number
  private readonly searchEvery: number
  private readonly max: number

  constructor(private readonly options: PrTrackerOptions) {
    this.now = options.now ?? Date.now
    this.base = options.baseIntervalMs ?? BASE_INTERVAL_MS
    this.searchEvery = options.searchIntervalMs ?? SEARCH_INTERVAL_MS
    this.max = options.maxIntervalMs ?? MAX_INTERVAL_MS
  }

  /** The PRs of `root` for these Ticket branches; runs gh only when an interval has passed. One read at a time per Project. */
  read(root: string, branches: readonly string[]): Promise<PrRead> {
    let state = this.projects.get(root)
    if (!state) {
      state = { listedAt: -Infinity, intervalMs: this.base, error: null, listed: [], searched: new Map(), running: null }
      this.projects.set(root, state)
    }
    const current = state
    current.running ??= this.refresh(root, current, branches).finally(() => {
      current.running = null
    })
    return current.running
  }

  private fail(state: ProjectState, error: unknown): void {
    state.error = messageOf(error)
    state.intervalMs = Math.min(state.intervalMs * 2, this.max)
  }

  private async refresh(root: string, state: ProjectState, branches: readonly string[]): Promise<PrRead> {
    const now = this.now()
    // The Project's environment for gh, asked for only when this read runs gh, and once: a refused
    // token fails the first gh call of the read like a refused gh would, and no pr list runs.
    let access: Promise<GhEnv> | undefined
    const runGh = async (args: readonly string[]): Promise<string> => {
      access ??= this.options.auth ? this.options.auth(root) : Promise.resolve({})
      return this.options.run(args, root, await access)
    }
    if (now - state.listedAt >= state.intervalMs) {
      state.listedAt = now
      try {
        state.listed = parsePrList(await runGh(['pr', 'list', '--state', 'all', '--limit', String(LIST_LIMIT), '--json', FIELDS]))
        state.error = null
        state.intervalMs = this.base
      } catch (error) {
        this.fail(state, error)
      }
    }

    if (state.error === null) {
      const listedBranches = new Set(state.listed.map((pull) => pull.branch))
      const missing = [...new Set(branches)].filter((branch) => !listedBranches.has(branch))
      let started = 0
      for (const branch of missing) {
        const known = state.searched.get(branch)
        if (known && now - known.at < this.searchEvery) continue
        if (started >= SEARCHES_PER_READ) break
        started += 1
        try {
          const pulls = parsePrList(await runGh(['pr', 'list', '--state', 'all', '--head', branch, '--limit', '1', '--json', FIELDS]))
          state.searched.set(branch, { at: now, pulls: pulls.filter((pull) => pull.branch === branch) })
        } catch (error) {
          this.fail(state, error)
          state.listedAt = now
          break
        }
      }
    }

    const gh: GhStatus = { available: state.error === null, error: state.error, intervalMs: state.intervalMs }
    if (!gh.available) return { pulls: [], gh }
    const pulls = [...state.listed]
    const seen = new Set(pulls.map((pull) => pull.number))
    for (const branch of new Set(branches)) {
      for (const pull of state.searched.get(branch)?.pulls ?? []) {
        if (seen.has(pull.number)) continue
        seen.add(pull.number)
        pulls.push(pull)
      }
    }
    return { pulls, gh }
  }
}
