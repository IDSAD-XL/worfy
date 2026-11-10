// The draft replies of a PR in the Pull requests view (worfy-pr-inbox ticket 05, src/renderer/pr-inbox/DraftThread.tsx):
// - DraftThread: Send is off on an empty text;
// - PrDrafts over a fake main: the drafts of the file, an edit kept on blur, Discard; Send carries the text shown;
//   Send all opens a dialog with every text, Cancel sends nothing, Send all in the dialog sends them in one call.
// Nothing reaches main's Send without a click: every test that does not press Send checks no `prInbox.send` went.
// main is a fake preload bridge; owners, repositories, logins and texts are invented.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcResult, WorfyBridge } from '../../src/shared/ipc/channels'
import type { PrReplyDrafts, PrReplyItem } from '../../src/shared/ipc/pr-inbox'

const API = 'example-org/api'
const PROJECT = 'web-00000001'

const item = (index: number, over: Partial<PrReplyItem> = {}): PrReplyItem => ({
  index,
  kind: 'thread',
  threadId: `T${index}`,
  replyTo: 100 + index,
  label: 'needs answer',
  body: `Draft ${index}`,
  fixPlan: null,
  state: 'draft',
  sentUrl: null,
  error: null,
  edited: false,
  ...over,
})

const draftsOf = (items: PrReplyItem[]): PrReplyDrafts => ({ repo: API, pr: 118, headOid: 'abc1234', items, problem: null })

interface FakeMain {
  calls: { channel: string; input: unknown }[]
  drafts: PrReplyDrafts
}

let main: FakeMain

function preload(drafts: PrReplyDrafts): void {
  const fake: FakeMain = { calls: [], drafts }
  const answer = (channel: string, input: unknown): IpcResult<unknown> => {
    switch (channel) {
      case 'prInbox.drafts':
        return { ok: true, value: fake.drafts }
      case 'prInbox.saveDraft': {
        const { item: ref, body } = input as { item: { index: number }; body: string }
        fake.drafts = { ...fake.drafts, items: fake.drafts.items.map((each) => (each.index === ref.index ? { ...each, body, edited: true } : each)) }
        return { ok: true, value: fake.drafts }
      }
      case 'prInbox.discard': {
        const { item: ref } = input as { item: { index: number } }
        fake.drafts = { ...fake.drafts, items: fake.drafts.items.map((each) => (each.index === ref.index ? { ...each, state: 'discarded' } : each)) }
        return { ok: true, value: fake.drafts }
      }
      case 'prInbox.send': {
        const { items } = input as { items: { index: number; body: string }[] }
        fake.drafts = { ...fake.drafts, items: fake.drafts.items.map((each) => (items.some((sent) => sent.index === each.index) ? { ...each, body: items.find((sent) => sent.index === each.index)!.body, state: 'sent', sentUrl: `https://github.com/${API}/pull/118#r${each.index}` } : each)) }
        return { ok: true, value: { results: items.map((sent) => ({ index: sent.index, outcome: 'sent', reason: null, sentUrl: `https://github.com/${API}/pull/118#r${sent.index}` })), drafts: fake.drafts } }
      }
      default:
        return { ok: false, error: `${channel}: not expected here` }
    }
  }
  const bridge: WorfyBridge = {
    invoke: (channel, input) => {
      fake.calls.push({ channel, input })
      return Promise.resolve(answer(channel, input) as never)
    },
    on: () => 1,
    off: () => undefined,
  }
  main = fake
  ;(globalThis as { worfy?: WorfyBridge }).worfy = bridge
}

beforeEach(() => {
  vi.resetModules()
})

afterEach(() => {
  cleanup()
  delete (globalThis as { worfy?: WorfyBridge }).worfy
})

const sends = (): unknown[] => main.calls.filter((call) => call.channel === 'prInbox.send').map((call) => call.input)

async function drafts(items: PrReplyItem[], readOnly: string | null = null): Promise<void> {
  preload(draftsOf(items))
  const { PrDrafts } = await import('../../src/renderer/pr-inbox/DraftThread')
  render(
    <PrDrafts projectId={PROJECT} repo={API} number={118} readOnly={readOnly} threads={[0, 1, 2].map((index) => ({ id: `T${index}`, path: `src/f${index}.ts`, line: index }))}>
      {(renderItem, list) => <div data-testid="threads">{renderItem === null ? null : list.map(renderItem)}</div>}
    </PrDrafts>,
  )
  await waitFor(() => expect(screen.getAllByTestId('pr-draft').length).toBeGreaterThan(0))
}

const draftAt = (index: number): HTMLElement => {
  const found = screen.getAllByTestId('pr-draft').find((each) => each.dataset.index === String(index))
  if (!found) throw new Error(`no draft ${index}`)
  return found
}
const field = (index: number): HTMLTextAreaElement => within(draftAt(index)).getByTestId('pr-draft-field') as HTMLTextAreaElement
const sendButton = (index: number): HTMLButtonElement => within(draftAt(index)).getByTestId('pr-draft-send') as HTMLButtonElement

describe('DraftThread', () => {
  it('Send is off on an empty text or one of spaces, on with a text', async () => {
    const { DraftThread } = await import('../../src/renderer/pr-inbox/DraftThread')
    const onSend = vi.fn()
    const props = { item: item(0), place: 'src/a.ts:3', busy: false, result: null, disabled: null, rewriteOff: null, onText: () => undefined, onSave: () => undefined, onSend, onDiscard: () => undefined, onAskRewrite: () => undefined }
    const { rerender } = render(<DraftThread {...props} text="" />)
    expect((screen.getByTestId('pr-draft-send') as HTMLButtonElement).disabled).toBe(true)
    rerender(<DraftThread {...props} text={'  \n '} />)
    expect((screen.getByTestId('pr-draft-send') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByTestId('pr-draft-send'))
    expect(onSend).not.toHaveBeenCalled()
    rerender(<DraftThread {...props} text="Three tries: the server drops the first." />)
    expect((screen.getByTestId('pr-draft-send') as HTMLButtonElement).disabled).toBe(false)
  })

  it('a sent reply shows its text and link, no field and no Send; a reply with the reason of a failed Send shows it', async () => {
    const { DraftThread } = await import('../../src/renderer/pr-inbox/DraftThread')
    const props = { place: 'src/a.ts:3', busy: false, result: null, disabled: null, rewriteOff: null, onText: () => undefined, onSave: () => undefined, onSend: () => undefined, onDiscard: () => undefined, onAskRewrite: () => undefined }
    const { rerender } = render(<DraftThread {...props} item={item(0, { state: 'sent', sentUrl: 'https://github.com/example-org/api/pull/118#r1' })} text="Draft 0" />)
    expect(screen.getByTestId('pr-draft-sent').textContent).toContain('View on GitHub')
    expect(screen.queryByTestId('pr-draft-field')).toBeNull()
    expect(screen.queryByTestId('pr-draft-send')).toBeNull()
    rerender(<DraftThread {...props} item={item(0, { error: 'GitHub did not confirm the reply: HTTP 500' })} text="Draft 0" />)
    expect(screen.getByTestId('pr-draft-result').textContent).toBe('GitHub did not confirm the reply: HTTP 500')
  })

  it('the read-only hint turns Send, Discard and Ask off', async () => {
    await drafts([item(0)], 'Linked machines can only view the Projects of Alpha')
    for (const id of ['pr-draft-send', 'pr-draft-discard', 'pr-draft-rewrite']) expect((within(draftAt(0)).getByTestId(id) as HTMLButtonElement).disabled, id).toBe(true)
  })
})

describe('the drafts of a PR', () => {
  it('shows the draft replies of the file; a discarded one is not shown; an edit is kept on blur; Discard discards — and nothing is sent', async () => {
    await drafts([item(0), item(1, { kind: 'conversation', threadId: null, replyTo: null }), item(2, { state: 'discarded' })])
    expect(screen.getAllByTestId('pr-draft').map((each) => each.dataset.index)).toEqual(['0', '1'])
    expect(field(0).value).toBe('Draft 0')
    fireEvent.change(field(0), { target: { value: 'Three tries: the server drops the first.' } })
    fireEvent.blur(field(0))
    await waitFor(() => expect(main.calls.filter((call) => call.channel === 'prInbox.saveDraft').map((call) => call.input)).toEqual([{ projectId: PROJECT, repo: API, number: 118, item: { index: 0, kind: 'thread', threadId: 'T0' }, body: 'Three tries: the server drops the first.' }]))
    // A blur without a change saves nothing.
    fireEvent.blur(field(1))
    fireEvent.click(within(draftAt(1)).getByTestId('pr-draft-discard'))
    await waitFor(() => expect(screen.getAllByTestId('pr-draft').map((each) => each.dataset.index)).toEqual(['0']))
    expect(main.calls.filter((call) => call.channel === 'prInbox.saveDraft')).toHaveLength(1)
    expect(main.calls.filter((call) => call.channel === 'prInbox.discard').map((call) => call.input)).toEqual([{ projectId: PROJECT, repo: API, number: 118, item: { index: 1, kind: 'conversation', threadId: null } }])
    expect(sends()).toEqual([])
  })

  it('Send on one reply sends the text in its field, once; the reply then shows as sent', async () => {
    await drafts([item(0), item(1)])
    fireEvent.change(field(0), { target: { value: 'Edited text\nwith a second line' } })
    fireEvent.click(sendButton(0))
    await waitFor(() => expect(within(draftAt(0)).queryByTestId('pr-draft-sent')).not.toBeNull())
    expect(sends()).toEqual([{ projectId: PROJECT, repo: API, number: 118, items: [{ index: 0, kind: 'thread', threadId: 'T0', body: 'Edited text\nwith a second line' }] }])
    // The other reply is still a draft.
    expect(field(1).value).toBe('Draft 1')
  })

  it('Send all opens a dialog with every text as it goes; Cancel sends nothing; Send all in the dialog sends them in one call', async () => {
    await drafts([item(0), item(1, { kind: 'conversation', threadId: null, replyTo: null }), item(2, { state: 'sent', sentUrl: 'https://github.com/x' })])
    fireEvent.change(field(1), { target: { value: 'Typed, not saved yet' } })
    fireEvent.click(screen.getByTestId('pr-drafts-send-all'))
    const dialog = screen.getByRole('dialog', { name: `Send 2 replies to ${API}#118?` })
    expect(within(dialog).getAllByTestId('pr-send-all-text').map((each) => each.textContent)).toEqual(['Draft 0', 'Typed, not saved yet'])
    expect(within(dialog).getAllByTestId('pr-send-all-reply').map((each) => each.firstChild?.textContent)).toEqual(['src/f0.ts:0', 'Conversation'])
    fireEvent.click(within(dialog).getByTestId('pr-send-all-cancel'))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(sends()).toEqual([])

    // Escape closes it the same way.
    fireEvent.click(screen.getByTestId('pr-drafts-send-all'))
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(sends()).toEqual([])

    fireEvent.click(screen.getByTestId('pr-drafts-send-all'))
    await act(async () => {
      fireEvent.click(within(screen.getByRole('dialog')).getByTestId('pr-send-all-confirm'))
    })
    await waitFor(() => expect(sends()).toHaveLength(1))
    expect(sends()[0]).toEqual({
      projectId: PROJECT,
      repo: API,
      number: 118,
      items: [
        { index: 0, kind: 'thread', threadId: 'T0', body: 'Draft 0' },
        { index: 1, kind: 'conversation', threadId: null, body: 'Typed, not saved yet' },
      ],
    })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('Send all is off while a reply is empty, and absent with one reply only', async () => {
    await drafts([item(0), item(1)])
    fireEvent.change(field(1), { target: { value: '' } })
    expect((screen.getByTestId('pr-drafts-send-all') as HTMLButtonElement).disabled).toBe(true)
    expect(sendButton(1).disabled).toBe(true)
    cleanup()
    await drafts([item(0)])
    expect(screen.queryByTestId('pr-drafts-send-all')).toBeNull()
    expect(sends()).toEqual([])
  })

  it('a refusal of Send shows its reason under the reply, which stays a draft', async () => {
    preload(draftsOf([item(0)]))
    const reason = 'Not sent: review-draft-lint found workflow trace ".scratch"'
    const bridge = (globalThis as { worfy?: WorfyBridge }).worfy!
    const invoke = bridge.invoke
    bridge.invoke = ((channel: string, input: unknown) => {
      if (channel !== 'prInbox.send') return invoke(channel as never, input as never)
      main.calls.push({ channel, input })
      main.drafts = draftsOf([item(0, { error: reason })])
      return Promise.resolve({ ok: true, value: { results: [{ index: 0, outcome: 'refused', reason, sentUrl: null }], drafts: main.drafts } })
    }) as WorfyBridge['invoke']
    const { PrDrafts } = await import('../../src/renderer/pr-inbox/DraftThread')
    render(
      <PrDrafts projectId={PROJECT} repo={API} number={118} readOnly={null} threads={[{ id: 'T0', path: 'src/a.ts', line: 1 }]}>
        {(renderItem, list) => <div>{renderItem === null ? null : list.map(renderItem)}</div>}
      </PrDrafts>,
    )
    await waitFor(() => expect(screen.getAllByTestId('pr-draft')).toHaveLength(1))
    fireEvent.click(sendButton(0))
    await waitFor(() => expect(screen.getByTestId('pr-draft-result').textContent).toBe(reason))
    expect(screen.getByTestId('pr-draft').dataset.state).toBe('draft')
  })
})
