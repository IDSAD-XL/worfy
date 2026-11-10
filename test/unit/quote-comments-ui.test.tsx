// Comments on quotes of an agent's message on screen (worfy-polish ticket 102): the button a
// selection in an agent's message gets, the popover a comment is written in, the tray above the input
// field and its chips, the round as it goes to the agent and as it stays afterwards, and the bubble
// of a sent message with its quote blocks — in the transcript after a restart too.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useLayoutEffect, useRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AttachmentSource } from '../../src/shared/agent/attachments'
import type { AgentEvent } from '../../src/shared/agent/events'
import type { WorfyBridge } from '../../src/shared/ipc/channels'
import { useQuoteComments, type QuoteCommentsLayer } from '../../src/renderer/session/QuoteComments'
import { agentText, parseQuoted } from '../../src/renderer/session/quote-comments'
import { forgetQuotesInMemory, readQuotes } from '../../src/renderer/session/quote-store'
import { QuotedPrompt } from '../../src/renderer/session/QuotedPrompt'
import { SentQuotesContext } from '../../src/renderer/session/sent-quotes'
import { Transcript } from '../../src/renderer/session/Transcript'
import { resetToasts, toasts } from '../../src/renderer/toast/toasts'

// An image of a comment is read and scaled in the window (canvas, createImageBitmap), which jsdom has
// not: the test gives the source as it would be.
vi.mock('../../src/renderer/session/comment-image', () => ({
  readCommentImage: (file: File): Promise<AttachmentSource> => Promise.resolve({ kind: 'pasted', name: file.name, data: 'AAAA' }),
}))

const FIRST = 'The build has two steps: the lint step is fast.'
const SECOND = 'The test step is slow and runs last.'
const AT = new Date(2026, 10, 10, 14, 2).getTime()

let key = 0
let storeKey = ''
/** The layer the harness drew last: what the Session view gets from it. */
const seen: { current: QuoteCommentsLayer | null } = { current: null }
let attached: string[] = []

/** Keeps the layer the harness drew last. */
const keep = (layer: QuoteCommentsLayer): void => {
  seen.current = layer
}

function Harness({ refusal = null }: { refusal?: string | null }) {
  const log = useRef<HTMLDivElement>(null)
  const layer = useQuoteComments({ storeKey, sessionId: 'live-1', log, assistant: 'claude', refusal })
  useLayoutEffect(() => keep(layer))
  return (
    <div>
      <div ref={log} data-testid="log">
        <div data-quote-anchor="m1#0" data-quote-at={String(AT)}>
          <p>{FIRST}</p>
        </div>
        <div data-quote-anchor="m2#0">
          <p>{SECOND}</p>
        </div>
      </div>
      {layer.overlay}
      <div data-testid="above-field">{layer.tray}</div>
    </div>
  )
}

/** Selects `quote` in a message's text with the mouse, as a drag that lets go. */
function select(anchor: string, quote: string, endAnchor = anchor, endQuote = quote) {
  const textOf = (name: string) => document.querySelector(`[data-quote-anchor="${name}"] p`)!.firstChild as Text
  const start = textOf(anchor)
  const end = textOf(endAnchor)
  const range = document.createRange()
  range.setStart(start, start.data.indexOf(quote))
  range.setEnd(end, end.data.indexOf(endQuote) + endQuote.length)
  const chosen = document.getSelection()!
  chosen.removeAllRanges()
  chosen.addRange(range)
  fireEvent.mouseDown(start.parentElement!, { button: 0 })
  fireEvent.mouseUp(start.parentElement!)
}

/** Writes a comment on `quote` through the button and the popover. */
async function commentOn(anchor: string, quote: string, text: string) {
  select(anchor, quote)
  fireEvent.click(await screen.findByTestId('quote-button'))
  const popover = await screen.findByTestId('quote-popover')
  fireEvent.change(within(popover).getByTestId('quote-popover-text'), { target: { value: text } })
  fireEvent.click(within(popover).getByTestId('quote-popover-save'))
  await waitFor(() => expect(screen.queryByTestId('quote-popover')).toBeNull())
}

beforeEach(() => {
  key += 1
  storeKey = `p1/n1/s${key}`
  seen.current = null
  attached = []
  ;(globalThis as { worfy?: WorfyBridge }).worfy = {
    invoke: (channel: string, input: { sources?: { name: string }[] }) => {
      if (channel !== 'agent.attach') return Promise.resolve({ ok: false, error: `no ${channel}` })
      const name = input.sources?.[0]?.name ?? 'image.png'
      attached.push(name)
      return Promise.resolve({ ok: true, value: { results: [{ ok: true, attachment: { kind: 'image', name, mediaType: 'image/png', size: 3, data: 'AAAA' } }] } })
    },
    on: () => 1,
    off: () => undefined,
  } as unknown as WorfyBridge
})

afterEach(() => {
  cleanup()
  forgetQuotesInMemory()
  localStorage.clear()
  resetToasts()
  delete (globalThis as { worfy?: WorfyBridge }).worfy
})

describe('the button next to a selection', () => {
  it('offers «Comment ⇧⌘M» for text inside one agent message', async () => {
    render(<Harness />)
    select('m1#0', 'the lint step')
    const button = await screen.findByTestId('quote-button')
    expect(button.textContent).toContain('Comment')
    expect(button.textContent).toContain('⇧⌘M')
  })

  it('says to select inside one message when the selection spans two', async () => {
    render(<Harness />)
    select('m1#0', 'fast.', 'm2#0', 'The test')
    expect((await screen.findByTestId('quote-button')).textContent).toBe('Select inside one message to comment')
  })

  it('over an unsent comment says «Overlaps a comment · Open it» and opens that comment', async () => {
    render(<Harness />)
    await commentOn('m1#0', 'the lint step', 'Keep it.')
    select('m1#0', 'lint step is')
    const button = await screen.findByTestId('quote-button')
    expect(button.textContent).toBe('Overlaps a comment · Open it')
    fireEvent.click(button)
    const popover = await screen.findByTestId('quote-popover')
    expect(within(popover).getByText('Edit comment')).toBeTruthy()
    expect((within(popover).getByTestId('quote-popover-text') as HTMLTextAreaElement).value).toBe('Keep it.')
  })

  it('right next to an unsent comment it offers a new comment', async () => {
    render(<Harness />)
    await commentOn('m1#0', 'the lint step', 'Keep it.')
    select('m1#0', ' is fast')
    expect((await screen.findByTestId('quote-button')).textContent).toContain('Comment')
  })

  it('shows nothing where comments cannot be made', async () => {
    render(<Harness refusal="Read-only" />)
    select('m1#0', 'the lint step')
    await new Promise((done) => setTimeout(done, 50))
    expect(screen.queryByTestId('quote-button')).toBeNull()
  })
})

describe('the popover', () => {
  it('shows the quote and the message’s source, saves the comment into the tray', async () => {
    render(<Harness />)
    select('m1#0', 'the lint step')
    fireEvent.click(await screen.findByTestId('quote-button'))
    const popover = await screen.findByTestId('quote-popover')
    expect(within(popover).getByTestId('quote-popover-quote').textContent).toBe('the lint step')
    expect(popover.textContent).toContain('claude · 14:02')
    // Save waits for a text or an image.
    expect((within(popover).getByTestId('quote-popover-save') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(within(popover).getByTestId('quote-popover-text'), { target: { value: 'Keep it.' } })
    fireEvent.keyDown(within(popover).getByTestId('quote-popover-text'), { key: 'Enter', metaKey: true })
    await waitFor(() => expect(screen.queryByTestId('quote-popover')).toBeNull())
    expect(readQuotes(storeKey).drafts).toMatchObject([{ anchor: 'm1#0', quote: 'the lint step', text: 'Keep it.', messageAt: AT, start: FIRST.indexOf('the lint step') }])
    expect(screen.getByTestId('quote-tray').textContent).toContain('1 comment on this message')
  })

  it('Esc cancels: nothing is kept', async () => {
    render(<Harness />)
    select('m1#0', 'the lint step')
    fireEvent.click(await screen.findByTestId('quote-button'))
    const field = within(await screen.findByTestId('quote-popover')).getByTestId('quote-popover-text')
    fireEvent.change(field, { target: { value: 'Not this.' } })
    fireEvent.keyDown(field, { key: 'Escape' })
    expect(screen.queryByTestId('quote-popover')).toBeNull()
    expect(readQuotes(storeKey).drafts).toEqual([])
  })

  it('takes images by the file picker, at most 3 per comment, and a comment of images alone', async () => {
    render(<Harness />)
    select('m1#0', 'the lint step')
    fireEvent.click(await screen.findByTestId('quote-button'))
    const popover = await screen.findByTestId('quote-popover')
    const files = ['a.png', 'b.png', 'c.png', 'd.png'].map((name) => new File(['x'], name, { type: 'image/png' }))
    fireEvent.change(within(popover).getByTestId('quote-popover-file'), { target: { files } })
    await waitFor(() => expect(within(popover).getAllByTestId('quote-popover-image')).toHaveLength(3))
    expect(attached).toEqual(['a.png', 'b.png', 'c.png'])
    expect(within(popover).getByTestId('quote-popover-error').textContent).toBe('Up to 3 images per comment.')
    fireEvent.click(within(popover).getByTestId('quote-popover-save'))
    await waitFor(() => expect(screen.queryByTestId('quote-popover')).toBeNull())
    expect(readQuotes(storeKey).drafts[0]?.images.map((each) => each.name)).toEqual(['a.png', 'b.png', 'c.png'])
  })

  it('takes a pasted image', async () => {
    render(<Harness />)
    select('m1#0', 'the lint step')
    fireEvent.click(await screen.findByTestId('quote-button'))
    const popover = await screen.findByTestId('quote-popover')
    fireEvent.paste(within(popover).getByTestId('quote-popover-text'), { clipboardData: { files: [new File(['x'], 'pasted.png', { type: 'image/png' })] } })
    await waitFor(() => expect(within(popover).getAllByTestId('quote-popover-image')).toHaveLength(1))
  })
})

describe('the tray above the input field', () => {
  it('lists the comments in text order, «N comments on M messages»; × removes one, Clear removes all, with Undo', async () => {
    render(<Harness />)
    await commentOn('m2#0', 'slow', 'Why slow?')
    await commentOn('m1#0', 'the lint step', 'Keep it.')
    const tray = screen.getByTestId('quote-tray')
    expect(tray.textContent).toContain('2 comments on 2 messages')
    expect(within(tray).getAllByTestId('quote-chip').map((chip) => chip.textContent)).toEqual(['1«the lint step»×', '2«slow»×'])
    fireEvent.click(within(tray).getAllByTestId('quote-chip-remove')[0]!)
    expect(within(screen.getByTestId('quote-tray')).getAllByTestId('quote-chip')).toHaveLength(1)
    const undo = toasts.getState().toasts.find((toast) => toast.testId === 'quote-undo-toast')
    expect(undo?.text).toBe('Comment deleted')
    act(() => undo?.kind === 'action' && undo.actions[0]?.run())
    expect(within(screen.getByTestId('quote-tray')).getAllByTestId('quote-chip')).toHaveLength(2)
    fireEvent.click(screen.getByTestId('quote-tray-clear'))
    expect(screen.queryByTestId('quote-tray')).toBeNull()
    expect(toasts.getState().toasts.find((toast) => toast.testId === 'quote-undo-toast')?.text).toBe('2 comments cleared')
  })
})

describe('sending a round', () => {
  it('composes one message: the comments in text order, then the field’s text and attachments; once sent they leave the tray', async () => {
    render(<Harness />)
    await commentOn('m2#0', 'slow', 'Why slow?')
    await commentOn('m1#0', 'the lint step', 'Keep it.')
    const composed = seen.current!.compose({ text: 'Thanks.', attachments: [] })
    if ('error' in composed) throw new Error(composed.error)
    expect(composed.message.text).toBe(
      ['Comments on parts of your messages (2):', '', '1. > «the lint step» (your message 14:02)', '   Keep it.', '', '2. > «slow» (your message)', '   Why slow?', '', 'General:', 'Thanks.'].join('\n'),
    )
    act(() => seen.current!.sent(composed.round, composed.message.text))
    expect(screen.queryByTestId('quote-tray')).toBeNull()
    const sent = readQuotes(storeKey).sent
    expect(sent.map((each) => [each.quote, each.number, each.message === composed.message.text])).toEqual([
      ['the lint step', 1, true],
      ['slow', 2, true],
    ])
    // The sent quotes tell the bubble of that message its blocks.
    expect(seen.current!.sentQuotes.sentIn(composed.message.text)?.get(1)?.quote).toBe('the lint step')
    // Over a sent quote a new comment may be made: a new round.
    select('m1#0', 'the lint step')
    expect((await screen.findByTestId('quote-button')).textContent).toContain('Comment')
  })

  it('with no comments the field’s message goes as it is', () => {
    render(<Harness />)
    const message = { text: 'plain', attachments: [] }
    expect(seen.current!.compose(message)).toEqual({ message, round: [] })
  })
})

describe('the bubble of a sent message', () => {
  const sentText = agentText(
    [
      { quote: 'the lint step', text: 'Keep it.', images: 1, time: '14:02' },
      { quote: 'slow', text: '', images: 1, time: null },
    ],
    'Thanks.',
  )
  const images = [
    { kind: 'image' as const, name: 'one.png', mediaType: 'image/png' as const, ref: null },
    { kind: 'image' as const, name: 'two.png', mediaType: 'image/png' as const, ref: null },
    { kind: 'file' as const, name: 'notes.txt', ext: 'txt', size: 3 },
  ]

  it('draws a block per quote — its source, the quote, the comment and its images — then the general text; the rest under it', () => {
    render(<QuotedPrompt text={sentText} parsed={parseQuoted(sentText)!} attachments={images} assistant="claude" find="f" />)
    const blocks = screen.getAllByTestId('quoted-prompt-block')
    expect(blocks).toHaveLength(2)
    expect(blocks[0]!.textContent).toContain('claude · 14:02')
    expect(within(blocks[0]!).getByTestId('quoted-prompt-quote').textContent).toBe('the lint step')
    expect(within(blocks[0]!).getByTestId('quoted-prompt-comment').textContent).toBe('Keep it.')
    expect(within(blocks[0]!).getAllByTestId(/^message-image/).map((each) => each.getAttribute('title'))).toEqual(['one.png'])
    expect(within(blocks[1]!).queryByTestId('quoted-prompt-comment')).toBeNull()
    expect(within(blocks[1]!).getAllByTestId(/^message-image/).map((each) => each.getAttribute('title'))).toEqual(['two.png'])
    expect(screen.getByTestId('quoted-prompt-general').textContent).toBe('Thanks.')
    expect(screen.getAllByTestId('message-file').map((each) => each.getAttribute('title'))).toEqual(['notes.txt'])
  })

  it('folds a quote past three lines with «Show all», and opens it', () => {
    const tall = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(80)
    render(<QuotedPrompt text={sentText} parsed={parseQuoted(sentText)!} attachments={[]} assistant="claude" find="f" />)
    const more = screen.getAllByTestId('quoted-prompt-more')[0]!
    expect(more.textContent).toBe('Show all')
    fireEvent.click(more)
    expect(more.textContent).toBe('Show less')
    expect(screen.getAllByTestId('quoted-prompt-quote')[0]!.classList.contains('w-qprompt__quote--open')).toBe(true)
    tall.mockRestore()
  })

  it('shows the whole quote this window sent, though the agent got it cut, and its source leads back to the quote', () => {
    const long = `${'start '.repeat(40)}and the end`
    const text = agentText([{ quote: long, text: 'c', images: 0, time: null }], '')
    const showQuote = vi.fn()
    const sent = { id: 'q1', anchor: 'm1#0', start: 0, end: long.length, quote: long, text: 'c', images: 0, message: text, number: 1, at: 1 }
    render(
      <SentQuotesContext.Provider value={{ sentIn: (message) => (message === text ? new Map([[1, sent]]) : undefined), showQuote }}>
        <QuotedPrompt text={text} parsed={parseQuoted(text)!} attachments={[]} assistant="claude" find="f" />
      </SentQuotesContext.Provider>,
    )
    expect(parseQuoted(text)!.quotes[0]!.quote).toContain(' … ')
    expect(screen.getByTestId('quoted-prompt-quote').textContent).toBe(long.trim())
    fireEvent.click(screen.getByTestId('quoted-prompt-source'))
    expect(showQuote).toHaveBeenCalledWith('q1')
  })

  it('the transcript draws a prompt in the round’s format as the quote bubble, after a restart too; other prompts as before', () => {
    const events: AgentEvent[] = [
      { type: 'text', text: FIRST, messageId: 'm1', parentToolUseId: null, synthetic: false },
      { type: 'notice', kind: 'user', text: sentText },
      { type: 'notice', kind: 'user', text: 'plain words' },
    ]
    render(<Transcript events={events} />)
    expect(screen.getAllByTestId('quoted-prompt')).toHaveLength(1)
    expect(screen.getAllByTestId('quoted-prompt-block')).toHaveLength(2)
    expect(screen.getByText('plain words')).toBeTruthy()
    // The agent's text row carries its anchor, so a comment can find its message again.
    expect(screen.getByTestId('transcript-text').querySelector('[data-quote-anchor]')?.getAttribute('data-quote-anchor')).toBe('m1#0')
  })
})
