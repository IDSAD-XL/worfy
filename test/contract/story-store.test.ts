// The store of the stories made by the button and of their answers (worfy-code-stories ticket 08):
// `<Project data folder>/stories.json`, in worfy's own data folder (ADR-0005), a zod schema and an atomic write, as
// pr-inbox.json (src/main/projects/pr-inbox-state.ts). A colleague's PR keeps no word of the colleague — no PR text,
// no comment, not the PR's title: only the agent's text and links `path:line@commit` (ADR-0105).
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { addStoryAnswer, addStoryReadMark, keepSelfCheck, readSavedStories, readSavedStory, readStoryAnswers, readStoryMarks, saveStory, storiesPath, storyAnswersKey, storyDigest, STORIES_FILE } from '../../src/main/stories/store'
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
  it('keeps a story in stories.json of the Project data folder and reads it back after a restart; its answers stay through a new build', () => {
    expect(readSavedStory(dir, 'owner/name#77')).toBeNull()
    const saved = saveStory(dir, 'owner/name#77', { story: prStory('Cart total in cents'), colleague: false }, new Date('2026-11-16T10:00:00Z'))
    expect(saved).toEqual({ savedAt: '2026-11-16T10:00:00.000Z', colleague: false, story: prStory('Cart total in cents') })
    // A story kept by the button is a story file too: a view of story files shows it (typecheck holds this line).
    const shown: StoryFile = saved.story
    expect(shown.kind).toBe('pr')
    const answer = { at: '2026-11-16T10:05:00.000Z', question: 'Why cents?', answer: 'Floats drift.', source: 'code' as const, about: { ticket: null, step: 2, path: 'src/cart.ts', from: 13, to: 14 }, lines: [`src/cart.ts:14@${HEAD}`], digest: storyDigest(saved.story) }
    addStoryAnswer(dir, 'owner/name#77', answer)
    expect(storiesPath(dir)).toBe(join(dir, STORIES_FILE))
    expect(readStoryAnswers(dir, 'owner/name#77')).toEqual([answer])
    // A new build of the same PR replaces the story; its answers stay, each with the digest of the text it was asked about.
    saveStory(dir, 'owner/name#77', { story: prStory('Cart total in whole cents'), colleague: false })
    expect(readStoryAnswers(dir, 'owner/name#77')).toEqual([answer])
    expect(answer.digest).not.toBe(storyDigest(readSavedStory(dir, 'owner/name#77')!.story))
  })

  it('writes atomically: no temporary file is left, and a story outside the schema is refused with the file as it was', () => {
    saveStory(dir, 'owner/name#77', { story: prStory('First'), colleague: false })
    const before = readFileSync(storiesPath(dir), 'utf8')
    const broken = { ...prStory('Second'), header: { ...prStory('Second').header, commit: 'not a sha' } } as Story
    expect(() => saveStory(dir, 'owner/name#78', { story: broken, colleague: false })).toThrow(/schema/u)
    expect(readFileSync(storiesPath(dir), 'utf8')).toBe(before)
    expect(readdirSync(dir)).toEqual([STORIES_FILE])
  })

  it('reads a story kept by the first build of ticket 08, with its answers inside it, and drops them', () => {
    const story = prStory('Kept before ticket 12')
    writeFileSync(storiesPath(dir), JSON.stringify({ stories: { 'owner/name#77': { savedAt: '2026-11-15T09:00:00.000Z', colleague: false, story, answers: [] } } }))
    expect(readSavedStory(dir, 'owner/name#77')).toEqual({ savedAt: '2026-11-15T09:00:00.000Z', colleague: false, story })
    expect(Object.keys(readSavedStories(dir))).toEqual(['owner/name#77'])
    // A rebuild writes it without them.
    saveStory(dir, 'owner/name#77', { story, colleague: false })
    expect((JSON.parse(readFileSync(storiesPath(dir), 'utf8')) as { stories: Record<string, object> }).stories['owner/name#77']).not.toHaveProperty('answers')
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
    addStoryAnswer(dir, 'owner/name#77', { at: '2026-11-16T10:05:00.000Z', question: 'Why?', answer: 'Because.', source: 'code', about: { ticket: null, step: 2, path: 'src/cart.ts', from: 13, to: 14 }, lines: [`src/cart.ts:10-17@${HEAD}`], digest: storyDigest(saved.story) })
    const text = readFileSync(storiesPath(dir), 'utf8')
    expect(text).not.toContain(words)
    expect(text).not.toContain('prText')
    expect(text).not.toContain('comments')
    // A link that is not path:line@commit is refused.
    expect(() => addStoryAnswer(dir, 'owner/name#77', { at: '2026-11-16T10:06:00.000Z', question: 'Why?', answer: 'Because.', source: 'code', about: { ticket: null, step: 2, path: 'src/cart.ts', from: 13, to: 14 }, lines: ['src/cart.ts:10'], digest: storyDigest(saved.story) })).toThrow(/schema/u)
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

describe('the answers to questions about lines of a story (ticket 12)', () => {
  const made = prStory('Cart total in cents')
  const committed = { ...made, header: { ...(made.header as Extract<StoryFile, { kind: 'pr' }>['header']), commit: null } } as StoryFile
  const answer = (question: string, story: StoryFile = committed) => ({
    at: '2026-11-16T11:00:00.000Z',
    question,
    answer: 'Floats drift.',
    source: 'code' as const,
    about: { ticket: null, step: 2, path: 'src/cart.ts', from: 13, to: 14 },
    lines: [`src/cart.ts:13@${HEAD}`],
    digest: storyDigest(story),
  })

  it('keys them by what the story names: its file for a committed story, owner/name#N for one made by the button, epic:<name> for an Epic before its file', () => {
    expect(storyAnswersKey(committed, { file: 'demo-cart/stories/04-cart-total.md', repo: 'owner/name' })).toBe('demo-cart/stories/04-cart-total.md')
    expect(storyAnswersKey(made, { file: 'demo-cart/stories/04-cart-total.md', repo: 'owner/name' })).toBe('owner/name#77')
    const epic = { kind: 'epic', header: { epic: 'demo-cart', language: 'ru' }, start: { text: 'x', requirement: 'y' }, chapters: [], seams: { text: '', handoffs: [] }, summary: '', check: '', checkYourself: [] } as unknown as StoryFile
    expect(storyAnswersKey(epic, { file: 'demo-cart/story.md', repo: null })).toBe('demo-cart/story.md')
    expect(storyAnswersKey(epic, { file: null, repo: null })).toBe('epic:demo-cart')
    // Nothing named: the digest of the text, so a question is still kept.
    expect(storyAnswersKey(committed, { file: null, repo: null })).toBe(`story:${storyDigest(committed)}`)
  })

  it('keeps them under the key, with the digest of the text asked about; an edit of the story keeps them', () => {
    saveStory(dir, 'owner/name#77', { story: made, colleague: false })
    expect(readStoryAnswers(dir, 'demo-cart/stories/04-cart-total.md')).toEqual([])
    addStoryAnswer(dir, 'demo-cart/stories/04-cart-total.md', answer('Why cents?'))
    addStoryAnswer(dir, 'demo-cart/stories/04-cart-total.md', answer('Why skip zero?'))
    expect(readStoryAnswers(dir, 'demo-cart/stories/04-cart-total.md').map((one) => one.question)).toEqual(['Why cents?', 'Why skip zero?'])
    expect(readStoryAnswers(dir, 'owner/name#77')).toEqual([])
    expect(readSavedStory(dir, 'owner/name#77')?.story).toEqual(made)
    // The digest does not depend on the order of the keys: the same story read again gives the same one.
    const again = JSON.parse(JSON.stringify({ ...committed, header: Object.fromEntries(Object.entries(committed.header).reverse()) })) as StoryFile
    expect(storyDigest(again)).toBe(storyDigest(committed))
    expect(storyDigest(again)).toMatch(/^[0-9a-f]{64}$/u)
    expect(storyDigest(made)).not.toBe(storyDigest(committed))
  })

  it('keeps an answer about a step of Ticket 121: a Ticket number has two digits at least', () => {
    const about = { ticket: '121', step: 2, path: 'src/cart.ts', from: 13, to: 14 }
    addStoryAnswer(dir, 'k', { ...answer('Why cents?'), about })
    expect(readStoryAnswers(dir, 'k').map((one) => one.about)).toEqual([about])
  })

  it('refuses an answer that does not fit, writing nothing; leaves out a kept one this build cannot read', () => {
    expect(() => addStoryAnswer(dir, 'k', { ...answer('Why?'), about: { ...answer('Why?').about, ticket: '4' } } as never)).toThrow(/schema/u)
    expect(() => addStoryAnswer(dir, 'k', { ...answer('Why?'), about: { ...answer('Why?').about, ticket: '0a' } } as never)).toThrow(/schema/u)
    expect(() => addStoryAnswer(dir, 'k', { ...answer('Why?'), lines: ['src/cart.ts:13'] })).toThrow(/schema/u)
    expect(() => addStoryAnswer(dir, 'k', { ...answer('Why?'), digest: 'short' })).toThrow(/schema/u)
    expect(existsSync(storiesPath(dir))).toBe(false)
    writeFileSync(storiesPath(dir), JSON.stringify({ stories: {}, answers: { k: [{ newer: true }, answer('Kept')] } }))
    expect(readStoryAnswers(dir, 'k').map((one) => one.question)).toEqual(['Kept'])
  })
})

describe('the "read" marks and the answers to "Check yourself" (ticket 13)', () => {
  const KEY = 'demo-cart/stories/04-cart-total.md'
  const check = (question: string, answer: string | null, at = '2026-11-16T12:00:00.000Z') => ({ at, question, answer })

  it('keeps them under the key of the story, beside its answers, in the one stories.json; a mark kept once is kept once', () => {
    expect(readStoryMarks(dir, KEY)).toEqual({ read: [], checks: [] })
    saveStory(dir, 'owner/name#77', { story: prStory('Cart total in cents'), colleague: false })
    addStoryAnswer(dir, KEY, {
      at: '2026-11-16T11:00:00.000Z',
      question: 'Why cents?',
      answer: 'Floats drift.',
      source: 'code',
      about: { ticket: '04', step: 2, path: 'src/cart.ts', from: 13, to: 14 },
      lines: [],
      digest: 'c'.repeat(64),
    })
    expect(addStoryReadMark(dir, KEY, { ticket: '04', step: 2 })).toBe(true)
    expect(addStoryReadMark(dir, KEY, { screen: 'check-yourself' })).toBe(true)
    expect(addStoryReadMark(dir, KEY, { ticket: '04', step: 2 })).toBe(false)
    keepSelfCheck(dir, KEY, check('Why cents?', 'Floats drift.'))
    keepSelfCheck(dir, KEY, check('What of a zero quantity?', null))
    // The same question answered again: the newer answer stands in place of the older one.
    keepSelfCheck(dir, KEY, check('Why cents?', 'Whole numbers add exactly.', '2026-11-16T13:00:00.000Z'))

    // As after a restart: read from the file again.
    expect(readStoryMarks(dir, KEY)).toEqual({
      read: [{ ticket: '04', step: 2 }, { screen: 'check-yourself' }],
      checks: [check('What of a zero quantity?', null), check('Why cents?', 'Whole numbers add exactly.', '2026-11-16T13:00:00.000Z')],
    })
    expect(readStoryMarks(dir, 'owner/name#77')).toEqual({ read: [], checks: [] })
    // One file: the story made by the button and the line answers stay as they were.
    expect(readdirSync(dir)).toEqual([STORIES_FILE])
    expect(readSavedStory(dir, 'owner/name#77')?.story).toEqual(prStory('Cart total in cents'))
    expect(readStoryAnswers(dir, KEY).map((one) => one.question)).toEqual(['Why cents?'])
    // A new line answer keeps the marks.
    addStoryAnswer(dir, KEY, { ...readStoryAnswers(dir, KEY)[0]!, question: 'And zero?' })
    expect(readStoryMarks(dir, KEY).read).toHaveLength(2)
  })

  it('keeps a mark of a step of Ticket 121: a Ticket number has two digits at least', () => {
    expect(addStoryReadMark(dir, KEY, { ticket: '121', step: 1 })).toBe(true)
    expect(readStoryMarks(dir, KEY).read).toEqual([{ ticket: '121', step: 1 }])
  })

  it('refuses a mark or an answer that does not fit, writing nothing; leaves out a kept one this build cannot read', () => {
    expect(() => addStoryReadMark(dir, KEY, { ticket: '4', step: 1 } as never)).toThrow(/schema/u)
    expect(() => addStoryReadMark(dir, KEY, { ticket: '0a', step: 1 } as never)).toThrow(/schema/u)
    expect(() => addStoryReadMark(dir, KEY, { screen: 'elsewhere' } as never)).toThrow(/schema/u)
    expect(() => keepSelfCheck(dir, KEY, check('', 'x'))).toThrow(/schema/u)
    expect(existsSync(storiesPath(dir))).toBe(false)
    writeFileSync(storiesPath(dir), JSON.stringify({ stories: {}, read: { [KEY]: [{ newer: true }, { ticket: null, step: 1 }] }, checks: { [KEY]: [{ newer: true }, check('Kept?', 'yes')] } }))
    expect(readStoryMarks(dir, KEY)).toEqual({ read: [{ ticket: null, step: 1 }], checks: [check('Kept?', 'yes')] })
    // What this build cannot read stays in the file when it writes.
    addStoryReadMark(dir, KEY, { ticket: null, step: 2 })
    expect(JSON.parse(readFileSync(storiesPath(dir), 'utf8')).read[KEY]).toEqual([{ newer: true }, { ticket: null, step: 1 }, { ticket: null, step: 2 }])
  })
})
