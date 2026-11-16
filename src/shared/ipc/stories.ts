// IPC of Code stories (Epic worfy-code-stories, ticket 04): the invisible build of a story through the
// oneShot of the Project's Vendor (src/main/stories/one-shot.ts), its progress lines and its Stop. No
// Session and no Session Node: the window shows only a progress bar where the pressed button was
// (src/renderer/stories/StoryProgress.tsx). The buttons that start it come with tickets 11 and 12.
import { z } from 'zod'
import { storyHeaderSchema, storySchema } from '../stories/schema'
import { eventChannel, invokeChannel } from './channels'

/** A diff, a PR's text or a Ticket larger than this is not sent to a model whole; the caller trims it. */
export const STORY_INPUT_MAX_CHARS = 1_000_000

const material = z.string().max(STORY_INPUT_MAX_CHARS)

/** What the agent explains: it cannot run git (oneShot has no Bash), so the diff comes in the request. */
export const storyInputSchema = z.object({
  header: storyHeaderSchema,
  /** The diff of the PR, as `gh pr diff` prints it. */
  diff: material.min(1),
  /** The PR's title and description. */
  prText: material,
  /** The Ticket's file; null when the PR has none. */
  ticket: material.nullable(),
  /** The review verdicts of the PR, if there are any. */
  verdicts: z.array(material).max(20),
})
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

/** Builds the story of `input` in Project `projectId` on its Vendor; stories.activity tells each line while it runs. */
export const storiesBuild = invokeChannel('stories.build', z.object({ storyId: storyIdSchema, projectId: z.string().min(1), input: storyInputSchema }), storyOutcomeSchema, 'project', 'write')

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
