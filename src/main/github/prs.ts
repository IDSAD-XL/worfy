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
// Read-only: the only gh command ever run is `gh pr list`. Nothing is written to GitHub, to the
// Project or to the Claude home.
import { execFile } from 'node:child_process'
import { z } from 'zod'
import type { CiState, GhStatus, PullRequest } from '../../shared/ipc/checks'

export const BASE_INTERVAL_MS = 60_000
export const SEARCH_INTERVAL_MS = 5 * 60_000
export const MAX_INTERVAL_MS = 32 * 60_000
export const LIST_LIMIT = 100
/** Branch searches started in one read, so a Project with many branches does not burst gh. */
export const SEARCHES_PER_READ = 10

const FIELDS = 'number,headRefName,state,url,statusCheckRollup,comments'

/** Runs `gh <args>` in `cwd` and resolves its stdout; rejects with a short reason. */
export type GhRunner = (args: readonly string[], cwd: string) => Promise<string>

export interface GhRunnerOptions {
  /** The gh executable; `gh` from PATH by default. WORFY_GH points tests at a stub. */
  command?: string
  /** Environment for gh, e.g. the login shell's (src/main/agent/env.ts) so PATH and auth are found. */
  env?: () => Promise<Record<string, string | undefined>>
  timeoutMs?: number
}

const firstLine = (text: string): string => text.trim().split('\n')[0]?.trim() ?? ''

/** The default runner: gh as a child process, never through a shell. */
export function ghRunner(options: GhRunnerOptions = {}): GhRunner {
  const command = options.command ?? 'gh'
  return async (args, cwd) => {
    const env = options.env ? await options.env() : process.env
    return new Promise((resolve, reject) => {
      execFile(
        command,
        [...args],
        { cwd, env: { ...env, GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1', NO_COLOR: '1' }, encoding: 'utf8', timeout: options.timeoutMs ?? 30_000, maxBuffer: 32 * 1024 * 1024 },
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

// ── the answer of gh ─────────────────────────────────────────────────────────

const checkSchema = z
  .object({
    __typename: z.string().optional(),
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

/** CI of a PR in three words: failing if any check failed, else running if any is not done, else passing. */
export function ciOf(rollup: readonly z.infer<typeof checkSchema>[] | null | undefined): CiState | null {
  if (!rollup || rollup.length === 0) return null
  let running = false
  for (const check of rollup) {
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

const VERDICT = /^(VERIFIED|REJECTED)\b/u

/** The reviewer's verdict: the last comment whose first line starts with VERIFIED or REJECTED. */
export function verdictOf(comments: readonly { body: string }[] | null | undefined): 'VERIFIED' | 'REJECTED' | null {
  let verdict: 'VERIFIED' | 'REJECTED' | null = null
  for (const comment of comments ?? []) {
    const match = VERDICT.exec(firstLine(comment.body))
    if (match) verdict = match[1] as 'VERIFIED' | 'REJECTED'
  }
  return verdict
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
    result.push({ number: pull.number, url: pull.url, state: pull.state, branch: pull.headRefName, ci: ciOf(pull.statusCheckRollup), verdict: verdictOf(pull.comments) })
  }
  return result
}

// ── the tracker ──────────────────────────────────────────────────────────────

export interface PrTrackerOptions {
  run: GhRunner
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

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

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
    if (now - state.listedAt >= state.intervalMs) {
      state.listedAt = now
      try {
        state.listed = parsePrList(await this.options.run(['pr', 'list', '--state', 'all', '--limit', String(LIST_LIMIT), '--json', FIELDS], root))
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
          const pulls = parsePrList(await this.options.run(['pr', 'list', '--state', 'all', '--head', branch, '--limit', '1', '--json', FIELDS], root))
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
