// What the worfy Guide says (worfy-guide ticket 03, ADR-0090), checked over every file it has: each
// Topic of the registry has its folder and each folder its line; topic.json, en.json and ru.json
// have the shape content.ts reads; every string has both its English and its Russian version; the
// pages a Topic was checked against and the files of its Under the hood are files of this repository
// at its commit; and the Guide's own labels exist in both languages.
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { GUIDE_CONTENT, GUIDE_STRINGS, TOPIC_FILES, topicMetaSchema, topicTextSchema } from '../../src/renderer/guide/content'
import { GUIDE_TOPICS } from '../../src/renderer/guide/registry'
import { translationGaps } from '../../src/renderer/guide/translation'

const REPO = join(import.meta.dirname, '..', '..')

/** The files of the repository at HEAD: what GitHub shows at the build's commit. */
function trackedAtHead(): Set<string> {
  const listed = execFileSync('git', ['-C', REPO, 'ls-tree', '-r', '--name-only', 'HEAD'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  return new Set(listed.split('\n').filter(Boolean))
}

/** The files the working tree adds to HEAD: a Topic and the files it names may come in one commit. */
function addedInTree(): Set<string> {
  const listed = execFileSync('git', ['-C', REPO, 'ls-files', '--others', '--exclude-standard', '--cached'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  return new Set(listed.split('\n').filter(Boolean))
}

const ids = [...TOPIC_FILES.meta.keys()].sort()

describe('the Topics of the Guide', () => {
  it('has at least the test Topic', () => {
    expect(ids).toContain('skeleton')
  })

  it('each registry entry has a folder with topic.json, en.json and ru.json, and each folder an entry', () => {
    expect(GUIDE_TOPICS.map((topic) => topic.id).sort()).toEqual(ids)
    expect([...TOPIC_FILES.en.keys()].sort()).toEqual(ids)
    expect([...TOPIC_FILES.ru.keys()].sort()).toEqual(ids)
    expect([...GUIDE_CONTENT.keys()].sort()).toEqual(ids)
  })

  it('each title of the registry is the title of en.json: the palette row and the Guide say the same', () => {
    for (const entry of GUIDE_TOPICS) expect(entry.title, entry.id).toBe(TOPIC_FILES.en.get(entry.id)?.title)
  })

  it.each(ids)('%s: topic.json and both texts have the shape the Guide reads', (id) => {
    expect(() => topicMetaSchema.parse(TOPIC_FILES.meta.get(id))).not.toThrow()
    expect(() => topicTextSchema.parse(TOPIC_FILES.en.get(id))).not.toThrow()
    expect(() => topicTextSchema.parse(TOPIC_FILES.ru.get(id))).not.toThrow()
  })

  it.each(ids)('%s: every string has its English and its Russian version', (id) => {
    expect(translationGaps(TOPIC_FILES.en.get(id), TOPIC_FILES.ru.get(id))).toEqual([])
  })

  it.each(ids)('%s: Under the hood describes exactly the files topic.json names', (id) => {
    const files = TOPIC_FILES.meta.get(id)?.files ?? []
    expect(Object.keys(TOPIC_FILES.en.get(id)?.underTheHood.files ?? {}).sort()).toEqual([...files].sort())
  })

  it('every page a Topic was checked against, and its commit, are in the repository', () => {
    const tracked = trackedAtHead()
    for (const id of ids) {
      for (const { page, sha } of TOPIC_FILES.meta.get(id)?.sources ?? []) {
        expect(tracked.has(page), `${id}: ${page}`).toBe(true)
        // The commit exists and the page was in it.
        expect(() => execFileSync('git', ['-C', REPO, 'cat-file', '-e', `${sha}:${page}`], { stdio: 'ignore' }), `${id}: ${sha}:${page}`).not.toThrow()
      }
    }
  })

  it('every file of an Under the hood table is a file of the repository at its commit', () => {
    const known = new Set([...trackedAtHead(), ...addedInTree()])
    for (const id of ids) {
      for (const path of TOPIC_FILES.meta.get(id)?.files ?? []) expect(known.has(path), `${id}: ${path}`).toBe(true)
    }
  })
})

describe('the labels of the Guide', () => {
  it('exist in both languages', () => {
    expect(translationGaps(GUIDE_STRINGS.en, GUIDE_STRINGS.ru)).toEqual([])
  })
})
