// The pure parts of the worfy Guide (worfy-guide ticket 03, ADR-0090): which language it opens in,
// where its GitHub links lead, how a missing translation is found, and which Topics a build shows.
import { describe, expect, it } from 'vitest'
import { guideLanguage, systemGuideLanguage } from '../../src/renderer/guide/language'
import { buildCommit, GUIDE_REPO_URL, githubFileUrl } from '../../src/renderer/guide/links'
import { GUIDE_TOPICS, shownTopics } from '../../src/renderer/guide/registry'
import { translationGaps } from '../../src/renderer/guide/translation'

describe('the language of the Guide', () => {
  it('is Russian when the first language of the system is Russian, English otherwise', () => {
    expect(systemGuideLanguage(['ru-RU', 'en-US'])).toBe('ru')
    expect(systemGuideLanguage(['ru'])).toBe('ru')
    expect(systemGuideLanguage(['RU-ru'])).toBe('ru')
    expect(systemGuideLanguage(['en-US', 'ru-RU'])).toBe('en')
    expect(systemGuideLanguage(['de-DE'])).toBe('en')
    expect(systemGuideLanguage(['rue'])).toBe('en')
    expect(systemGuideLanguage([])).toBe('en')
  })

  it('a choice the person made wins over the system language', () => {
    expect(guideLanguage('en', ['ru-RU'])).toBe('en')
    expect(guideLanguage('ru', ['en-US'])).toBe('ru')
    expect(guideLanguage(undefined, ['ru-RU'])).toBe('ru')
    expect(guideLanguage(undefined, ['en-US'])).toBe('en')
  })
})

describe('the GitHub links of the Guide', () => {
  it('take the commit from the build version, a dirty build included', () => {
    expect(buildCommit('0.3.0+e61cb1fe')).toBe('e61cb1fe')
    expect(buildCommit('0.3.0+e61cb1fe.dirty')).toBe('e61cb1fe')
    expect(buildCommit('1.2.3+0123456789abcdef0123456789abcdef01234567')).toBe('0123456789abcdef0123456789abcdef01234567')
  })

  it('know no commit for a version without one, or no version', () => {
    expect(buildCommit('0.3.0')).toBeNull()
    expect(buildCommit('0.3.0+xyz1234')).toBeNull()
    expect(buildCommit('0.3.0+e61cb1f+e61cb1f')).toBeNull()
    expect(buildCommit(null)).toBeNull()
    expect(buildCommit(undefined)).toBeNull()
  })

  it('lead to the file at the commit of the build', () => {
    expect(githubFileUrl('docs/features/app-shell.md', '0.3.0+e61cb1fe')).toBe(`${GUIDE_REPO_URL}/blob/e61cb1fe/docs/features/app-shell.md`)
    expect(GUIDE_REPO_URL).toBe('https://github.com/IDSAD-XL/worfy')
  })

  it('lead to main when the commit is not known', () => {
    expect(githubFileUrl('src/main/menu.ts', '0.3.0')).toBe(`${GUIDE_REPO_URL}/blob/main/src/main/menu.ts`)
    expect(githubFileUrl('src/main/menu.ts', null)).toBe(`${GUIDE_REPO_URL}/blob/main/src/main/menu.ts`)
  })

  it('escape what a path may hold and keep its slashes', () => {
    expect(githubFileUrl('docs/a b#c.md', null)).toBe(`${GUIDE_REPO_URL}/blob/main/docs/a%20b%23c.md`)
  })
})

describe('translationGaps', () => {
  const en = { title: 'Title', summary: ['One', 'Two'], under: { files: { 'a.ts': 'A' }, limits: [] as string[] } }

  it('finds nothing when both versions have every string', () => {
    expect(translationGaps(en, { title: 'T', summary: ['1', '2'], under: { files: { 'a.ts': 'a' }, limits: [] } })).toEqual([])
  })

  it('names a string the Russian version lacks, and one only it has', () => {
    expect(translationGaps(en, { title: 'T', summary: ['1', '2'], under: { files: {}, limits: [] } })).toEqual(['under.files.a.ts: missing in ru'])
    expect(translationGaps({ title: 'T' }, { title: 'T', extra: 'x' })).toEqual(['extra: missing in en'])
  })

  it('names an empty string and a list of another length', () => {
    expect(translationGaps({ title: 'T' }, { title: ' ' })).toEqual(['title: empty in ru'])
    expect(translationGaps({ title: '' }, { title: 'T' })).toEqual(['title: empty in en'])
    expect(translationGaps({ list: ['a', 'b'] }, { list: ['a'] })).toEqual(['list.1: missing in ru'])
  })

  it('names a value of another shape', () => {
    expect(translationGaps({ title: 'T' }, { title: ['T'] })).toEqual(['title: a string in en, a list in ru'])
    expect(translationGaps({ title: 'T' }, { title: 1 })).toEqual(['title: a string in en, not text in ru'])
  })
})

describe('the registry of Topics', () => {
  it('has one entry per id', () => {
    const ids = GUIDE_TOPICS.map((topic) => topic.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('shows a test Topic only in a build known not to be packaged', () => {
    const test = GUIDE_TOPICS.filter((topic) => topic.devOnly === true).map((topic) => topic.id)
    expect(test).toEqual(['skeleton'])
    expect(shownTopics(false).map((topic) => topic.id)).toContain('skeleton')
    expect(shownTopics(true).map((topic) => topic.id)).not.toContain('skeleton')
    // Not answered yet: as a release build.
    expect(shownTopics(null).map((topic) => topic.id)).not.toContain('skeleton')
    expect(shownTopics(true)).toEqual(GUIDE_TOPICS.filter((topic) => topic.devOnly !== true))
  })
})
