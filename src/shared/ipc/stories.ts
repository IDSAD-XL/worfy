// IPC of Code stories (Epic worfy-code-stories, ticket 04): the invisible build of a story through the
// oneShot of the Project's Vendor (src/main/stories/one-shot.ts), its progress lines and its Stop. No
// Session and no Session Node: the window shows only a progress bar where the pressed button was
// (src/renderer/stories/StoryProgress.tsx). The buttons that start it come with tickets 11 and 12.
//
// Ticket 08 adds the reads: a story file of an Epic (`stories.read`, from the source the workflow is read from,
// ADR-0107), the code of one of its fragments from git (`stories.code`, TICKETS.md "Story anchor"), and a story made
// by the button with its answers (`stories.saved`, src/main/stories/store.ts).
//
// Ticket 12 adds a question about lines of a story (`stories.ask`): the same invisible agent answers it, with the same
// progress lines and Stop, and its answers are kept with the story in worfy's data (`stories.answers`).
//
// Ticket 13 adds the screens read and the answers to "Check yourself", kept beside those answers (`stories.marks`).
import { z } from 'zod'
import { epicStoryHeaderSchema, prStoryHeaderSchema, storyFileSchema, storyFragmentSchema, storySchema } from '../stories/schema'
import { eventChannel, invokeChannel } from './channels'

/** A diff, a PR's text or a Ticket larger than this is not sent to a model whole; the caller trims it. */
export const STORY_INPUT_MAX_CHARS = 1_000_000

const material = z.string().max(STORY_INPUT_MAX_CHARS)

/** The Ticket of a PR: its file name (the Requirement links point into it) and its text. */
export const storyTicketSchema = z.object({ file: z.string().min(1).max(300), text: material })

/** What the agent explains for the story of a PR: it cannot run git (oneShot has no Bash), so the diff comes in the request. */
export const prStoryInputSchema = z.object({
  kind: z.literal('pr'),
  header: prStoryHeaderSchema,
  /** The diff of the PR, as `gh pr diff` prints it. */
  diff: material.min(1),
  /** The PR's title and description. */
  prText: material,
  /** The Ticket; null when the PR has none. */
  ticket: storyTicketSchema.nullable(),
  /** The review verdicts of the PR, if there are any. */
  verdicts: z.array(material).max(20),
})

/** What the agent puts together for the story of an Epic: its spec and the story (or the state) of each Ticket's PR. */
export const epicStoryInputSchema = z.object({
  kind: z.literal('epic'),
  header: epicStoryHeaderSchema,
  spec: material.min(1),
  /** One text per Ticket: the story of its PR with the PR's number and head, or why its PR is not ready. */
  chapters: z.array(material).min(1).max(100),
  verdicts: z.array(material).max(100),
})

export const storyInputSchema = z.discriminatedUnion('kind', [prStoryInputSchema, epicStoryInputSchema])
export type StoryInput = z.output<typeof storyInputSchema>

export const storyIdSchema = z.string().min(1).max(100)

/**
 * How a build ended: the story (`story`), Stop (`stopped`: nothing kept), the Project's Vendor without a
 * oneShot (`unavailable`: the request never started, `reason` from the Vendor's capabilities), or a
 * failure with its reason (`failed`: an answer that does not fit the schema, the Vendor's error).
 */
export const storyOutcomeSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('story'), story: storySchema }),
  z.object({ status: z.literal('stopped') }),
  z.object({ status: z.literal('unavailable'), reason: z.string().min(1) }),
  z.object({ status: z.literal('failed'), reason: z.string().min(1) }),
])
export type StoryOutcome = z.output<typeof storyOutcomeSchema>

/**
 * Builds the story of `input` in Project `projectId` on its Vendor; stories.activity tells each line while it
 * runs. `folder`: the checkout whose files the agent reads — the Project's root (the default) or one of its git
 * worktrees, where the PR's head is checked out; any other folder is refused.
 */
export const storiesBuild = invokeChannel(
  'stories.build',
  z.object({ storyId: storyIdSchema, projectId: z.string().min(1), folder: z.string().min(1).optional(), input: storyInputSchema }),
  storyOutcomeSchema,
  'project',
  'write',
)

/** Stop of the progress bar: ends the build or the question (`questionId` of stories.ask) `storyId`; false when none runs under it. */
export const storiesStop = invokeChannel('stories.stop', z.object({ storyId: storyIdSchema }), z.object({ stopped: z.boolean() }), 'project', 'write')

/** A line of what the build's agent is doing, sent to the window that asked for the story. */
export const storiesActivity = eventChannel('stories.activity', z.object({ storyId: z.string(), text: z.string() }), 'project', 'read')

/** A story file under the Tickets root, `/` between the parts: `<epic>/story.md` or `<epic>/stories/<NN>-<slug>.md`. */
export const storyPathSchema = z.string().min(1).max(500)

/** The story of a file, or why it cannot be shown: no such file, or a file that does not fit the format. */
export const storyReadSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    story: storyFileSchema,
    /** The file, as asked. */
    path: storyPathSchema,
    /** The folder of the file relative to the Project root, `/` between the parts: a Requirement link is relative to it. */
    dir: z.string(),
  }),
  z.object({ ok: z.literal(false), reason: z.string().min(1) }),
])
export type StoryRead = z.output<typeof storyReadSchema>

/** Reads the story file `path` of Project `projectId`: from its main branch in Full mode, from the Workflow folder in Silent. */
export const storiesRead = invokeChannel('stories.read', z.object({ projectId: z.string().min(1), path: storyPathSchema }), storyReadSchema, 'project', 'read')

const fullSha = z.string().regex(/^[0-9a-f]{40}$/u, 'a full commit sha')

/**
 * The code a step shows for a fragment: its lines, the number of the first one and the key lines. `fromHead` is true when
 * it is the story's own code — the code of the PR head — and `reason` says why: `changed`, the anchor commit holds other
 * code there or no such file (the main branch no longer holds it in this form); `no-anchor`, there is no anchor commit
 * to read, or git cannot read it. Null when the code was found.
 */
export const fragmentCodeSchema = z.object({
  code: z.string(),
  startLine: z.number().int().min(1),
  keyLines: z.array(z.number().int().min(1)),
  fromHead: z.boolean(),
  reason: z.enum(['changed', 'no-anchor']).nullable(),
})
export type FragmentCode = z.output<typeof fragmentCodeSchema>

/**
 * Where a fragment's code is read: in the anchor commit of a committed story file (`path`, as stories.read takes it),
 * or at the PR head a story kept outside git names (`commit`: its header's, or its chapter's). `pr` is the PR of the
 * story's header, or of the fragment's chapter in an Epic story: a Silent Project's story, outside the code's git, is
 * read at that PR's merge commit or head. Null or absent for `PR -`: main then takes the PR of the story's Ticket from
 * the workflow model (its `PR: #N` line; the Ticket of `stories/NN-<slug>.md` is NN), as harness/bin/TICKETS.md says
 * of `PR -`. In Full mode it is not needed.
 */
export const storyCodeAtSchema = z.union([
  z.object({ path: storyPathSchema, pr: z.number().int().positive().nullable().optional() }).strict(),
  z.object({ commit: fullSha }).strict(),
])
export type StoryCodeAt = z.output<typeof storyCodeAtSchema>

/**
 * The most lines and characters of a fragment whose code is looked for in git: a story's fragment is a few lines, and
 * the search is bounded by them (src/main/stories/code.ts). A larger one is refused before git is read.
 */
export const FRAGMENT_MAX_LINES = 500
export const FRAGMENT_MAX_CHARS = 64 * 1024

/** Why the code of `fragment` is not looked for; null when it is small enough. */
export function fragmentTooLarge(fragment: { code: string }): string | null {
  if (fragment.code.length > FRAGMENT_MAX_CHARS) return `a fragment longer than ${String(FRAGMENT_MAX_CHARS)} characters is not looked for in git`
  if (fragment.code.split('\n').length > FRAGMENT_MAX_LINES) return `a fragment of more than ${String(FRAGMENT_MAX_LINES)} lines is not looked for in git`
  return null
}

/** The code of `fragment` of a story of Project `projectId`, read from git when a step shows it. */
export const storiesCode = invokeChannel(
  'stories.code',
  z.object({
    projectId: z.string().min(1),
    at: storyCodeAtSchema,
    fragment: storyFragmentSchema.refine((fragment) => fragmentTooLarge(fragment) === null, { message: `a fragment of at most ${String(FRAGMENT_MAX_LINES)} lines and ${String(FRAGMENT_MAX_CHARS)} characters` }),
  }),
  fragmentCodeSchema,
  'project',
  'read',
)

/** The key of a story made by the button: `owner/name#N` for a PR, `epic:<name>` for an Epic. */
export const storyKeySchema = z.string().min(1).max(300)

/** A line of code an answer points to: `path:line@commit` or `path:from-to@commit`. */
const CODE_LINK = /^[^\s:@]+:\d+(-\d+)?@[0-9a-f]{40}$/u

/** The longest question about lines of a story: a question, not a document (its text goes to a model). */
export const STORY_QUESTION_MAX_CHARS = 2_000

/**
 * What an answer rests on (ticket 12): the code of the checkout, the story, the PR's text or a review verdict — or
 * nothing (`none`), and then the answer says so.
 */
export const storyAnswerSourceSchema = z.enum(['code', 'story', 'pr', 'verdict', 'none'])
export type StoryAnswerSource = z.output<typeof storyAnswerSourceSchema>

/**
 * The lines a question was asked about, so its answer shows after them: the Ticket of the step — a PR story's own, an
 * Epic story's chapter's; null for a PR story without one — and the number of the step inside it, so a chapter that
 * becomes ready before it moves no answer; the fragment's file and its first and last line, numbered as the step shows
 * them. Numbers and a path, no code.
 */
export const storyQuestionLinesSchema = z
  .object({
    ticket: z.string().regex(/^\d{2,}$/u, 'the Ticket number, two digits at least').nullable(),
    step: z.number().int().min(1),
    path: z.string().min(1).max(500),
    from: z.number().int().min(1),
    to: z.number().int().min(1),
  })
  .strict()
  .refine((lines) => lines.to >= lines.from, { message: 'the last line comes after the first', path: ['to'] })
export type StoryQuestionLines = z.output<typeof storyQuestionLinesSchema>

/** The SHA-256 of a story's canonical JSON, hex (src/main/stories/store.ts, storyDigest). */
export const storyDigestSchema = z.string().regex(/^[0-9a-f]{64}$/u, 'a SHA-256, hex')

/**
 * An answer of the invisible agent to a question about lines of the story (ticket 12): the user's question, the agent's
 * text, what it rests on, the lines it was asked about, the lines of code it quotes as links — never their text; empty
 * when git named no commit of the checkout — and the digest of the story's text it was asked about: a story edited
 * since shows the answer marked as asked about an earlier text.
 */
export const storyAnswerSchema = z
  .object({
    at: z.iso.datetime(),
    /** The user's question. */
    question: z.string().min(1).max(STORY_QUESTION_MAX_CHARS),
    /** The agent's answer. */
    answer: z.string().min(1),
    source: storyAnswerSourceSchema,
    about: storyQuestionLinesSchema,
    lines: z.array(z.string().regex(CODE_LINK, 'path:line@commit or path:from-to@commit')),
    digest: storyDigestSchema,
  })
  .strict()
export type StoryAnswer = z.output<typeof storyAnswerSchema>

/**
 * A story made by the button, as worfy keeps it on this machine. For a colleague's PR (`colleague`) nothing of the
 * colleague is kept — not the PR's text, its comments or its title (ADR-0105): the header's title is `PR #<N>`. Its
 * answers are kept beside it, under the same key, as those of any story (stories.answers).
 */
export const savedStorySchema = z
  .object({
    savedAt: z.iso.datetime(),
    colleague: z.boolean(),
    story: storySchema,
    // A story kept by ticket 08's first build carries its answers (then always none) inside it: read, and dropped.
    answers: z.array(z.unknown()).optional(),
  })
  .strict()
  .transform((saved) => ({ savedAt: saved.savedAt, colleague: saved.colleague, story: saved.story }))
export type SavedStory = z.output<typeof savedStorySchema>

/** The story made by the button under `key`; null when there is none. */
export const storiesSaved = invokeChannel('stories.saved', z.object({ projectId: z.string().min(1), key: storyKeySchema }), savedStorySchema.nullable(), 'project', 'read')

/**
 * How a question ended (ticket 12): the answer, kept with the story (`answer`); Stop (`stopped`: nothing kept); the
 * Project's Vendor without a oneShot (`unavailable`, the reason of its capabilities); or a failure with its reason
 * (`failed`: an answer that does not fit its schema, the Vendor's error).
 */
export const storyAskOutcomeSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('answer'), answer: storyAnswerSchema }),
  z.object({ status: z.literal('stopped') }),
  z.object({ status: z.literal('unavailable'), reason: z.string().min(1) }),
  z.object({ status: z.literal('failed'), reason: z.string().min(1) }),
])
export type StoryAskOutcome = z.output<typeof storyAskOutcomeSchema>

/**
 * Asks the invisible agent of Project `projectId` (its Vendor's oneShot) about lines of `story`: `about` names them,
 * `code` is their text as the step shows it. stories.activity tells each line of what the agent does under
 * `questionId`, and stories.stop with it ends the question. main adds the PR's diff, its text, its review verdicts and
 * the Ticket's file, and keeps the answer with the story (stories.answers). `folder`: the checkout the agent reads, as
 * for stories.build — the Project's root or one of its git worktrees; without one, the worktree where the story's PR
 * head is checked out, else the root. `key`: the key a story made by the button was kept under (`StoryMade.key`,
 * ticket 11): the answer is kept under it, and for `owner/name#N` main reads the PR in that repository (gh `--repo`)
 * and the checkout is that repository's — its worktree at the story's head, else its clone.
 */
export const storiesAsk = invokeChannel(
  'stories.ask',
  z.object({
    questionId: storyIdSchema,
    projectId: z.string().min(1),
    folder: z.string().min(1).optional(),
    story: storyFileSchema,
    about: storyQuestionLinesSchema,
    code: z.string().max(FRAGMENT_MAX_CHARS),
    question: z.string().trim().min(1).max(STORY_QUESTION_MAX_CHARS),
    key: storyKeySchema.optional(),
  }),
  storyAskOutcomeSchema,
  'project',
  'write',
)

// Ticket 11: a story made by the button. The window names only what the story is of; main reads the material itself
// (src/main/stories/by-button.ts) — the diff, the PR's text, the Ticket's file and the verdicts for a PR, the spec and
// the stories of the merged PRs for an Epic before its end — builds it as `stories.build` does, and keeps it
// (src/main/stories/store.ts) under its key.

/** A repository of the Project: on GitHub, `owner/name`; or its name in the Profile (`_resolved.repos`), as a Ticket's `PR: <repo>#N` line spells it. */
export const storyRepoSchema = z.string().regex(/^[A-Za-z0-9_.-]+(\/[A-Za-z0-9_.-]+)?$/u, 'owner/name, or the name of a repository in the Profile')

/**
 * What a story made by the button is of: a PR of the Project (`repo` null — the Project's first repository, as a Ticket's
 * bare `PR: #N` line names it), or an Epic that has no `story.md` yet.
 */
export const storyTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('pr'), repo: storyRepoSchema.nullable(), number: z.number().int().positive() }).strict(),
  z.object({ kind: z.literal('epic'), epic: z.string().min(1).max(200) }).strict(),
])
export type StoryTarget = z.output<typeof storyTargetSchema>

/**
 * How a story made by the button came: `key`, where it is kept (`owner/name#N`, `epic:<name>`); `reused` — the story
 * kept before, opened without a request; `outcome` — as `stories.build` answers, the story as it was kept.
 */
export const storyMadeSchema = z.object({ key: storyKeySchema, reused: z.boolean(), outcome: storyOutcomeSchema })
export type StoryMade = z.output<typeof storyMadeSchema>

/**
 * Makes the story of `target` in Project `projectId` (stories.activity tells each line, stories.stop ends it), or opens
 * the one kept before; `rebuild` builds it again in place of the kept one. A stopped or failed build keeps nothing.
 * A build runs to its end whatever view is open: only Stop ends it (worfy-polish 122). A press on a key that is being
 * built already starts no second request: it hears that build's lines under its own storyId and answers that build's
 * story; its storyId stops that build.
 */
export const storiesMake = invokeChannel(
  'stories.make',
  z.object({ storyId: storyIdSchema, projectId: z.string().min(1), target: storyTargetSchema, rebuild: z.boolean().optional() }),
  storyMadeSchema,
  'project',
  'write',
)

/** How many of the last lines of a build under way main keeps, for a button that comes back to it: as many as the bar shows. */
export const RUNNING_LINES_KEPT = 3

/**
 * The build by the button of `target` under way in Project `projectId` (worfy-polish 122), for a button that comes back
 * to it — after a switch of the PR or the view, or a reload of the window: its storyId (stories.activity, stories.stop,
 * stories.made), the key its story will be kept under and its last lines. Null when none runs.
 */
export const storiesRunning = invokeChannel(
  'stories.running',
  z.object({ projectId: z.string().min(1), target: storyTargetSchema }),
  z.object({ storyId: storyIdSchema, key: storyKeySchema, lines: z.array(z.string()) }).nullable(),
  'project',
  'read',
)

/**
 * The end of a build by the button (worfy-polish 122), sent to the window that pressed: how stories.make answered it.
 * A button that came back to the build ends its bar with it; when no button follows it, the window shows a toast for a
 * story made. A press that joined a build under way gets no event of its own.
 */
export const storiesMadeEvent = eventChannel('stories.made', z.object({ storyId: z.string(), projectId: z.string(), made: storyMadeSchema }), 'project', 'read')

/**
 * The answers kept for `story` in Project `projectId`, oldest first — by what the story names: its file, or the PR or
 * Epic of a story made by the button — and the digest of `story` itself, so the view marks an answer asked about an
 * earlier text. `key`: the key a story made by the button was kept under (`StoryMade.key`), as for stories.ask.
 */
export const storiesAnswers = invokeChannel(
  'stories.answers',
  z.object({ projectId: z.string().min(1), story: storyFileSchema, key: storyKeySchema.optional() }),
  z.object({ digest: storyDigestSchema, answers: z.array(storyAnswerSchema) }),
  'project',
  'read',
)

/**
 * A screen of a story read (ticket 13): a step by its Ticket — a PR story's own, an Epic story's chapter's; null for a
 * PR story without one — and its number inside it, as the answers about lines name it (storyQuestionLinesSchema), so a
 * chapter that becomes ready before it moves no mark; any other screen of an Epic story, and "Check yourself", by name.
 */
export const storyReadMarkSchema = z.union([
  z
    .object({ ticket: z.string().regex(/^\d{2,}$/u, 'the Ticket number, two digits at least').nullable(), step: z.number().int().min(1) })
    .strict(),
  z.object({ screen: z.enum(['start', 'seams', 'summary', 'check', 'check-yourself']) }).strict(),
])
export type StoryReadMark = z.output<typeof storyReadMarkSchema>

/** The longest answer a person gives to a question of "Check yourself", and the longest question kept with it. */
export const SELF_CHECK_MAX_CHARS = 4_000

/**
 * The person's answer to a question of "Check yourself" (ticket 13): the question as the story asks it — the answer is
 * matched to it by its text, so a story asked anew keeps the answers to the same questions — and their own words, or
 * null for "I don't know". Nothing depends on it (owner decision 15).
 */
export const storySelfCheckSchema = z
  .object({
    at: z.iso.datetime(),
    question: z.string().min(1).max(SELF_CHECK_MAX_CHARS),
    answer: z.string().min(1).max(SELF_CHECK_MAX_CHARS).nullable(),
  })
  .strict()
export type StorySelfCheck = z.output<typeof storySelfCheckSchema>

/**
 * The screens of `story` read and the answers to its "Check yourself", kept in worfy's data under what the story names
 * (`key`, as its answers about lines: stories.answers); the window names `key` when it adds to them. For a story made by
 * the button the window names the key it was kept under, as for stories.answers (worfy-code-stories ticket 11).
 */
export const storiesMarks = invokeChannel(
  'stories.marks',
  z.object({ projectId: z.string().min(1), story: storyFileSchema, key: storyKeySchema.optional() }),
  z.object({ key: storyKeySchema, read: z.array(storyReadMarkSchema), checks: z.array(storySelfCheckSchema) }),
  'project',
  'read',
)

/** Keeps a screen of the story under `key` as read; `kept` is false when it was kept already. */
export const storiesMarkRead = invokeChannel(
  'stories.markRead',
  z.object({ projectId: z.string().min(1), key: storyKeySchema, mark: storyReadMarkSchema }),
  z.object({ kept: z.boolean() }),
  'project',
  'write',
)

/** Keeps the person's answer to a question of "Check yourself" under `key`, in place of an earlier one to it. */
export const storiesSelfCheck = invokeChannel(
  'stories.selfCheck',
  z.object({
    projectId: z.string().min(1),
    key: storyKeySchema,
    answer: z.object({ question: z.string().min(1).max(SELF_CHECK_MAX_CHARS), answer: z.string().trim().min(1).max(SELF_CHECK_MAX_CHARS).nullable() }).strict(),
  }),
  storySelfCheckSchema,
  'project',
  'write',
)

declare module './channels' {
  interface IpcContract {
    'stories.make': typeof storiesMake
    'stories.running': typeof storiesRunning
    'stories.made': typeof storiesMadeEvent
    'stories.build': typeof storiesBuild
    'stories.stop': typeof storiesStop
    'stories.activity': typeof storiesActivity
    'stories.read': typeof storiesRead
    'stories.code': typeof storiesCode
    'stories.saved': typeof storiesSaved
    'stories.ask': typeof storiesAsk
    'stories.answers': typeof storiesAnswers
    'stories.marks': typeof storiesMarks
    'stories.markRead': typeof storiesMarkRead
    'stories.selfCheck': typeof storiesSelfCheck
  }
}
