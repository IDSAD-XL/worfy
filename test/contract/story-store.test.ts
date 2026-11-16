// The store of the stories made by the button and of their answers (worfy-code-stories ticket 08):
// `<Project data folder>/stories.json`, in worfy's own data folder (ADR-0005), a zod schema and an atomic write, as
// pr-inbox.json (src/main/projects/pr-inbox-state.ts). A colleague's PR keeps no word of the colleague — no PR text,
// no comment, not the PR's title: only the agent's text and links `path:line@commit` (ADR-0105).
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { addStoryAnswer, readSavedStories, readSavedStory, saveStory, storiesPath, STORIES_FILE } from '../../src/main/stories/store'
import type { PrStoryAnswer, Story, StoryFile } from '../../src/shared/stories/schema'
import { removeTestTree } from '../remove'

const ANSWERS = join(import.meta.dirname, '..', 'fixtures', 'code-story-answers')
const HEAD = 'a'.repeat(40)

/** The English PR story of the shared cases, as a story made by the button for `title`. */
const prStory = (title: string): Story => ({
  kind: 'pr',
  header: { title, epic: null, ticket: null, pr: 77, language: 'en', commit: HEAD },
  ...(JSON.parse(readFileSync(join(ANSWERS, 'pr-en.json'), 'utf8')) as PrStoryAnswer),
})

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'worfy-story-store-'))
})

afterEach(() => {
  vi.restoreAllMocks()
  removeTestTree(dir)
})

describe('the store of the stories made by the button', () => {
  it('keeps a story and its answers in stories.json of the Project data folder, and reads them back after a restart', () => {
    expect(readSavedStory(dir, 'owner/name#77')).toBeNull()
    const saved = saveStory(dir, 'owner/name#77', { story: prStory('Cart total in cents'), colleague: false }, new Date('2026-11-16T10:00:00Z'))
    expect(saved).toEqual({ savedAt: '2026-11-16T10:00:00.000Z', colleague: false, story: prStory('Cart total in cents'), answers: [] })
    // A story kept by the button is a story file too: a view of story files shows it (typecheck holds this line).
    const shown: StoryFile = saved.story
    expect(shown.kind).toBe('pr')
    const answer = { at: '2026-11-16T10:05:00.000Z', question: 'Why cents?', answer: 'Floats drift.', lines: [`src/cart.ts:14@${HEAD}`] }
    addStoryAnswer(dir, 'owner/name#77', answer)
    expect(storiesPath(dir)).toBe(join(dir, STORIES_FILE))
    expect(readSavedStory(dir, 'owner/name#77')).toEqual({ ...saved, answers: [answer] })
    // A new build of the same PR replaces the story; the answers were about the old one.
    saveStory(dir, 'owner/name#77', { story: prStory('Cart total in cents'), colleague: false })
    expect(readSavedStory(dir, 'owner/name#77')?.answers).toEqual([])
  })

  it('writes atomically: no temporary file is left, and a story outside the schema is refused with the file as it was', () => {
    saveStory(dir, 'owner/name#77', { story: prStory('First'), colleague: false })
    const before = readFileSync(storiesPath(dir), 'utf8')
    const broken = { ...prStory('Second'), header: { ...prStory('Second').header, commit: 'not a sha' } } as Story
    expect(() => saveStory(dir, 'owner/name#78', { story: broken, colleague: false })).toThrow(/schema/u)
    expect(readFileSync(storiesPath(dir), 'utf8')).toBe(before)
    expect(readdirSync(dir)).toEqual([STORIES_FILE])
  })

  it('a file that does not fit the schema does not stop the read: a broken entry is left out and kept; a file that is no JSON is set aside', () => {
    saveStory(dir, 'owner/name#77', { story: prStory('Kept'), colleague: false })
    const file = JSON.parse(readFileSync(storiesPath(dir), 'utf8')) as { stories: Record<string, unknown> }
    file.stories['owner/name#78'] = { savedAt: 'yesterday', story: { kind: 'book' } }
    writeFileSync(storiesPath(dir), JSON.stringify(file))
    expect(Object.keys(readSavedStories(dir))).toEqual(['owner/name#77'])
    expect(readSavedStory(dir, 'owner/name#78')).toBeNull()
    // Another write keeps the entry this build cannot read: a newer worfy may have written it.
    saveStory(dir, 'epic:demo-cart-x', { story: prStory('Other'), colleague: false })
    expect(Object.keys((JSON.parse(readFileSync(storiesPath(dir), 'utf8')) as { stories: object }).stories).sort()).toEqual(['epic:demo-cart-x', 'owner/name#77', 'owner/name#78'])

    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    writeFileSync(storiesPath(dir), '{ not json')
    expect(readSavedStories(dir)).toEqual({})
    expect(readdirSync(dir).some((name) => name.startsWith(`${STORIES_FILE}.unreadable-`))).toBe(true)
  })

  it("keeps no word of a colleague's PR: neither its text, its comments nor its title — only the agent's text and links path:line@commit", () => {
    const words = 'The words of a colleague that never reach the disk'
    const input = { story: prStory(words), colleague: true, prText: words, comments: [words] }
    const saved = saveStory(dir, 'owner/name#77', input as Parameters<typeof saveStory>[2])
    expect(saved.story.header).toMatchObject({ title: 'PR #77', pr: 77, commit: HEAD })
    addStoryAnswer(dir, 'owner/name#77', { at: '2026-11-16T10:05:00.000Z', question: 'Why?', answer: 'Because.', lines: [`src/cart.ts:10-17@${HEAD}`] })
    const text = readFileSync(storiesPath(dir), 'utf8')
    expect(text).not.toContain(words)
    expect(text).not.toContain('prText')
    expect(text).not.toContain('comments')
    // A link that is not path:line@commit is refused.
    expect(() => addStoryAnswer(dir, 'owner/name#77', { at: '2026-11-16T10:06:00.000Z', question: 'Why?', answer: 'Because.', lines: ['src/cart.ts:10'] })).toThrow(/schema/u)
  })

  it('writes only into the Project data folder it is given', () => {
    const data = join(dir, 'data', 'project-1')
    mkdirSync(data, { recursive: true })
    saveStory(data, 'owner/name#77', { story: prStory('x'), colleague: false })
    expect(readdirSync(dir)).toEqual(['data'])
    expect(readdirSync(data)).toEqual([STORIES_FILE])
    expect(existsSync(join(data, '..', STORIES_FILE))).toBe(false)
  })
})
