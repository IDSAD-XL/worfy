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
//
// The answers to questions about lines of a story (ticket 12) are kept here too, in one place for any story the view
// shows — a committed story file as well as one made by the button: by what the story names (`answers`,
// storyAnswersKey below), so an edit of the story or a new build keeps them. Each answer carries the digest of the text
// it was asked about (storyDigest), and the view marks one asked about an earlier text. An answer is the agent's text,
// the user's question, what the answer rests on, the lines asked about and links `path:line@commit` — never the code,
// the PR's text or a verdict it quotes.
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { z } from 'zod'
import { savedStorySchema, storyAnswerSchema, type SavedStory, type StoryAnswer } from '../../shared/ipc/stories'
import type { Story, StoryFile } from '../../shared/stories/schema'
import { readJsonFile, writeJsonFile } from '../storage/json-file'

export const STORIES_FILE = 'stories.json'

/**
 * The file: the stories made by the button by key, each read against savedStorySchema on its own; the answers to
 * questions by the key of their story (storyAnswersKey), each answer read against storyAnswerSchema on its own.
 */
const storiesFileSchema = z.object({ stories: z.record(z.string(), z.unknown()), answers: z.record(z.string(), z.unknown()).optional() })
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
  writeJsonFile(storiesPath(projectDataDir), storiesFileSchema, { ...file, stories: { ...file.stories, [key]: checked.data } })
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
 * Keeps the story made by the button under `key`, in place of one kept before. Its answers stay: they are kept under
 * the same key (addStoryAnswer), each with the digest of the text it was asked about. Answers what was written.
 */
export function saveStory(projectDataDir: string, key: string, input: StoryToSave, now: Date = new Date()): SavedStory {
  const story = input.colleague ? withoutColleague(input.story) : input.story
  return write(projectDataDir, key, { savedAt: now.toISOString(), colleague: input.colleague, story })
}

/** A JSON text of `value` with the keys of each object in order: the same story gives the same text. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined)
    return `{${entries
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

/** The SHA-256 of the canonical JSON of `story`, hex: the same text gives the same digest, an edit another. */
export function storyDigest(story: StoryFile): string {
  return createHash('sha256').update(canonical(story)).digest('hex')
}

/** What main knows of where `story` comes from: its file under the Tickets root, the Project's `owner/name` on GitHub. */
export interface StoryNames {
  file: string | null
  repo: string | null
}

/**
 * The key the answers of `story` are kept under — what the story names, so an edit keeps them. A committed story
 * (no commit in its header): its file. A story made by the button: `owner/name#N` for a PR, as saveStory keeps it. An
 * Epic story: its file, else `epic:<name>`. Nothing named: `story:` and its digest, so a question is still kept.
 */
export function storyAnswersKey(story: StoryFile, names: StoryNames): string {
  if (story.kind === 'pr') {
    if (story.header.commit === null && names.file !== null) return names.file
    if (story.header.pr !== null && names.repo !== null) return `${names.repo}#${String(story.header.pr)}`
    if (names.file !== null) return names.file
    return `story:${storyDigest(story)}`
  }
  return names.file ?? `epic:${story.header.epic}`
}

/** The answers kept under `key`, oldest first; one this build cannot read is left out, and kept in the file. */
export function readStoryAnswers(projectDataDir: string, key: string): StoryAnswer[] {
  const kept = readFile(projectDataDir).answers?.[key]
  return (Array.isArray(kept) ? (kept as unknown[]) : []).flatMap((entry) => {
    const parsed = storyAnswerSchema.safeParse(entry)
    return parsed.success ? [parsed.data] : []
  })
}

/** Adds `answer` to the answers kept under `key`; the rest of the file stays as it is. Throws, writing nothing, when it does not fit. */
export function addStoryAnswer(projectDataDir: string, key: string, answer: StoryAnswer): void {
  const checked = storyAnswerSchema.safeParse(answer)
  if (!checked.success) throw new Error(`refusing to write ${storiesPath(projectDataDir)}: the answer does not match its schema\n${z.prettifyError(checked.error)}`)
  const file = readFile(projectDataDir)
  const answers = file.answers ?? {}
  const before = answers[key]
  writeJsonFile(storiesPath(projectDataDir), storiesFileSchema, { ...file, answers: { ...answers, [key]: [...(Array.isArray(before) ? (before as unknown[]) : []), checked.data] } })
}
