// The `prReview` domain (worfy-pr-review ticket 07): the draft of a review of someone else's PR, kept on this machine in
// `<Profile folder>/state/pr-review/<owner>-<name>-<N>.json` (src/main/github/pr-review-draft.ts). The draft is the body
// of GitHub's `POST /repos/{o}/{r}/pulls/{n}/reviews` as harness/bin/review-draft-lint checks it (`payload`), plus the
// fields of worfy: who wrote each comment last, the text of its lines for finding them again after a new push, the
// verdict an Agent review suggested, the files marked Viewed, and the state of a Submit.
//
// Only Submit review (`prReview.submit`, ticket 11, ADR-0112) writes to GitHub: one POST on the person's click. worfy
// creates no pending review there (ADR-0105). Every channel is `local`, as the drafts of replies
// (src/shared/ipc/pr-inbox.ts): a Linked machine never reaches the draft, whatever its access.
import { z } from 'zod'
import { eventChannel, invokeChannel } from './channels'

/** GitHub's verdicts of a review; the person chooses one in Finish review, an Agent review only suggests one. */
export const REVIEW_EVENTS = ['APPROVE', 'REQUEST_CHANGES', 'COMMENT'] as const
export const reviewEventSchema = z.enum(REVIEW_EVENTS)
export type ReviewEvent = z.infer<typeof reviewEventSchema>

export const REVIEW_DRAFT_STATES = ['draft', 'submitting', 'submitted'] as const

/** An Agent review (ticket 08): its Session writes the draft, has said it is done, or was stopped (Stop, Take over). */
export const AGENT_REVIEW_STATES = ['writing', 'done', 'stopped'] as const
export type AgentReviewState = (typeof AGENT_REVIEW_STATES)[number]

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
    /**
     * Who wrote `payload.body` last; absent — the person's when it is not empty. An Agent review writes the summary only
     * while it is empty or its own (bin/pr-review-draft, ticket 08).
     */
    bodyBy: z.enum(['person', 'agent']).optional(),
    /** The verdict an Agent review suggested; never sent by itself. */
    suggestedEvent: reviewEventSchema.optional(),
    /** The Agent review of the draft: the id of its Session (the app's id) and its state. */
    agent: z.object({ sessionId: z.string(), state: z.enum(AGENT_REVIEW_STATES) }).loose().optional(),
    /** The files marked Viewed: path → the blob sha it was viewed at. */
    viewed: z.record(z.string(), z.string()),
    state: z.enum(REVIEW_DRAFT_STATES),
    reviewUrl: z.string().optional(),
    /** When GitHub took the review (ISO): a submitted draft is kept 30 days from it. */
    submittedAt: z.string().optional(),
    /**
     * When Submit marked the draft `submitting` (ISO), kept while GitHub has not confirmed that Submit: the next one looks
     * on GitHub only for a review given from then on (ticket 11, ADR-0112, point 6).
     */
    submittingAt: z.string().optional(),
    error: z.string().optional(),
  })
  .loose()
  .refine((draft) => draft.anchors.length === draft.payload.comments.length, { message: 'anchors must have one entry for each comment of payload.comments' })
export type ReviewDraft = z.infer<typeof reviewDraftSchema>

/** The words every reason of a Submit GitHub did not confirm carries: the next Submit looks on GitHub first. */
export const UNCONFIRMED = 'GitHub did not confirm the review'

/**
 * A Submit of the draft may be on GitHub: it is marked `submitting` (worfy stopped during the POST), or GitHub did not
 * confirm it. Its texts are the ones that went and stay as they are until the next Submit looks on GitHub (ADR-0112).
 */
export const submitPending = (draft: Pick<ReviewDraft, 'state' | 'error'>): boolean => draft.state === 'submitting' || (draft.state === 'draft' && (draft.error?.includes(UNCONFIRMED) ?? false))

/** Why main refuses to change the texts of a draft whose Submit may be on GitHub (submitPending). */
export const TEXTS_LOCKED = `${UNCONFIRMED} yet: its texts stay as they went until worfy finds it on GitHub, a Submit of them posts it, or you Discard the review`

/**
 * How long after the mark `submitting` GitHub gets to list the review it made. A POST of gh ends within 30 s; GitHub
 * lists a new review within seconds, and 5 minutes leave room for a slow answer of a busy GitHub. Until then a Submit
 * that finds nothing is refused, not posted again, and a mark `submitting` is not discarded: the POST may still run.
 */
export const LISTING_WAIT_MS = 5 * 60_000

/** How long ago the mark `submitting` of `draft` was set; Infinity without one (a draft from before the mark kept its time). */
export const markAge = (draft: Pick<ReviewDraft, 'submittingAt'>, now: number = Date.now()): number => {
  const at = draft.submittingAt === undefined ? Number.NaN : Date.parse(draft.submittingAt)
  return Number.isNaN(at) ? Infinity : now - at
}

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

/**
 * Agent review (ticket 08): a new Session Node of the Project on Claude Code with the Team reviewer of the Project
 * (`/human-review`) or, without one, the review lenses of `/worfy:code-review`, which writes the draft only through
 * harness/bin/pr-review-draft. `fill: 'new'` starts a review of a PR with no draft of the person (a draft is created on
 * `head` when there is none); `'add'` is Ask the agent to add comments to the person's draft. Refused while an Agent
 * review of the PR still writes. Local: the Session runs on the Machine of the draft.
 */
export const prReviewAgentReview = invokeChannel(
  'prReview.agentReview',
  pullInput.extend({ head: shaSchema, fill: z.enum(['new', 'add']) }),
  z.object({ nodeId: z.string(), sessionId: z.string(), text: z.string(), draft: reviewDraftSchema }),
  'local',
)

/** A file of the PR as Review mode lists it: its path and the blob of its new side, which a Viewed mark is set at. */
export const reviewFileSchema = z.object({ path: z.string().min(1), blob: z.string().min(1) })

/** GitHub lists at most this many files of a pull request; Start review sends no more. */
export const REVIEW_FILES_MAX = 3_000

/**
 * Start review (worfy-pr-review ticket 09): Review mode opens on the PR. A PR without a draft gets one on `head`, with
 * the files the account marked Viewed on github.com — read once, by one GraphQL query (`viewerViewedState`), never
 * written back (Q3 (a)); a mark is set at the blob `files` gives for its path. A PR with a draft keeps it as it is, and
 * nothing is read. Local, as the whole draft.
 */
export const prReviewStart = invokeChannel('prReview.start', pullInput.extend({ head: shaSchema, files: z.array(reviewFileSchema).max(REVIEW_FILES_MAX) }), prReviewDraftAnswerSchema, 'local')

/** Stop and Take over: the Session of the Agent review stops, the draft keeps what it wrote, `agent.state` is `stopped`. */
export const prReviewStopAgent = invokeChannel('prReview.stopAgent', pullInput, prReviewDraftAnswerSchema, 'local')

/** What the Finish review dialog shows and Submit sends: the verdict the person chose, the summary, each comment as it goes. */
export const reviewSubmittedTextsSchema = z.object({ event: reviewEventSchema, body: z.string().max(REVIEW_MAX_CHARS), comments: z.array(reviewCommentSchema) })

/**
 * The check of the Finish review dialog (worfy-pr-review ticket 11): review-draft-lint over the texts shown — the
 * traces of the workflow, an AI signature, personal data, the length. `findings` — one line each; `reason` — why the
 * check could not run. Never reaches GitHub.
 */
export const prReviewCheck = invokeChannel('prReview.check', pullInput.merge(reviewSubmittedTextsSchema), z.object({ findings: z.array(z.string()), reason: z.string().nullable() }), 'local')

/** How a Submit ended: posted now, found on GitHub already (a Submit before whose answer was lost), refused before any POST, or failed at GitHub. */
export const REVIEW_SUBMIT_OUTCOMES = ['submitted', 'already-submitted', 'refused', 'failed'] as const

export const prReviewSubmitAnswerSchema = z.object({
  outcome: z.enum(REVIEW_SUBMIT_OUTCOMES),
  /** Why it was refused or failed; null when the review is on GitHub. */
  reason: z.string().nullable(),
  reviewUrl: z.string().nullable(),
  /** The head of the PR GitHub has now, when Submit read it; the dialog shows a head that moved. */
  head: z.string().nullable(),
  /** The draft after it; null when it could not be read. */
  draft: reviewDraftSchema.nullable(),
})
export type PrReviewSubmitAnswer = z.infer<typeof prReviewSubmitAnswerSchema>

/**
 * Submit review (ticket 11, ADR-0112): one POST of the review on the person's click in the Finish review dialog, with
 * exactly the texts it shows. `commit` — the commit the comments are drawn and numbered on (the draft's `anchoredOn`,
 * else `startedOn`), which the review goes on; `head` — the head of the PR the dialog showed: a head that moved since
 * is refused, with the head now. Local: the draft lives on this machine, and only its account posts.
 */
export const prReviewSubmit = invokeChannel('prReview.submit', pullInput.merge(reviewSubmittedTextsSchema).extend({ commit: shaSchema, head: shaSchema }), prReviewSubmitAnswerSchema, 'local')

/** The draft file of a PR changed while an Agent review writes it: read it again (`prReview.draft`). */
export const prReviewChanged = eventChannel('prReview.changed', pullInput, 'local')

declare module './channels' {
  interface IpcContract {
    'prReview.draft': typeof prReviewDraft
    'prReview.saveComment': typeof prReviewSaveComment
    'prReview.deleteComment': typeof prReviewDeleteComment
    'prReview.setViewed': typeof prReviewSetViewed
    'prReview.discard': typeof prReviewDiscard
    'prReview.drafts': typeof prReviewDrafts
    'prReview.agentReview': typeof prReviewAgentReview
    'prReview.stopAgent': typeof prReviewStopAgent
    'prReview.changed': typeof prReviewChanged
    'prReview.start': typeof prReviewStart
    'prReview.check': typeof prReviewCheck
    'prReview.submit': typeof prReviewSubmit
  }
}
