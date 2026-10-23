// Find in the Session view (⌘F, Ctrl+F on Windows and Linux; worfy-ui ticket 26): the matches of the
// rows (src/renderer/session/transcript-find.ts) — case ignored, Cyrillic, several in one message, in
// a folded «N tools» line, which opens, and in closed thinking, which opens too — the keys of the
// bar on each system and with a Russian layout, Esc, Enter and Shift+Enter, the paint of the matches
// (the CSS Custom Highlight API, stubbed here: jsdom has none), and the matches main finds in the
// part of the file before the rows, which the bar goes to by loading earlier windows. What is counted
// is what the rows show — markdown as drawn, long outputs cut — so every match counted is painted;
// main is asked only for the part of the file its last answer did not cover, and not at all while a
// resumed Session's window may hold turns the live events show. A fake bridge answers
// `claudeHome.transcriptFind`; no main process.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useRef, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AgentEvent } from '../../src/shared/agent/events'
import type { WorfyBridge } from '../../src/shared/ipc/channels'
import { TRANSCRIPT_FIND } from '../../src/shared/ipc/claude-home'
import { CACHED_CHARS, markdownCacheChars, markdownText, textCache } from '../../src/shared/markdown/visible-text'
import { eventMatches, findNeedle } from '../../src/shared/transcript/find'
import { Markdown } from '../../src/renderer/markdown/Markdown'
import { foldTranscript } from '../../src/renderer/session/fold'
import { joinPastAndLive, keepsTurnBeforeResume } from '../../src/renderer/session/store'
import { setView } from '../../src/renderer/session/navigation'
import { SessionFind } from '../../src/renderer/session/SessionFind'
import { Transcript } from '../../src/renderer/session/Transcript'
import { extendAnswer, extensionTypes, FIND_DEBOUNCE_MS, HIGHLIGHT, pastSettled, rowMatches, useTranscriptFind, type FindSource } from '../../src/renderer/session/transcript-find'

const prompt = (text: string): AgentEvent => ({ type: 'notice', kind: 'user', text })
const answer = (text: string): AgentEvent => ({ type: 'text', text, messageId: 'm', parentToolUseId: null, synthetic: false })
const toolUse = (id: string, name: string, input: unknown): AgentEvent => ({ type: 'tool_use', id, name, input, parentToolUseId: null })
const toolResult = (toolUseId: string, content = 'ok', isError = false): AgentEvent => ({ type: 'tool_result', toolUseId, content, isError, parentToolUseId: null })
const answerOf = (messageId: string, text: string): AgentEvent => ({ type: 'text', text, messageId, parentToolUseId: null, synthetic: false })
const thinking = (text: string): AgentEvent => ({ type: 'thinking', text, messageId: 'm', parentToolUseId: null })

type FindRequest = { projectRoot: string; sessionId: string; agentId?: string; query: string; before: number; from?: number }
type FindAnswer = { found: boolean; hits: { offset: number; count: number }[]; total: number; skipped: number }
let requests: FindRequest[]
let reply: (request: FindRequest) => { ok: true; value: FindAnswer } | { ok: false; error: string }

/** A stub of the CSS Custom Highlight API: the registry and a Highlight that keeps its ranges. */
class Highlight {
  readonly ranges: Range[]
  constructor(...ranges: Range[]) {
    this.ranges = ranges
  }
}
const registry = new Map<string, Highlight>()
const painted = (name: string): string[] => (registry.get(name)?.ranges ?? []).map((range) => range.toString())

beforeEach(() => {
  requests = []
  reply = () => ({ ok: true, value: { found: true, hits: [], total: 0, skipped: 0 } })
  ;(globalThis as { worfy?: WorfyBridge }).worfy = {
    invoke: async (channel: string, input: unknown) => {
      if (channel !== 'claudeHome.transcriptFind') return { ok: false, error: `no ${channel}` }
      requests.push(input as FindRequest)
      return reply(input as FindRequest)
    },
    on: () => 1,
    off: () => undefined,
  } as unknown as WorfyBridge
  ;(globalThis as { CSS?: unknown }).CSS = { highlights: registry }
  ;(globalThis as { Highlight?: unknown }).Highlight = Highlight
  registry.clear()
  document.documentElement.dataset.platform = 'mac'
  setView('session')
})

afterEach(() => {
  cleanup()
  setView('canvas')
  delete (globalThis as { worfy?: WorfyBridge }).worfy
  delete (globalThis as { CSS?: unknown }).CSS
  delete (globalThis as { Highlight?: unknown }).Highlight
})

/** The Session view's transcript with its find bar, as SessionView.tsx and ExternalSessionPanel.tsx put them together. */
function View({ events, hideTools = false, source, firstIndex = 0 }: { events: readonly AgentEvent[]; hideTools?: boolean; source?: FindSource; firstIndex?: number }) {
  const log = useRef<HTMLDivElement>(null)
  const find = useTranscriptFind({ events, firstIndex, hideTools, source, log })
  return (
    <section>
      <SessionFind find={find} />
      <Transcript events={events} firstIndex={firstIndex} hideTools={hideTools} find={find.transcript} logRef={log} />
    </section>
  )
}

const press = async (init: KeyboardEventInit & { key: string }, target: EventTarget = document.body): Promise<KeyboardEvent> => {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
  await act(async () => {
    target.dispatchEvent(event)
  })
  return event
}
const bar = () => screen.queryByTestId('session-find')
const field = () => screen.getByTestId('session-find-input') as HTMLInputElement
const count = () => screen.getByTestId('session-find-count').textContent
const type = async (text: string) => {
  await act(async () => {
    fireEvent.change(field(), { target: { value: text } })
  })
}
const key = async (init: KeyboardEventInit & { key: string }) => {
  await act(async () => {
    fireEvent.keyDown(field(), init)
  })
}

const chat: AgentEvent[] = [prompt('Where is the Zebra?'), answer('A **zebra** here and a ZEBRA there.'), prompt('и где зебра?'), answer('Зебра в саду.')]

describe('the matches of the rows', () => {
  it('ignores case, finds Cyrillic, counts several matches in one message, in the order of the transcript', () => {
    const items = foldTranscript(chat, extensionTypes)
    expect(rowMatches(items, findNeedle('zebra'), false).map((match) => [match.row, match.occurrence])).toEqual([
      ['e0', 0],
      ['e1', 0],
      ['e1', 1],
    ])
    // The Russian word for zebra, in capitals: case is ignored for Cyrillic too.
    expect(rowMatches(items, findNeedle('ЗЕБРА'), false).map((match) => match.part)).toEqual(['e2:prompt', 'e3:text'])
    expect(rowMatches(items, '', false)).toEqual([])
  })

  it("finds a tool's name and its line, not its result; inside a folded line it names the line to open", () => {
    const events = [toolUse('t1', 'Bash', { command: 'grep zebra src' }), toolResult('t1', 'zebra.ts'), toolUse('t2', 'Edit', { file_path: 'zebra.ts' }), toolResult('t2', 'no', true)]
    const items = foldTranscript(events, extensionTypes)
    expect(rowMatches(items, 'zebra', false).map((match) => [match.part, match.reveal])).toEqual([
      ['e0:t1:line', null],
      ['e0:t2:line', null],
    ])
    // With tools hidden, Bash folds into «1 tool»; Edit with its error stays in sight.
    expect(rowMatches(items, 'zebra', true).map((match) => [match.part, match.reveal])).toEqual([
      ['e0:t1:line', 'tools:t1'],
      ['e0:t2:line', null],
    ])
  })

  it('counts in a transcript read from a file what main counts in its lines', () => {
    const file: AgentEvent[] = [
      ...chat,
      thinking('zebra thoughts'),
      toolUse('t1', 'Grep', { pattern: 'zebra' }),
      toolResult('t1', 'zebra zebra'),
      { type: 'hook', hookEvent: 'Stop', hookName: 'gate', exitCode: 0, outcome: 'success', stdout: 'zebra ok', stderr: '' },
      { type: 'notice', kind: 'synthetic', text: 'a zebra reminder' },
      { type: 'subagent', phase: 'started', taskId: 'task', toolUseId: null, description: 'Find the zebra', subagentType: null, status: null, summary: null },
    ]
    const main = file.reduce((sum, event) => sum + eventMatches(event, 'zebra'), 0)
    expect(rowMatches(foldTranscript(file, extensionTypes), 'zebra', false)).toHaveLength(main)
    expect(main).toBe(8)
  })
})

describe('the find bar', () => {
  it.each([
    ['mac', { metaKey: true }, { ctrlKey: true }],
    ['windows', { ctrlKey: true }, { metaKey: true }],
    ['linux', { ctrlKey: true }, { metaKey: true }],
  ] as const)('on %s opens with its primary key and F, a Russian layout too; not with the other modifier', async (system, primary, other) => {
    document.documentElement.dataset.platform = system
    render(<View events={chat} />)
    expect((await press({ key: 'f', ...other })).defaultPrevented).toBe(false)
    expect((await press({ key: 'f', ...primary, shiftKey: true })).defaultPrevented).toBe(false)
    expect(bar()).toBeNull()
    expect((await press({ key: 'f', ...primary })).defaultPrevented).toBe(true)
    expect(bar()).not.toBeNull()
    expect(document.activeElement).toBe(field())
    expect(screen.getByLabelText('Previous match').getAttribute('title')).toBe(`Previous match (${system === 'mac' ? '⇧Enter' : 'Shift+Enter'})`)
    await key({ key: 'Escape' })
    expect(bar()).toBeNull()
    // With a Russian layout the F key gives the Cyrillic a: the place of the key decides.
    expect((await press({ key: 'а', code: 'KeyF', ...primary })).defaultPrevented).toBe(true)
    expect(bar()).not.toBeNull()
  })

  it('leaves Ctrl+F inside a Terminal to the shell on Windows, and does nothing while the Canvas is shown', async () => {
    document.documentElement.dataset.platform = 'windows'
    render(<View events={chat} />)
    // The screen of a Terminal as xterm.js draws it: its text field inside `.xterm`.
    const terminal = document.createElement('div')
    terminal.className = 'w-terminal xterm'
    const xterm = document.createElement('textarea')
    terminal.append(xterm)
    document.body.append(terminal)
    try {
      expect((await press({ key: 'f', ctrlKey: true }, xterm)).defaultPrevented).toBe(false)
      expect(bar()).toBeNull()
      act(() => setView('canvas'))
      expect((await press({ key: 'f', ctrlKey: true })).defaultPrevented).toBe(false)
      expect(bar()).toBeNull()
      act(() => setView('session'))
      expect((await press({ key: 'f', ctrlKey: true })).defaultPrevented).toBe(true)
      expect(bar()).not.toBeNull()
    } finally {
      terminal.remove()
    }
  })

  it('counts «N of M», starts on the newest match, steps with Enter and Shift+Enter around the ends, paints the matches, and Esc takes the paint away', async () => {
    render(<View events={chat} />)
    await press({ key: 'f', metaKey: true })
    await type('z')
    expect(count()).toBe('')
    await type('zebra')
    expect(count()).toBe('3 of 3')
    expect(painted(HIGHLIGHT.all)).toEqual(['Zebra', 'zebra', 'ZEBRA'])
    expect(painted(HIGHLIGHT.current)).toEqual(['ZEBRA'])
    await key({ key: 'Enter' })
    expect(count()).toBe('1 of 3')
    expect(painted(HIGHLIGHT.current)).toEqual(['Zebra'])
    await key({ key: 'Enter', shiftKey: true })
    expect(count()).toBe('3 of 3')
    await key({ key: 'Enter', shiftKey: true })
    expect(count()).toBe('2 of 3')
    // The second match is inside the markdown: painted over the drawn text, not the source.
    expect(painted(HIGHLIGHT.current)).toEqual(['zebra'])
    expect(screen.getAllByTestId('transcript-text')[0]?.querySelector('strong')?.textContent).toBe('zebra')
    await type('ЗЕБРА')
    expect(count()).toBe('2 of 2')
    expect(painted(HIGHLIGHT.all)).toEqual(['зебра', 'Зебра'])
    await type('okapi')
    expect(count()).toBe('No matches')
    await type('zebra')
    await key({ key: 'Escape' })
    expect(bar()).toBeNull()
    expect(registry.has(HIGHLIGHT.all)).toBe(false)
    expect(registry.has(HIGHLIGHT.current)).toBe(false)
    // Opened again, it keeps the query, selected, and paints again.
    await press({ key: 'f', metaKey: true })
    expect(field().value).toBe('zebra')
    expect(painted(HIGHLIGHT.all)).toHaveLength(3)
  })

  it('opens a folded «N tools» line and a closed thinking row when the current match is inside', async () => {
    const events = [prompt('go'), thinking('the okapi is shy'), toolUse('t1', 'Bash', { command: 'echo okapi' }), toolResult('t1'), toolUse('t2', 'Read', { file_path: 'a.ts' }), toolResult('t2'), answer('done')]
    render(<View events={events} hideTools />)
    const line = screen.getByRole('button', { name: /2 tools/ })
    const thought = screen.getByRole('button', { name: /Thinking/ })
    expect(line.getAttribute('aria-expanded')).toBe('false')
    expect(thought.getAttribute('aria-expanded')).toBe('false')
    await press({ key: 'f', metaKey: true })
    await type('okapi')
    // The newest match is in the Bash call, folded: its line opens.
    expect(count()).toBe('2 of 2')
    expect(line.getAttribute('aria-expanded')).toBe('true')
    expect(thought.getAttribute('aria-expanded')).toBe('false')
    expect(painted(HIGHLIGHT.current)).toEqual(['okapi'])
    await key({ key: 'Enter' })
    expect(count()).toBe('1 of 2')
    expect(thought.getAttribute('aria-expanded')).toBe('true')
  })

  it('opens the row again on each step and each ⌘F, even to the same match the reader closed it on', async () => {
    render(<View events={[prompt('go'), thinking('the okapi is shy'), answer('done')]} />)
    const thought = screen.getByRole('button', { name: /Thinking/ })
    await press({ key: 'f', metaKey: true })
    await type('okapi')
    expect(count()).toBe('1 of 1')
    expect(thought.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(thought)
    expect(thought.getAttribute('aria-expanded')).toBe('false')
    // Enter at «1 of 1»: the same match, and its row opens again.
    await key({ key: 'Enter' })
    expect(count()).toBe('1 of 1')
    expect(thought.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(thought)
    await key({ key: 'Escape' })
    expect(thought.getAttribute('aria-expanded')).toBe('false')
    // ⌘F again on the same query: the row opens again too.
    await press({ key: 'f', metaKey: true })
    expect(count()).toBe('1 of 1')
    expect(thought.getAttribute('aria-expanded')).toBe('true')
  })
})

describe('what is counted is what is drawn', () => {
  const hook = (stdout: string): AgentEvent => ({ type: 'hook', hookEvent: 'Stop', hookName: 'gate', exitCode: 0, outcome: 'success', stdout, stderr: '' })

  it('counts the text of links, emphasis and inline code as the markdown shows it, not its source, and every match counted is painted', async () => {
    const events = [prompt('go'), answer('See [docs](https://example.com/docs) and `docs.ts`.'), answer('**foo** bar, and [x.ts](src/docs/x.ts)')]
    render(<View events={events} />)
    await press({ key: 'f', metaKey: true })
    await type('docs')
    // The link's address and the file link's path hold «docs» too: not shown, not counted.
    expect(count()).toBe('2 of 2')
    expect(painted(HIGHLIGHT.all)).toEqual(['docs', 'docs'])
    await type('foo bar')
    expect(count()).toBe('1 of 1')
    expect(painted(HIGHLIGHT.all)).toEqual(['foo bar'])
    // Main counts the same in the lines it reads.
    for (const query of ['docs', 'foo bar', 'x.ts']) {
      const main = events.reduce((sum, event) => sum + eventMatches(event, query), 0)
      expect(rowMatches(foldTranscript(events, extensionTypes), query, false)).toHaveLength(main)
    }
    expect(eventMatches(events[2]!, 'x.ts')).toBe(1)
  })

  it("counts a hook's output and an added notice as far as their rows show them: cut at 20 000 characters", () => {
    const long = `zebra ${'x'.repeat(20_000)} zebra`
    const events: AgentEvent[] = [hook(long), { type: 'notice', kind: 'synthetic', text: long }]
    expect(events.map((event) => eventMatches(event, 'zebra'))).toEqual([1, 1])
    expect(rowMatches(foldTranscript(events, extensionTypes), 'zebra', false)).toHaveLength(2)
    // The words the cut adds are on screen: they count.
    expect(eventMatches(events[0]!, 'more characters')).toBe(1)
  })

  it('keeps the read answers within a bound of characters, and no long answer at all', () => {
    // A cache as markdownText's (bound CACHED_CHARS), 100 times smaller: the same rules, kilobytes parsed.
    const bound = CACHED_CHARS / 100
    const cache = textCache(bound)
    const reads: string[] = []
    const read = (markdown: string) => {
      reads.push(markdown)
      return markdownText(markdown)
    }
    // 5 answers of 2 400 characters (4 800 with their text): each over a tenth of the bound, none kept.
    for (let index = 0; index < 5; index += 1) expect(cache.get(`${index} ${'long '.repeat(480)}`, read)).toHaveLength(2 + 5 * 480 - 1)
    expect(cache.chars()).toBe(0)
    // 150 answers of 200 characters (400 with their text): the oldest go, the bound holds.
    const answers = Array.from({ length: 150 }, (_, index) => `${String(index).padStart(3, '0')} ${'word '.repeat(39)}`)
    for (const one of answers) cache.get(one, read)
    expect(cache.chars()).toBeLessThanOrEqual(bound)
    expect(cache.chars()).toBeGreaterThan(bound / 2)
    // The newest is kept, the oldest went: read again only that one.
    reads.length = 0
    expect(cache.get(answers.at(-1)!, read)).toBe(markdownText(answers.at(-1)!))
    expect(reads).toEqual([])
    cache.get(answers[0]!, read)
    expect(reads).toEqual([answers[0]])
    // Read again, an answer gives the same text.
    expect(cache.get('**foo** bar', read)).toBe('foo bar')
    expect(cache.get('**foo** bar', read)).toBe('foo bar')
    // markdownText keeps what it read in its own cache: a short answer, not one over a tenth of CACHED_CHARS.
    const held = markdownCacheChars()
    const short = `**kept** ${held} answer`
    expect(markdownText(short)).toBe(`kept ${held} answer`)
    expect(markdownCacheChars()).toBe(held + short.length + `kept ${held} answer`.length)
    expect(markdownText(short)).toBe(`kept ${held} answer`)
    expect(markdownCacheChars()).toBe(held + short.length + `kept ${held} answer`.length)
    const long = 'x'.repeat(CACHED_CHARS / 20 + 1)
    expect(markdownText(long)).toHaveLength(long.length)
    expect(markdownCacheChars()).toBe(held + short.length + `kept ${held} answer`.length)
  })

  it.each([
    ['a link', 'See [the docs](https://example.com/docs).'],
    ['emphasis and code', '**bold** _it_ ~~gone~~ `code` and\n\n```ts\nconst a = 1\n```'],
    ['lines and paragraphs', 'one\ntwo\n\nthree'],
    ['a list and a task list', '- a\n- b\n\n1. one\n2. two\n\n- [x] done\n- [ ] not yet'],
    ['a table', '| a | b |\n| - | - |\n| 1 | 2 |'],
    ['HTML, shown as text', 'a <b>bold</b> tag <script>alert(1)</script>'],
    ['images', '![a cat](cat.png) and ![](dog.png)'],
    ['a quote, a heading, an autolink', '# Title\n\n> quoted\n\nsee www.example.com'],
    ['entities and escapes', '&amp; &#65; \\*not em\\*'],
  ])('reads %s as the page shows it', (_, source) => {
    const { container } = render(<Markdown text={source} breaks />)
    expect(markdownText(source)).toBe(container.querySelector('.w-md')?.textContent)
  })
})

describe('a Subagent whose Agent call is before the rows', () => {
  const started: AgentEvent = { type: 'subagent', phase: 'started', taskId: 'task', toolUseId: 'toolu_a', description: 'Find the zebra', subagentType: null, status: null, summary: null }

  it('is counted once: by main, in the Agent call, and not again in its own row', async () => {
    const items = foldTranscript([started, answer('done')], extensionTypes)
    // Its own row is drawn, as the call is not among the events…
    expect(items.map((item) => item.kind)).toEqual(['subagent', 'text'])
    // …and counted only when the rows start at the start of the file.
    expect(rowMatches(items, 'zebra', false, false)).toHaveLength(1)
    expect(rowMatches(items, 'zebra', false, true)).toHaveLength(0)
    expect(eventMatches(toolUse('toolu_a', 'Agent', { description: 'Find the zebra', prompt: 'go' }), 'zebra')).toBe(1)
    expect(eventMatches(started, 'zebra')).toBe(0)
    reply = () => ({ ok: true, value: { found: true, hits: [{ offset: 10, count: 1 }], total: 1, skipped: 0 } })
    const source: FindSource = { root: '/repo', sessionId: 'session-1', earlier: 500, earlierNow: () => 500, loadEarlier: async () => undefined }
    render(<View events={[started, answer('done')]} source={source} />)
    await press({ key: 'f', metaKey: true })
    await type('zebra')
    await wait(FIND_DEBOUNCE_MS + 50)
    expect(count()).toBe('1 match')
  })
})

const wait = async (ms: number): Promise<void> => {
  await act(async () => {
    await new Promise((done) => setTimeout(done, ms))
  })
}

describe('the matches before the rows', () => {
  /**
   * A transcript read from its end: the rows hold lines from byte 1000 on; before them, main finds
   * three matches in lines 200 and 600. «Load earlier» puts the window of lines 0..999 in front.
   */
  function Earlier({ onLoad }: { onLoad?: () => void }) {
    const shown = [prompt('first zebra in the rows'), answer('second zebra')]
    const older = [prompt('old zebra'), answer('older zebra, zebra again')]
    const [state, setState] = useState({ events: shown, first: 0, earlier: 1000 })
    // The state as the reader of the transcript holds it, outside React (useClaudeHome.ts, transcriptStateNow).
    const now = useRef(state)
    const source: FindSource = {
      root: '/repo',
      sessionId: 'session-1',
      earlier: state.earlier,
      earlierNow: () => now.current.earlier,
      loadEarlier: async () => {
        onLoad?.()
        const next = { events: [...older, ...now.current.events], first: now.current.first - older.length, earlier: 0 }
        now.current = next
        setState(next)
      },
    }
    return <View events={state.events} firstIndex={state.first} source={source} />
  }

  it('asks main about the bytes before the rows, adds its matches to M, and goes to one by loading earlier windows', async () => {
    reply = () => ({
      ok: true,
      value: {
        found: true,
        hits: [
          { offset: 200, count: 1 },
          { offset: 600, count: 2 },
        ],
        total: 3,
        skipped: 0,
      },
    })
    let loads = 0
    render(<Earlier onLoad={() => (loads += 1)} />)
    await press({ key: 'f', metaKey: true })
    await type('zebra')
    expect(count()).toBe('2 of 2+')
    await act(async () => {
      await new Promise((done) => setTimeout(done, FIND_DEBOUNCE_MS + 50))
    })
    expect(requests).toEqual([{ projectRoot: '/repo', sessionId: 'session-1', query: 'zebra', before: 1000 }])
    expect(count()).toBe('5 of 5')
    expect(loads).toBe(0)
    // Back past the first row: the third match, in line 600, is behind «Load earlier».
    await key({ key: 'Enter', shiftKey: true })
    await key({ key: 'Enter', shiftKey: true })
    await settled(() => expect(count()).toBe('3 of 5'))
    expect(loads).toBe(1)
    expect(screen.getAllByTestId('transcript-prompt')[0]?.textContent).toContain('old zebra')
    // The match is now a row's: the second occurrence of «zebra» in the older answer.
    expect(painted(HIGHLIGHT.current)).toEqual(['zebra'])
    expect(painted(HIGHLIGHT.all)).toHaveLength(5)
    await key({ key: 'Enter', shiftKey: true })
    expect(count()).toBe('2 of 5')
    // Nothing is left before the rows: main is not asked again.
    await act(async () => {
      await new Promise((done) => setTimeout(done, FIND_DEBOUNCE_MS + 50))
    })
    expect(requests).toHaveLength(1)
  })

  it('asks main only for the part the window gave up since its last answer, and adds it', async () => {
    // A live Session: the cap of the events drops its oldest rows, and the window starts later.
    function Growing() {
      const [state, setState] = useState({ events: [prompt('zebra one'), answer('zebra two'), prompt('three')], earlier: 1000 })
      const source: FindSource = { root: '/repo', sessionId: 'session-1', earlier: state.earlier, earlierNow: () => state.earlier, loadEarlier: async () => undefined }
      return (
        <>
          <button type="button" onClick={() => setState({ events: state.events.slice(1), earlier: 1500 })}>
            drop
          </button>
          <View events={state.events} firstIndex={1000 - state.events.length} source={source} />
        </>
      )
    }
    reply = (request) => ({ ok: true, value: { found: true, hits: request.from === undefined ? [{ offset: 200, count: 2 }] : [{ offset: 1000, count: 1 }], total: 0, skipped: 0 } })
    render(<Growing />)
    await press({ key: 'f', metaKey: true })
    await type('zebra')
    await wait(FIND_DEBOUNCE_MS + 50)
    expect(count()).toBe('4 of 4')
    fireEvent.click(screen.getByText('drop'))
    await wait(FIND_DEBOUNCE_MS + 50)
    expect(requests.map(({ from, before }) => [from, before])).toEqual([
      [undefined, 1000],
      [1000, 1500],
    ])
    // The dropped prompt's match is now main's: still four in all.
    expect(count()).toBe('4 of 4')
  })

  it('drops what main said of a file opened again from its end (replaced or cut), and asks about the new one from its start', async () => {
    function Reopened() {
      const [state, setState] = useState({ opening: 1, earlier: 1000 })
      const source: FindSource = { root: '/repo', sessionId: 'session-1', earlier: state.earlier, opening: state.opening, earlierNow: () => state.earlier, loadEarlier: async () => undefined }
      return (
        <>
          {/* The new file is longer: its window starts later, as if the old one had only grown. */}
          <button type="button" onClick={() => setState({ opening: 2, earlier: 1500 })}>
            replace
          </button>
          <View events={[prompt('zebra here')]} source={source} />
        </>
      )
    }
    let file = 'old'
    reply = () => ({ ok: true, value: { found: true, hits: file === 'old' ? [{ offset: 200, count: 2 }] : [{ offset: 700, count: 1 }], total: 0, skipped: 0 } })
    render(<Reopened />)
    await press({ key: 'f', metaKey: true })
    await type('zebra')
    await wait(FIND_DEBOUNCE_MS + 50)
    expect(count()).toBe('3 of 3')
    file = 'new'
    fireEvent.click(screen.getByText('replace'))
    await wait(FIND_DEBOUNCE_MS + 50)
    expect(requests.map(({ from, before }) => [from, before])).toEqual([
      [undefined, 1000],
      [undefined, 1500],
    ])
    // The old file's two matches are gone.
    expect(count()).toBe('2 of 2')
  })

  it('keeps the latest lines when a part is added, as main does, and counts the older in `skipped`', () => {
    const many = Array.from({ length: TRANSCRIPT_FIND.hits }, (_, index) => ({ offset: index * 10, count: 1 }))
    const known = { key: 'k', needle: 'zebra', before: 1_000_000, hits: many, skipped: 5 }
    const grown = extendAnswer(known, 2_000_000, { hits: [{ offset: 1_500_000, count: 3 }], skipped: 0 })
    expect(grown.before).toBe(2_000_000)
    expect(grown.hits).toHaveLength(TRANSCRIPT_FIND.hits)
    expect(grown.hits[0]).toEqual({ offset: 10, count: 1 })
    expect(grown.hits.at(-1)).toEqual({ offset: 1_500_000, count: 3 })
    expect(grown.skipped).toBe(6)
  })

  it('tells a window that surely holds a turn from before Resume from one that may lie wholly after it', () => {
    const added: AgentEvent = { type: 'notice', kind: 'synthetic', text: 'a skill body' }
    const m1 = answerOf('m1', 'one')
    const m2 = answerOf('m2', 'two')
    /** pastSettled as SessionView.tsx computes it, for a window `past` and the live events. */
    const settledFor = (past: AgentEvent[], live: AgentEvent[], earlier: number | null = 4000) => {
      const joined = joinPastAndLive(past, live)
      return pastSettled(keepsTurnBeforeResume(joined.slice(0, joined.length - live.length)), live.length, earlier)
    }
    // The window starts with an event without an id (an added notice): kept before the live part,
    // though the whole window is after Resume.
    expect(joinPastAndLive([added, m1, m2], [added, m1, m2])).toHaveLength(4)
    expect(settledFor([added, m1, m2], [added, m1, m2])).toBe(false)
    expect(settledFor([m1, m2], [m1, m2])).toBe(false)
    // A prompt that opens the live part is not kept; one from before Resume is, and settles.
    expect(settledFor([prompt('go'), m1], [prompt('go'), m1])).toBe(false)
    expect(settledFor([prompt('earlier question'), added, m1], [prompt('go'), m1])).toBe(true)
    // An answer from before Resume, before the added notice.
    expect(settledFor([answerOf('m0', 'zero'), added, m1], [m1])).toBe(true)
    // The file's start, or no live events: nothing to count twice.
    expect(settledFor([added, m1], [added, m1], 0)).toBe(true)
    expect(settledFor([added, m1], [])).toBe(true)
  })

  it("does not ask main while a resumed Session's window may lie after Resume: reads on first", async () => {
    let settles = 0
    function Resumed() {
      const [settled, setSettled] = useState(false)
      const source: FindSource = {
        root: '/repo',
        sessionId: 'session-1',
        earlier: settled ? 3000 : 4000,
        earlierNow: () => (settled ? 3000 : 4000),
        loadEarlier: async () => undefined,
        settled,
        settle: () => {
          settles += 1
          setSettled(true)
        },
      }
      return <View events={[prompt('zebra live')]} source={source} />
    }
    // Answered only for the bytes before 3000: lines before Resume.
    reply = (request) => ({ ok: true, value: { found: true, hits: request.before === 3000 ? [{ offset: 100, count: 1 }] : [{ offset: 3500, count: 1 }], total: 1, skipped: 0 } })
    render(<Resumed />)
    await press({ key: 'f', metaKey: true })
    await type('zebra')
    await wait(FIND_DEBOUNCE_MS + 50)
    expect(settles).toBe(1)
    expect(requests.map((request) => request.before)).toEqual([3000])
    expect(count()).toBe('2 of 2')
  })

  it('counts only the rows when main cannot answer, and says so', async () => {
    reply = () => ({ ok: false, error: 'no handler for claudeHome.transcriptFind' })
    render(<Earlier />)
    await press({ key: 'f', metaKey: true })
    await type('zebra')
    await act(async () => {
      await new Promise((done) => setTimeout(done, FIND_DEBOUNCE_MS + 50))
    })
    expect(count()).toBe('2 of 2')
    expect(screen.getByTestId('session-find-count').getAttribute('title')).toMatch(/was not searched: no handler/)
  })
})

/** Waits for an expectation inside act, for the loads the bar starts after a state change. */
async function settled(check: () => void): Promise<void> {
  for (let round = 0; ; round += 1) {
    try {
      check()
      return
    } catch (error) {
      if (round > 50) throw error
      await act(async () => {
        await new Promise((done) => setTimeout(done, 10))
      })
    }
  }
}
