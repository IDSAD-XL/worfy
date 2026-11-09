// The narrator of a Product Session's turn (worfy-product-session ticket 32, owner 2026-11-09): while a turn
// runs, main now and then asks a small model (Haiku, through the Claude driver: src/main/vendors/claude/narrator.ts)
// for one short line of what the advisor is doing and why. The window shows the last NARRATOR_KEEP lines under the
// status line of ticket 29 and drops them all when the turn ends; they are never chat messages and never reach a
// transcript.
//
// The narrator is not a Session: Sessions never run on haiku (session.ts, isSelectableModel), while the
// narrator's single requests always do — one turn, no tools, no transcript of their own.
//
// The cadence (NarratorCadence): the first request only once the turn has run `firstMs`; then at most one request
// per `everyMs`, counted from the start of the previous one, and only when new events of the turn came since it.
// Never two requests at once. The end of the turn (`result`, an idle, error or closed state) stops the narrator at
// once: a request in flight is aborted, and its late answer is dropped. A request that fails (an error, a Limit,
// no Haiku for this login) silences the narrator for the rest of the turn; only the log says why. With the setting
// off (`enabled`), no request is made at all.
//
// What the request reads is a digest of the turn (narratorDigest): the user's message, the latest tool calls with
// short inputs, the latest text and thinking, and the narrator's own previous lines, NARRATOR_DIGEST_MAX characters
// at most.
import type { AgentEvent } from '../../shared/agent/events'

/** No request before the turn has run this long. */
export const NARRATOR_FIRST_MS = 20_000
/** At most one request this often, from the start of the previous one. */
export const NARRATOR_EVERY_MS = 30_000
/** The longest line shown. */
export const NARRATOR_LINE_MAX = 120
/** How many lines the window shows at once. */
export const NARRATOR_KEEP = 3
/** The longest digest a request reads. */
export const NARRATOR_DIGEST_MAX = 5_000

/** How much of each part of the turn the digest keeps. */
const PROMPT_MAX = 800
const CALLS_KEPT = 8
const CALL_INPUT_MAX = 200
const SNIPPETS_KEPT = 4
const SNIPPET_MAX = 500

/** What the small model is told about its job; the digest is its message. */
export const NARRATOR_SYSTEM_PROMPT = [
  'You tell a person who waits what an AI product advisor is doing in its current turn.',
  'You get a digest of the turn so far: the user message, the latest tool calls, the latest text and thinking, and your previous lines.',
  `Answer with exactly one line of at most ${NARRATOR_LINE_MAX} characters: what the advisor is doing now and why, in the present tense, without naming the advisor.`,
  'Example: "Compares three sources on competitor prices to size the niche".',
  'Write in the language of the user message; when you cannot tell it, write in English.',
  'Say something your previous lines did not. No quotes, no markdown, no preamble.',
].join('\n')

/** One request for a line: the digest in, the model's answer out. Rejects when no line comes; `signal` stops it. */
export type NarratorAsk = (digest: string, signal: AbortSignal) => Promise<string>

/** The clock and the timer the narrator runs on; tests give their own. */
export interface NarratorClock {
  now(): number
  setTimeout(run: () => void, ms: number): unknown
  clearTimeout(timer: unknown): void
}

const SYSTEM_CLOCK: NarratorClock = {
  now: () => Date.now(),
  setTimeout: (run, ms) => setTimeout(run, ms),
  clearTimeout: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
}

export interface NarratorCadence {
  firstMs: number
  everyMs: number
}

export interface NarratorDeps {
  ask: NarratorAsk
  /** Whether the person wants the live summary (Settings → Sessions); read before each request. */
  enabled: () => boolean
  /** The lines to show now, oldest first; empty: show none. */
  emit: (lines: readonly string[]) => void
  /** Where a failure is told; the chat never shows it. */
  log?: ((message: string) => void) | undefined
  clock?: NarratorClock | undefined
  cadence?: Partial<NarratorCadence> | undefined
}

/** A tool call as the digest names it. */
export interface DigestCall {
  name: string
  input: string
  /** Made inside a Subagent. */
  subagent: boolean
}

/** A piece of what the advisor wrote or thought. */
export interface DigestSnippet {
  kind: 'text' | 'thinking'
  text: string
}

/** What the digest is made of. */
export interface DigestFacts {
  prompt: string
  elapsedMs: number
  calls: readonly DigestCall[]
  snippets: readonly DigestSnippet[]
  lines: readonly string[]
}

/** `text` on one line, cut to `max` characters with an ellipsis. */
export function cut(text: string, max: number): string {
  const line = text.replace(/\s+/gu, ' ').trim()
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

function inputText(input: unknown): string {
  if (input === undefined || input === null) return ''
  try {
    return typeof input === 'string' ? input : (JSON.stringify(input) ?? '')
  } catch {
    return ''
  }
}

function section(title: string, rows: readonly string[]): string {
  return rows.length === 0 ? '' : `${title}\n${rows.map((row) => `- ${row}`).join('\n')}`
}

/**
 * The digest of a turn: each part cut short, the oldest snippets and calls left out while it is longer than
 * NARRATOR_DIGEST_MAX, and cut to that length at the end whatever is left.
 */
export function narratorDigest(facts: DigestFacts): string {
  let calls = facts.calls.slice(-CALLS_KEPT)
  let snippets = facts.snippets.slice(-SNIPPETS_KEPT)
  const build = (): string =>
    [
      `The user message:\n${cut(facts.prompt, PROMPT_MAX) || '(none)'}`,
      `Seconds since the turn began: ${Math.max(0, Math.round(facts.elapsedMs / 1000))}`,
      section(
        'The latest tool calls, oldest first:',
        calls.map((call) => `${call.name}${call.subagent ? ' (in a Subagent)' : ''}: ${cut(call.input, CALL_INPUT_MAX)}`),
      ),
      section(
        'The latest text and thinking, oldest first:',
        snippets.map((snippet) => `${snippet.kind}: ${cut(snippet.text, SNIPPET_MAX)}`),
      ),
      section('Your previous lines, oldest first:', facts.lines.map((line) => cut(line, NARRATOR_LINE_MAX))),
    ]
      .filter((part) => part !== '')
      .join('\n\n')
  let digest = build()
  while (digest.length > NARRATOR_DIGEST_MAX && (snippets.length > 0 || calls.length > 0)) {
    if (snippets.length > 0) snippets = snippets.slice(1)
    else calls = calls.slice(1)
    digest = build()
  }
  return digest.slice(0, NARRATOR_DIGEST_MAX)
}

/** The line of a model's answer: its first non-empty line, without quotes or a list mark, NARRATOR_LINE_MAX characters at most. */
export function narratorLine(answer: string): string {
  const first = answer.split('\n').find((line) => line.trim() !== '') ?? ''
  const bare = first
    .trim()
    .replace(/^[-*•]\s+/u, '')
    .replace(/^["'`«“]+|["'`»”]+$/gu, '')
  return cut(bare, NARRATOR_LINE_MAX)
}

/** The turn the narrator follows. */
interface Turn {
  startedAt: number
  prompt: string
  calls: DigestCall[]
  snippets: DigestSnippet[]
  /** The text or thinking streaming now (delta events), its latest part. */
  streaming: DigestSnippet | null
  lines: string[]
  /** Counts the events that bring something new; `asked` is its value at the last request. */
  seen: number
  asked: number
  /** No request before this time. */
  nextAt: number
  /** A request failed: silent until the turn ends. */
  silenced: boolean
  request: AbortController | null
}

/** The events that are something new for the narrator to say. */
const NEWS: ReadonlySet<AgentEvent['type']> = new Set(['tool_use', 'tool_result', 'text', 'thinking', 'delta', 'subagent'])

/** The narrator of one Product Session: given each of its events, it emits the lines to show. */
export class Narrator {
  private readonly clock: NarratorClock
  private readonly cadence: NarratorCadence
  private turn: Turn | null = null
  private timer: unknown = null
  /** A request is out: the next one waits for its answer, whatever turn it was for. */
  private inFlight = false
  private closed = false

  constructor(private readonly deps: NarratorDeps) {
    this.clock = deps.clock ?? SYSTEM_CLOCK
    this.cadence = { firstMs: deps.cadence?.firstMs ?? NARRATOR_FIRST_MS, everyMs: deps.cadence?.everyMs ?? NARRATOR_EVERY_MS }
  }

  /** One event of the Session, in the order it sent them. */
  event(event: AgentEvent): void {
    if (this.closed) return
    switch (event.type) {
      case 'prompt':
        this.begin(event.text)
        return
      case 'result':
        this.end()
        return
      case 'state':
        if (event.state === 'busy' && this.turn === null) this.begin('')
        else if (event.state === 'idle' || event.state === 'error') this.end()
        else if (event.state === 'closed') this.close()
        return
    }
    const turn = this.turn
    if (turn === null || !NEWS.has(event.type)) return
    this.note(turn, event)
    turn.seen += 1
    this.maybeAsk()
  }

  /** Stops for good: the Session is gone. */
  close(): void {
    if (this.closed) return
    this.end()
    this.closed = true
  }

  private begin(prompt: string): void {
    this.end()
    const now = this.clock.now()
    this.turn = { startedAt: now, prompt, calls: [], snippets: [], streaming: null, lines: [], seen: 0, asked: 0, nextAt: now + this.cadence.firstMs, silenced: false, request: null }
    this.arm(this.cadence.firstMs)
  }

  private end(): void {
    const turn = this.turn
    if (turn === null) return
    this.turn = null
    this.disarm()
    turn.request?.abort()
    if (turn.lines.length > 0) this.deps.emit([])
  }

  private note(turn: Turn, event: AgentEvent): void {
    switch (event.type) {
      case 'tool_use':
        turn.calls.push({ name: event.name, input: inputText(event.input), subagent: event.parentToolUseId !== null })
        if (turn.calls.length > CALLS_KEPT) turn.calls.shift()
        return
      case 'text':
      case 'thinking':
        turn.streaming = null
        if (event.text.trim() === '') return
        turn.snippets.push({ kind: event.type, text: cut(event.text, SNIPPET_MAX * 2) })
        if (turn.snippets.length > SNIPPETS_KEPT) turn.snippets.shift()
        return
      case 'delta': {
        const kind = event.kind
        const before = turn.streaming?.kind === kind ? turn.streaming.text : ''
        turn.streaming = { kind, text: `${before}${event.text}`.slice(-SNIPPET_MAX) }
        return
      }
      default:
        return
    }
  }

  private arm(ms: number): void {
    if (this.timer !== null) return
    this.timer = this.clock.setTimeout(
      () => {
        this.timer = null
        this.maybeAsk()
      },
      Math.max(0, ms),
    )
  }

  private disarm(): void {
    if (this.timer === null) return
    this.clock.clearTimeout(this.timer)
    this.timer = null
  }

  private maybeAsk(): void {
    const turn = this.turn
    if (turn === null || turn.silenced || this.inFlight || this.closed) return
    const now = this.clock.now()
    if (now < turn.nextAt) {
      this.arm(turn.nextAt - now)
      return
    }
    // Nothing new since the last line: the next event asks.
    if (turn.seen === turn.asked) return
    if (!this.deps.enabled()) {
      // Off: no request; the setting is read again a cadence later, not at every event.
      turn.nextAt = now + this.cadence.everyMs
      return
    }
    void this.ask(turn, now)
  }

  private async ask(turn: Turn, now: number): Promise<void> {
    turn.asked = turn.seen
    turn.nextAt = now + this.cadence.everyMs
    const snippets = turn.streaming === null ? turn.snippets : [...turn.snippets, turn.streaming]
    const digest = narratorDigest({ prompt: turn.prompt, elapsedMs: now - turn.startedAt, calls: turn.calls, snippets, lines: turn.lines })
    const request = new AbortController()
    turn.request = request
    this.inFlight = true
    let answer: string
    try {
      answer = await this.deps.ask(digest, request.signal)
    } catch (error) {
      if (this.turn === turn && !request.signal.aborted) {
        turn.silenced = true
        this.deps.log?.(`the live summary stops for this turn: ${error instanceof Error ? error.message : String(error)}`)
      }
      return
    } finally {
      this.inFlight = false
      if (turn.request === request) turn.request = null
    }
    // The turn ended while the request was out: its answer is late.
    if (this.turn !== turn || request.signal.aborted || this.closed) return
    const line = narratorLine(answer)
    if (line !== '' && line !== turn.lines.at(-1)) {
      turn.lines = [...turn.lines, line].slice(-NARRATOR_KEEP)
      this.deps.emit(turn.lines)
    }
    this.maybeAsk()
  }
}
