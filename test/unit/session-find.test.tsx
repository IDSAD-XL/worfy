// Find in the Session view (⌘F, Ctrl+F on Windows and Linux; worfy-ui ticket 26): the matches of the
// rows (src/renderer/session/transcript-find.ts) — case ignored, Cyrillic, several in one message, in
// a folded «N tools» line, which opens, and in closed thinking, which opens too — the keys of the
// bar on each system and with a Russian layout, Esc, Enter and Shift+Enter, the paint of the matches
// (the CSS Custom Highlight API, stubbed here: jsdom has none), and the matches main finds in the
// part of the file before the rows, which the bar goes to by loading earlier windows. A fake bridge
// answers `claudeHome.transcriptFind`; no main process.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useRef, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AgentEvent } from '../../src/shared/agent/events'
import type { WorfyBridge } from '../../src/shared/ipc/channels'
import { eventMatches, findNeedle } from '../../src/shared/transcript/find'
import { foldTranscript } from '../../src/renderer/session/fold'
import { setView } from '../../src/renderer/session/navigation'
import { SessionFind } from '../../src/renderer/session/SessionFind'
import { Transcript } from '../../src/renderer/session/Transcript'
import { extensionTypes, FIND_DEBOUNCE_MS, HIGHLIGHT, rowMatches, useTranscriptFind, type FindSource } from '../../src/renderer/session/transcript-find'

const prompt = (text: string): AgentEvent => ({ type: 'notice', kind: 'user', text })
const answer = (text: string): AgentEvent => ({ type: 'text', text, messageId: 'm', parentToolUseId: null, synthetic: false })
const toolUse = (id: string, name: string, input: unknown): AgentEvent => ({ type: 'tool_use', id, name, input, parentToolUseId: null })
const toolResult = (toolUseId: string, content = 'ok', isError = false): AgentEvent => ({ type: 'tool_result', toolUseId, content, isError, parentToolUseId: null })
const thinking = (text: string): AgentEvent => ({ type: 'thinking', text, messageId: 'm', parentToolUseId: null })

type FindRequest = { projectRoot: string; sessionId: string; agentId?: string; query: string; before: number }
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
    // A line the reader closes stays closed until another match in it becomes the current one.
    fireEvent.click(thought)
    expect(thought.getAttribute('aria-expanded')).toBe('false')
  })
})

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
