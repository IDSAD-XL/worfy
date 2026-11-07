// Reading one Product Session topic, `docs/product/<topic>/` (ADR-0101; Epic worfy-product-session,
// ticket 03): the wayfinder map (`map.md`), its Tickets (`issues/NN-slug.md`) and the Mind map
// (`mind-map.json`, checked by checkMindMap).
//
// A file that is missing, unreadable or wrong makes a topic with errors, never an exception: the
// screen shows the error and the node it is about instead of an empty map. Nothing here writes. In
// particular mind-map.json is not read with readJsonFile (src/main/storage/json-file.ts): that one
// renames a file it cannot parse, and this file belongs to the Project, edited by hand or by an agent.
import { readdir, readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { checkMindMap, type MindMapNode } from '../../shared/product/mind-map'
import { MAP_FILE, MAP_ISSUES_DIR, MIND_MAP_FILE } from '../../shared/product/paths'
import { firstHeading, issueKey } from '../workflow/reader'

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

async function readText(path: string): Promise<Read> {
  try {
    return { text: await readFile(path, 'utf8') }
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

async function readTickets(folder: string, errors: TopicError[]): Promise<MapTicket[]> {
  let names: string[]
  try {
    names = await readdir(join(folder, MAP_ISSUES_DIR))
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return []
    errors.push({ file: MAP_ISSUES_DIR, id: null, message: error instanceof Error ? error.message : String(error) })
    return []
  }
  const tickets: MapTicket[] = []
  for (const file of names) {
    const key = issueKey(file)
    if (key === null) continue
    const read = await readText(join(folder, MAP_ISSUES_DIR, file))
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
export async function readTopic(folder: string): Promise<ProductTopic> {
  const errors: TopicError[] = []
  const topic: ProductTopic = { name: basename(folder), folder, title: null, sections: [], tickets: [], nodes: [], errors }

  const map = await readText(join(folder, MAP_FILE))
  if ('text' in map) {
    topic.title = firstHeading(map.text)
    topic.sections = mapSections(map.text)
  } else {
    errors.push({ file: MAP_FILE, id: null, message: 'missing' in map ? 'the topic has no map.md' : map.error })
  }

  topic.tickets = await readTickets(folder, errors)

  const mindMap = await readText(join(folder, MIND_MAP_FILE))
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
