// The `changes` domain (worfy-changes-view ticket 02; ADR-0110): the Changes screen reads the diff of a Ticket from
// git in main — the scopes the Ticket has in each repository, the files of a scope, one file's hunks, the Ticket's
// commits. Handled in src/main/ipc/changes.ts over src/main/changes/. Every channel is `project` and `read`: git
// runs on the Machine of the Project, and nothing in the repository is written (a Linked machine with read-only
// access reads the diff too, ADR-0066). The model is src/shared/changes/types.ts.
//
// A Project over several repositories answers per repository: the repository is the top level of `changes.scopes`
// and `changes.list`; `changes.file` and `changes.commits` name the repository they read.
import { z } from 'zod'
import { CHANGE_STATUSES, FOLD_REASONS, SCOPE_KINDS } from '../changes/types'
import { invokeChannel } from './channels'

const projectId = z.string().min(1)
const text = z.string()
const count = z.number().int().nonnegative()
const mode = z.string().nullable()

/** The Ticket the screen shows: TicketSubjectRef of src/main/changes/subjects.ts. */
export const changesTicketSchema = z.object({
  epic: z.string().min(1),
  num: z.number().int().nonnegative(),
  /** The Ticket's `Branch:` line, when it has one. */
  branch: z.string().min(1).nullable().optional(),
  /** The Ticket's `Repo:` lines, in a Project over several repositories. */
  repos: z.array(z.string().min(1)).optional(),
})

/** ChangesScope of src/shared/changes/types.ts. */
export const changesScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('all') }),
  z.object({ kind: z.literal('uncommitted') }),
  z.object({ kind: z.literal('commit'), repo: z.string().min(1), sha: z.string().regex(/^[0-9a-f]{7,64}$/u) }),
  z.object({ kind: z.literal('compare'), repo: z.string().min(1), ref: z.string().min(1) }),
])

const subjectKind = z.enum(['worktree', 'branch'])

/** RepoBase of src/main/changes/scopes.ts. */
export const changesBaseSchema = z.object({
  ref: text,
  from: z.enum(['worktree.base', 'default_branch', 'origin/HEAD', 'origin/main', 'local', 'compare']),
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
})

export const changesCommitSchema = z.object({ sha: text, short: text, author: text, date: text, subject: text })

const subject = { projectId, ticket: changesTicketSchema }
const whitespace = { hideWhitespace: z.boolean().optional() }

/** The repositories of the Ticket, each with its scopes, its base and the branches to compare against. */
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
    path: z.string().min(1),
    oldPath: z.string().min(1).nullable().optional(),
    untracked: z.boolean().optional(),
    whole: z.boolean().optional(),
    expand: z.boolean().optional(),
    ...whitespace,
  }),
  z.object({ file: fileDiffSchema }),
  'project',
  'read',
)

/** The Ticket's commits in a repository (`git log <merge-base>..HEAD`), for the scope Commit. */
export const changesCommits = invokeChannel(
  'changes.commits',
  z.object({ ...subject, repo: z.string().min(1) }),
  z.object({ base: changesBaseSchema, commits: z.array(changesCommitSchema) }),
  'project',
  'read',
)

declare module './channels' {
  interface IpcContract {
    'changes.scopes': typeof changesScopes
    'changes.list': typeof changesList
    'changes.file': typeof changesFile
    'changes.commits': typeof changesCommits
  }
}
