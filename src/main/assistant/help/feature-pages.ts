/// <reference types="vite/client" />
// Help about worfy (worfy-assistant ticket 17; spec, the section on the introduction and help): the feature pages of docs/features, English
// and their Russian translation under ru/, as the Assistant's tools features_search and features_read of `worfy-app`
// find and read them. electron-builder.yml puts the folder into the packaged app, outside app.asar, at
// <resources>/features (FEATURE_PAGES_RESOURCE); `pnpm dev` and the runs of out/ read docs/features of the checkout.
//
// - A search finds a page only when every word of the question is in it, in English or in its translation: a page that
//   is only near the question is not an answer, and the Assistant says it does not know (test/contract/
//   worfy-app-tools.test.ts). A word matches the start of a word of the page, its last two letters cut when it is
//   longer than five, so «tickets» finds «ticket», and a Russian word finds its other endings the same way.
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

/** The words of a question, lower case, each as the prefix it matches. */
function terms(query: string): string[] {
  const words = query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
  return [...new Set(words.filter((word) => word.length >= 2).map((word) => (word.length > 5 ? word.slice(0, -2) : word)))]
}

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')

/** How many words of `text` start with `term`. */
function hits(text: string, term: string): number {
  return text.toLowerCase().match(new RegExp(`(?<![\\p{L}\\p{N}])${escape(term)}`, 'gu'))?.length ?? 0
}

/** The score of a page for the terms: null when a term is not in it; the title counts most, then the headings. */
function score(text: string, words: readonly string[]): number | null {
  const page = outline(text)
  const headings = page.headings.map((heading) => heading.title).join('\n')
  let total = 0
  for (const term of words) {
    const inText = hits(text, term)
    if (inText === 0) return null
    total += inText + 10 * hits(page.title ?? '', term) + 3 * hits(headings, term)
  }
  return total
}

/** A search result: a page in the Guide's language (English without a translation). */
export interface FeatureHit {
  page: string
  language: GuideLanguage
  title: string
  path: string
  url: string
  /** The headings of the sections that hold a word of the question. */
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

/** The pages that hold every word of the question, best first, at most `limit`. */
export function searchFeaturePages(files: readonly FeaturePageFile[], query: string, limit: number, options: FeatureHelpOptions): FeatureHit[] {
  const words = terms(query)
  if (words.length === 0) return []
  const best = new Map<string, number>()
  for (const file of files) {
    if (file.name === INDEX) continue
    const found = score(file.text, words)
    if (found !== null && found > (best.get(file.name) ?? 0)) best.set(file.name, found)
  }
  return [...best.entries()]
    .sort(([a, left], [b, right]) => right - left || a.localeCompare(b))
    .slice(0, limit)
    .map(([name]) => {
      const file = pageIn(files, name, options.language)!
      const page = outline(file.text)
      const sections = page.headings.filter((heading) => words.some((term) => hits(sectionOwnText(page, heading), term) > 0)).map((heading) => heading.title)
      const path = featurePagePath(name, file.language)
      return { page: name, language: file.language, title: page.title ?? name, path, url: githubFileUrl(path, options.version), sections: sections.slice(0, HIT_SECTIONS_MAX) }
    })
}

/** A heading's own text: its line up to the next heading of any level. */
function sectionOwnText(page: ReturnType<typeof outline>, heading: Heading): string {
  const next = page.headings.find((each) => each.line > heading.line)
  return page.lines.slice(heading.line, next?.line).join('\n')
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
  const file = pageIn(files, name, options.language)
  if (file === undefined) throw new FeaturePageMissing(`There is no feature page ${name}: features_search finds the pages there are.`)
  const page = outline(file.text)
  let heading: Heading | null = null
  if (section !== undefined) {
    const wanted = section.trim().toLowerCase()
    heading = page.headings.find((each) => each.title.toLowerCase() === wanted) ?? page.headings.find((each) => each.title.toLowerCase().includes(wanted)) ?? null
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
