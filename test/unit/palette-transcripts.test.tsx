// The "In transcripts" group of the command palette (⌘K, worfy-polish ticket 10): the query of the
// field goes to `claudeHome.search` once typing pauses; while no answer is there the group says
// "Searching…"; an answer to an older query is never shown; picking a hit opens its Session in the
// Session view. `invoke` is a mock: nothing here reaches main or a Claude home.
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TranscriptHit } from '../../src/shared/ipc/claude-home'
import type { IpcResult } from '../../src/shared/ipc/channels'
import { PaletteBody, TRANSCRIPT_SEARCH_DELAY_MS, TRANSCRIPTS_GROUP } from '../../src/renderer/palette/CommandPalette'
import type { PaletteCommand } from '../../src/renderer/palette/commands'
import { useNavigation } from '../../src/renderer/session/navigation'

type Answer = IpcResult<{ hits: TranscriptHit[]; limited: boolean }>

interface Call {
  channel: string
  input: unknown
  answer: (value: Answer) => Promise<void>
}

const calls: Call[] = []
const invoke = vi.hoisted(() => vi.fn<(channel: string, input?: unknown) => Promise<unknown>>())
vi.mock('../../src/renderer/ipc', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../src/renderer/ipc')>()), invoke }))

const SOURCE = { projectId: 'p1', projectRoot: '/repo/one' }
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const hit = (sessionId: string, title: string, snippet: string): TranscriptHit => ({ sessionId, title, at: 1_760_000_000_000, snippet })

const commands = (): PaletteCommand[] => [{ id: 'new:session', group: 'Action', title: 'New session', run: vi.fn(() => undefined) }]

beforeEach(() => {
  vi.useFakeTimers()
  calls.length = 0
  invoke.mockReset()
  invoke.mockImplementation((channel, input) => {
    let settle: (value: Answer) => void = () => undefined
    const promise = new Promise<Answer>((resolve) => (settle = resolve))
    calls.push({
      channel,
      input,
      answer: async (value) => {
        await act(async () => {
          settle(value)
          await promise
        })
      },
    })
    return promise
  })
  Element.prototype.scrollIntoView = () => undefined
  useNavigation.setState({ view: 'canvas', opened: null })
})

afterEach(() => {
  vi.useRealTimers()
  delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
})

function open(onClose = vi.fn()) {
  render(<PaletteBody commands={commands()} empty="Nothing matches" onClose={onClose} transcripts={SOURCE} />)
  return onClose
}

const type = (text: string) => fireEvent.change(screen.getByTestId('palette-input'), { target: { value: text } })
const wait = (ms: number) => act(() => vi.advanceTimersByTime(ms))
const group = () => screen.queryByRole('group', { name: TRANSCRIPTS_GROUP })
const hitTitles = () => within(group() ?? document.createElement('div')).queryAllByRole('option').map((option) => option.textContent)
const note = () => screen.queryByTestId('palette-transcripts-note')?.textContent ?? null

describe('the In transcripts group of the palette', () => {
  it('sends one search after the pause, with the last query, and says Searching… until the answer', async () => {
    open()
    type('zeb')
    await wait(100)
    type('zebr')
    await wait(100)
    type('zebra')
    await wait(TRANSCRIPT_SEARCH_DELAY_MS - 1)
    expect(invoke).not.toHaveBeenCalled()
    expect(note()).toBe('Searching…')
    await wait(1)
    expect(calls.map(({ channel, input }) => [channel, input])).toEqual([['claudeHome.search', { projectRoot: '/repo/one', query: 'zebra' }]])

    await calls[0]!.answer({ ok: true, value: { hits: [hit(A, 'Zebra config', 'Where does the Zebra config live?')], limited: false } })
    expect(hitTitles()).toEqual(['Zebra configWhere does the Zebra config live?'])
    expect(note()).toBeNull()
  })

  it('does not search a query shorter than 3 characters', async () => {
    open()
    type('ze')
    await wait(TRANSCRIPT_SEARCH_DELAY_MS * 2)
    expect(invoke).not.toHaveBeenCalled()
    expect(group()).toBeNull()
  })

  it.each([
    ['the old answer arrives first', [0, 1]],
    ['the old answer arrives last', [1, 0]],
  ] as const)('never shows the answer to an older query: %s', async (_name, order) => {
    open()
    type('zebra')
    await wait(TRANSCRIPT_SEARCH_DELAY_MS)
    type('stripes')
    await wait(TRANSCRIPT_SEARCH_DELAY_MS)
    expect(calls.map(({ input }) => (input as { query: string }).query)).toEqual(['zebra', 'stripes'])
    const answers: Answer[] = [
      { ok: true, value: { hits: [hit(A, 'Old', 'zebra')], limited: false } },
      { ok: true, value: { hits: [hit(B, 'New', 'stripes')], limited: false } },
    ]
    for (const index of order) {
      await calls[index]!.answer(answers[index]!)
      // Until the answer to "stripes" is in, the group only searches.
      if (index === 0) expect(hitTitles().some((title) => title?.startsWith('Old'))).toBe(false)
    }
    expect(hitTitles()).toEqual(['Newstripes'])
    expect(note()).toBeNull()
  })

  it('hides the hits of the last answer as soon as the query changes', async () => {
    open()
    type('zebra')
    await wait(TRANSCRIPT_SEARCH_DELAY_MS)
    await calls[0]!.answer({ ok: true, value: { hits: [hit(A, 'Old', 'zebra')], limited: false } })
    expect(hitTitles()).toEqual(['Oldzebra'])
    type('zebras')
    expect(hitTitles()).toEqual([])
    expect(note()).toBe('Searching…')
    await wait(TRANSCRIPT_SEARCH_DELAY_MS)
    expect(hitTitles()).toEqual([])
    expect(note()).toBe('Searching…')
  })

  it('opens the picked Session in the Session view and closes the palette', async () => {
    const onClose = open()
    type('zebra')
    await wait(TRANSCRIPT_SEARCH_DELAY_MS)
    await calls[0]!.answer({ ok: true, value: { hits: [hit(A, 'Zebra config', 'the zebra')], limited: false } })
    fireEvent.click(within(group()!).getByRole('option'))
    expect(useNavigation.getState()).toMatchObject({ view: 'session', opened: { nodeId: `session:${A}`, projectId: 'p1', external: { sessionId: A } } })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('reaches a hit with ↓ after the commands and opens it with Enter', async () => {
    open()
    type('session')
    await wait(TRANSCRIPT_SEARCH_DELAY_MS)
    await calls[0]!.answer({ ok: true, value: { hits: [hit(B, 'Old work', 'a new session was started')], limited: false } })
    const input = screen.getByTestId('palette-input')
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(within(group()!).getByRole('option').getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(useNavigation.getState().opened).toMatchObject({ external: { sessionId: B } })
  })

  it('says when older transcripts were not searched, and when the search failed', async () => {
    open()
    type('zebra')
    await wait(TRANSCRIPT_SEARCH_DELAY_MS)
    await calls[0]!.answer({ ok: true, value: { hits: [], limited: true } })
    expect(note()).toBe('Older transcripts were not searched')
    type('zebras')
    await wait(TRANSCRIPT_SEARCH_DELAY_MS)
    await calls[1]!.answer({ ok: false, error: 'claudeHome.search: Mini is unreachable' })
    expect(note()).toBe('Could not search the transcripts: Mini is unreachable')
  })

  it('shows no group for a search that found nothing, and "Nothing matches" when no command matches either', async () => {
    open()
    type('qwerty')
    await wait(TRANSCRIPT_SEARCH_DELAY_MS)
    await calls[0]!.answer({ ok: true, value: { hits: [], limited: false } })
    expect(group()).toBeNull()
    expect(screen.getByText('Nothing matches')).toBeTruthy()
  })

  it('shows the snippet from a little before the match, and the whole snippet as the tooltip', async () => {
    open()
    type('needle')
    await wait(TRANSCRIPT_SEARCH_DELAY_MS)
    const snippet = `…${'word '.repeat(16)}the needle is here`
    await calls[0]!.answer({ ok: true, value: { hits: [hit(A, 'Long', snippet)], limited: false } })
    const option = within(group()!).getByRole('option')
    expect(option.getAttribute('title')).toBe(snippet)
    const shown = option.textContent ?? ''
    expect(shown.startsWith('Long…')).toBe(true)
    expect(shown).toContain('the needle is here')
    expect(shown.length).toBeLessThan(`Long${snippet}`.length)
  })
})
