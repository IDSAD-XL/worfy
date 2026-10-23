// Find in a Session's transcript (⌘F in the Session view, worfy-ui ticket 26): the matches of a
// query over the whole history of the Session, not only the rows on screen.
//
// - The rows the view holds are searched here, over the rows of fold.ts: the parts of each row
//   find looks in (findParts) are the fields src/shared/transcript/find.ts names. A match inside a
//   folded «N tools» line or a closed thinking, hook or notice row says what to open (`reveal`).
// - The part of the file before them (behind «Load earlier», ticket 21) is searched by main
//   (`claudeHome.transcriptFind`): it answers the lines with matches and their counts. Going to such
//   a match loads windows until its line is read; then it is a match of the rows like the others.
//
// Matches are in the order of the transcript, oldest first: «1 of M» is the oldest. The Transcript
// (Transcript.tsx) paints them with the CSS Custom Highlight API and scrolls to the current one; the
// bar is SessionFind.tsx. Everything here only reads.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type { AgentEvent } from '../../shared/agent/events'
import { SHORTCUTS } from '../../shared/shortcuts'
import { TRANSCRIPT_FIND } from '../../shared/ipc/claude-home'
import { clipText, findNeedle, hookOutput, textMatches, toolSummary, type FindText } from '../../shared/transcript/find'
import { stepMatch } from '../find/search-index'
import { invoke } from '../ipc'
import { matches as matchesShortcut } from '../shortcuts/match'
import { foldTranscript, toolSegments, type TranscriptItem } from './fold'
import { useNavigation } from './navigation'
import { rowTypes } from './rows/index'

/** The event types drawn by a row file (rows/index.ts): the same set the Transcript folds with. */
export const extensionTypes: ReadonlySet<string> = new Set(rowTypes.keys())

/** Pause after typing before main is asked about the history the view has not read. */
export const FIND_DEBOUNCE_MS = 150

/** Matches painted at most; the current one always is. */
const PAINTED = 5000

/** The id of one searched part of a row: `data-find` of its element. */
export const partId = (row: string, part: string): string => `${row}:${part}`

/**
 * What a match in a part needs opened to be seen: `fold` — the row's closed line (thinking, hook,
 * notice); `tools:<call id>` — the «N tools» line whose first call has that id; null — nothing.
 */
export type Reveal = 'fold' | `tools:${string}` | null

export interface FindPart extends FindText {
  id: string
  reveal: Reveal
}

/**
 * The parts of a row find looks in, in the order the row draws them, with the text the row shows
 * (src/shared/transcript/find.ts). `partial`: the rows start after the beginning of the file, which
 * main searches; a Subagent row whose Agent call lies there is left out then, as main counts the
 * call and not the Subagent.
 */
export function findParts(item: TranscriptItem, hideTools: boolean, partial = false): FindPart[] {
  const part = (name: string, text: string, reveal: Reveal = null, markdown = false): FindPart => ({ id: partId(item.key, name), text, reveal, ...(markdown ? { markdown } : {}) })
  switch (item.kind) {
    case 'prompt':
      return [part('prompt', item.text)]
    case 'text':
      return [part('text', item.text, null, true)]
    case 'thinking':
      return [part('thinking', item.text, 'fold')]
    case 'tools': {
      const folded = new Map<string, Reveal>()
      if (hideTools) for (const segment of toolSegments(item.calls)) if (segment.folded) for (const call of segment.calls) folded.set(call.id, `tools:${segment.calls[0]?.id ?? ''}`)
      return item.calls.flatMap((call) => [
        part(`${call.id}:name`, call.name, folded.get(call.id) ?? null),
        part(`${call.id}:line`, call.subagent?.description ?? toolSummary(call.input), folded.get(call.id) ?? null),
      ])
    }
    case 'subagent':
      return item.run.description === null || (partial && item.toolUseId !== undefined) ? [] : [part('subagent', item.run.description)]
    case 'hook': {
      const output = hookOutput(item.event)
      return [part('hook-name', item.event.hookName), ...(output === '' ? [] : [part('hook-output', clipText(output), 'fold')])]
    }
    case 'notice':
      return item.noticeKind === 'synthetic' ? [part('notice', clipText(item.text), 'fold')] : [part('notice', item.text)]
    case 'error':
      return [part('error', item.text)]
    default:
      return []
  }
}

/** One match among the rows the view holds: its row, its part, which occurrence in the part. */
export interface RowMatch {
  row: string
  part: string
  occurrence: number
  reveal: Reveal
}

/** Every match of `needle` (findNeedle) in the rows, oldest first; `partial` as for findParts. */
export function rowMatches(items: readonly TranscriptItem[], needle: string, hideTools: boolean, partial = false): RowMatch[] {
  const found: RowMatch[] = []
  if (needle === '') return found
  for (const item of items) {
    for (const each of findParts(item, hideTools, partial)) {
      const count = textMatches(each, needle)
      for (let occurrence = 0; occurrence < count; occurrence += 1) found.push({ row: item.key, part: each.id, occurrence, reveal: each.reveal })
    }
  }
  return found
}

/** What the Transcript draws of find: the query, the parts with matches, the current match. */
export interface TranscriptFind {
  needle: string
  parts: ReadonlySet<string>
  current: RowMatch | null
  /**
   * Grows on each step and each ⌘F: the current match is scrolled to, and its folded line or closed
   * row opens, again even when the match is the same one (the reader may have closed the row).
   */
  seq: number
}

// ── the part of the file the view has not read ──────────────────────────────

/** The transcript file a view reads from its end, and how to read more of it (useClaudeHome.ts). */
export interface FindSource {
  root: string
  sessionId: string
  agentId?: string | undefined
  /** Where the line of the view's first event starts (TranscriptState.earlier); 0 or null: nothing before. */
  earlier: number | null
  /** Reads one more window before the shown events («Load earlier»). */
  loadEarlier: () => Promise<void>
  /** `earlier` now, outside React. */
  earlierNow: () => number | null
  /**
   * False while the part before `earlier` may hold turns the view shows from other events: a
   * resumed Session whose window holds only turns since Resume (its live events show them, and
   * where they start in the file is not known yet). Main is not asked then; `settle` reads on.
   * Absent: true.
   */
  settled?: boolean
  /** Reads windows until `settled` (SessionView: until one shows a turn from before Resume). */
  settle?: () => void
}

/**
 * FindSource.settled of a resumed Session's view (SessionView.tsx): the file before the window
 * holds only turns from before Resume once the window shows one of those (`shown`, the events of
 * the file joinPastAndLive keeps), or starts at the file's start, or there are no live events.
 * A window that shows none may lie wholly after Resume: the live part starts before it then, at a
 * byte not known, and main would count its turns a second time.
 */
export function pastSettled(shown: number, live: number, earlier: number | null): boolean {
  return live === 0 || shown > 0 || (earlier ?? 0) === 0
}

interface EarlierAnswer {
  /** Which file and query the answer is for. */
  key: string
  needle: string
  /** The bytes searched: [0, before). */
  before: number
  hits: readonly { offset: number; count: number }[]
  skipped: number
}

/**
 * `answer` with the lines of [answer.before, before) added: the window gave them up since (the
 * cap of the events dropped its oldest rows). The latest TRANSCRIPT_FIND.hits lines are kept, as
 * main keeps them; the matches of the older ones go to `skipped`.
 */
export function extendAnswer<T extends EarlierAnswer>(answer: T, before: number, more: { hits: readonly { offset: number; count: number }[]; skipped: number }): T {
  const hits = [...answer.hits, ...more.hits]
  const dropped = hits.splice(0, Math.max(0, hits.length - TRANSCRIPT_FIND.hits))
  return { ...answer, before, hits, skipped: answer.skipped + more.skipped + dropped.reduce((sum, hit) => sum + hit.count, 0) }
}

/** The answer for the part before `earlier`: lines past `earlier` are now rows of the view. */
function earlierCount(answer: EarlierAnswer | null, earlier: number | null): number {
  if (answer === null || earlier === null || earlier <= 0) return 0
  let count = answer.skipped
  for (const hit of answer.hits) if (hit.offset < earlier) count += hit.count
  return count
}

/** The byte of the line of match `index` (counted from the oldest) before `earlier`; the oldest line known for a skipped one. */
function lineOf(answer: EarlierAnswer, index: number): number {
  let seen = answer.skipped
  for (const hit of answer.hits) {
    if (index < seen + hit.count) return hit.offset
    seen += hit.count
  }
  return answer.hits.at(-1)?.offset ?? 0
}

type Current = { kind: 'row'; match: RowMatch } | { kind: 'earlier'; index: number } | null

const sameMatch = (a: RowMatch, b: RowMatch): boolean => a.part === b.part && a.occurrence === b.occurrence

/**
 * The match a new query starts on: the last one whose row begins above the bottom of the log, so a
 * reader at the bottom starts on the newest; the first one when every row with a match is below.
 */
function startingMatch(log: HTMLElement | null, found: readonly RowMatch[]): RowMatch | null {
  if (found.length === 0) return null
  // A log with no height (hidden, or not laid out) tells nothing of where the reader is: the newest.
  if (log !== null && log.getBoundingClientRect().height > 0) {
    const bottom = log.getBoundingClientRect().bottom
    const rows = new Map<string, Element>()
    for (const row of Array.from(log.querySelectorAll('[data-row]'))) rows.set(row.getAttribute('data-row') ?? '', row)
    for (let index = found.length - 1; index >= 0; index -= 1) {
      const row = rows.get(found[index]!.row)
      if (row !== undefined && row.getBoundingClientRect().top < bottom) return found[index]!
    }
    if (found.some((match) => rows.has(match.row))) return found[0]!
  }
  return found.at(-1) ?? null
}

export interface TranscriptFindOptions {
  events: readonly AgentEvent[]
  firstIndex: number
  hideTools: boolean
  /** The transcript file behind the events, when the view reads one; undefined without. */
  source: FindSource | undefined
  /** The Transcript's log (Transcript.tsx, `logRef`): where a new query starts. */
  log: RefObject<HTMLDivElement | null>
}

export interface TranscriptFindState {
  open: boolean
  query: string
  setQuery: (query: string) => void
  /** Grows each time ⌘F asks for the field: the bar focuses it and selects its text. */
  focusSeq: number
  close: () => void
  /** Goes to the next match, or the previous one with `back`, around the ends. */
  step: (back: boolean) => void
  /** «3 of 12», «12 matches», «No matches»; empty for a query too short. */
  count: string
  /** Why the count may miss matches; null when it counts them all. */
  note: string | null
  /** True while windows are loaded to reach a match. */
  loading: boolean
  /** What the Transcript draws; undefined while the bar is closed or the query too short. */
  transcript: TranscriptFind | undefined
}

/**
 * Find in the Session view's transcript: the bar's state, ⌘F (Ctrl+F on Windows and Linux) while
 * the Session view is on screen, the matches of the rows and of the file before them.
 */
export function useTranscriptFind({ events, firstIndex, hideTools, source, log }: TranscriptFindOptions): TranscriptFindState {
  const [open, setOpen] = useState(false)
  const [query, setQueryState] = useState('')
  const [focusSeq, setFocusSeq] = useState(0)
  const [current, setCurrent] = useState<Current>(null)
  const [answer, setAnswer] = useState<EarlierAnswer | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [seq, setSeq] = useState(0)
  const needle = open ? findNeedle(query) : ''
  const view = useNavigation((store) => store.view)
  // The rows start after the beginning of the file: main searches the part before them.
  const partial = (source?.earlier ?? 0) > 0

  // The rows are folded only while the bar is open.
  const items = useMemo(() => (open ? foldTranscript(events, extensionTypes, firstIndex) : []), [open, events, firstIndex])
  const found = useMemo(() => rowMatches(items, needle, hideTools, partial), [items, needle, hideTools, partial])

  // What the handlers and the effects read of the last render: the panel makes a new source each
  // render, so the effects follow its key and read the source here.
  const latest = useRef({ source, events, firstIndex, hideTools, found, open, query })
  useLayoutEffect(() => {
    latest.current = { source, events, firstIndex, hideTools, found, open, query }
  })

  /** Where a query starts: near what the reader looks at (startingMatch). */
  const begin = useCallback(
    (next: string) => {
    const wanted = findNeedle(next)
    if (wanted === '') return setCurrent(null)
    const now = latest.current
    const start = startingMatch(log.current, rowMatches(foldTranscript(now.events, extensionTypes, now.firstIndex), wanted, now.hideTools, (now.source?.earlier ?? 0) > 0))
    setCurrent(start === null ? null : { kind: 'row', match: start })
    },
    [log],
  )

  // ⌘F while the Session view is shown (the panel stays mounted under the Canvas). On Windows and
  // Linux Ctrl+F inside a Terminal stays with the shell (match.ts).
  useEffect(() => {
    if (view !== 'session') return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !matchesShortcut(event, SHORTCUTS.sessionFind)) return
      event.preventDefault()
      // Opened again on the query it had: it starts again near what the reader looks at.
      if (!latest.current.open) begin(latest.current.query)
      setOpen(true)
      setFocusSeq((seq) => seq + 1)
      setSeq((seq) => seq + 1)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [view, begin])

  // ── main, for the part of the file before the rows ──
  const sourceKey = source === undefined ? '' : `${source.root}\0${source.sessionId}\0${source.agentId ?? ''}`
  const earlier = source?.earlier ?? null
  const settled = source?.settled !== false
  const searchable = needle !== '' && source !== undefined && earlier !== null && earlier > 0
  const fresh = answer !== null && answer.key === sourceKey && answer.needle === needle
  // Asked again from the start for a new query or file, or when the part before the rows shrank
  // past lines the answer left out (`skipped`); asked only for the part it gave up when it grew
  // (the cap of the events dropped old rows), so a live Session does not read its file again.
  let from: number | null = null
  if (searchable && settled) {
    if (!fresh || (answer.skipped > 0 && earlier < answer.before)) from = 0
    else if (earlier > answer.before) from = answer.before
  }
  const asked = useRef(0)
  useEffect(() => {
    const source = latest.current.source
    const start = from
    if (start === null || source === undefined || earlier === null) return
    const ask = (asked.current += 1)
    const timer = setTimeout(() => {
      const input = { projectRoot: source.root, sessionId: source.sessionId, query: needle, before: earlier, ...(start > 0 ? { from: start } : {}), ...(source.agentId === undefined ? {} : { agentId: source.agentId }) }
      void invoke('claudeHome.transcriptFind', input).then((result) => {
        if (ask !== asked.current) return
        if (!result.ok) {
          // A main without the channel (a Linked machine on an older build) or a failed read: the rows still count.
          setFailed(result.error)
          return
        }
        setFailed(null)
        const value = result.value.found ? result.value : { hits: [], skipped: 0 }
        if (start === 0) setAnswer({ key: sourceKey, needle, before: earlier, hits: value.hits, skipped: value.skipped })
        else setAnswer((known) => (known !== null && known.key === sourceKey && known.needle === needle && known.before === start ? extendAnswer(known, earlier, value) : known))
      })
    }, FIND_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [from, sourceKey, needle, earlier])
  // A resumed Session whose window shows only turns since Resume: read on before main is asked.
  const settling = searchable && !settled ? `${sourceKey}\0${earlier}` : null
  useEffect(() => {
    if (settling !== null) latest.current.source?.settle?.()
  }, [settling])
  const before = fresh && searchable && settled ? earlierCount(answer, earlier) : 0
  const total = before + found.length

  // The current match as an index from the oldest, and as a match of the rows once its row is read.
  let at = -1
  let shown: RowMatch | null = null
  if (current?.kind === 'row') {
    const index = found.findIndex((match) => sameMatch(match, current.match))
    if (index >= 0) {
      at = before + index
      shown = found[index]!
    }
  } else if (current?.kind === 'earlier') {
    at = current.index
    if (current.index >= before) shown = found[current.index - before] ?? null
  }
  // Once read, a match of the file is a match of the rows: it keeps its place as more is read.
  if (current?.kind === 'earlier' && shown !== null) setCurrent({ kind: 'row', match: shown })

  // Going to a match before the rows: «Load earlier» until its line is read. If nothing more can
  // be read, the oldest match of the rows becomes the current one.
  const bringing = useRef(0)
  const target = current?.kind === 'earlier' && current.index < before && fresh && answer !== null ? lineOf(answer, current.index) : null
  useEffect(() => {
    const source = latest.current.source
    if (target === null || source === undefined) return
    const run = (bringing.current += 1)
    void (async () => {
      for (let round = 0; round < 1000; round += 1) {
        const now = source.earlierNow()
        if (run !== bringing.current || now === null || now <= target) return
        await source.loadEarlier()
        if (source.earlierNow() === now) break // nothing more could be read
      }
      if (run !== bringing.current) return
      const oldest = latest.current.found[0]
      setCurrent(oldest === undefined ? null : { kind: 'row', match: oldest })
    })()
    return () => {
      bringing.current += 1
    }
  }, [target, sourceKey])

  const step = (back: boolean) => {
    const next = stepMatch(at, total, back)
    if (next < 0) return
    setSeq((seq) => seq + 1)
    if (next >= before) setCurrent({ kind: 'row', match: found[next - before]! })
    else setCurrent({ kind: 'earlier', index: next })
  }

  const close = () => setOpen(false)

  const setQuery = (next: string) => {
    setQueryState(next)
    begin(next)
  }

  let count = ''
  if (needle !== '') {
    const more = searchable && (from !== null || !settled) && failed === null ? '+' : ''
    if (total === 0) count = more === '' ? 'No matches' : 'Searching…'
    else if (at >= 0) count = `${at + 1} of ${total}${more}`
    else count = `${total}${more} ${total === 1 && more === '' ? 'match' : 'matches'}`
  }
  const note = needle !== '' && searchable && failed !== null ? `The history before the shown messages was not searched: ${failed}` : null

  const parts = useMemo(() => new Set(found.map((match) => match.part)), [found])
  // One object while nothing changed: the Transcript paints again only when it does.
  const transcript = useMemo(() => (needle === '' ? undefined : { needle, parts, current: shown, seq }), [needle, parts, shown, seq])
  return { open, query, setQuery, focusSeq, close, step, count, note, loading: target !== null, transcript }
}

// ── painting in the log ─────────────────────────────────────────────────────

/** Names of the highlights in CSS (session.css, `::highlight(…)`). */
export const HIGHLIGHT = { all: 'worfy-find', current: 'worfy-find-current' } as const

interface Painted {
  /** The current match's text, when its part is drawn. */
  range: Range | null
  /** The element of the current match's part, or of its row when the part is not drawn. */
  element: Element | null
}

/** The occurrences of `needle` in the text of `element`, as ranges, case ignored. */
export function rangesOf(element: Element, needle: string): Range[] {
  const document = element.ownerDocument
  const walker = document.createTreeWalker(element, 4 /* NodeFilter.SHOW_TEXT */)
  const nodes: { node: Text; start: number }[] = []
  let text = ''
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const data = (node as Text).data
    nodes.push({ node: node as Text, start: text.length })
    // One unit at a time, so an offset in the lower-case text is the same offset in the node.
    for (const unit of data.split('')) {
      const lower = unit.toLowerCase()
      text += lower.length === 1 ? lower : unit
    }
  }
  const ranges: Range[] = []
  if (needle === '') return ranges
  const place = (offset: number, end: boolean): { node: Text; offset: number } => {
    let index = nodes.length - 1
    while (index > 0 && (end ? nodes[index]!.start >= offset : nodes[index]!.start > offset)) index -= 1
    const at = nodes[index]!
    return { node: at.node, offset: offset - at.start }
  }
  for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + needle.length)) {
    const range = document.createRange()
    const start = place(at, false)
    const end = place(at + needle.length, true)
    range.setStart(start.node, start.offset)
    range.setEnd(end.node, end.offset)
    ranges.push(range)
  }
  return ranges
}

type Registry = { set: (name: string, highlight: unknown) => void; delete: (name: string) => void }

/** The CSS highlight registry and its Highlight class; undefined where the API is missing. */
function highlights(): { registry: Registry; Highlight: new (...ranges: Range[]) => unknown } | undefined {
  const css = (globalThis as { CSS?: { highlights?: Registry } }).CSS
  const Highlight = (globalThis as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight
  return css?.highlights !== undefined && Highlight !== undefined ? { registry: css.highlights, Highlight } : undefined
}

/** Paints the matches drawn in `log` and says where the current one is. */
export function paintMatches(log: HTMLElement, find: TranscriptFind): Painted {
  const ranges: Range[] = []
  let range: Range | null = null
  let element: Element | null = null
  const current = find.current
  for (const each of Array.from(log.querySelectorAll('[data-find]'))) {
    const id = each.getAttribute('data-find') ?? ''
    if (!find.parts.has(id)) continue
    const isCurrent = current !== null && current.part === id
    if (ranges.length >= PAINTED && !isCurrent) continue
    const found = rangesOf(each, find.needle)
    for (const one of found) if (ranges.length < PAINTED) ranges.push(one)
    if (isCurrent) {
      element = each
      range = found[Math.min(current.occurrence, found.length - 1)] ?? null
    }
  }
  if (current !== null && element === null) element = Array.from(log.querySelectorAll('[data-row]')).find((row) => row.getAttribute('data-row') === current.row) ?? null
  const api = highlights()
  if (api !== undefined) {
    api.registry.set(HIGHLIGHT.all, new api.Highlight(...ranges))
    if (range !== null) api.registry.set(HIGHLIGHT.current, new api.Highlight(range))
    else api.registry.delete(HIGHLIGHT.current)
  }
  return { range, element }
}

/** Takes the paint of find away. */
export function clearMatches(): void {
  const api = highlights()
  api?.registry.delete(HIGHLIGHT.all)
  api?.registry.delete(HIGHLIGHT.current)
}

/** Scrolls `log` so the current match is in the middle of it, unless it is in sight already. */
export function scrollToMatch(log: HTMLElement, painted: Painted): void {
  const box = (typeof painted.range?.getBoundingClientRect === 'function' ? painted.range.getBoundingClientRect() : null) ?? painted.element?.getBoundingClientRect()
  if (box === undefined) return
  const view = log.getBoundingClientRect()
  if (box.top >= view.top && box.bottom <= view.bottom && (box.width > 0 || box.height > 0)) return
  log.scrollTop += box.top - view.top - (log.clientHeight - box.height) / 2
}
