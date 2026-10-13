// The `checks` domain: what the gate, GitHub pull requests and CI say about a Project's worktrees
// and Ticket branches, for the badges on Tickets and Sessions (ticket 17). Main reads the gate's
// state files under ~/.claude/gate (markers and the verdict file), the Sessions' transcripts and `gh pr list`; nothing is
// written anywhere (ADR-0002, ADR-0005). The main process side is src/main/gate/state.ts,
// src/main/github/prs.ts and src/main/ipc/checks.ts.
import { z } from 'zod'
import { absolutePathSchema, isWindowsAbsolutePath } from '../paths'
import { parseTicketBranch, parseWorktreeFolder } from '../workflow/ticket-ref'
import { invokeChannel } from './channels'

/** An absolute path, POSIX or Windows (`C:\…`, `C:/…`, `\\server\share\…`); the main process resolves it again before use. */
const absolutePath = absolutePathSchema

/**
 * A branch name `checks.get` takes: at most 200 characters, no whitespace or control characters,
 * never starting with a dash. Main passes it to `gh` inside a single argument, and takes it only
 * when it is `<epic>/<NN>` or a branch the workflow model names for a Ticket (src/main/ipc/checks.ts).
 */
export const branchNameSchema = z
  .string()
  .min(1)
  .max(200)
  // eslint-disable-next-line no-control-regex
  .refine((branch) => !branch.startsWith('-') && !/[\s\u0000-\u001f\u007f]/u.test(branch), 'not a branch name')

/** A branch that names a Ticket by its form (`<epic>/<NN>`, src/shared/workflow/ticket-ref.ts). */
export const ticketBranchSchema = branchNameSchema.refine((branch) => parseTicketBranch(branch) !== null, 'not a Ticket branch')

/**
 * The gate's verdict on one worktree. `green`, `red` and `unverified` («проверить не удалось») are
 * the gate's own words; `none` is «нет данных»: no marker and no gate line in a transcript, or the
 * last line said «ничего не прогналось», which is not green.
 */
export const gateOutcomeSchema = z.enum(['green', 'red', 'unverified', 'none'])
export type GateOutcome = z.infer<typeof gateOutcomeSchema>

export const gateStateSchema = z.object({
  outcome: gateOutcomeSchema,
  /**
   * Where it came from: a marker file of the Gate, its verdict file (`verdict-<tag>.json`, ticket
   * worfy-harness/09), the last `[gate]` line of a transcript, or nothing.
   */
  source: z.enum(['marker', 'file', 'transcript', 'none']),
  /** ISO time of the run in the verdict file or of the transcript record with the gate line; null for a marker or no data. */
  at: z.string().nullable(),
})
export type GateState = z.infer<typeof gateStateSchema>

/** One worktree of the Project (the checkout itself included) and its gate state. */
export const worktreeChecksSchema = z.object({
  path: z.string(),
  /** Checked-out branch; null for a detached HEAD. */
  branch: z.string().nullable(),
  gate: gateStateSchema,
})
export type WorktreeChecks = z.infer<typeof worktreeChecksSchema>

/** CI of a pull request reduced to three words; null when the PR has no checks at all. */
export const ciStateSchema = z.enum(['passing', 'failing', 'running'])
export type CiState = z.infer<typeof ciStateSchema>

/** How much of the first line a narrow-round state keeps, as the run journal keeps an answer. */
export const NARROW_TEXT_MAX = 1000

/**
 * One state of a narrow fix round (worfy-harness ticket 20, ADR-0046), read from a PR comment whose
 * first line starts with `NARROW:` — `started` for `NARROW: <findings>`, `verified` for
 * `NARROW: VERIFIED`, `rejected` for `NARROW: REJECTED…` — that first line, at most 1000
 * characters, and when the comment was made (gh's `createdAt`), null when gh did not say. The
 * findings are not parsed.
 */
export const narrowStateSchema = z.object({
  outcome: z.enum(['started', 'verified', 'rejected']),
  text: z.string().min(1).max(NARROW_TEXT_MAX),
  at: z.string().nullable(),
})
export type NarrowState = z.infer<typeof narrowStateSchema>

export const pullRequestSchema = z.object({
  number: z.number().int().positive(),
  url: z.string(),
  state: z.enum(['OPEN', 'CLOSED', 'MERGED']),
  /** Head branch of the PR. */
  branch: z.string(),
  ci: ciStateSchema.nullable(),
  /**
   * The last comment whose first line is `VERIFIED` or `REJECTED`, or the narrow round's
   * `NARROW: VERIFIED` or `NARROW: REJECTED`; null when there is none.
   */
  verdict: z.enum(['VERIFIED', 'REJECTED']).nullable(),
  /**
   * The narrow round's comments of the PR, oldest first (worfy-harness ticket 20): its states as the
   * /epic-wave skill writes them; absent when the PR has none. The renderer does not use it; the
   * Autopilot run journals it.
   */
  narrow: z.array(narrowStateSchema).optional(),
})
export type PullRequest = z.infer<typeof pullRequestSchema>

/** Whether `gh` answered on the last try. When it did not, `pulls` is empty and `error` says why. */
export const ghStatusSchema = z.object({
  available: z.boolean(),
  error: z.string().nullable(),
  /** Current interval between `gh pr list` calls; doubles after each failure. */
  intervalMs: z.number().int().positive(),
})
export type GhStatus = z.infer<typeof ghStatusSchema>

export const checksSnapshotSchema = z.object({
  root: z.string(),
  worktrees: z.array(worktreeChecksSchema),
  pulls: z.array(pullRequestSchema),
  gh: ghStatusSchema,
})
export type ChecksSnapshot = z.infer<typeof checksSnapshotSchema>

/**
 * Gate state of every worktree of a repository and the pull requests of its Ticket branches.
 * `root` is the Project root or one of the Project's repositories (`checks.repos`): main refuses
 * any other folder, so `git` and `gh` never run elsewhere. `branches` are the branches of Tickets in
 * work that the renderer knows of — `<epic>/<NN>`, or the `Branch:` the workflow model names for a
 * Ticket of that repository; main refuses any other and adds the branches of the worktrees itself.
 * `gh` runs at most once per interval whatever the call rate, so the renderer may ask often (it
 * asks only while its window is focused).
 */
export const checksGet = invokeChannel(
  'checks.get',
  z.object({ root: absolutePath, branches: z.array(branchNameSchema).max(500) }),
  checksSnapshotSchema,
  'project',
)

/** One repository of a Project: `name` is what a Ticket's `Repo:` line says, `path` its root. */
export const projectRepoSchema = z.object({ name: z.string().min(1), path: z.string().min(1) })
export type ProjectRepoView = z.infer<typeof projectRepoSchema>

export const projectReposSchema = z.object({
  mode: z.enum(['full', 'silent']),
  /** The Project's repositories as the Harness names them (worfy-harness ticket 22); empty when it does not. */
  repos: z.array(projectRepoSchema),
})
export type ProjectRepos = z.infer<typeof projectReposSchema>

/**
 * The mode and the repositories of the Project at `root` (a Project root, nothing else): a
 * Project over several repositories gets its checks one repository at a time (ADR-0045). Open to a
 * Linked machine like `checks.get`: its Canvas shows the same badges.
 */
export const checksRepos = invokeChannel('checks.repos', z.object({ root: absolutePath }), projectReposSchema, 'project')

declare module './channels' {
  interface IpcContract {
    'checks.get': typeof checksGet
    'checks.repos': typeof checksRepos
  }
}

// ── what a badge shows ──────────────────────────────────────────────────────

/** A Ticket as the selectors need it; `branch` is its `Branch:` line, when it has one. */
export interface TicketLike {
  epic: string
  num: number
  branch?: string | null | undefined
}

/** The branch is the Ticket's: the one its `Branch:` line names, or `<epic>/<NN>` of it. */
const sameTicket = (ticket: TicketLike, branch: string | null): boolean => {
  if (branch === null) return false
  if (ticket.branch && branch === ticket.branch) return true
  const ref = parseTicketBranch(branch)
  return ref !== null && ref.epic === ticket.epic && ref.num === ticket.num
}

/**
 * The worktree of a Ticket: the one whose branch names it, else the one whose folder
 * (`.claude/worktrees/<NN>`, or `<Harness home>/worktrees/<project>/<NN>` outside the repository)
 * carries its number while its branch names no Ticket at all. The folder names no Epic, so it is
 * taken only when no other Epic of the Project (`tickets`, all of its Tickets) has a Ticket with
 * that number.
 */
export function worktreeOfTicket(snapshot: ChecksSnapshot, ticket: TicketLike, tickets: readonly TicketLike[]): WorktreeChecks | null {
  const byBranch = snapshot.worktrees.find((worktree) => sameTicket(ticket, worktree.branch))
  if (byBranch) return byBranch
  if (tickets.some((other) => other.num === ticket.num && other.epic !== ticket.epic)) return null
  const named = new Set(tickets.flatMap((other) => (other.branch ? [other.branch] : [])))
  return (
    snapshot.worktrees.find((worktree) => {
      if (worktree.branch !== null && (parseTicketBranch(worktree.branch) !== null || named.has(worktree.branch))) return false
      return parseWorktreeFolder(worktree.path)?.num === ticket.num
    }) ?? null
  )
}

/**
 * Where a Ticket's checks come from: `project` — the Project root, as for a Project of one
 * repository; `repo` — its own repository in a Project over several (its `Repo:` line names one of
 * them); `none` — such a Project, and the Ticket names no repository of it: it gets no Gate, PR or
 * CI badges.
 */
export type TicketChecksSource = { kind: 'project' } | { kind: 'repo'; repo: ProjectRepoView } | { kind: 'none' }

export function checksSourceOfTicket(repos: readonly ProjectRepoView[], ticket: { repo?: string | null | undefined }): TicketChecksSource {
  if (repos.length < 2) return { kind: 'project' }
  const repo = ticket.repo ? repos.find((each) => each.name === ticket.repo) : undefined
  return repo ? { kind: 'repo', repo } : { kind: 'none' }
}

const PR_STATE_RANK: Record<PullRequest['state'], number> = { OPEN: 0, MERGED: 1, CLOSED: 2 }

/** The pull request of a Ticket's branch: an open one first, then a merged one, newest first. */
export function pullOfTicket(snapshot: ChecksSnapshot, ticket: TicketLike): PullRequest | null {
  const pulls = snapshot.pulls.filter((pull) => sameTicket(ticket, pull.branch))
  pulls.sort((a, b) => PR_STATE_RANK[a.state] - PR_STATE_RANK[b.state] || b.number - a.number)
  return pulls[0] ?? null
}

/**
 * A path in the form two paths are compared in. An absolute path of Windows is folded: `\` as `/`
 * and lower case, because git names a worktree `C:/Users/x/worfy`, Claude Code names the folder of
 * a Session `C:\Users\x\worfy`, and NTFS does not tell letter case apart. Any other path is taken as
 * it is. The path itself says which it is: this file is shared with the renderer, which has no
 * `process.platform`.
 */
const comparable = (path: string): string => (isWindowsAbsolutePath(path) ? path.replaceAll('\\', '/').toLowerCase() : path)

/** Whether `path` is `folder` or lies under it; both are `comparable`. */
const inside = (path: string, folder: string): boolean => path === folder || path.startsWith(folder.endsWith('/') ? folder : `${folder}/`)

/** The worktree a Session runs in: the deepest worktree (or the checkout) that contains its cwd. */
export function worktreeOfCwd(snapshot: ChecksSnapshot, cwd: string): WorktreeChecks | null {
  const where = comparable(cwd)
  let best: WorktreeChecks | null = null
  for (const worktree of snapshot.worktrees) {
    if (inside(where, comparable(worktree.path)) && (best === null || worktree.path.length > best.path.length)) best = worktree
  }
  return best
}
