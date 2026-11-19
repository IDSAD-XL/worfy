// The subject of the Changes screen in part 1 — a Ticket (worfy-changes-view ticket 02; ADR-0110): in each
// repository of the Project, the Ticket's worktree, and without one, the Ticket's branch.
//
// - The worktree: an entry of `git worktree list` whose branch names the Ticket (ticketWorktrees of
//   src/main/workflow/reader.ts, the checkout itself too: with `parallel: single` the Ticket's branch is checked out
//   there). Its changes are the work tree's, with what is not committed yet.
// - The branch: a local branch that names the Ticket and is checked out nowhere (ticketBranches of the reader; in a
//   Project over several repositories one branch name stands in each repository the Ticket names, ADR-0104). Its
//   changes are its commits.
//
// A Project over several repositories gives one subject per repository: the repository is the top level of every
// answer of the screen. A repository where the Ticket has neither is left out.
import { posix, win32 } from 'node:path'
import { ticketBranches, ticketWorktrees } from '../workflow/reader'
import { branchNamesTicket } from '../../shared/workflow/ticket-ref'
import type { ChangesGit } from './git'

/** The Ticket as the screen names it; `branch` and `repos` are its `Branch:` and `Repo:` lines, when it has them. */
export interface TicketSubjectRef {
  epic: string
  num: number
  branch?: string | null | undefined
  repos?: readonly string[] | undefined
}

/** A repository of the Project: its name in the Profile and its checkout. */
export interface SubjectCheckout {
  name: string
  path: string
}

/** The Ticket in one repository. */
export interface RepoSubject {
  /** The repository's name in the Profile. */
  repo: string
  /** The repository's checkout. */
  checkout: string
  /** Where git runs: the worktree in the OS's own form (nativePath), or the checkout for a branch checked out nowhere. */
  cwd: string
  kind: 'worktree' | 'branch'
  branch: string
  /** What the changes end at: `HEAD` of the worktree, `refs/heads/<branch>` of a branch. */
  head: string
  /** The SHA `head` points to now. */
  headSha: string
}

/**
 * A path in the OS's own form. git for Windows prints `worktree D:/a/b` in `git worktree list --porcelain`, while the
 * Profile's checkout and the paths of main are `D:\a\b`: the worktree's cwd is given in the second form, so the same folder
 * reads as one path whether it came from git or from the Profile.
 */
export function nativePath(path: string, platform: NodeJS.Platform = process.platform): string {
  return (platform === 'win32' ? win32 : posix).normalize(path)
}

/** A git runner in the form the workflow reader takes: stdout, or a rejection with git's exit code as `code`. */
function readerRun(git: ChangesGit): (cwd: string, args: string[]) => Promise<string> {
  return async (cwd, args) => {
    const read = await git(cwd, args)
    if (read.code === 0) return read.stdout
    throw Object.assign(new Error(`git ${args[0] ?? ''} failed: ${read.stderr.trim() || `exit code ${String(read.code)}`}`), { code: read.code })
  }
}

/** The Ticket's subject in each repository of `checkouts`, in their order; only reads. `platform` is the OS whose paths git prints. */
export async function ticketSubjects(checkouts: readonly SubjectCheckout[], ticket: TicketSubjectRef, git: ChangesGit, platform: NodeJS.Platform = process.platform): Promise<RepoSubject[]> {
  const run = readerRun(git)
  const named = ticket.repos && ticket.repos.length > 0 ? checkouts.filter(({ name }) => ticket.repos!.includes(name)) : checkouts
  const found = await Promise.all(
    named.map(async ({ name, path }): Promise<RepoSubject | null> => {
      const worktrees = await ticketWorktrees(path, run, true).catch(() => [])
      const worktree = worktrees.find((entry) => branchNamesTicket(entry.branch, ticket))
      if (worktree) return { repo: name, checkout: path, cwd: nativePath(worktree.path, platform), kind: 'worktree', branch: worktree.branch, head: 'HEAD', headSha: worktree.head }
      const like = { epic: ticket.epic, num: ticket.num, branch: ticket.branch ?? null, repo: null, pr: null, repos: [name] }
      const [branch] = await ticketBranches([{ name, path }], [like], run).catch(() => [])
      if (!branch) return null
      return { repo: name, checkout: path, cwd: path, kind: 'branch', branch: branch.branch, head: `refs/heads/${branch.branch}`, headSha: branch.head }
    }),
  )
  return found.filter((subject): subject is RepoSubject => subject !== null)
}
