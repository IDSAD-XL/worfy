/// <reference types="vite/client" />
// Help about worfy (worfy-assistant ticket 17; spec, the section on the introduction and help): the feature pages of
// docs/features, English and their Russian translation under ru/, as the Assistant's tools features_search and
// features_read of `worfy-app` find and read them. electron-builder.yml puts the folder into the packaged app, outside
// app.asar, at <resources>/features (FEATURE_PAGES_RESOURCE); `pnpm dev` and the runs of out/ read docs/features of the
// checkout.
//
// - A search finds a page only when one of its sections is about the question, in English or in its translation: every
//   word of the question is in that section (its own text with the headings above it and the page's title), and a
//   question of one word has it in those headings or twice in the text. A page that only mentions the words here and
//   there is not an answer, and the Assistant says it does not know (test/contract/feature-pages-in-build.test.ts runs
//   such questions over the real pages).
// - Case and the Russian letters yo and ye are folded. A Latin word matches the same word in the singular or the plural
//   only; a Cyrillic word matches the words that start with it, its case ending cut (see term()).
// - The answer is the page in the Guide's language, the English one when it has no translation yet, with its path in
//   the repository and its GitHub link at the commit of the build, as the Guide's «Full page» links it.
// - The Guide topics that were checked against a page (their topic.json) are named with it, so the Assistant can point
//   to the short version.
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'
import { GUIDE_TOPICS } from '../../../shared/guide/registry'
import { githubFileUrl } from '../../../shared/guide/links'
import type { GuideLanguage } from '../../../shared/settings/app-settings'

/** The folder of the pages in the packaged app, under process.resourcesPath (electron-builder.yml, extraResources). */
export const FEATURE_PAGES_RESOURCE = 'features'
/** The most characters of a page, or of a section, one answer carries. */
export const FEATURE_PAGE_MAX_CHARS = 40_000
/** The index of the pages: it names every page, so it is never a search result. */
const INDEX = 'README'

/** The folder the pages are read from: the build's copy in the packaged app, docs/features of the checkout otherwise. */
export function featurePagesDir(): string {
  return app.isPackaged ? join(process.resourcesPath, FEATURE_PAGES_RESOURCE) : join(app.getAppPath(), 'docs', 'features')
}

/** One page in one language: `name` is its file name without `.md`. */
export interface FeaturePageFile {
  name: string
  language: GuideLanguage
  text: string
}

/** Every page of `dir` (English) and of `dir/ru` (Russian). A build without the English pages is an error; ru/ may lag. */
export async function readFeaturePages(dir: string): Promise<FeaturePageFile[]> {
  const read = async (folder: string, language: GuideLanguage): Promise<FeaturePageFile[]> => {
    const names = (await readdir(folder)).filter((name) => name.endsWith('.md')).sort()
    return Promise.all(names.map(async (name) => ({ name: name.slice(0, -'.md'.length), language, text: await readFile(join(folder, name), 'utf8') })))
  }
  return [...(await read(dir, 'en')), ...(await read(join(dir, 'ru'), 'ru').catch(() => []))]
}

/** The path of a page in the repository. */
export const featurePagePath = (name: string, language: GuideLanguage): string => `docs/features/${language === 'ru' ? 'ru/' : ''}${name}.md`

interface Heading {
  level: number
  title: string
  /** The line of the heading. */
  line: number
}

/** The title (`# …`) and the headings (`## …` and deeper) of a page; a `#` inside a fenced code block is not one. */
function outline(text: string): { title: string | null; headings: Heading[]; lines: string[] } {
  const lines = text.split('\n')
  const headings: Heading[] = []
  let title: string | null = null
  let fenced = false
  lines.forEach((line, index) => {
    if (/^\s*(```|~~~)/u.test(line)) fenced = !fenced
    if (fenced) return
    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/u.exec(line)
    if (match === null) return
    const level = match[1]!.length
    if (level === 1) title ??= match[2]!
    else headings.push({ level, title: match[2]!, line: index })
  })
  return { title, headings, lines }
}

/** The text of a heading's section: its line up to the next heading of its level or higher. */
function sectionText(page: ReturnType<typeof outline>, heading: Heading): string {
  const next = page.headings.find((each) => each.line > heading.line && each.level <= heading.level)
  return page.lines.slice(heading.line, next?.line).join('\n')
}

type Outline = ReturnType<typeof outline>

/** Lower case, the Cyrillic yo as ye: the Russian pages write the dark theme with yo, a question may not. */
const fold = (text: string): string => text.toLowerCase().replace(/\u0451/gu, '\u0435')

/** The words of a text, folded. */
const tokens = (text: string): string[] => fold(text).match(/[\p{L}\p{N}]+/gu) ?? []

/** A Latin word without a plural ending: «badges» and «badge», «policies» and «policy» are one word. */
function singular(word: string): string {
  if (word.length <= 3) return word
  if (word.endsWith('ies') && word.length > 4) return `${word.slice(0, -3)}y`
  if (/(?:s|x|z|ch|sh)es$/u.test(word)) return word.slice(0, -2)
  return word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word
}

/** A word of a question and the words of a page it matches. */
type Term = (word: string) => boolean

/**
 * A Cyrillic word matches the words that start with it, its ending cut (one letter of four or five, two of six, three
 * of seven and more), so a noun finds its other cases and an adjective its other endings. A Latin word matches the same
 * word in the singular or the plural only: «spell» never finds «spelling», nor «mode» «model».
 */
function term(word: string): Term {
  if (/\p{Script=Cyrillic}/u.test(word)) {
    const stem = word.length >= 7 ? word.slice(0, -3) : word.length === 6 ? word.slice(0, -2) : word.length >= 4 ? word.slice(0, -1) : word
    return (other) => other.startsWith(stem)
  }
  const base = singular(word)
  return (other) => other === word || singular(other) === base
}

/** The words of a question, each once. */
const terms = (query: string): Term[] => [...new Set(tokens(query).filter((word) => word.length >= 2))].map(term)

/**
 * The most words of a section's text that may stand between the first and the last word of a question: further apart,
 * the words are about different things.
 */
const NEAR_WORDS = 12

/** A section as a search reads it: the headings above its text, the page's title first, and its own text. */
interface Block {
  /** The index of its heading in the outline; -1 for the text before the first heading. */
  heading: number
  chain: string[]
  body: string[]
}

/** The sections of a page, each with its own text only: up to the next heading of any level. */
function blocks(page: Outline): Block[] {
  const own = (from: number, to: number | undefined): string[] => tokens(page.lines.slice(from, to).filter((line) => !/^#\s/u.test(line)).join('\n'))
  const preamble: Block = { heading: -1, chain: tokens(page.title ?? ''), body: own(0, page.headings[0]?.line) }
  return [
    preamble,
    ...page.headings.map((heading, index) => {
      const chain = [heading.title]
      let level = heading.level
      for (let above = index - 1; above >= 0 && level > 2; above -= 1) {
        const each = page.headings[above]!
        if (each.level < level) {
          chain.unshift(each.title)
          level = each.level
        }
      }
      return { heading: index, chain: tokens([page.title ?? '', ...chain].join('\n')), body: own(heading.line + 1, page.headings[index + 1]?.line) }
    }),
  ]
}

/** The fewest words of `body` from one word of each term to the last, or null when a term is not there. */
function span(body: readonly string[], wanted: readonly Term[]): number | null {
  if (wanted.length === 0) return 0
  const last = new Array<number>(wanted.length).fill(-1)
  let best: number | null = null
  body.forEach((word, at) => {
    wanted.forEach((matches, index) => {
      if (matches(word)) last[index] = at
    })
    if (last.every((position) => position >= 0)) {
      const length = at - Math.min(...last) + 1
      best = best === null ? length : Math.min(best, length)
    }
  })
  return best
}

/**
 * How much a section is about the question, or null when it is not. Every word of the question is in its headings (the
 * page's title and the headings above it count) or in its own text, and the words of its text stand close together
 * (NEAR_WORDS); the one word of a one-word question is in its headings or twice in its text — once is in passing.
 * The headings count most.
 */
function about(block: Block, words: readonly Term[]): number | null {
  const count = (where: readonly string[], matches: Term): number => where.filter(matches).length
  const inChain = words.map((matches) => count(block.chain, matches))
  const inBody = words.map((matches) => count(block.body, matches))
  if (words.some((_, index) => inChain[index]! + inBody[index]! === 0)) return null
  if (words.length === 1 && inChain[0] === 0 && inBody[0]! < 2) return null
  const near = span(
    block.body,
    words.filter((_, index) => inChain[index] === 0),
  )
  if (near === null || near > NEAR_WORDS) return null
  return inBody.reduce((sum, each) => sum + each, 0) + 3 * inChain.reduce((sum, each) => sum + each, 0)
}

/** A search result: a page in the Guide's language (English without a translation). */
export interface FeatureHit {
  page: string
  language: GuideLanguage
  title: string
  path: string
  url: string
  /** The headings of the sections that are about the question, as the answered page names them. */
  sections: string[]
}

/** The most sections a search result names. */
const HIT_SECTIONS_MAX = 5

export interface FeatureHelpOptions {
  /** The language of the Guide: the one the answer is in. */
  language: GuideLanguage
  /** The build version `<semver>+<SHA>`; the link points at its commit, else at main. */
  version: string | null
}

/** The page `name` in the Guide's language, else in English; undefined when there is no such page. */
function pageIn(files: readonly FeaturePageFile[], name: string, language: GuideLanguage): FeaturePageFile | undefined {
  return files.find((file) => file.name === name && file.language === language) ?? files.find((file) => file.name === name && file.language === 'en')
}

/**
 * The headings of `indexes` of the outline `from` as the outline `to` names them: the same places, when the translation
 * keeps the outline of its page (the same number of headings); else as `from` names them.
 */
function headingsIn(from: Outline, to: Outline, indexes: readonly number[]): string[] {
  const names = to.headings.length === from.headings.length ? to : from
  return indexes.map((index) => names.headings[index]!.title)
}

/** The pages with a section about the question, best first, at most `limit`. */
export function searchFeaturePages(files: readonly FeaturePageFile[], query: string, limit: number, options: FeatureHelpOptions): FeatureHit[] {
  const words = terms(query)
  if (words.length === 0) return []
  const best = new Map<string, { score: number; page: Outline; sections: number[] }>()
  for (const file of files) {
    if (file.name === INDEX) continue
    const page = outline(file.text)
    let score: number | null = null
    const sections: number[] = []
    for (const block of blocks(page)) {
      const found = about(block, words)
      if (found === null) continue
      score = Math.max(score ?? 0, found)
      if (block.heading >= 0) sections.push(block.heading)
    }
    if (score !== null && score > (best.get(file.name)?.score ?? 0)) best.set(file.name, { score, page, sections })
  }
  return [...best.entries()]
    .sort(([a, left], [b, right]) => right.score - left.score || a.localeCompare(b))
    .slice(0, limit)
    .map(([name, matched]) => {
      const file = pageIn(files, name, options.language)!
      const page = outline(file.text)
      const path = featurePagePath(name, file.language)
      // The words may have matched the other language's version: its sections, named as this page names them.
      const sections = headingsIn(matched.page, page, matched.sections)
      return { page: name, language: file.language, title: page.title ?? name, path, url: githubFileUrl(path, options.version), sections: sections.slice(0, HIT_SECTIONS_MAX) }
    })
}

/** A Guide topic: its id (the folder under src/renderer/guide/topics/) and its title in the Guide's language. */
export interface GuideTopicRef {
  id: string
  title: string
}

const TOPIC_SOURCES = import.meta.glob<readonly { page: string }[]>('../../../renderer/guide/topics/*/topic.json', { eager: true, import: 'sources' })
const TOPIC_TITLES = import.meta.glob<string>('../../../renderer/guide/topics/*/{en,ru}.json', { eager: true, import: 'title' })
const topicFile = (id: string, file: string): string => `../../../renderer/guide/topics/${id}/${file}`

/**
 * The Guide topics checked against the page, in the order of the Guide's list. A topic for checking the Guide itself
 * (devOnly) is never named.
 */
export function guideTopicsOf(name: string, language: GuideLanguage): GuideTopicRef[] {
  const page = featurePagePath(name, 'en')
  return GUIDE_TOPICS.filter((topic) => topic.devOnly !== true && (TOPIC_SOURCES[topicFile(topic.id, 'topic.json')] ?? []).some((source) => source.page === page)).map((topic) => ({
    id: topic.id,
    title: TOPIC_TITLES[topicFile(topic.id, `${language}.json`)] ?? topic.title,
  }))
}

/** A page as features_read answers it. */
export interface FeaturePageAnswer {
  page: string
  language: GuideLanguage
  guideLanguage: GuideLanguage
  title: string
  path: string
  url: string
  guideTopics: GuideTopicRef[]
  /** The headings of the page, in order. */
  sections: string[]
  /** The heading of the section read; null for the whole page. */
  section: string | null
  /** True when the text stops at FEATURE_PAGE_MAX_CHARS: read a section for the rest. */
  truncated: boolean
  text: string
}

/** Refuses a page or a section that is not there, with what is. */
export class FeaturePageMissing extends Error {}

/** The page `name` in the Guide's language (English without a translation), or one section of it. */
export function readFeaturePage(files: readonly FeaturePageFile[], name: string, section: string | undefined, options: FeatureHelpOptions): FeaturePageAnswer {
  let file = pageIn(files, name, options.language)
  if (file === undefined) throw new FeaturePageMissing(`There is no feature page ${name}: features_search finds the pages there are.`)
  let page = outline(file.text)
  let heading: Heading | null = null
  if (section !== undefined) {
    const wanted = fold(section.trim())
    const find = (where: Outline): Heading | null => where.headings.find((each) => fold(each.title) === wanted) ?? where.headings.find((each) => fold(each.title).includes(wanted)) ?? null
    heading = find(page)
    // A section named as the other language's version names it (a search matched there): the same place in this page,
    // or that version's section when the translation has another outline.
    for (const other of heading === null ? files.filter((each) => each.name === name && each !== file) : []) {
      const otherPage = outline(other.text)
      const found = find(otherPage)
      if (found === null) continue
      if (otherPage.headings.length === page.headings.length) heading = page.headings[otherPage.headings.indexOf(found)]!
      else [file, page, heading] = [other, otherPage, found]
      break
    }
    if (heading === null) throw new FeaturePageMissing(`The page ${name} has no section "${section}". Its sections: ${page.headings.map((each) => each.title).join(', ')}.`)
  }
  const whole = heading === null ? file.text : sectionText(page, heading)
  const path = featurePagePath(name, file.language)
  return {
    page: name,
    language: file.language,
    guideLanguage: options.language,
    title: page.title ?? name,
    path,
    url: githubFileUrl(path, options.version),
    guideTopics: guideTopicsOf(name, options.language),
    sections: page.headings.map((each) => each.title),
    section: heading?.title ?? null,
    truncated: whole.length > FEATURE_PAGE_MAX_CHARS,
    text: whole.slice(0, FEATURE_PAGE_MAX_CHARS),
  }
}
