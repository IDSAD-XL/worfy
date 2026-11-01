// The verdicts and head changes of Tickets without a PR (worfy-flight-recorder ticket 16): Silent
// mode and `workflow.finish` `local-green`, where GitHub holds nothing of the Ticket.
// - The marks file of Silent mode, `<Harness home>/runs/<project>/marks/<epic>-<NN>.json`, read by
//   SilentMarks of src/main/workflow/marks.ts; only when the caller says the marks live there
//   (`marksInFile` of src/main/workflow/stages.ts).
// - The Ticket's branch in git: its reflog gives each new head and the `gate: VERIFIED` /
//   `gate: REJECTED: …` commits of `local-green` (src/shared/flight-recorder/from-gate.ts,
//   `branchEvents`); a branch whose head went into the main branch gives the local merge: the
//   moment the main branch's reflog reached that head, else the merge commit over it, else the
//   head's own commit time.
// - A branch that is gone is the lost fact «branch deleted».
// The caller passes only Tickets without a PR: a PR's pushes and merge are GitHub's (reader 15).
// Nothing is written: git only reads (`log`, `rev-parse`, `merge-base`), the marks file is read.
import { branchEvents, markEvents, parseReflog, REFLOG_FORMAT, type ReflogEntry } from '../../shared/flight-recorder/from-gate'
import type { LostFact, StageEventFact } from '../../shared/flight-recorder/facts'
import { SilentMarks } from '../workflow/marks'
import { gitRunner, type GitRunner } from '../workflow/stages'

export interface LocalTicket {
  /** `<epic>/<NN>`, as the facts name a Ticket. */
  ticket: string
  epic: string
  num: number
  /** The Ticket's branch (`tickets.branch` of the Profile). */
  branch: string
}

export interface LocalVerdictOptions {
  /** A worktree of the Project's repository. */
  repo: string
  /** The Tickets of the Run without a PR. */
  tickets: readonly LocalTicket[]
  /** The marks file to read, when the marks of the Project live there (Silent mode; local-green without `origin`). */
  marksFile?: { harnessHome: string; project: string } | null
  /** The main branch the Tickets merge into; `main` by default. */
  mainBranch?: string
  git?: GitRunner
  log?: (message: string) => void
}

export interface LocalVerdictFacts {
  ticketEvents: StageEventFact[]
  lost: LostFact[]
}

/** The reflog of a branch, newest first; empty when git has none. */
async function reflog(git: GitRunner, repo: string, ref: string): Promise<ReflogEntry[]> {
  const out = await git(repo, ['log', '-g', '--date=iso-strict', `--format=${REFLOG_FORMAT}`, ref, '--'])
  return out.code === 0 ? parseReflog(out.stdout) : []
}

/** When `head` went into the main branch, or null when it did not. */
async function mergeOf(git: GitRunner, repo: string, head: string, main: string, entries: readonly ReflogEntry[]): Promise<{ at: string; sha: string } | null> {
  // A branch with no commit of its own is not merged: its head is the commit it was created from.
  const created = entries.find((entry) => entry.action.startsWith('branch: Created'))
  if (created !== undefined && created.sha === head && entries.every((entry) => entry.sha === head)) return null
  const ancestor = await git(repo, ['merge-base', '--is-ancestor', head, `refs/heads/${main}`])
  if (ancestor.code !== 0) return null
  const reached = (await reflog(git, repo, `refs/heads/${main}`)).filter((entry) => entry.sha === head).at(-1)
  if (reached !== undefined) return { at: reached.at, sha: head }
  const over = await git(repo, ['log', '--ancestry-path', '--reverse', '--format=%H%x00%P%x00%cI', `${head}..refs/heads/${main}`, '--'])
  for (const line of over.code === 0 ? over.stdout.split('\n') : []) {
    const [, parents, date] = line.split('\u0000')
    if (parents?.split(' ').includes(head) && date) return { at: new Date(date).toISOString(), sha: head }
  }
  const own = await git(repo, ['log', '-1', '--format=%cI', head, '--'])
  const date = own.code === 0 ? own.stdout.trim() : ''
  return date ? { at: new Date(date).toISOString(), sha: head } : null
}

/** The Ticket events and lost branches of Tickets without a PR. */
export async function readLocalVerdicts(options: LocalVerdictOptions): Promise<LocalVerdictFacts> {
  const git = options.git ?? gitRunner
  const main = options.mainBranch ?? 'main'
  const marks = options.marksFile ? new SilentMarks({ harnessHome: options.marksFile.harnessHome, project: options.marksFile.project, log: options.log }) : null
  const ticketEvents: StageEventFact[] = []
  const lost: LostFact[] = []
  const inGit = (await git(options.repo, ['rev-parse', '--git-dir'])).code === 0
  for (const item of options.tickets) {
    if (marks !== null) ticketEvents.push(...markEvents(item.ticket, await marks.read(item.epic, item.num)))
    if (!inGit) continue
    const ref = `refs/heads/${item.branch}`
    const head = await git(options.repo, ['rev-parse', '-q', '--verify', `${ref}^{commit}`])
    if (head.code !== 0) {
      // git answered and the branch is not there; a git that could not start (code null) says nothing.
      if (head.code !== null) lost.push({ ticket: item.ticket, kind: 'script', name: `branch ${item.branch}`, source: 'branch-deleted' })
      continue
    }
    const entries = await reflog(git, options.repo, ref)
    const merge = await mergeOf(git, options.repo, head.stdout.trim(), main, entries)
    ticketEvents.push(...branchEvents(item.ticket, entries, merge))
  }
  return { ticketEvents, lost }
}
