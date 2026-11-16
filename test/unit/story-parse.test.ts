// The parser of a Code story file (src/shared/stories/parse.ts, worfy-code-stories ticket 08) on the shared cases of
// the format, harness/bin/tests/fixtures/code-story/: the files the Harness's story-check reads too. Each clean case
// parses into the same steps, fields and code as its JSON twin of test/fixtures/code-story-answers/, which ticket 04
// wrote by hand from the same Markdown; the header comes from the file's own title and header line.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseStory } from '../../src/shared/stories/parse'
import { storyFileSchema, storySchema, type EpicStoryAnswer, type PrStoryAnswer } from '../../src/shared/stories/schema'

const SHARED = join(__dirname, '..', '..', 'harness', 'bin', 'tests', 'fixtures', 'code-story')
const ANSWERS = join(__dirname, '..', 'fixtures', 'code-story-answers')

const story = (name: string): string => readFileSync(join(SHARED, name), 'utf8')
const answer = <T>(name: string): T => JSON.parse(readFileSync(join(ANSWERS, name), 'utf8')) as T

/**
 * The twin with one empty line where it has several: the parser keeps one where a fragment taken out of a frame's prose
 * left more (the review step of pr-ru.md), the hand-written twin kept them all.
 */
const oneEmptyLine = <T>(value: T): T => JSON.parse(JSON.stringify(value).replace(/(\\n){3,}/gu, '\\n\\n')) as T

const parsed = (name: string) => {
  const result = parseStory(story(name))
  if (!result.ok) throw new Error(`${name} did not parse: ${result.reason}`)
  return result.story
}

describe('parseStory on the shared cases of the format', () => {
  it('reads the English story of a PR: its header, frame steps, two code steps with every field, "not recorded" and Check yourself', () => {
    const read = parsed('pr-en.md')
    expect(read).toEqual({
      kind: 'pr',
      header: { title: 'Cart total in cents', epic: 'demo-cart', ticket: '04', pr: 212, language: 'en', commit: null },
      ...answer<PrStoryAnswer>('pr-en.json'),
    })
    expect(storyFileSchema.safeParse(read).success).toBe(true)
    // A committed story names no commit: it is no story kept by the button, whose schema wants one.
    expect(storySchema.safeParse(read).success).toBe(false)
  })

  it('reads the Russian story of a PR: Russian labels and frame titles, "not recorded" in Russian, no Check yourself, the review step with its own fragment last', () => {
    const read = parsed('pr-ru.md')
    expect(read).toEqual({
      kind: 'pr',
      header: { title: 'скидка по купону', epic: 'demo-cart', ticket: '05', pr: 213, language: 'ru', commit: null },
      ...oneEmptyLine(answer<PrStoryAnswer>('pr-ru.json')),
    })
    if (read.kind !== 'pr') throw new Error('not a PR story')
    expect(read.steps.filter((step) => step.kind === 'code' && step.whyHere === 'не записано')).toHaveLength(1)
    expect(read.steps.at(-1)).toMatchObject({ kind: 'frame', frame: 'review', fragments: [{ path: 'src/coupon.ts', startLine: 11, endLine: 11, keyLines: [11] }] })
  })

  it('reads the story of an Epic: Start, the PR chapters with their steps, a chapter not ready, the handoffs with the dropped one, Summary, Check, Check yourself', () => {
    const read = parsed('epic-ru.md')
    const twin = answer<EpicStoryAnswer>('epic-ru.json')
    // The file names no PR head (its anchor is the commit that added it); the twin gives each ready chapter an invented one.
    expect(read).toEqual({
      kind: 'epic',
      header: { epic: 'demo-cart', language: 'ru' },
      ...twin,
      chapters: twin.chapters.map((chapter) => ({ ...chapter, head: null })),
    })
    if (read.kind !== 'epic') throw new Error('not an Epic story')
    expect(read.seams.handoffs.filter((handoff) => !handoff.done)).toEqual([
      { from: '05', to: '04', what: 'скидка купона в итоге корзины', done: false, why: '`cartTotal` не вызывает `discountFor`, итог на чеке без скидки' },
    ])
    expect(read.chapters.map((chapter) => [chapter.ticket, chapter.ready, chapter.pr])).toEqual([
      ['03', true, 211],
      ['04', true, 212],
      ['05', true, 213],
      ['06', false, null],
    ])
    expect(storyFileSchema.safeParse(read).success).toBe(true)
  })

  it('parses a fragment that does not match the code: matching it is the work of the code reader, not of the parser', () => {
    const read = parsed('bad-fragment.md')
    if (read.kind !== 'pr' || read.steps[1]?.kind !== 'code') throw new Error('step 2 is not a code step')
    expect(read.steps[1].fragment).toMatchObject({ path: 'src/cart.ts', startLine: 10, endLine: 17 })
  })

  it('refuses a step without a field with the reason, naming the step and the field, never an empty story', () => {
    const result = parseStory(story('missing-field.md'))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toContain('step 3')
    expect(result.reason).toContain('"Why here"')
  })
})

describe('parseStory: the two header shapes and the reasons of a file that does not parse', () => {
  const prEn = story('pr-en.md')

  it('takes the Commit: of a story kept outside git, and refuses one that is not a full sha', () => {
    const sha = 'a'.repeat(40)
    const withCommit = parseStory(prEn.replace('· Language: en', `· Language: en · Commit: ${sha}`))
    expect(withCommit.ok && withCommit.story.kind === 'pr' ? withCommit.story.header.commit : null).toBe(sha)
    const short = parseStory(prEn.replace('· Language: en', '· Language: en · Commit: abc123'))
    expect(short).toMatchObject({ ok: false, reason: expect.stringContaining('Commit') as unknown })
  })

  it('reads a PR outside a Ticket — no Epic, no Ticket — and a PR not open yet (PR: -)', () => {
    const outside = parseStory(prEn.replace('# Code story — demo-cart 04: Cart total in cents', '# Code story — PR #77: Cart total in cents').replace('Kind: pr · Epic: demo-cart · Ticket: 04 · PR: #212', 'Kind: pr · PR: #77'))
    expect(outside.ok && outside.story.header).toEqual({ title: 'Cart total in cents', epic: null, ticket: null, pr: 77, language: 'en', commit: null })
    const notOpen = parseStory(prEn.replace('PR: #212', 'PR: -'))
    expect(notOpen.ok && notOpen.story.kind === 'pr' ? notOpen.story.header.pr : 'failed').toBeNull()
  })

  it('reads the English labels for a language other than ru', () => {
    const other = parseStory(prEn.replace('Language: en', 'Language: de'))
    expect(other.ok && other.story.header.language).toBe('en')
  })

  it('gives a reason for a file that is no story: no title, no header, an unknown Kind, a section of no step', () => {
    expect(parseStory('')).toMatchObject({ ok: false, reason: expect.stringContaining('title') as unknown })
    expect(parseStory('# Code story — x\n\n## 1. What was wrong\n')).toMatchObject({ ok: false, reason: expect.stringContaining('header') as unknown })
    expect(parseStory('# Code story — x\n\nLanguage: en\n')).toMatchObject({ ok: false, reason: expect.stringContaining('Kind') as unknown })
    expect(parseStory(prEn.replace('Kind: pr', 'Kind: book'))).toMatchObject({ ok: false, reason: expect.stringContaining('Kind') as unknown })
    expect(parseStory(prEn.replace('## Check yourself', '## Notes'))).toMatchObject({ ok: false, reason: expect.stringContaining('"Notes"') as unknown })
  })

  it('refuses a code step whose fragment has no code block, and a key line outside the fragment', () => {
    const noBlock = prEn.replace(/Code: `src\/cart.ts:20-22` · key lines: 21\n\n```ts\n[\s\S]*?\n```\n/u, 'Code: `src/cart.ts:20-22` · key lines: 21\n\n')
    expect(parseStory(noBlock)).toMatchObject({ ok: false, reason: expect.stringContaining('code block') as unknown })
    const outside = parseStory(prEn.replace('Code: `src/cart.ts:20-22` · key lines: 21', 'Code: `src/cart.ts:20-22` · key lines: 30'))
    expect(outside).toMatchObject({ ok: false, reason: expect.stringContaining('key line 30') as unknown })
  })

  it('refuses a handoff without done:, naming the handoff', () => {
    const epic = story('epic-ru.md').replace('- 03 → 05: доля суммы с округлением до цента (`percentOf`) · done: yes', '- 03 → 05: доля суммы с округлением до цента (`percentOf`)')
    expect(parseStory(epic)).toMatchObject({ ok: false, reason: expect.stringContaining('03 → 05') as unknown })
  })

  it('reads a story with CRLF line ends and a byte order mark as the same story', () => {
    const crlf = parseStory(`\uFEFF${prEn.replace(/\n/gu, '\r\n')}`)
    expect(crlf).toEqual(parseStory(prEn))
  })
})
