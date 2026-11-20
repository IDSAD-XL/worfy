// The `prReview` domain (worfy-pr-review ticket 07): the draft of a review of someone else's PR, kept on this machine in
// `<Profile folder>/state/pr-review/<owner>-<name>-<N>.json` (src/main/github/pr-review-draft.ts). The draft is the body
// of GitHub's `POST /repos/{o}/{r}/pulls/{n}/reviews` as harness/bin/review-draft-lint checks it (`payload`), plus the
// fields of worfy: who wrote each comment last, the text of its lines for finding them again after a new push, the
// verdict an Agent review suggested, the files marked Viewed, and the state of a Submit.
//
// Nothing here reaches GitHub: worfy creates no pending review there (ADR-0105). Every channel is `local`, as the drafts
// of replies (src/shared/ipc/pr-inbox.ts): a Linked machine never reaches the draft, whatever its access.
import { z } from 'zod'
import { invokeChannel } from './channels'

/** GitHub's verdicts of a review; the person chooses one in Finish review, an Agent review only suggests one. */
export const REVIEW_EVENTS = ['APPROVE', 'REQUEST_CHANGES', 'COMMENT'] as const
export const reviewEventSchema = z.enum(REVIEW_EVENTS)
export type ReviewEvent = z.infer<typeof reviewEventSchema>

export const REVIEW_DRAFT_STATES = ['draft', 'submitting', 'submitted'] as const

/** GitHub's longest comment body, in characters. */
export const REVIEW_MAX_CHARS = 65_536

/** A repository on GitHub as `owner/name`. */
export const reviewRepoSchema = z.string().regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\/[A-Za-z0-9._-]+$/u)
const shaSchema = z.string().regex(/^[0-9a-f]{7,64}$/iu)
const sideSchema = z.enum(['LEFT', 'RIGHT'])

/** One comment on lines of the diff, in the names of GitHub's request: `line` is the last line, `start_line` the first of a range. */
export const reviewCommentSchema = z
  .object({
    path: z.string().min(1),
    line: z.number().int().positive(),
    side: sideSchema,
    start_line: z.number().int().positive().optional(),
    start_side: sideSchema.optional(),
    body: z.string().max(REVIEW_MAX_CHARS),
  })
  .refine((comment) => comment.start_line === undefined || comment.start_line < comment.line, { message: 'start_line must be before line' })
export type ReviewComment = z.infer<typeof reviewCommentSchema>

/**
 * What worfy keeps beside `payload.comments[i]`: the text of the commented lines (code, not the words of colleagues),
 * by which the comment is found again after a new push; who wrote the comment last; and `moved`, set when its lines
 * were not found on the head the draft was last placed on — the comment stays on its old line, marked "line moved".
 */
export const reviewAnchorSchema = z.object({ text: z.string(), by: z.enum(['person', 'agent']), moved: z.boolean().optional() })
export type ReviewAnchor = z.infer<typeof reviewAnchorSchema>

/** The draft file. Fields this version does not know are kept as they are when main writes. */
export const reviewDraftSchema = z
  .object({
    schema: z.literal(1),
    repo: reviewRepoSchema,
    pr: z.number().int().positive(),
    /** The head of the PR when the draft was created. */
    startedOn: shaSchema,
    /** The head whose lines `payload.comments` name; absent — `startedOn`. Finding the lines again moves it. */
    anchoredOn: shaSchema.optional(),
    payload: z
      .object({
        /** Absent until the person chooses the verdict in Finish review. */
        event: reviewEventSchema.optional(),
        body: z.string().max(REVIEW_MAX_CHARS),
        comments: z.array(reviewCommentSchema),
      })
      .loose(),
    /** `anchors[i]` belongs to `payload.comments[i]`. */
    anchors: z.array(reviewAnchorSchema),
    /** The verdict an Agent review suggested; never sent by itself. */
    suggestedEvent: reviewEventSchema.optional(),
    agent: z.object({ sessionId: z.string(), state: z.enum(['writing', 'done', 'stopped']) }).loose().optional(),
    /** The files marked Viewed: path → the blob sha it was viewed at. */
    viewed: z.record(z.string(), z.string()),
    state: z.enum(REVIEW_DRAFT_STATES),
    reviewUrl: z.string().optional(),
    /** When GitHub took the review (ISO): a submitted draft is kept 30 days from it. */
    submittedAt: z.string().optional(),
    error: z.string().optional(),
  })
  .loose()
  .refine((draft) => draft.anchors.length === draft.payload.comments.length, { message: 'anchors must have one entry for each comment of payload.comments' })
export type ReviewDraft = z.infer<typeof reviewDraftSchema>

/**
 * The draft of one PR: null without one; `problem` when it cannot be read (no Profile folder, a broken file), or beside
 * the draft when a change is taken but not written yet (the disk refused): it waits for the next write, so the view must
 * not save it again.
 */
export const prReviewDraftAnswerSchema = z.object({ repo: z.string(), pr: z.number().int().positive(), draft: reviewDraftSchema.nullable(), problem: z.string().nullable() })
export type PrReviewDraftAnswer = z.infer<typeof prReviewDraftAnswerSchema>

/** A PR with a draft, for the chip `Review draft` of its row: «3 pending comments, started on 3f2a9c1». */
export const prReviewDraftRowSchema = z.object({ repo: z.string(), pr: z.number().int().positive(), comments: z.number().int().nonnegative(), startedOn: z.string(), state: z.enum(REVIEW_DRAFT_STATES) })
export type PrReviewDraftRow = z.infer<typeof prReviewDraftRowSchema>

const projectInput = z.object({ projectId: z.string().min(1) })
const pullInput = projectInput.extend({ repo: reviewRepoSchema, number: z.number().int().positive() })

/**
 * Which comment: its place in `payload.comments` when the view read it, its file and its text then. An Agent review
 * writing meanwhile may move comments: main takes the comment of that file whose text is `body`, the nearest to
 * `index`, and refuses when there is none.
 */
export const reviewCommentRefSchema = z.object({ index: z.number().int().nonnegative(), path: z.string().min(1), body: z.string().max(REVIEW_MAX_CHARS) })
export type ReviewCommentRef = z.infer<typeof reviewCommentRefSchema>

/** The draft of one PR on this machine. Reads only. */
export const prReviewDraft = invokeChannel('prReview.draft', pullInput, prReviewDraftAnswerSchema, 'local')

/**
 * A comment of the person: a new one (no `ref`), or a change of `ref`, which then counts as the person's. `anchor` — the
 * text of the commented lines; `head` — the head of the PR the view shows, which a draft created now starts on.
 */
export const prReviewSaveComment = invokeChannel(
  'prReview.saveComment',
  pullInput.extend({ head: shaSchema, ref: reviewCommentRefSchema.optional(), comment: reviewCommentSchema, anchor: z.string() }),
  prReviewDraftAnswerSchema,
  'local',
)

/** Deletes one comment of the draft. */
export const prReviewDeleteComment = invokeChannel('prReview.deleteComment', pullInput.extend({ ref: reviewCommentRefSchema }), prReviewDraftAnswerSchema, 'local')

/** Marks a file Viewed at its blob, or not Viewed (`blob: null`). A draft created now starts on `head`. */
export const prReviewSetViewed = invokeChannel(
  'prReview.setViewed',
  pullInput.extend({ head: shaSchema, path: z.string().min(1), blob: z.string().min(1).nullable() }),
  prReviewDraftAnswerSchema,
  'local',
)

/** Discard review, after the view's confirmation: the draft file is removed. */
export const prReviewDiscard = invokeChannel('prReview.discard', pullInput, prReviewDraftAnswerSchema, 'local')

/** The PRs of the Project with a draft on this machine. */
export const prReviewDrafts = invokeChannel('prReview.drafts', projectInput, z.object({ drafts: z.array(prReviewDraftRowSchema), problem: z.string().nullable() }), 'local')

declare module './channels' {
  interface IpcContract {
    'prReview.draft': typeof prReviewDraft
    'prReview.saveComment': typeof prReviewSaveComment
    'prReview.deleteComment': typeof prReviewDeleteComment
    'prReview.setViewed': typeof prReviewSetViewed
    'prReview.discard': typeof prReviewDiscard
    'prReview.drafts': typeof prReviewDrafts
  }
}
