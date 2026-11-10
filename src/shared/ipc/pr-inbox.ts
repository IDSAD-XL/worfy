// The `prInbox` domain (worfy-pr-inbox ticket 02): the open PRs of the user and the review requests to the user in
// the repositories of a Project, grouped by whose move it is (src/main/github/inbox.ts reads them with gh). Read-only
// towards GitHub: the reader never writes there (ADR-0105). `prInbox.markSeen` writes only `pr-inbox.json` in the
// Project's data folder (ADR-0005): what the user has seen, as ids, a sha and a time, never a text.
//
// A Linked machine gets the snapshot of the Project machine through these channels and never polls GitHub itself.
import { z } from 'zod'
import { invokeChannel, eventChannel } from './channels'
import { ciStateSchema } from './checks'

/** The groups of the view, in the order it shows them. */
export const PR_INBOX_GROUPS = ['needs-review', 'needs-answer', 'needs-fix', 'ready', 'waiting'] as const
export const prInboxGroupSchema = z.enum(PR_INBOX_GROUPS)
export type PrInboxGroup = z.infer<typeof prInboxGroupSchema>

/** What the view calls each group. */
export const PR_INBOX_GROUP_TITLES: Readonly<Record<PrInboxGroup, string>> = {
  'needs-review': 'Needs my review',
  'needs-answer': 'Needs my answer',
  'needs-fix': 'Needs a fix',
  ready: 'Ready',
  waiting: 'Waiting on others',
}

export const prInboxCommentSchema = z.object({
  /** GitHub's node id. */
  id: z.string(),
  databaseId: z.number().int().nullable(),
  /** The login; null for a deleted account. */
  author: z.string().nullable(),
  body: z.string(),
  createdAt: z.string(),
  url: z.string(),
})
export type PrInboxComment = z.infer<typeof prInboxCommentSchema>

export const prInboxThreadSchema = z.object({
  id: z.string(),
  isResolved: z.boolean(),
  isOutdated: z.boolean(),
  path: z.string().nullable(),
  line: z.number().int().nullable(),
  viewerCanReply: z.boolean(),
  /** The last comments of the thread, oldest first. */
  comments: z.array(prInboxCommentSchema),
})
export type PrInboxThread = z.infer<typeof prInboxThreadSchema>

export const prInboxRowSchema = z.object({
  /** `owner/name`. */
  repo: z.string(),
  number: z.number().int().positive(),
  title: z.string(),
  url: z.string(),
  isDraft: z.boolean(),
  author: z.string().nullable(),
  headRefName: z.string(),
  headRefOid: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  ci: ciStateSchema.nullable(),
  /** APPROVED, CHANGES_REQUESTED, REVIEW_REQUIRED; null when GitHub gives none. */
  reviewDecision: z.string().nullable(),
  /** CLEAN, DIRTY, BLOCKED, BEHIND, UNSTABLE, …; null when GitHub gives none. */
  mergeStateStatus: z.string().nullable(),
  /** The review is asked of the user only through a team: the row says "via team". */
  viaTeam: z.boolean(),
  unresolvedThreads: z.number().int().nonnegative(),
  /** Comments of others newer than the user's last look at the PR (`prInbox.markSeen`). */
  newSinceSeen: z.number().int().nonnegative(),
  /** The time of the last comment or review, else `updatedAt`: the age the row shows. */
  lastActivityAt: z.string(),
  threads: z.array(prInboxThreadSchema),
  /** The last comments of the conversation tab, oldest first. */
  comments: z.array(prInboxCommentSchema),
})
export type PrInboxRow = z.infer<typeof prInboxRowSchema>

export const prInboxSnapshotSchema = z.object({
  projectId: z.string(),
  /** False when the Project's `settings.json` says `prInbox: false` or none of its repositories is on GitHub. */
  enabled: z.boolean(),
  /** The login the PRs are read as; null before the first search. */
  viewer: z.string().nullable(),
  /** Every group, in the order of PR_INBOX_GROUPS, empty ones too. */
  groups: z.array(z.object({ group: prInboxGroupSchema, rows: z.array(prInboxRowSchema) })),
  /** When the last search answered (ISO); null before the first one. */
  readAt: z.string().nullable(),
  /** When the next search runs (ISO); null while the reader is off. */
  nextSearchAt: z.string().nullable(),
  /** Why the last read failed, or why the reader waits (a low rate limit); null when it went well. */
  error: z.string().nullable(),
  /** A line for the view about how the inbox is read (worfy-pr-inbox ticket 08 fills it); null here. */
  notice: z.string().nullable(),
})
export type PrInboxSnapshot = z.infer<typeof prInboxSnapshotSchema>

const projectInput = z.object({ projectId: z.string().min(1) })

/** The Project's PR inbox as last read; the first call reads it when it was never read. */
export const prInboxGet = invokeChannel('prInbox.get', projectInput, prInboxSnapshotSchema, 'project', 'read')

/** The user has seen this PR now: "N new since you looked" starts again from zero. Writes only `pr-inbox.json`. */
export const prInboxMarkSeen = invokeChannel(
  'prInbox.markSeen',
  projectInput.extend({ repo: z.string().regex(/^[^/\s]+\/[^/\s]+$/u), number: z.number().int().positive() }),
  prInboxSnapshotSchema,
  'project',
  'write',
)

/** The PR inbox of a Project changed: a read answered, or a PR was marked seen. The view asks `prInbox.get`. */
export const prInboxChanged = eventChannel('prInbox.changed', projectInput, 'project', 'read')

declare module './channels' {
  interface IpcContract {
    'prInbox.get': typeof prInboxGet
    'prInbox.markSeen': typeof prInboxMarkSeen
    'prInbox.changed': typeof prInboxChanged
  }
}
