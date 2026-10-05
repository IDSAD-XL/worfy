// The `checks` domain: what the gate, GitHub pull requests and CI say about a Project's worktrees
// and Ticket branches, for the badges on Tickets and Sessions (ticket 17). Main reads the gate's
// state files under ~/.claude/gate, the Sessions' transcripts and `gh pr list`; nothing is
// written anywhere (ADR-0002, ADR-0005). The main process side is src/main/gate/state.ts,
// src/main/github/prs.ts and src/main/ipc/checks.ts.
import { z } from 'zod'
import { parseTicketBranch, parseWorktreeFolder } from '../workflow/ticket-ref'
import { invokeChannel } from './channels'

/** An absolute POSIX path; the main process resolves it again before use. */
const absolutePath = z
  .string()
  .min(1)
  .refine((path) => path.startsWith('/') && !path.includes('\0'), 'must be an absolute path')

/**
 * A branch that names a Ticket (`<epic>/<NN>`, src/shared/workflow/ticket-ref.ts). Main passes it
 * to `gh` inside a single argument; it can never start with a dash.
 */
export const ticketBranchSchema = z
  .string()
  .max(200)
  .refine((branch) => parseTicketBranch(branch) !== null && !branch.startsWith('-') && !/\s/.test(branch), 'not a Ticket branch')

/**
 * The gate's verdict on one worktree. `green`, `red` and `unverified` («проверить не удалось») are
 * the gate's own words; `none` is «нет данных»: no marker and no gate line in a transcript, or the
 * last line said «ничего не прогналось», which is not green.
 */
export const gateOutcomeSchema = z.enum(['green', 'red', 'unverified', 'none'])
export type GateOutcome = z.infer<typeof gateOutcomeSchema>

export const gateStateSchema = z.object({
  outcome: gateOutcomeSchema,
  /** Where it came from: a marker file of gate.sh, the last `[gate]` line of a transcript, or nothing. */
  source: z.enum(['marker', 'transcript', 'none']),
  /** ISO time of the transcript record with the gate line; null for a marker or no data. */
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

export const pullRequestSchema = z.object({
  number: z.number().int().positive(),
  url: z.string(),
  state: z.enum(['OPEN', 'CLOSED', 'MERGED']),
  /** Head branch of the PR. */
  branch: z.string(),
  ci: ciStateSchema.nullable(),
  /** The last comment whose first line is `VERIFIED` or `REJECTED`; null when there is none. */
  verdict: z.enum(['VERIFIED', 'REJECTED']).nullable(),
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
 * Gate state of every worktree of the Project and the pull requests of its Ticket branches.
 * `branches` are the branches of Tickets in work that the renderer knows of; main adds the
 * branches of the Project's worktrees itself. `gh` runs at most once per interval whatever the
 * call rate, so the renderer may ask often (it asks only while its window is focused).
 */
export const checksGet = invokeChannel(
  'checks.get',
  z.object({ root: absolutePath, branches: z.array(ticketBranchSchema).max(500) }),
  checksSnapshotSchema,
)

declare module './channels' {
  interface IpcContract {
    'checks.get': typeof checksGet
  }
}

// ── what a badge shows ──────────────────────────────────────────────────────

/** A Ticket as the selectors need it. */
export interface TicketLike {
  epic: string
  num: number
}

const sameTicket = (ticket: TicketLike, branch: string | null): boolean => {
  const ref = branch === null ? null : parseTicketBranch(branch)
  return ref !== null && ref.epic === ticket.epic && ref.num === ticket.num
}

/**
 * The worktree of a Ticket: the one whose branch names it, else the one whose folder
 * (`.claude/worktrees/<NN>`) carries its number while its branch names no Ticket at all.
 */
export function worktreeOfTicket(snapshot: ChecksSnapshot, ticket: TicketLike): WorktreeChecks | null {
  const byBranch = snapshot.worktrees.find((worktree) => sameTicket(ticket, worktree.branch))
  if (byBranch) return byBranch
  return (
    snapshot.worktrees.find((worktree) => {
      if (worktree.branch !== null && parseTicketBranch(worktree.branch) !== null) return false
      return parseWorktreeFolder(worktree.path)?.num === ticket.num
    }) ?? null
  )
}

const PR_STATE_RANK: Record<PullRequest['state'], number> = { OPEN: 0, MERGED: 1, CLOSED: 2 }

/** The pull request of a Ticket's branch: an open one first, then a merged one, newest first. */
export function pullOfTicket(snapshot: ChecksSnapshot, ticket: TicketLike): PullRequest | null {
  const pulls = snapshot.pulls.filter((pull) => sameTicket(ticket, pull.branch))
  pulls.sort((a, b) => PR_STATE_RANK[a.state] - PR_STATE_RANK[b.state] || b.number - a.number)
  return pulls[0] ?? null
}

const inside = (path: string, folder: string): boolean => path === folder || path.startsWith(folder.endsWith('/') ? folder : `${folder}/`)

/** The worktree a Session runs in: the deepest worktree (or the checkout) that contains its cwd. */
export function worktreeOfCwd(snapshot: ChecksSnapshot, cwd: string): WorktreeChecks | null {
  let best: WorktreeChecks | null = null
  for (const worktree of snapshot.worktrees) {
    if (inside(cwd, worktree.path) && (best === null || worktree.path.length > best.path.length)) best = worktree
  }
  return best
}
