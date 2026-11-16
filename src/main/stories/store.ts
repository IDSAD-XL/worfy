// The stories made by the button and their answers (worfy-code-stories ticket 08; spec, owner decisions 9 and 25):
// `<Project data folder>/stories.json`, next to pr-inbox.json (src/main/projects/pr-inbox-state.ts), in worfy's own
// data folder (ADR-0005). By key: `owner/name#N` for a PR, `epic:<name>` for an Epic before its end. The story is
// the agent's text; an answer is the agent's text and links `path:line@commit` (shared/ipc/stories.ts).
//
// A colleague's PR keeps no word of the colleague (ADR-0105: "the words of colleagues stay in main's memory only"):
// not the PR's text, not its comments — nothing but the story is taken from what the caller passes — and not the PR's
// title either, which the header of its story would carry: it becomes `PR #<N>`.
//
// Each entry is read on its own: one that this build cannot read (a newer worfy wrote it, or it was cut) is left out of
// the answer and kept in the file. A file that is no JSON is set aside by readJsonFile, as pr-inbox.json is. Every
// write is atomic (writeJsonFile: a temporary file in the same folder, then a rename).
import { join } from 'node:path'
import { z } from 'zod'
import { savedStorySchema, storyAnswerSchema, type SavedStory, type StoryAnswer } from '../../shared/ipc/stories'
import type { Story } from '../../shared/stories/schema'
import { readJsonFile, writeJsonFile } from '../storage/json-file'

export const STORIES_FILE = 'stories.json'

/** The file: entries by key, each read against savedStorySchema on its own. */
const storiesFileSchema = z.object({ stories: z.record(z.string(), z.unknown()) })
type StoriesFile = z.output<typeof storiesFileSchema>

export function storiesPath(projectDataDir: string): string {
  return join(projectDataDir, STORIES_FILE)
}

const readFile = (projectDataDir: string): StoriesFile => readJsonFile(storiesPath(projectDataDir), storiesFileSchema) ?? { stories: {} }

/** Every story this build can read, by key. */
export function readSavedStories(projectDataDir: string): Record<string, SavedStory> {
  const read: Record<string, SavedStory> = {}
  for (const [key, entry] of Object.entries(readFile(projectDataDir).stories)) {
    const parsed = savedStorySchema.safeParse(entry)
    if (parsed.success) read[key] = parsed.data
  }
  return read
}

/** The story under `key`; null when there is none, or none this build can read. */
export function readSavedStory(projectDataDir: string, key: string): SavedStory | null {
  const parsed = savedStorySchema.safeParse(readFile(projectDataDir).stories[key])
  return parsed.success ? parsed.data : null
}

/** Writes `entry` under `key`; the other entries stay as they are. Throws, writing nothing, when it does not fit. */
function write(projectDataDir: string, key: string, entry: SavedStory): SavedStory {
  const checked = savedStorySchema.safeParse(entry)
  if (!checked.success) throw new Error(`refusing to write ${storiesPath(projectDataDir)}: the story does not match its schema\n${z.prettifyError(checked.error)}`)
  const file = readFile(projectDataDir)
  writeJsonFile(storiesPath(projectDataDir), storiesFileSchema, { stories: { ...file.stories, [key]: checked.data } })
  return checked.data
}

/** What a build hands to the store: the story and whether the PR is a colleague's. Nothing else of the PR is kept. */
export interface StoryToSave {
  story: Story
  colleague: boolean
}

/** The story without a colleague's words: the title of their PR is their text. */
function withoutColleague(story: Story): Story {
  if (story.kind !== 'pr') return story
  return { ...story, header: { ...story.header, title: story.header.pr === null ? 'PR' : `PR #${String(story.header.pr)}` } }
}

/**
 * Keeps the story made by the button under `key`, in place of one kept before: the answers were about that one and go
 * with it. Answers what was written.
 */
export function saveStory(projectDataDir: string, key: string, input: StoryToSave, now: Date = new Date()): SavedStory {
  const story = input.colleague ? withoutColleague(input.story) : input.story
  return write(projectDataDir, key, { savedAt: now.toISOString(), colleague: input.colleague, story, answers: [] })
}

/** Adds an answer to the story under `key`; null when there is no such story. Throws, writing nothing, when it does not fit. */
export function addStoryAnswer(projectDataDir: string, key: string, answer: StoryAnswer): SavedStory | null {
  const saved = readSavedStory(projectDataDir, key)
  if (saved === null) return null
  const checked = storyAnswerSchema.safeParse(answer)
  if (!checked.success) throw new Error(`refusing to write ${storiesPath(projectDataDir)}: the answer does not match its schema\n${z.prettifyError(checked.error)}`)
  return write(projectDataDir, key, { ...saved, answers: [...saved.answers, checked.data] })
}
