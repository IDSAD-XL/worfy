import { createContext, createElement, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import type { AgentEvent } from '../../shared/agent/events'
import { subagentTypeLabel } from '../../shared/agent/subagent-type'
import { clipText as clip, hookOutput, toolSummary } from '../../shared/transcript/find'
import { Markdown } from '../markdown/Markdown'
import { DRAW_ALL_UP_TO, FIRST_DRAWN, foldTranscript, ROW_ESTIMATE, rowFor, rowOrder, rowWindow, spanOf, stepOf, toolSegments, type SubagentRun, type ToolCall, type TranscriptItem } from './fold'
import { formatDuration } from './format'
import { MessageAttachments } from './MessageAttachments'
import { rowTypes } from './rows/index'
import { clearMatches, extensionTypes, paintMatches, partId, scrollToMatch, type TranscriptFind } from './transcript-find'

// The transcript of one Session: the user's messages, the assistant's text as markdown, thinking
// folded away, tool calls one line each with ✓ or the error, hooks that said something, subagents
// the Session started, and how each turn ended. It gets the Session's events and does not know
// where they come from (fold.ts); a new kind of row is a file in rows/ (rows/index.ts). The
// prompt, hook, subagent and notice rows show when they happened under the label; the answer
// keeps its time in the label's tooltip, as the F mockups draw it (ticket 14). With `hideTools`
// (the header's «Hide tools», worfy-ui ticket 25) the ordinary calls of a run fold into one line.
// With `find` (⌘F, worfy-ui ticket 26, transcript-find.ts) the matches are painted, the current one
// is scrolled to, and the folded line or closed row it is in opens. Every row carries its key in
// `data-row` and every searched part its id in `data-find`.

export interface TranscriptProps {
  events: readonly AgentEvent[]
  /** Position of `events[0]` in the whole Session, when older events were dropped (store.ts); 0 by default. */
  firstIndex?: number
  /** The live Session the events belong to; null for a transcript read from a file. */
  sessionId?: string | null
  /** The Project whose files relative links in the text open. */
  projectId?: string | undefined
  /** How the assistant's rows are labelled. */
  assistantLabel?: string
  /**
   * «Load earlier» at the top of the log, for a transcript read from its end (ticket 21); none
   * without it, or once the events start at the beginning of the file.
   */
  earlier?: EarlierControl | undefined
  /**
   * Tool calls folded (worfy-ui ticket 25): the ordinary calls of each run are one «N tools» line
   * that opens on a click; a call with an error and a call that started a Subagent stay as they are
   * (fold.ts, toolSegments). Every other row is drawn the same either way.
   */
  hideTools?: boolean | undefined
  /** The matches of the Session view's find bar (transcript-find.ts); none while it is closed. */
  find?: TranscriptFind | undefined
  /** Gets the log element, for find to tell where the reader is. */
  logRef?: RefObject<HTMLDivElement | null> | undefined
}

export interface EarlierControl {
  /** Reads the events before the shown ones; the log keeps the row the reader looked at in place. */
  load: () => void
  /** True while they are read. */
  loading: boolean
}

/** The key of the row being drawn (fold.ts): Row writes it in `data-row`. */
const RowKey = createContext<string | undefined>(undefined)

/** A closed line of a row (a tool call, «N tools», thinking, hook, notice): open, and the last find match that opened it. */
interface LineState {
  open: boolean
  revealed: string | null
}

/**
 * The lines of the transcript as the reader left them, by line id: a row that scrolls out of the
 * drawn part (worfy-ui ticket 22) is drawn again open or closed as it was.
 */
const Lines = createContext<Map<string, LineState> | null>(null)

/**
 * Whether line `id` is open. It also opens when find's current match is in it: `reveal` names that
 * match and the step that went to it (TranscriptFind.seq), and a new one opens the line again even
 * after the reader closed it — also a step back to the same match.
 */
function useLine(id: string, reveal: string | null = null): [boolean, (open: boolean) => void] {
  const lines = useContext(Lines)
  const [state, setState] = useState<LineState>(() => lines?.get(id) ?? { open: false, revealed: null })
  let shown = state
  if (reveal !== null && reveal !== state.revealed) {
    shown = { open: true, revealed: reveal }
    setState(shown)
  }
  useEffect(() => {
    lines?.set(id, state)
  }, [lines, id, state])
  return [shown.open, (open) => setState((now) => ({ ...now, open }))]
}

function Check() {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3.5 8.5l3 3 6-7" />
    </svg>
  )
}

function Cross() {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  )
}

function Spinner() {
  return (
    <svg className="w-session__spin" width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
      <circle cx="8" cy="8" r="5.5" strokeOpacity="0.3" />
      <path d="M8 2.5a5.5 5.5 0 0 1 5.5 5.5" />
    </svg>
  )
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg className="w-tr__chevron" data-open={open} width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 3.5L10.5 8 6 12.5" />
    </svg>
  )
}

/** The time rows are dated against (useToday): which of them are of today. */
const NowContext = createContext(0)

/**
 * The time now, taken when the transcript mounts and again at every local midnight, so a row of
 * yesterday gets its date while the view stays open.
 */
function useToday(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const midnight = new Date(now)
    midnight.setHours(24, 0, 0, 0)
    const timer = setTimeout(() => setNow(Date.now()), Math.max(midnight.getTime() - now, 1000))
    return () => clearTimeout(timer)
  }, [now])
  return now
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const two = (value: number): string => String(value).padStart(2, '0')

/**
 * When a row happened, in local time: `HH:MM`, a date before it for a row of another day than
 * today (`Oct 4`, `Dec 31 '25` in another year), and the full time with seconds for the tooltip.
 */
function rowTime(at: number, now: number): { date: string | null; clock: string; full: string } {
  const when = new Date(at)
  const today = new Date(now)
  const clock = `${two(when.getHours())}:${two(when.getMinutes())}`
  const full = `${when.getFullYear()}-${two(when.getMonth() + 1)}-${two(when.getDate())} ${clock}:${two(when.getSeconds())}`
  const sameDay = when.getFullYear() === today.getFullYear() && when.getMonth() === today.getMonth() && when.getDate() === today.getDate()
  if (sameDay) return { date: null, clock, full }
  const day = `${MONTHS[when.getMonth()] ?? ''} ${when.getDate()}`
  return { date: when.getFullYear() === today.getFullYear() ? day : `${day} '${String(when.getFullYear()).slice(-2)}`, clock, full }
}

/**
 * A row with the label column on the left (who wrote it), as in the F mockups. `at` is shown under
 * the label when `time` is `shown`, only in the label's tooltip when it is `tooltip`.
 */
function Row({
  label,
  labelKind,
  at = null,
  time = 'shown',
  children,
  testId,
}: {
  label?: string
  labelKind?: 'user' | 'assistant'
  at?: number | null
  time?: 'shown' | 'tooltip'
  children: ReactNode
  testId: string
}) {
  const now = useContext(NowContext)
  const rowKey = useContext(RowKey)
  // A time Date cannot hold (out of its range) is shown as none rather than thrown on.
  const when = at === null || !Number.isFinite(new Date(at).getTime()) ? null : rowTime(at, now)
  return (
    <div className="w-tr__row" data-testid={testId} data-row={rowKey}>
      <div className={`w-tr__who w-mono${labelKind ? ` w-tr__who--${labelKind}` : ''}`} title={when !== null && time === 'tooltip' ? when.full : undefined}>
        {label !== undefined ? <span className="w-tr__label">{label}</span> : null}
        {when !== null && time === 'shown' ? (
          <time className="w-tr__time" dateTime={new Date(at as number).toISOString()} title={when.full} data-testid="transcript-time">
            {when.date !== null ? (
              <span className="w-tr__date" data-testid="transcript-date">
                {when.date}
              </span>
            ) : null}
            <span data-testid="transcript-clock">{when.clock}</span>
          </time>
        ) : null}
      </div>
      <div className="w-tr__body">{children}</div>
    </div>
  )
}

/**
 * Hook outcomes that are an error (worfy-daily ticket 25): `error` and `cancelled` of a live
 * Session's hook_response, `blocked` of a Stop hook summary, and the attachment types of Claude
 * Code 2.1.291 transcripts (`hook_blocking_error`, `hook_non_blocking_error`,
 * `hook_error_during_execution`, `hook_cancelled`, `hook_stopped_continuation`). Any other outcome
 * (`success`, `permission_decision`, `deferred_tool`) gets a cross only with a non-zero exit code.
 */
const HOOK_FAILURES: ReadonlySet<string> = new Set([
  'error',
  'cancelled',
  'blocked',
  'blocking_error',
  'non_blocking_error',
  'error_during_execution',
  'stopped_continuation',
])

function json(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value)
  } catch {
    return String(value)
  }
}

function SubagentStatus({ run }: { run: SubagentRun }) {
  if (run.status === null) {
    return (
      <span className="w-tr__status w-tr__status--working">
        <Spinner />
        running
      </span>
    )
  }
  const failed = run.status !== 'completed'
  return (
    <span className={`w-tr__status ${failed ? 'w-tr__status--blocked' : 'w-tr__status--done'}`}>
      {failed ? <Cross /> : <Check />}
      {run.status}
    </span>
  )
}

function ToolStatus({ call }: { call: ToolCall }) {
  if (call.subagent) return <SubagentStatus run={call.subagent} />
  if (call.result === null) {
    return (
      <span className="w-tr__status w-tr__status--working" data-testid="tool-running">
        <Spinner />
        running
      </span>
    )
  }
  return call.result.isError ? (
    <span className="w-tr__status w-tr__status--blocked" data-testid="tool-error">
      <Cross />
      error
    </span>
  ) : (
    <span className="w-tr__status w-tr__status--ready" data-testid="tool-ok" aria-label="succeeded">
      <Check />
    </span>
  )
}

function ToolRow({ call, row }: { call: ToolCall; row: string }) {
  const [open, setOpen] = useLine(`${row}:${call.id}`)
  const summary = call.subagent?.description ?? toolSummary(call.input)
  return (
    <div className="w-tr__tool" data-testid="tool-call" data-tool={call.name}>
      <button type="button" className="w-tr__tool-line" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Chevron open={open} />
        <span className="w-tr__tool-name" data-find={partId(row, `${call.id}:name`)}>
          {call.name}
        </span>
        <span className="w-tr__tool-summary w-mono" title={summary} data-find={partId(row, `${call.id}:line`)}>
          {summary}
        </span>
        <ToolStatus call={call} />
      </button>
      {open ? (
        <div className="w-tr__tool-details">
          <pre className="w-tr__pre w-mono">{clip(json(call.input))}</pre>
          {call.result ? <pre className={`w-tr__pre w-mono${call.result.isError ? ' w-tr__pre--error' : ''}`}>{clip(call.result.content)}</pre> : null}
          {call.subagent?.summary ? <pre className="w-tr__pre w-mono">{clip(call.subagent.summary)}</pre> : null}
        </div>
      ) : null}
    </div>
  )
}

/**
 * The ordinary calls of a run with tools hidden: one thin line «N tools» that opens on a click into
 * their own rows. While one of them runs, the line shows one «running» for all of them.
 */
function FoldedTools({ calls, row, reveal }: { calls: readonly ToolCall[]; row: string; reveal: string | null }) {
  const [open, setOpen] = useLine(`${row}:tools:${calls[0]?.id ?? ''}`, reveal)
  const running = calls.some((call) => call.result === null)
  return (
    <div className="w-tr__folded-tools" data-testid="tools-folded">
      <button type="button" className="w-tr__fold-line w-tr__folded-line" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Chevron open={open} />
        <span className="w-tr__muted">{calls.length === 1 ? '1 tool' : `${calls.length} tools`}</span>
        {running ? (
          <span className="w-tr__status w-tr__status--working" data-testid="tools-running">
            <Spinner />
            running
          </span>
        ) : null}
      </button>
      {open ? (
        <div className="w-tr__tools">
          {calls.map((call) => (
            <ToolRow key={call.id} call={call} row={row} />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function Disclosure({ summary, children, testId, reveal = null }: { summary: ReactNode; children: ReactNode; testId: string; reveal?: string | null }) {
  // One closed line per row (thinking, hook, notice).
  const [open, setOpen] = useLine(`${useContext(RowKey) ?? ''}:fold`, reveal)
  return (
    <div className="w-tr__fold" data-testid={testId}>
      <button type="button" className="w-tr__fold-line" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Chevron open={open} />
        {summary}
      </button>
      {open ? <div className="w-tr__fold-body">{children}</div> : null}
    </div>
  )
}

function ResultRow({ event }: { event: Extract<AgentEvent, { type: 'result' }> }) {
  if (event.interrupted) {
    return (
      <Row testId="transcript-interrupted">
        <span className="w-tr__marker w-tr__marker--blocked">
          <Cross />
          Interrupted
        </span>
      </Row>
    )
  }
  if (event.isError) {
    return (
      <Row testId="transcript-turn-error">
        <div className="w-tr__error">
          <Cross />
          <span>{event.error ?? event.subtype}</span>
        </div>
      </Row>
    )
  }
  return (
    <Row testId="transcript-turn-done">
      <span className="w-tr__marker">
        <Check />
        Turn finished · <span className="w-mono">{formatDuration(event.durationMs)}</span>
      </span>
    </Row>
  )
}

function Item({ item, props }: { item: TranscriptItem; props: TranscriptProps }) {
  const assistant = props.assistantLabel ?? 'claude'
  const current = props.find?.current
  // What find's current match opens in this row: its line «N tools» or the row's closed line.
  const revealing = current !== undefined && current !== null && current.row === item.key ? current : null
  const seq = props.find?.seq ?? 0
  const reveal = (what: string): string | null => (revealing !== null && revealing.reveal === what ? `${revealing.part}#${revealing.occurrence}#${seq}` : null)
  const find = (part: string): string => partId(item.key, part)
  switch (item.kind) {
    case 'prompt':
      return (
        <Row label="you" labelKind="user" at={item.at} testId="transcript-prompt">
          {item.text !== '' || item.attachments.length === 0 ? (
            <div className="w-tr__prompt" data-find={find('prompt')}>
              {item.text}
            </div>
          ) : null}
          <MessageAttachments attachments={item.attachments} />
        </Row>
      )
    case 'text':
      return (
        // The F mockups show no time on the answer: it stays in the label's tooltip.
        <Row label={item.synthetic ? 'claude code' : assistant} labelKind="assistant" at={item.at} time="tooltip" testId="transcript-text">
          <div className={item.synthetic ? 'w-tr__synthetic' : undefined} data-streaming={item.streaming || undefined} data-find={find('text')}>
            <Markdown text={item.text} projectId={props.projectId} breaks />
          </div>
        </Row>
      )
    case 'thinking':
      return (
        <Row testId="transcript-thinking">
          <Disclosure testId="thinking" reveal={reveal('fold')} summary={<span className="w-tr__muted">{item.streaming ? 'Thinking…' : 'Thinking'}</span>}>
            <div className="w-tr__thinking" data-find={find('thinking')}>
              {item.text}
            </div>
          </Disclosure>
        </Row>
      )
    case 'tools': {
      if (props.hideTools === true) {
        // A segment is keyed by its first call: a line keeps its open state while the run grows.
        return (
          <Row testId="transcript-tools">
            <div className="w-tr__tool-run">
              {toolSegments(item.calls).map((segment) =>
                segment.folded ? (
                  <FoldedTools key={segment.calls[0]?.id} calls={segment.calls} row={item.key} reveal={reveal(`tools:${segment.calls[0]?.id ?? ''}`)} />
                ) : (
                  <div key={segment.calls[0]?.id} className="w-tr__tools">
                    {segment.calls.map((call) => (
                      <ToolRow key={call.id} call={call} row={item.key} />
                    ))}
                  </div>
                ),
              )}
            </div>
          </Row>
        )
      }
      return (
        <Row testId="transcript-tools">
          <div className="w-tr__tools">
            {item.calls.map((call) => (
              <ToolRow key={call.id} call={call} row={item.key} />
            ))}
          </div>
        </Row>
      )
    }
    case 'subagent':
      return (
        <Row at={item.at} testId="transcript-subagent">
          <div className="w-tr__chip-row">
            <span className="w-tr__tool-name">Subagent</span>
            {item.run.subagentType ? (
              <span className="w-mono w-tr__muted" title={item.run.subagentType} data-testid="transcript-subagent-type">
                {subagentTypeLabel(item.run.subagentType)}
              </span>
            ) : null}
            <span className="w-tr__tool-summary" data-find={item.run.description === null ? undefined : find('subagent')}>
              {item.run.description ?? item.run.taskId}
            </span>
            <SubagentStatus run={item.run} />
          </div>
        </Row>
      )
    case 'hook': {
      const { event } = item
      const failed = HOOK_FAILURES.has(event.outcome) || (event.exitCode !== null && event.exitCode !== 0)
      const output = hookOutput(event)
      const line = (
        <span className="w-tr__hook-line">
          <span className={failed ? 'w-tr__status--blocked' : 'w-tr__status--ready'}>{failed ? <Cross /> : <Check />}</span>
          <span className="w-tr__tool-name">{event.hookEvent} hook</span>
          <span className="w-mono w-tr__muted" data-find={find('hook-name')}>
            {event.hookName}
          </span>
          <span className="w-mono w-tr__muted">{event.exitCode !== null ? `exit ${event.exitCode}` : event.outcome}</span>
        </span>
      )
      return (
        <Row at={item.at} testId="transcript-hook">
          {output === '' ? (
            <div className="w-tr__chip-row">{line}</div>
          ) : (
            <Disclosure testId="hook" summary={line} reveal={reveal('fold')}>
              <pre className="w-tr__pre w-mono" data-find={find('hook-output')}>
                {clip(output)}
              </pre>
            </Disclosure>
          )}
        </Row>
      )
    }
    case 'notice':
      return (
        <Row at={item.at} testId="transcript-notice">
          {item.noticeKind === 'synthetic' ? (
            <Disclosure testId="notice" summary={<span className="w-tr__muted">Added by Claude Code</span>} reveal={reveal('fold')}>
              <pre className="w-tr__pre w-mono" data-find={find('notice')}>
                {clip(item.text)}
              </pre>
            </Disclosure>
          ) : (
            <div className={`w-tr__notice${item.noticeKind === 'local_command' ? ' w-mono' : ''}`} data-find={find('notice')}>
              {item.text}
            </div>
          )}
        </Row>
      )
    case 'result':
      return <ResultRow event={item.event} />
    case 'error':
      return (
        <Row testId="transcript-error">
          <div className="w-tr__error">
            <Cross />
            <span data-find={find('error')}>{item.text}</span>
          </div>
        </Row>
      )
    case 'extension': {
      // The registry is fixed at build time (rows/index.ts), so the component never changes between renders.
      const row = rowTypes.get(item.event.type)
      return row ? createElement(row, { event: item.event, sessionId: props.sessionId ?? null, projectId: props.projectId }) : null
    }
  }
}

// ── drawing only the rows around the visible part (worfy-ui ticket 22) ─────────

/** Where the reader is: at the bottom of the log, or row `key` with its top `offset` px below the top of the visible part. */
type Position = { bottom: true } | { bottom: false; key: string; offset: number }
const BOTTOM: Position = { bottom: true }

/**
 * The part of the rows drawn: from row `from` to row `to` (null: to the last), and the height of
 * each space that stands for rows not drawn, by the key of the drawn row after it ('' for the last).
 */
interface Drawn {
  from: string
  to: string | null
  /** How many rows; where they start when `from` is gone (the cap of the events dropped it). */
  count: number
  spaces: Readonly<Record<string, number>>
}

function sameDrawn(a: Drawn | null, b: Drawn): boolean {
  if (a === null || a.from !== b.from || a.to !== b.to || a.count !== b.count) return false
  const keys = Object.keys(b.spaces)
  return keys.length === Object.keys(a.spaces).length && keys.every((key) => Math.abs((a.spaces[key] ?? Number.NaN) - b.spaces[key]!) < 1)
}

/**
 * The rows drawn, in order: [start, end), and the rows of `pinned` outside it — an open permission
 * or question card keeps what the reader picked and typed while they scroll away from it.
 */
function drawnIndices(n: number, start: number, end: number, pinned: readonly number[]): number[] {
  const rows: number[] = []
  for (const row of pinned) if (row < start) rows.push(row)
  for (let row = start; row < end; row += 1) rows.push(row)
  for (const row of pinned) if (row >= end && row < n) rows.push(row)
  return rows
}

/** The rows of the open permission and question cards of a live Session (rows/PermissionRequest.tsx, rows/QuestionRequest.tsx). */
function openRequests(items: readonly TranscriptItem[], events: readonly AgentEvent[], sessionId: string | null): number[] {
  if (sessionId === null) return []
  const resolved = new Set<string>()
  for (const event of events) if (event.type === 'permission_resolved' || event.type === 'question_resolved') resolved.add(event.requestId)
  const rows: number[] = []
  items.forEach((item, row) => {
    if (item.kind !== 'extension') return
    const { event } = item
    if ((event.type === 'permission_request' || event.type === 'question_request') && !resolved.has(event.requestId)) rows.push(row)
  })
  return rows
}

/** The rows of the log as drawn: each row's element and key, in order. */
const drawnRows = (log: HTMLElement): HTMLElement[] => Array.from(log.querySelectorAll<HTMLElement>(':scope > [data-item]'))

/** The first row of the log the reader sees, and how far below the top of the log it is. */
function firstVisibleRow(log: HTMLElement): { row: HTMLElement; offset: number } | null {
  const top = log.getBoundingClientRect().top
  for (const row of drawnRows(log)) {
    const box = row.getBoundingClientRect()
    if (box.bottom > top) return { row, offset: box.top - top }
  }
  return null
}

export function Transcript(props: TranscriptProps) {
  const { events, firstIndex = 0, earlier, hideTools, find, logRef, sessionId = null } = props
  const items = useMemo(() => foldTranscript(events, extensionTypes, firstIndex), [events, firstIndex])
  const index = useMemo(() => new Map(items.map((item, at) => [item.key, at])), [items])
  const pinned = useMemo(() => openRequests(items, events, sessionId), [items, events, sessionId])
  const now = useToday()
  const [lines] = useState(() => new Map<string, LineState>())
  const log = useRef<HTMLDivElement>(null)
  // Follows new rows while the reader is at the bottom; leaves the scroll alone once they scrolled up.
  const atBottom = useRef(true)
  // The row the reader looked at when they asked for earlier events, and the scroll height then.
  const anchor = useRef<{ row: Element | null; offset: number; height: number; firstIndex: number } | null>(null)
  // Whether the earlier events were being read at the last layout.
  const loadingBefore = useRef(false)
  // Where the reader is, the height each row had when it was last drawn, and the rows of the last
  // render: what the handlers and effects choose the rows to draw from.
  const position = useRef<Position>(BOTTOM)
  const heights = useRef(new Map<string, number>())
  const latest = useRef({ items, index, pinned })
  const [drawn, setDrawn] = useState<Drawn | null>(null)

  // The rows drawn now: all of a short transcript; of a long one the part `drawn` names and the
  // open cards, with spaces for the others.
  const n = items.length
  let start = 0
  let end = n
  if (n > DRAW_ALL_UP_TO) {
    if (drawn === null) {
      start = Math.max(0, n - FIRST_DRAWN)
    } else {
      end = drawn.to === null ? n : Math.min(n, (index.get(drawn.to) ?? n - 1) + 1)
      start = Math.min(index.get(drawn.from) ?? Math.max(0, end - drawn.count), end)
    }
  }
  const shown = drawnIndices(n, start, end, n > DRAW_ALL_UP_TO ? pinned : [])

  /** Notes the height of every row drawn, unless the log is hidden (no height to measure). */
  const measure = useCallback((element: HTMLElement) => {
    if (element.clientHeight > 0) for (const row of drawnRows(element)) heights.current.set(row.dataset['item'] ?? '', row.getBoundingClientRect().height)
  }, [])

  /**
   * Measures the rows drawn, and says the height of every row: measured when it was last drawn,
   * the mean of those measured when it never was.
   */
  const sizing = useCallback((element: HTMLElement) => {
    const known = heights.current
    measure(element)
    let sum = 0
    for (const height of known.values()) sum += height
    const estimate = known.size > 0 ? sum / known.size : ROW_ESTIMATE
    const sizes = latest.current.items.map((row) => known.get(row.key) ?? estimate)
    const gap = Number.parseFloat(getComputedStyle(element).rowGap) || 0
    return { sizes, gap }
  }, [measure])

  /** Reads where the reader is from the log (Position, atBottom). */
  const track = useCallback(() => {
    const element = log.current
    // A hidden log (the Canvas is on screen) has no height: where the reader was stays.
    if (element === null || element.clientHeight === 0) return
    atBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 24
    if (atBottom.current) {
      position.current = BOTTOM
      return
    }
    const top = element.getBoundingClientRect().top
    const { items: rows, index: rowIndex } = latest.current
    const rowOf = (sibling: Element | null): number | undefined => (sibling?.hasAttribute('data-item') === true ? rowIndex.get(sibling.getAttribute('data-item') ?? '') : undefined)
    // The top of the visible part in a space of rows not drawn (a scroll past the drawn ones): the
    // row there is the one at the same share of that space. The heights rows are taken to have
    // may have changed since the space was laid out (a drawn row grew with no render: a line
    // opened in it), so they are scaled to the space.
    for (const space of Array.from(element.querySelectorAll<HTMLElement>(':scope > [data-space]'))) {
      const box = space.getBoundingClientRect()
      const before = rowOf(space.previousElementSibling)
      const after = rowOf(space.nextElementSibling)
      const from = before === undefined ? 0 : before + 1
      const to = after ?? rows.length
      // The first space also takes the visible part that starts before it (the padding at the very top); the last, one past it.
      const inside = (from === 0 || box.top <= top) && (to === rows.length || box.bottom > top)
      if (!inside || from >= to) continue
      const { sizes, gap } = sizing(element)
      const total = spanOf(sizes, gap, from, to)
      const scale = total > 0 ? box.height / total : 1
      let row = from
      let y = box.top
      for (; row < to - 1 && y + stepOf(sizes[row]!, gap) * scale <= top; row += 1) y += stepOf(sizes[row]!, gap) * scale
      position.current = { bottom: false, key: rows[row]!.key, offset: y - top }
      return
    }
    const visible = firstVisibleRow(element)
    if (visible !== null) position.current = { bottom: false, key: visible.row.dataset['item'] ?? '', offset: visible.offset }
  }, [sizing])

  /**
   * Keeps the reader where they were: at the bottom, or their row at its offset when rows above it
   * changed (drawn in place of their space, measured anew, come in front with «Load earlier»). A row
   * that is gone gives its place to the row that holds its event now (rowFor).
   */
  const keep = useCallback(() => {
    const element = log.current
    if (element === null) return
    if (atBottom.current) {
      element.scrollTop = element.scrollHeight
      return
    }
    const at = position.current
    if (at.bottom || element.clientHeight === 0) return
    const { items: rows, index: rowIndex } = latest.current
    // The position keeps the gone key: the row may come back (the cap dropped it while «Load earlier» read).
    const stand = rowIndex.has(at.key) ? undefined : rows[rowFor(rows, at.key)]
    const key = stand?.key ?? at.key
    const row = drawnRows(element).find((one) => one.dataset['item'] === key)
    if (row === undefined) return
    // A run of tool calls that earlier calls joined at its top holds the reader's row at its bottom:
    // it stands that much higher, by what it grew since the reader's row was measured.
    const was = heights.current.get(at.key)
    const grown = stand?.kind === 'tools' && rowOrder(stand.key) < rowOrder(at.key) && was !== undefined ? row.getBoundingClientRect().height - was : 0
    // Not read back here: a space above may still be the old one until the rows to draw are chosen
    // again (the last effect), and the reader's row is where it was by now anyway.
    element.scrollTop += row.getBoundingClientRect().top - element.getBoundingClientRect().top - (at.offset - grown)
  }, [])

  /** Measures the rows drawn and chooses the rows to draw around where the reader is. */
  const place = useCallback(() => {
    const element = log.current
    const { items: rows, index: rowIndex, pinned: open } = latest.current
    if (element === null) return
    if (rows.length <= DRAW_ALL_UP_TO) {
      measure(element)
      return setDrawn(null)
    }
    const { sizes, gap } = sizing(element)
    const at = position.current
    const row = at.bottom ? -1 : (rowIndex.get(at.key) ?? rowFor(rows, at.key))
    const { start, end } = rowWindow(sizes, gap, row, at.bottom ? 0 : at.offset, element.clientHeight || window.innerHeight)
    const spaces: Record<string, number> = {}
    let next = 0
    for (const one of drawnIndices(rows.length, start, end, open)) {
      if (one > next) spaces[rows[one]!.key] = spanOf(sizes, gap, next, one)
      next = one + 1
    }
    if (next < rows.length) spaces[''] = spanOf(sizes, gap, next, rows.length)
    const drawnNext: Drawn = { from: rows[start]!.key, to: end >= rows.length ? null : rows[end - 1]!.key, count: end - start, spaces }
    setDrawn((was) => (sameDrawn(was, drawnNext) ? was : drawnNext))
  }, [measure, sizing])

  useLayoutEffect(() => {
    latest.current = { items, index, pinned }
  })

  useLayoutEffect(() => {
    const element = log.current
    if (!element) return
    const kept = anchor.current
    // The anchor serves until older rows come in front, or the read ends without them: then there is
    // none to keep in place. While it reads, the first row can also move on (new records came and
    // the cap dropped the oldest): the anchor then counts from the new first row and keeps waiting.
    const ended = loadingBefore.current && earlier?.loading !== true
    loadingBefore.current = earlier?.loading === true
    if (kept !== null && (firstIndex < kept.firstIndex || ended)) anchor.current = null
    else if (kept !== null && firstIndex > kept.firstIndex) anchor.current = { ...kept, firstIndex, height: element.scrollHeight }
    if (kept !== null && firstIndex < kept.firstIndex) {
      // Older rows came in at the top: the row the reader looked at stays where it was. The rows
      // keep their keys (firstIndex), so it is the same element; if it went (its fold changed),
      // the scroll moves by the height the new rows added.
      if (kept.row?.isConnected) {
        element.scrollTop += kept.row.getBoundingClientRect().top - element.getBoundingClientRect().top - kept.offset
      } else {
        element.scrollTop += element.scrollHeight - kept.height
      }
      return
    }
    // Folding or unfolding the tool calls (hideTools) changes the height too: a reader at the bottom stays there.
    if (atBottom.current) element.scrollTop = element.scrollHeight
  }, [items, firstIndex, earlier?.loading, hideTools])

  // After every render: the reader stays where they were (keep).
  useLayoutEffect(() => keep())

  // Find (worfy-ui ticket 26): paints the matches drawn now and again when rows change or open; scrolls
  // to the current match once each time it changes. After the follow above, so it wins over it.
  const scrolledTo = useRef<string | null>(null)
  useLayoutEffect(() => {
    const element = log.current
    if (element === null || find === undefined) {
      clearMatches()
      scrolledTo.current = null
      return
    }
    const current = find.current
    const target = current === null ? null : `${current.part}#${current.occurrence}#${find.seq}`
    if (target !== null && current !== null && target !== scrolledTo.current && index.has(current.row) && !drawnRows(element).some((row) => row.dataset['item'] === current.row)) {
      // The match is in a row not drawn: it is drawn a third of the way down the log first, and this runs again.
      position.current = { bottom: false, key: current.row, offset: element.clientHeight / 3 }
      atBottom.current = false
      place()
      return
    }
    const painted = paintMatches(element, find)
    if (target !== null && target !== scrolledTo.current) {
      scrolledTo.current = target
      scrollToMatch(element, painted)
      track()
    }
    if (typeof MutationObserver === 'undefined') return
    let frame = 0
    const observer = new MutationObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => paintMatches(element, find))
    })
    observer.observe(element, { childList: true, subtree: true, characterData: true })
    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
    }
  }, [find, items, index, drawn, place, track])
  useEffect(() => clearMatches, [])

  // Last: the rows to draw for where the reader is now, after the scroll above moved.
  useLayoutEffect(() => place())

  const loadEarlier = () => {
    const element = log.current
    if (element) {
      const visible = firstVisibleRow(element)
      anchor.current = { row: visible?.row ?? null, offset: visible?.offset ?? 0, height: element.scrollHeight, firstIndex }
    }
    earlier?.load()
  }

  // Rows that arrive while the log is hidden (the Canvas is on screen) cannot be followed: a hidden
  // element has no height. Once it is shown again, and when it is resized, the log follows them or
  // keeps the reader's row, and chooses the rows to draw for its height.
  useEffect(() => {
    const element = log.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      keep()
      place()
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [keep, place])

  const spaces = drawn?.spaces ?? {}
  const space = (key: string, from: number, to: number) => (
    <div key={`space:${key}`} className="w-tr__space" style={{ height: spaces[key] ?? (to - from) * ROW_ESTIMATE }} aria-hidden="true" data-space="" />
  )
  const rows: ReactNode[] = []
  let next = 0
  for (const row of shown) {
    const item = items[row]!
    if (row > next) rows.push(space(item.key, next, row))
    rows.push(
      <div key={item.key} className="w-tr__item" data-item={item.key}>
        <RowKey.Provider value={item.key}>
          <Item item={item} props={props} />
        </RowKey.Provider>
      </div>,
    )
    next = row + 1
  }
  if (next < n) rows.push(space('', next, n))

  return (
    <div
      ref={(element) => {
        log.current = element
        if (logRef !== undefined) logRef.current = element
      }}
      className="w-tr"
      role="log"
      aria-label="Transcript"
      data-testid="transcript"
      onScroll={() => {
        track()
        place()
      }}
    >
      {earlier !== undefined && items.length > 0 ? (
        <div className="w-tr__earlier" data-transcript-earlier="">
          <button type="button" className="w-tr__earlier-button" data-testid="transcript-load-earlier" disabled={earlier.loading} aria-busy={earlier.loading} onClick={loadEarlier}>
            {earlier.loading ? 'Loading earlier…' : 'Load earlier'}
          </button>
        </div>
      ) : null}
      <NowContext.Provider value={now}>
        <Lines.Provider value={lines}>{items.length === 0 ? <div className="w-tr__empty">No messages yet</div> : rows}</Lines.Provider>
      </NowContext.Provider>
    </div>
  )
}
