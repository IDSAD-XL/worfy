// The `prInbox` domain (worfy-pr-inbox ticket 02): the open PRs of the user and the review requests to the user in
// the repositories of a Project, grouped by whose move it is (src/main/github/inbox.ts reads them with gh). The reader
// never writes to GitHub (ADR-0105); the one write is `prInbox.send` below, on the user's click (ticket 05). `prInbox.markSeen` writes only `pr-inbox.json` in the
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

/**
 * The morning digest (worfy-pr-inbox ticket 07, src/main/github/inbox-digest.ts): a window of this Machine asks when
 * it gets the focus. `show` — the first time today, with the line and the Projects it counts (in the order of the
 * list); `pending` — an inbox is not read yet, ask again when one changes; `none` — nothing to show. This Machine's
 * windows only: a Linked machine has no digest of the Project machine's inboxes.
 */
export const prInboxDigestAnswerSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('pending') }),
  z.object({ state: z.literal('none') }),
  z.object({ state: z.literal('show'), text: z.string(), projectIds: z.array(z.string()) }),
])
export type PrInboxDigestAnswer = z.output<typeof prInboxDigestAnswerSchema>
export const prInboxDigest = invokeChannel('prInbox.digest', z.void(), prInboxDigestAnswerSchema, 'local')

// ── the drafts of replies and Send (worfy-pr-inbox ticket 05, ADR-0105) ─────────────────────────────────────────
//
// Skill pr-reply writes the drafts of replies of one PR into `<Profile folder>/state/pr-inbox/drafts/<owner>-<name>-<N>.json`
// (harness/bin/pr-reply-draft). The view shows them under their threads; the user edits a text, discards it, or
// sends it. Send is the one write to GitHub main ever makes (src/main/github/pr-reply-send.ts): the text shown, as it
// is, after review-draft-lint --reply checked it again, once. Every channel below is `local`: a Linked machine never
// reaches the drafts or Send, whatever its access.

/** The labels skill pr-reply gives a reply (harness/bin/review-draft-lint, `--reply`). */
export const PR_REPLY_LABELS = ['needs code change', 'needs answer', 'FYI', 'resolved by push'] as const
export const PR_REPLY_STATES = ['draft', 'sent', 'discarded'] as const
/** GitHub's longest comment body, in characters; the lint holds a reply to far less. */
export const PR_REPLY_MAX_CHARS = 65_536

/** A repository on GitHub as `owner/name`, as the draft file and the reply's path name it. */
const repoSchema = z.string().regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\/[A-Za-z0-9._-]+$/u)

/** One reply of a draft file, with its place in the file's `items`. */
export const prReplyItemSchema = z.object({
  /** The place of the reply in the file's `items` when it was read; a save, a discard and a send name the reply by `kind`, `threadId` and its text. */
  index: z.number().int().nonnegative(),
  kind: z.enum(['thread', 'conversation']),
  /** The review thread's node id; null for a reply in the conversation. */
  threadId: z.string().nullable(),
  /** The databaseId of the thread's first comment, which the reply goes under; null for the conversation. */
  replyTo: z.number().int().positive().nullable(),
  label: z.string(),
  body: z.string(),
  /** A plan for the user, never posted. */
  fixPlan: z.string().nullable(),
  state: z.enum(PR_REPLY_STATES),
  sentUrl: z.string().nullable(),
  /** Why the last Send did not post it, or the mark of a Send in flight (one that stays: worfy stopped mid-post); null when none failed. */
  error: z.string().nullable(),
  /** The user changed the text: skill pr-reply keeps it as it is when it runs again. */
  edited: z.boolean(),
})
export type PrReplyItem = z.infer<typeof prReplyItemSchema>

export const prReplyDraftsSchema = z.object({
  repo: z.string(),
  pr: z.number().int().positive(),
  /** The head commit the drafts are about; null without a draft file. */
  headOid: z.string().nullable(),
  /** Every reply of the file, in its order; empty without a file. */
  items: z.array(prReplyItemSchema),
  /** Why the drafts cannot be read (no Profile folder, a file of another shape); null when they can, or there are none. */
  problem: z.string().nullable(),
})
export type PrReplyDrafts = z.infer<typeof prReplyDraftsSchema>

const pullInput = projectInput.extend({ repo: repoSchema, number: z.number().int().positive() })

const bodySchema = z.string().max(PR_REPLY_MAX_CHARS)

/**
 * Which reply: its kind and thread, and `base`, the text the view last read of it; `index`, its place in the file then,
 * only orders the candidates. A Session that rewrote the file meanwhile moves replies: main takes the reply of that
 * kind and thread whose text is `base` or the text shown, and refuses when there is none.
 */
export const prReplyRefSchema = z.object({ index: z.number().int().nonnegative(), kind: z.enum(['thread', 'conversation']), threadId: z.string().min(1).nullable(), base: bodySchema })
export type PrReplyRef = z.infer<typeof prReplyRefSchema>

/** What became of one reply of a Send. */
export const prReplySendResultSchema = z.object({
  index: z.number().int().nonnegative(),
  /**
   * `sent` — posted now (with a reason when the draft file could not record it); `already-sent` — the text of this
   * account was on GitHub already (a Send whose answer was lost; asked only when an earlier Send was not confirmed),
   * the reply is only marked sent; `refused` — not posted, and nothing was sent to GitHub: a lint finding, a reply
   * sent or discarded before, a file that changed, a thread whose first comment is not the one the draft answers;
   * `failed` — GitHub or the network failed, the reply stays a draft with the reason; `skipped` — not tried, since an
   * earlier reply of the same Send failed.
   */
  outcome: z.enum(['sent', 'already-sent', 'refused', 'failed', 'skipped']),
  reason: z.string().nullable(),
  sentUrl: z.string().nullable(),
})
export type PrReplySendResult = z.infer<typeof prReplySendResultSchema>

/** The drafts of replies of one PR on this machine. Reads only. */
export const prInboxDrafts = invokeChannel('prInbox.drafts', pullInput, prReplyDraftsSchema, 'local')

/** The user's text of one reply into the draft file, as it is; the reply is marked `edited`. Never reaches GitHub. */
export const prInboxSaveDraft = invokeChannel('prInbox.saveDraft', pullInput.extend({ item: prReplyRefSchema, body: bodySchema }), prReplyDraftsSchema, 'local')

/** The reply will not be sent: `discarded` in the draft file. `body` is the text shown, which a save on blur may have put there. Never reaches GitHub. */
export const prInboxDiscard = invokeChannel('prInbox.discard', pullInput.extend({ item: prReplyRefSchema, body: bodySchema }), prReplyDraftsSchema, 'local')

/**
 * Send, on the user's click: each reply with the text shown in its field, one after another — Send on one reply,
 * or Send all after the dialog with every text. Main saves the text, checks it again with review-draft-lint --reply,
 * and posts it once (ADR-0105).
 */
export const prInboxSend = invokeChannel(
  'prInbox.send',
  pullInput.extend({ items: z.array(prReplyRefSchema.extend({ body: bodySchema })).min(1).max(100) }),
  z.object({ results: z.array(prReplySendResultSchema), drafts: prReplyDraftsSchema }),
  'local',
)

declare module './channels' {
  interface IpcContract {
    'prInbox.digest': typeof prInboxDigest
    'prInbox.get': typeof prInboxGet
    'prInbox.markSeen': typeof prInboxMarkSeen
    'prInbox.changed': typeof prInboxChanged
    'prInbox.drafts': typeof prInboxDrafts
    'prInbox.saveDraft': typeof prInboxSaveDraft
    'prInbox.discard': typeof prInboxDiscard
    'prInbox.send': typeof prInboxSend
  }
}
