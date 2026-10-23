// What find in a Session's transcript (⌘F in the Session view, worfy-ui ticket 26) looks in, and how
// it counts. Two places count: the renderer over the rows it has read (src/renderer/session/
// transcript-find.ts, over fold.ts), and main over the part of the file before them, which the
// view has not read yet (src/main/claude-home/transcript-find.ts). Both count in the same fields,
// the ones this file names, so «N of M» stays the same match as the history loads.
//
// Searched: the user's messages, Claude's text, thinking, a tool call's name and its one line (the
// command, file or pattern its row shows), a Subagent's description, a hook's name and output, a
// notice and an error. Not searched: the whole input and result of a tool call — most of the bytes
// of a transcript, and drawn only in a call's opened row, cut at 20 000 characters.
//
// Counted is the text the row shows, so every match counted is one painted: Claude's markdown as
// it reads on screen (src/shared/markdown/visible-text.ts), a hook's output and an added notice cut
// as their rows cut them (clipText).
//
// Pure: no DOM, no Node; main and the renderer both import it.
import type { AgentEvent } from '../agent/events'
import { markdownText, mayShow } from '../markdown/visible-text'
import { INTERRUPT_NOTICE } from './parse'

/** Characters a row shows of a long text (a tool's input or result, a hook's output, an added notice). */
export const TEXT_LIMIT = 20_000

/** A long text as its row shows it: the first TEXT_LIMIT characters and how many more there are. */
export function clipText(text: string): string {
  return text.length > TEXT_LIMIT ? `${text.slice(0, TEXT_LIMIT)}\n… (${text.length - TEXT_LIMIT} more characters)` : text
}

/** One text find looks in: shown as it is, or as markdown (Claude's answer). */
export interface FindText {
  text: string
  markdown?: boolean
}

/** The matches of `needle` in one text, counted in what its row shows. */
export function textMatches(field: FindText, needle: string): number {
  if (field.markdown !== true) return countMatches(field.text, needle)
  if (needle === '' || !mayShow(field.text, needle)) return 0
  return countMatches(markdownText(field.text), needle)
}

/** Shortest query find searches for, as on the Canvas (src/renderer/find/search-index.ts). */
export const MIN_TRANSCRIPT_FIND = 2

/** The query as find compares it: trimmed, lower case. Empty when it is too short to search. */
export function findNeedle(query: string): string {
  const needle = query.trim().toLowerCase()
  return needle.length >= MIN_TRANSCRIPT_FIND ? needle : ''
}

/** How many times `needle` (from findNeedle) occurs in `text`, case ignored, without overlaps. */
export function countMatches(text: string, needle: string): number {
  if (needle === '' || text.length < needle.length) return 0
  const haystack = text.toLowerCase()
  let count = 0
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + needle.length)) count += 1
  return count
}

function stringField(input: unknown, key: string): string | null {
  if (input === null || typeof input !== 'object') return null
  const value = (input as Record<string, unknown>)[key]
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

/** One line that says what a tool call did: its command, file, pattern or description. */
export function toolSummary(input: unknown): string {
  for (const key of ['command', 'file_path', 'notebook_path', 'pattern', 'url', 'query', 'description', 'prompt', 'path', 'skill']) {
    const value = stringField(input, key)
    if (value !== null) return value.split('\n')[0] ?? value
  }
  return ''
}

/** What a hook row opens to: its output and its errors. */
export function hookOutput(event: Extract<AgentEvent, { type: 'hook' }>): string {
  return [event.stdout.trim(), event.stderr.trim()].filter((part) => part !== '').join('\n')
}

/**
 * The texts of one event that find looks in, as the transcript draws them (fold.ts): only the
 * Session's own thread, no interruption notice, a Subagent's description on its own row only when
 * no tool call of the thread started it (the call's row shows it then, and the call counts).
 */
export function eventFindTexts(event: AgentEvent): FindText[] {
  const plain = (...texts: string[]): FindText[] => texts.map((text) => ({ text }))
  switch (event.type) {
    case 'notice':
      if (event.kind === 'user') return INTERRUPT_NOTICE.test(event.text) ? [] : plain(event.text)
      return plain(event.kind === 'synthetic' ? clipText(event.text) : event.text)
    case 'text':
      return event.parentToolUseId === null ? [{ text: event.text, markdown: true }] : []
    case 'thinking':
      return event.parentToolUseId === null ? plain(event.text) : []
    case 'tool_use':
      return event.parentToolUseId === null ? plain(event.name, toolSummary(event.input)) : []
    case 'subagent':
      return event.phase === 'started' && event.toolUseId === null && event.description !== null ? plain(event.description) : []
    case 'hook':
      return plain(event.hookName, clipText(hookOutput(event)))
    case 'state':
      return event.state === 'error' ? plain(event.error ?? 'The Session stopped with an error') : []
    default:
      return []
  }
}

/** The matches of `needle` in one event: what main counts for a line of the file it has not shown. */
export function eventMatches(event: AgentEvent, needle: string): number {
  let count = 0
  for (const field of eventFindTexts(event)) count += textMatches(field, needle)
  return count
}
