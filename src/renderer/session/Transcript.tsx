import { createContext, createElement, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import type { AgentEvent } from '../../shared/agent/events'
import { subagentTypeLabel } from '../../shared/agent/subagent-type'
import { clipText as clip, hookOutput, toolSummary } from '../../shared/transcript/find'
import { Markdown } from '../markdown/Markdown'
import { foldTranscript, toolSegments, type SubagentRun, type ToolCall, type TranscriptItem } from './fold'
import { formatDuration } from './format'
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

/**
 * Opens a closed line when find's current match is in it: `reveal` names that match and the step
 * that went to it (TranscriptFind.seq), and a new one opens the line again even after the reader
 * closed it — also a step back to the same match.
 */
function useRevealed(reveal: string | null): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(false)
  const [revealed, setRevealed] = useState<string | null>(null)
  if (reveal !== null && reveal !== revealed) {
    setRevealed(reveal)
    setOpen(true)
  }
  return [open, setOpen]
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
  const [open, setOpen] = useState(false)
  const summary = call.subagent?.description ?? toolSummary(call.input)
  return (
    <div className="w-tr__tool" data-testid="tool-call" data-tool={call.name}>
      <button type="button" className="w-tr__tool-line" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
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
  const [open, setOpen] = useRevealed(reveal)
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
  const [open, setOpen] = useRevealed(reveal)
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
          <div className="w-tr__prompt" data-find={find('prompt')}>
            {item.text}
          </div>
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

/** The first row of the log the reader sees, and how far below the top of the log it is. */
function firstVisibleRow(log: HTMLElement): { row: Element; offset: number } | null {
  const top = log.getBoundingClientRect().top
  for (const row of Array.from(log.children)) {
    if (row.hasAttribute('data-transcript-earlier')) continue
    const box = row.getBoundingClientRect()
    if (box.bottom > top) return { row, offset: box.top - top }
  }
  return null
}

export function Transcript(props: TranscriptProps) {
  const { events, firstIndex = 0, earlier, hideTools, find, logRef } = props
  const items = useMemo(() => foldTranscript(events, extensionTypes, firstIndex), [events, firstIndex])
  const now = useToday()
  const log = useRef<HTMLDivElement>(null)
  // Follows new rows while the reader is at the bottom; leaves the scroll alone once they scrolled up.
  const atBottom = useRef(true)
  // The row the reader looked at when they asked for earlier events, and the scroll height then.
  const anchor = useRef<{ row: Element | null; offset: number; height: number; firstIndex: number } | null>(null)
  // Whether the earlier events were being read at the last layout.
  const loadingBefore = useRef(false)

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
    const painted = paintMatches(element, find)
    const target = find.current === null ? null : `${find.current.part}#${find.current.occurrence}#${find.seq}`
    if (target !== null && target !== scrolledTo.current) {
      scrolledTo.current = target
      scrollToMatch(element, painted)
      atBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 24
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
  }, [find, items])
  useEffect(() => clearMatches, [])

  const loadEarlier = () => {
    const element = log.current
    if (element) {
      const visible = firstVisibleRow(element)
      anchor.current = { row: visible?.row ?? null, offset: visible?.offset ?? 0, height: element.scrollHeight, firstIndex }
    }
    earlier?.load()
  }

  // Rows that arrive while the log is hidden (the Canvas is on screen) cannot be followed: a hidden
  // element has no height. The log follows them once it is shown again, and when it is resized.
  useEffect(() => {
    const element = log.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      if (atBottom.current) element.scrollTop = element.scrollHeight
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

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
      onScroll={(event) => {
        const element = event.currentTarget
        atBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 24
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
        {items.length === 0 ? (
          <div className="w-tr__empty">No messages yet</div>
        ) : (
          items.map((item) => (
            <RowKey.Provider key={item.key} value={item.key}>
              <Item item={item} props={props} />
            </RowKey.Provider>
          ))
        )}
      </NowContext.Provider>
    </div>
  )
}
