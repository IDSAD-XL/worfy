// GitHub for Flight Recorder (worfy-flight-recorder ticket 15): gh's answers about the PRs of a Run's
// Tickets, for src/shared/flight-recorder/from-github.ts to turn into facts. Read-only gh, run as the
// Project's GitHub account through the PR tracker (`PrTracker.gh` of src/main/github/prs.ts: GH_TOKEN of
// the Profile's account, WORFY_GH for a stand-in, the Windows rules of `ghRunner`).
//
// - One read per Project and set of branches per interval (60 s, as PrTracker; decision 07): within it
//   the answer kept in memory is given again and gh is not run. Nothing is written to disk.
// - A read: per Ticket branch `gh pr list --state all --head <branch>` (the exact branch), then for a
//   branch with a PR the workflow runs of the branch, and for a merged PR the runs of its merge commit
//   (CI in batch on the main branch). Calls run one after another, so a Run of many Tickets does not
//   burst gh.
// - gh fails (no network, no gh login for the account, an answer that is not JSON): the read is "GitHub
//   did not answer" with the reason, and the timeline is built from the local sources. That answer is
//   kept for the interval too, so a failing gh is not run more than once a minute; `retry` (the «Retry»
//   of ticket 17) reads at once.
import { GH_APP_FIELDS, GH_RUN_FIELDS } from '../../shared/flight-recorder/pr-facts.mjs'
import type { GithubAnswer, GithubPr, GithubRun } from '../../shared/flight-recorder/from-github'
import { parseRemote } from '../github/accounts'
import { BASE_INTERVAL_MS } from '../github/prs'

export const GITHUB_READ_INTERVAL_MS = BASE_INTERVAL_MS
/** The PR fields: those of pr-facts.mjs, the head, the base branch, the approval and the closing time. */
export const PR_FIELDS = `${GH_APP_FIELDS},headRefOid,baseRefName,reviewDecision,reviews,closedAt`
/** The run fields: those of pr-facts.mjs, the run's id and attempt, its workflow, head and start. */
export const RUN_FIELDS = `${GH_RUN_FIELDS},databaseId,attempt,name,headSha,startedAt`
/** PRs of one branch: a Ticket's branch is reused by its reopened PRs only. */
export const PRS_PER_BRANCH = 10
// shortcut: only the newest RUNS_PER_BRANCH runs of a branch are read, so the early CI of a Ticket pushed more often than that is missing; page with `--created` when a Ticket's branch runs CI that often.
export const RUNS_PER_BRANCH = 50
export const RUNS_PER_COMMIT = 20

/**
 * The address of a repository's page from its remote URL (`git remote get-url origin` of the Project root,
 * the repository gh reads the PRs of): `https://<host>/<owner>/<repo>` for an https, ssh or scp-like remote
 * (`git@host:owner/repo.git`), without `.git`; null for a folder or any other form. The host is the
 * remote's own, so a GitHub Enterprise server gives its pages. The Run history screen opens
 * `<it>/pull/<N>` and `<it>/commit/<sha>` from it (worfy-flight-recorder ticket 19).
 */
export function repoPageUrl(remote: string): string | null {
  const repo = parseRemote(remote)
  return repo === null ? null : `https://${repo.host}/${repo.owner}/${repo.repo}`
}

/** A read: gh's answer, or the reason GitHub did not answer; `at` — when gh ran. */
export type GithubRead = { answer: GithubAnswer; error: null; at: number } | { answer: null; error: string; at: number }

export interface GithubReaderOptions {
  /** Runs a read-only gh command in the Project's root as its account (PrTracker.gh). */
  gh: (root: string, args: readonly string[]) => Promise<string>
  now?: () => number
  intervalMs?: number
}

interface Entry {
  read: GithubRead | null
  running: Promise<GithubRead> | null
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))
/** A value gh would take for an option, as `--head` or `--branch` of a branch that starts with "-". */
const safeArg = (value: string): boolean => value !== '' && !value.startsWith('-')
const SHA = /^[0-9a-f]{7,64}$/u

function parseArray(text: string, what: string): unknown[] {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new Error(`gh ${what} gave an answer that is not JSON`)
  }
  if (!Array.isArray(value)) throw new Error(`gh ${what} gave no list`)
  return value
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null
// The branch of each PR is left to from-github.ts, which keeps only those of the Run's Tickets.
const prsOf = (text: string): GithubPr[] => parseArray(text, 'pr list').filter((pr): pr is GithubPr => isObject(pr) && Number.isInteger(pr.number))
const runsOf = (text: string): GithubRun[] => parseArray(text, 'run list').filter(isObject) as GithubRun[]

/** Reads gh for the Runs of a Project, at most once per interval for each set of branches. */
export class GithubReader {
  private readonly entries = new Map<string, Entry>()
  private readonly now: () => number
  private readonly interval: number

  constructor(private readonly options: GithubReaderOptions) {
    this.now = options.now ?? Date.now
    this.interval = options.intervalMs ?? GITHUB_READ_INTERVAL_MS
  }

  /**
   * The PRs of these Ticket branches in the Project at `root`, with their runs. Runs gh only when the
   * interval has passed since the last read of the same branches, or with `retry`; one read at a time.
   */
  read(root: string, branches: readonly string[], options: { retry?: boolean } = {}): Promise<GithubRead> {
    const wanted = [...new Set(branches)].filter(safeArg).sort()
    const key = `${root}\n${wanted.join('\n')}`
    const now = this.now()
    // Answers of other branch sets that are out of date go: the next read of them runs gh anyway.
    for (const [other, entry] of this.entries) {
      if (other !== key && entry.running === null && (entry.read === null || now - entry.read.at >= this.interval)) this.entries.delete(other)
    }
    const entry = this.entries.get(key) ?? { read: null, running: null }
    this.entries.set(key, entry)
    if (entry.running !== null) return entry.running
    if (entry.read !== null && !options.retry && now - entry.read.at < this.interval) return Promise.resolve(entry.read)
    entry.running = this.fetch(root, wanted, now).then((read) => {
      entry.read = read
      entry.running = null
      return read
    })
    return entry.running
  }

  private async fetch(root: string, branches: readonly string[], at: number): Promise<GithubRead> {
    const gh = (args: readonly string[]) => this.options.gh(root, args)
    try {
      const prs: GithubPr[] = []
      for (const branch of branches) {
        const own = prsOf(await gh(['pr', 'list', '--state', 'all', '--head', branch, '--limit', String(PRS_PER_BRANCH), '--json', PR_FIELDS]))
        if (own.length === 0) continue
        const ciRuns = runsOf(await gh(['run', 'list', '--branch', branch, '--limit', String(RUNS_PER_BRANCH), '--json', RUN_FIELDS]))
        for (const pr of own) {
          const merge = pr.mergeCommit?.oid
          const mergeRuns = typeof merge === 'string' && SHA.test(merge) ? runsOf(await gh(['run', 'list', '--commit', merge, '--limit', String(RUNS_PER_COMMIT), '--json', RUN_FIELDS])) : []
          prs.push({ ...pr, ciRuns, mergeRuns })
        }
      }
      return { answer: { prs }, error: null, at }
    } catch (error) {
      return { answer: null, error: messageOf(error), at }
    }
  }
}
