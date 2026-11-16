// IPC of Code stories (Epic worfy-code-stories, ticket 04): the invisible build of a story through the
// oneShot of the Project's Vendor (src/main/stories/one-shot.ts), its progress lines and its Stop. No
// Session and no Session Node: the window shows only a progress bar where the pressed button was
// (src/renderer/stories/StoryProgress.tsx). The buttons that start it come with tickets 11 and 12.
import { z } from 'zod'
import { epicStoryHeaderSchema, prStoryHeaderSchema, storySchema } from '../stories/schema'
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

declare module './channels' {
  interface IpcContract {
    'stories.build': typeof storiesBuild
    'stories.stop': typeof storiesStop
    'stories.activity': typeof storiesActivity
  }
}
