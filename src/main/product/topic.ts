// Reading one Product Session topic, `docs/product/<topic>/` (ADR-0101; Epic worfy-product-session,
// ticket 03): the wayfinder map (`map.md`), its Tickets (`issues/NN-slug.md`) and the Mind map
// (`mind-map.json`, checked by checkMindMap).
//
// A file that is missing, unreadable or wrong makes a topic with errors, never an exception: the
// screen shows the error and the node it is about instead of an empty map. Nothing here writes. In
// particular mind-map.json is not read with readJsonFile (src/main/storage/json-file.ts): that one
// renames a file it cannot parse, and this file belongs to the Project, edited by hand or by an agent.
//
// On Windows a read through a symlink to `\\host\share\…` makes the system hand that host the user's
// credentials (worfy-windows tickets 18 and 19), and a topic is read as soon as its Product Session
// is open, with no click. So each file and folder of the topic is checked for such a link
// (walkLinks of src/main/remote-links.ts) before it is read; one that leads there is not read, and the
// topic names it among its errors (worfy-polish ticket 146).
import { readdir, readFile, realpath, stat } from 'node:fs/promises'
import * as nativePath from 'node:path'
import { checkMindMap, type MindMapNode } from '../../shared/product/mind-map'
import { MAP_FILE, MAP_ISSUES_DIR, MIND_MAP_FILE } from '../../shared/product/paths'
import { cachedLinks, UNCHECKED, walkLinks, type LinkFs, type PathRules } from '../remote-links'
import { firstHeading, issueKey } from '../workflow/reader'

/** What is asked of the file system for the Product Session files; each call follows links. */
export interface ProductFs {
  /** The text of a file. */
  readFile: (path: string) => Promise<string>
  /** The entries of a folder; one that is a link is no folder here. */
  readdir: (dir: string) => Promise<{ name: string; isDirectory: () => boolean }[]>
  realpath: (path: string) => Promise<string>
  /** Whether there is a folder at the path. */
  isFolder: (path: string) => Promise<boolean>
}

export const nodeProductFs: ProductFs = {
  readFile: (path) => readFile(path, 'utf8'),
  readdir: (dir) => readdir(dir, { withFileTypes: true }),
  realpath: (path) => realpath(path),
  isFolder: (path) =>
    stat(path).then(
      (stats) => stats.isDirectory(),
      () => false,
    ),
}

/** How the Product Session files are read: the platform's rules and Node by default; path.win32 and replaced calls in tests. */
export interface ProductReadOptions {
  paths?: PathRules
  /** lstat and readlink for the links on the way to a file (remote-links.ts). */
  links?: LinkFs
  fs?: ProductFs
}

export interface TopicReadOptions extends ProductReadOptions {
  /**
   * The folders the topic's files may lie in on a share — the Project root as written and as its real
   * path — from which the walk of each file starts (walkLinks). The topic folder by default: the walk
   * then starts there, and a link above it is not looked for.
   */
  allowed?: readonly string[]
}

/**
 * The folders the walks of a Product Session file start from (walkLinks): `root` — the root of the Project's
 * documents, the Workflow folder in Silent mode (docsSource of src/main/ipc/docs.ts) — as written and, under
 * Windows rules, as its real path, so that a root on the user's own share, or reached through a link to one,
 * is the Project's own. Null when that real path cannot be found.
 */
export async function projectFolders(root: string, options: { paths: PathRules; fs: Pick<ProductFs, 'realpath'> }): Promise<string[] | null> {
  if (options.paths.sep !== '\\') return [root]
  const base = await options.fs.realpath(root).catch(() => null)
  return base === null ? null : [root, base]
}

/** What a topic error says of a file whose way leads to another host. */
export const LEADS_TO_ANOTHER_HOST = 'leads to another host through a link: not read'

/**
 * Why `path` must not be read under Windows rules: a link on the way to it leads to another host, or a
 * link could not be read; null to read it. Under any other rules null at once, with nothing asked.
 */
export async function linkRefusal(path: string, allowed: readonly string[], options: { paths: PathRules; links?: LinkFs | undefined }): Promise<string | null> {
  const verdict = await walkLinks(path, allowed, options)
  return verdict === 'remote' ? LEADS_TO_ANOTHER_HOST : verdict === 'unchecked' ? UNCHECKED : null
}

/** The word of a Ticket's `Status:` line (harness/bin/TICKETS.md, "Header"); `none` without a line or with an unknown word. */
export type MapTicketStatus = 'open' | 'claimed' | 'blocked' | 'done' | 'none'

export interface MapTicket {
  number: number
  slug: string
  /** The file name inside `issues/`. */
  file: string
  /** The H1, by the rule of firstHeading; null without one. */
  title: string | null
  status: MapTicketStatus
}

/** A `## ` section of map.md: Destination, Notes, Decisions so far, Not yet specified, or any other. */
export interface MapSection {
  heading: string
  /** The lines under the heading up to the next `## `, trimmed. */
  body: string
}

/** A problem of one file of the topic; `id` is the Mind map node it is about, when there is one. */
export interface TopicError {
  /** The file, relative to the topic folder with `/`. */
  file: string
  id: string | null
  message: string
}

export interface ProductTopic {
  /** The folder name. */
  name: string
  folder: string
  /** The H1 of map.md; null without one or without the file. */
  title: string | null
  sections: MapSection[]
  /** The Tickets of the map, by number. */
  tickets: MapTicket[]
  /** The Mind map nodes; empty when the file is missing or has an error. */
  nodes: MindMapNode[]
  errors: TopicError[]
}

const STATUS_WORDS = new Set<MapTicketStatus>(['open', 'claimed', 'blocked', 'done'])

/** What reading a file gave: its text, null when it is not there, or the reason it could not be read. */
type Read = { text: string } | { missing: true } | { error: string }

/** The calls of one topic read and the check before each of them. */
interface Reader {
  paths: PathRules
  fs: ProductFs
  /** Why the path is not read (linkRefusal); null to read it. */
  refusal: (path: string) => Promise<string | null>
}

async function readText(reader: Reader, path: string): Promise<Read> {
  const refused = await reader.refusal(path)
  if (refused !== null) return { error: refused }
  try {
    return { text: await reader.fs.readFile(path) }
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return { missing: true }
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * The lines of a markdown file outside ``` and ~~~ code blocks, by the rule of firstHeading
 * (src/main/workflow/reader.ts) and harness/lib/code-fence.cjs: a block closes only with a line of
 * the same character, at least as long, with nothing after it. Each line comes with whether it is
 * inside a block, so a section body keeps its code.
 */
function markdownLines(markdown: string): { line: string; inFence: boolean }[] {
  let fence = ''
  const lines: { line: string; inFence: boolean }[] = []
  for (const line of markdown.replace(/^\uFEFF/u, '').split(/\r?\n/u)) {
    const f = /^[ \t]*(`{3,}|~{3,})(.*)$/u.exec(line)
    if (fence !== '') {
      lines.push({ line, inFence: true })
      if (f && f[1]![0] === fence[0] && f[1]!.length >= fence.length && /^[ \t]*$/u.test(f[2]!)) fence = ''
    } else {
      if (f) fence = f[1]!
      lines.push({ line, inFence: f !== null })
    }
  }
  return lines
}

/** The `## ` sections of a map, in order. */
export function mapSections(markdown: string): MapSection[] {
  const sections: { heading: string; lines: string[] }[] = []
  for (const { line, inFence } of markdownLines(markdown)) {
    const heading = inFence ? null : /^##[ \t]+([^ \t].*?)[ \t]*$/u.exec(line)
    if (heading) sections.push({ heading: heading[1]!, lines: [] })
    else sections.at(-1)?.lines.push(line)
  }
  return sections.map(({ heading, lines }) => ({ heading, body: lines.join('\n').trim() }))
}

/** The word of the first `Status:` line outside code blocks. */
export function ticketStatus(markdown: string): MapTicketStatus {
  for (const { line, inFence } of markdownLines(markdown)) {
    if (inFence) continue
    const match = /^Status:[ \t]+(\S+)/u.exec(line)
    if (match) return STATUS_WORDS.has(match[1] as MapTicketStatus) ? (match[1] as MapTicketStatus) : 'none'
  }
  return 'none'
}

async function readTickets(reader: Reader, folder: string, errors: TopicError[]): Promise<MapTicket[]> {
  const issues = reader.paths.join(folder, MAP_ISSUES_DIR)
  const refused = await reader.refusal(issues)
  if (refused !== null) {
    errors.push({ file: MAP_ISSUES_DIR, id: null, message: refused })
    return []
  }
  let names: string[]
  try {
    names = (await reader.fs.readdir(issues)).map((entry) => entry.name)
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return []
    errors.push({ file: MAP_ISSUES_DIR, id: null, message: error instanceof Error ? error.message : String(error) })
    return []
  }
  const tickets: MapTicket[] = []
  for (const file of names) {
    const key = issueKey(file)
    if (key === null) continue
    const read = await readText(reader, reader.paths.join(issues, file))
    if ('error' in read) errors.push({ file: `${MAP_ISSUES_DIR}/${file}`, id: null, message: read.error })
    if (!('text' in read)) continue
    const colon = key.indexOf(':')
    tickets.push({
      number: Number(key.slice(0, colon)),
      slug: key.slice(colon + 1),
      file,
      title: firstHeading(read.text),
      status: ticketStatus(read.text),
    })
  }
  return tickets.sort((a, b) => a.number - b.number || a.file.localeCompare(b.file))
}

/** Reads the topic in `folder`. Never throws for the topic's files: what is wrong with them is in `errors`. */
export async function readTopic(folder: string, options: TopicReadOptions = {}): Promise<ProductTopic> {
  const paths = options.paths ?? nativePath
  const links = cachedLinks(options.links)
  const allowed = options.allowed ?? [folder]
  const reader: Reader = { paths, fs: options.fs ?? nodeProductFs, refusal: (path) => linkRefusal(path, allowed, { paths, links }) }
  const errors: TopicError[] = []
  const topic: ProductTopic = { name: paths.parse(folder).base, folder, title: null, sections: [], tickets: [], nodes: [], errors }

  const map = await readText(reader, paths.join(folder, MAP_FILE))
  if ('text' in map) {
    topic.title = firstHeading(map.text)
    topic.sections = mapSections(map.text)
  } else {
    errors.push({ file: MAP_FILE, id: null, message: 'missing' in map ? 'the topic has no map.md' : map.error })
  }

  topic.tickets = await readTickets(reader, folder, errors)

  const mindMap = await readText(reader, paths.join(folder, MIND_MAP_FILE))
  if ('error' in mindMap) errors.push({ file: MIND_MAP_FILE, id: null, message: mindMap.error })
  if (!('text' in mindMap)) return topic
  let value: unknown
  try {
    // A byte order mark at the start, as some Windows editors save UTF-8, is not part of the JSON.
    value = JSON.parse(mindMap.text.replace(/^\uFEFF/u, ''))
  } catch (error) {
    errors.push({ file: MIND_MAP_FILE, id: null, message: `not valid JSON: ${error instanceof Error ? error.message : String(error)}` })
    return topic
  }
  const checked = checkMindMap(
    value,
    topic.tickets.map((ticket) => ticket.number),
  )
  if (checked.ok) topic.nodes = checked.map.nodes
  else for (const error of checked.errors) errors.push({ file: MIND_MAP_FILE, ...error })
  return topic
}
