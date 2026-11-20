// The `changes` domain (worfy-changes-view ticket 02; ADR-0110): the Changes screen reads the diff of a Ticket from
// git in main — the scopes the Ticket has in each repository, the files of a scope, one file's hunks, the Ticket's
// commits. Handled in src/main/ipc/changes.ts over src/main/changes/. Every channel is `project` and `read`: git
// runs on the Machine of the Project, and nothing in the repository is written (a Linked machine with read-only
// access reads the diff too, ADR-0066). The model is src/shared/changes/types.ts.
//
// A Project over several repositories answers per repository: the repository is the top level of `changes.scopes`
// and `changes.list`; `changes.file` and `changes.commits` name the repository they read.
//
// The subject is a Ticket or a pull request (worfy-pr-review ticket 06): a PR is read with the Project's git when its
// repository is the Project's and both commits are there, else from GitHub with `gh api` GETs only, while the screen is
// open (ADR-0110, Amendment); its one repository is `owner/name`.
import { z } from 'zod'
import { isRepoPath } from '../changes/parse'
import { CHANGE_STATUSES, FOLD_REASONS, SCOPE_KINDS } from '../changes/types'
import { invokeChannel } from './channels'

const projectId = z.string().min(1)
const text = z.string()
const count = z.number().int().nonnegative()
const mode = z.string().nullable()
/** A path from the repository's top folder: never absolute, never with a `..` part (isRepoPath, by main's platform). */
const repoPath = z.string().min(1).refine((path) => isRepoPath(path), { message: 'a path inside the repository' })

/** The Ticket the screen shows: TicketSubjectRef of src/main/changes/subjects.ts. */
export const changesTicketSchema = z.object({
  epic: z.string().min(1),
  num: z.number().int().nonnegative(),
  /** The Ticket's `Branch:` line, when it has one. */
  branch: z.string().min(1).nullable().optional(),
  /** The Ticket's `Repo:` lines, in a Project over several repositories. */
  repos: z.array(z.string().min(1)).optional(),
})

const SHA = /^[0-9a-f]{7,64}$/u

/**
 * A pull request the screen shows (ChangesPrRef of src/shared/changes/types.ts; worfy-pr-review ticket 06): read with
 * the Project's git when its repository is the Project's and both commits are in it, else from GitHub (ADR-0110,
 * Amendment).
 */
export const changesPrSchema = z.object({
  kind: z.literal('pr'),
  repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/u, { message: 'owner/name' }),
  number: z.number().int().positive(),
  headOid: z.string().regex(SHA),
  baseOid: z.string().regex(SHA),
})

/** What `changes.scopes`, `changes.list`, `changes.file` and `changes.commits` read: a Ticket, or a pull request. */
export const changesSubjectSchema = z.discriminatedUnion('kind', [changesTicketSchema.extend({ kind: z.literal('ticket') }), changesPrSchema])

/** ChangesScope of src/shared/changes/types.ts. */
export const changesScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('all') }),
  z.object({ kind: z.literal('uncommitted') }),
  z.object({ kind: z.literal('commit'), repo: z.string().min(1), sha: z.string().regex(SHA) }),
  z.object({ kind: z.literal('compare'), repo: z.string().min(1), ref: z.string().min(1) }),
])

/** A Ticket's worktree or branch, or a pull request. */
const subjectKind = z.enum(['worktree', 'branch', 'pr'])
/** Where the diff was read: the Project's git, or GitHub (a pull request only). */
const source = z.enum(['git', 'github'])

/** RepoBase of src/main/changes/scopes.ts. */
export const changesBaseSchema = z.object({
  ref: text,
  from: z.enum(['worktree.base', 'default_branch', 'origin/HEAD', 'origin/main', 'local', 'compare', 'pr']),
  /** Empty for a pull request read from GitHub: `pulls/{n}/files` does not name it. */
  mergeBase: text,
})

/** ChangedFile of src/shared/changes/types.ts. */
export const changedFileSchema = z.object({
  path: text,
  oldPath: text.nullable(),
  status: z.enum(CHANGE_STATUSES),
  additions: count.nullable(),
  deletions: count.nullable(),
  binary: z.boolean(),
  oldMode: mode,
  newMode: mode,
  oldBlob: text.nullable(),
  newBlob: text.nullable(),
  untracked: z.boolean(),
  workflow: z.boolean(),
  fold: z.enum(FOLD_REASONS).nullable(),
  url: text.optional(),
})

/** DiffLine of src/shared/changes/types.ts. */
const diffLineSchema = z.object({
  kind: z.enum(['context', 'add', 'del']),
  text,
  oldLine: count.nullable(),
  newLine: count.nullable(),
  crlf: z.boolean(),
  noNewline: z.boolean(),
})

/** DiffHunk of src/shared/changes/types.ts. */
const diffHunkSchema = z.object({
  header: text,
  oldStart: count,
  oldLines: count,
  newStart: count,
  newLines: count,
  section: text,
  lines: z.array(diffLineSchema),
})

/** FileDiff of src/shared/changes/types.ts. */
export const fileDiffSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('hunks'), path: text, oldPath: text.nullable(), oldMode: mode, newMode: mode, hunks: z.array(diffHunkSchema), whole: z.boolean() }),
  z.object({ kind: z.literal('folded'), path: text, reason: z.enum(FOLD_REASONS), lines: count }),
  z.object({ kind: z.literal('binary'), path: text, oldSize: count.nullable(), newSize: count.nullable() }),
  z.object({ kind: z.literal('no-patch'), path: text, url: text.nullable() }),
])

/** The Ticket in one repository and what the screen may ask of it. */
export const changesRepoScopesSchema = z.object({
  repo: text,
  kind: subjectKind,
  branch: text,
  headSha: text,
  /** The base of All changes; null with `error` when none is found. */
  base: changesBaseSchema.nullable(),
  scopes: z.array(z.enum(SCOPE_KINDS)),
  /** The branches Compare against offers. */
  branches: z.array(text),
  error: text.nullable(),
  /**
   * The repository's checkout and, for a worktree, the worktree's folder from it with `/` (`.claude/worktrees/03`;
   * absolute when it lies outside; empty for a branch): what a comment on lines names (ticket 05). Absent in an answer
   * of a build before that ticket.
   */
  checkout: text.optional(),
  worktree: text.optional(),
  /** Where the diff is read (worfy-pr-review ticket 06); absent in an answer of a build before that ticket. */
  source: source.optional(),
})

export const changesScopesAnswerSchema = z.object({
  /** One entry per repository where the Ticket has a worktree or a branch; empty when it has neither. */
  repos: z.array(changesRepoScopesSchema),
})

/** RepoChanges of src/main/changes/scopes.ts. */
export const changesRepoListSchema = z.object({
  repo: text,
  kind: subjectKind,
  branch: text,
  scope: z.enum(SCOPE_KINDS),
  base: changesBaseSchema.nullable(),
  headSha: text,
  workTree: z.boolean(),
  files: z.array(changedFileSchema),
  additions: count,
  deletions: count,
  error: text.nullable(),
  source: source.optional(),
  /** GitHub listed only this many files of the pull request (3,000 of `pulls/{n}/files`, 300 of a compare); null when it listed all. */
  truncatedAt: count.nullable().optional(),
})

export const changesCommitSchema = z.object({ sha: text, short: text, author: text, date: text, subject: text })

const subject = { projectId, subject: changesSubjectSchema }
const whitespace = { hideWhitespace: z.boolean().optional() }

/** The repositories of the Ticket, each with its scopes, its base and the branches to compare against; the one repository of a PR. */
export const changesScopes = invokeChannel('changes.scopes', z.object(subject), changesScopesAnswerSchema, 'project', 'read')

/** The files of a scope, per repository (`commit` and `compare` read only the repository they name). */
export const changesList = invokeChannel('changes.list', z.object({ ...subject, scope: changesScopeSchema, ...whitespace }), z.object({ repos: z.array(changesRepoListSchema) }), 'project', 'read')

/** One file's hunks; `whole` — «Show whole file», `expand` — «Show» on a folded patch. */
export const changesFile = invokeChannel(
  'changes.file',
  z.object({
    ...subject,
    repo: z.string().min(1),
    scope: changesScopeSchema,
    path: repoPath,
    oldPath: repoPath.nullable().optional(),
    untracked: z.boolean().optional(),
    whole: z.boolean().optional(),
    expand: z.boolean().optional(),
    ...whitespace,
  }),
  z.object({ file: fileDiffSchema }),
  'project',
  'read',
)

/** The Ticket's commits in a repository (`git log <merge-base>..HEAD`), for the scope Commit; a PR's, from git or `pulls/{n}/commits`. */
export const changesCommits = invokeChannel(
  'changes.commits',
  z.object({ ...subject, repo: z.string().min(1) }),
  z.object({ base: changesBaseSchema, commits: z.array(changesCommitSchema) }),
  'project',
  'read',
)

/**
 * A Session the comments on lines of the diff may go to (worfy-changes-view ticket 05, the list «To»): a Session Node
 * of worfy bound to the Ticket, or the Project's Orchestrator. `sessionId` names the Session's comments (quoteKey of
 * src/renderer/session/quote-store.ts), as its Session view names them: the live Session's id once its agent reported
 * it, else the saved one; null when the Node has none yet.
 */
export const changesTargetSchema = z.object({
  kind: z.enum(['session', 'orchestrator']),
  nodeId: z.string().min(1),
  sessionId: z.string().min(1).nullable(),
  /** How the list names it. */
  title: text,
  /** The time of the last record of its transcript, in ms; null when it has none. */
  lastAt: z.number().nullable(),
})

export const changesTargetsAnswerSchema = z.object({
  /** The bound Sessions, the one with the newest record first, then the Orchestrator. */
  targets: z.array(changesTargetSchema),
  /** The Node the comments go to unless the user picks another (spec, Q2); null when the list is empty. */
  defaultNodeId: z.string().min(1).nullable(),
  /** Autopilot runs in the Project now: the Orchestrator is busy with its Run. */
  autopilot: z.boolean(),
})

/** The list «To» of the comments on lines of the Ticket's diff (ticket 05): reading only, as every channel here. */
export const changesTargets = invokeChannel('changes.targets', z.object({ projectId, ticket: changesTicketSchema.pick({ epic: true, num: true }) }), changesTargetsAnswerSchema, 'project', 'read')

declare module './channels' {
  interface IpcContract {
    'changes.scopes': typeof changesScopes
    'changes.list': typeof changesList
    'changes.file': typeof changesFile
    'changes.commits': typeof changesCommits
    'changes.targets': typeof changesTargets
  }
}
