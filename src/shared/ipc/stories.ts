// IPC of Code stories (Epic worfy-code-stories, ticket 04): the invisible build of a story through the
// oneShot of the Project's Vendor (src/main/stories/one-shot.ts), its progress lines and its Stop. No
// Session and no Session Node: the window shows only a progress bar where the pressed button was
// (src/renderer/stories/StoryProgress.tsx). The buttons that start it come with tickets 11 and 12.
//
// Ticket 08 adds the reads: a story file of an Epic (`stories.read`, from the source the workflow is read from,
// ADR-0107), the code of one of its fragments from git (`stories.code`, TICKETS.md "Story anchor"), and a story made
// by the button with its answers (`stories.saved`, src/main/stories/store.ts).
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

/** Stop of the progress bar: ends the build `storyId`; false when none runs under it. */
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
 * read at that PR's merge commit or head; null or absent for `PR -`, and in Full mode it is not needed.
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

/** An answer of the invisible agent to a question about the story (ticket 12): the agent's text and links to code. */
export const storyAnswerSchema = z
  .object({
    at: z.iso.datetime(),
    /** The user's question. */
    question: z.string().min(1),
    /** The agent's answer. */
    answer: z.string().min(1),
    lines: z.array(z.string().regex(CODE_LINK, 'path:line@commit or path:from-to@commit')),
  })
  .strict()
export type StoryAnswer = z.output<typeof storyAnswerSchema>

/**
 * A story made by the button, as worfy keeps it on this machine. For a colleague's PR (`colleague`) nothing of the
 * colleague is kept — not the PR's text, its comments or its title (ADR-0105): the header's title is `PR #<N>`.
 */
export const savedStorySchema = z
  .object({
    savedAt: z.iso.datetime(),
    colleague: z.boolean(),
    story: storySchema,
    answers: z.array(storyAnswerSchema),
  })
  .strict()
export type SavedStory = z.output<typeof savedStorySchema>

/** The story made by the button under `key` with its answers; null when there is none. */
export const storiesSaved = invokeChannel('stories.saved', z.object({ projectId: z.string().min(1), key: storyKeySchema }), savedStorySchema.nullable(), 'project', 'read')

declare module './channels' {
  interface IpcContract {
    'stories.build': typeof storiesBuild
    'stories.stop': typeof storiesStop
    'stories.activity': typeof storiesActivity
    'stories.read': typeof storiesRead
    'stories.code': typeof storiesCode
    'stories.saved': typeof storiesSaved
  }
}
