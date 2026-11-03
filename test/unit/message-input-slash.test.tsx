// The input field's slash menu and attachments (ticket 20) over a mocked bridge: what the user
// does with the keyboard and the chips, and what goes to main.
import { act, fireEvent, render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Attachment, AttachResult } from '../../src/shared/agent/attachments'
import type { SlashCommand } from '../../src/shared/agent/commands'
import type { WorfyBridge } from '../../src/shared/ipc/channels'
import { matchCommands, putCommand, slashToken } from '../../src/renderer/session/SlashMenu'
import type { MessageInputHandle, OutgoingMessage } from '../../src/renderer/session/MessageInput'

const COMMANDS: SlashCommand[] = [
  { name: 'compact', description: 'Clear the conversation but keep a summary', argumentHint: '', kind: 'command' },
  { name: 'ship-ticket', description: 'Carry one ticket from claim to the finish', argumentHint: '<epic> <NN>', kind: 'skill' },
  { name: 'epic-wave', description: 'Run wave N of an epic', argumentHint: '', kind: 'skill' },
  { name: 'reship', description: 'Holds "ship" in the middle', argumentHint: '', kind: 'command' },
]

const asked: { channel: string; input: unknown }[] = []
let answers: Record<string, (input: unknown) => unknown>

beforeEach(() => {
  vi.resetModules()
  asked.length = 0
  answers = {
    'agent.commands': () => ({ commands: COMMANDS }),
    'agent.controls': () => ({ settings: { model: null, effort: null, permissionMode: 'bypassPermissions' }, queue: { items: [], paused: false } }),
    'agent.models': () => ({ models: [] }),
  }
  ;(globalThis as { worfy?: WorfyBridge }).worfy = {
    invoke: (channel: string, input: unknown) => {
      asked.push({ channel, input })
      const answer = answers[channel]
      return Promise.resolve(answer ? { ok: true, value: answer(input) } : { ok: false, error: `no ${channel}` })
    },
    on: () => 1,
    off: () => undefined,
  } as unknown as WorfyBridge
})

afterEach(() => {
  delete (globalThis as { worfy?: WorfyBridge }).worfy
})

interface MountOptions {
  busy?: boolean
  history?: readonly string[]
}

/** The field's handle: what the chat around it calls with dropped files (session/chat-drop.tsx). */
const input = createRef<MessageInputHandle>()

async function mount(onSend: (message: OutgoingMessage) => Promise<string | null> = () => Promise.resolve(null), { busy = false, history = [] }: MountOptions = {}) {
  const { MessageInput } = await import('../../src/renderer/session/MessageInput')
  const send = vi.fn(onSend)
  const interrupt = vi.fn()
  render(<MessageInput ref={input} sessionId="s" busy={busy} history={history} recipient="Orchestrator" onSend={send} onInterrupt={interrupt} />)
  const field = screen.getByRole('textbox', { name: 'Message Orchestrator' }) as HTMLTextAreaElement
  const type = async (value: string) => {
    await act(async () => {
      fireEvent.change(field, { target: { value } })
    })
  }
  /** Presses a key in the field; true when nothing took it (its default was not prevented). */
  const key = async (name: string, init: Record<string, unknown> = {}) => {
    let free = true
    await act(async () => {
      free = fireEvent.keyDown(field, { key: name, ...init })
    })
    return free
  }
  /** Puts the caret at `at`, as an arrow key or a click does, and lets the field read it. */
  const caretTo = async (at: number, how: 'key' | 'click' = 'key') => {
    await act(async () => {
      field.setSelectionRange(at, at)
      if (how === 'key') fireEvent.keyUp(field, { key: 'ArrowLeft' })
      else fireEvent.click(field)
    })
  }
  /** Changes the text as a key in the middle of it does: the caret stays where the edit was, not at the end. */
  const typeAt = async (value: string, at: number) => {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(field, value)
      field.setSelectionRange(at, at)
      field.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }
  /** Selects `from`..`to` in the field, as a double click on a word or Shift with an arrow does. */
  const select = async (from: number, to: number) => {
    await act(async () => {
      field.setSelectionRange(from, to)
      fireEvent.keyUp(field, { key: 'ArrowRight', shiftKey: true })
    })
  }
  return { field, send, interrupt, type, key, caretTo, typeAt, select }
}

const items = () => screen.queryAllByTestId('slash-item').map((item) => item.getAttribute('data-name'))
const selected = () => screen.getAllByTestId('slash-item').find((item) => item.getAttribute('aria-selected') === 'true')?.getAttribute('data-name')

describe('slashToken, putCommand and matchCommands', () => {
  it('reads the command name only while it is being typed', () => {
    expect(slashToken('/', 1)).toEqual({ start: 0, end: 1, query: '' })
    expect(slashToken('/sh', 3)).toEqual({ start: 0, end: 3, query: 'sh' })
    expect(slashToken('/ship-ticket ', 13)).toBeNull()
    expect(slashToken('', 0)).toBeNull()
  })

  it('finds the command word at the caret: at the start, after a space or a line break, never inside a word', () => {
    expect(slashToken('say /sh', 7)).toEqual({ start: 4, end: 7, query: 'sh' })
    expect(slashToken('say\t/sh', 7)).toEqual({ start: 4, end: 7, query: 'sh' })
    expect(slashToken('first line\n/ep', 14)).toEqual({ start: 11, end: 14, query: 'ep' })
    expect(slashToken('a/b', 3)).toBeNull()
    expect(slashToken('see src/foo', 11)).toBeNull()
    expect(slashToken('say/', 4)).toBeNull()
  })

  it('reads the word at the caret, not to the end of the text: the word runs on to the next space', () => {
    // The caret in the middle of the text: the word before it counts, the text after it does not.
    expect(slashToken('fix /sh then more', 7)).toEqual({ start: 4, end: 7, query: 'sh' })
    expect(slashToken('fix /sh then more', 17)).toBeNull()
    // The caret inside the word: the filter is the whole word, which ends at the space.
    expect(slashToken('/ship-ticket now', 3)).toEqual({ start: 0, end: 12, query: 'ship-ticket' })
    expect(slashToken('/cost', 3)).toEqual({ start: 0, end: 5, query: 'cost' })
    expect(slashToken('/cost', 1)).toEqual({ start: 0, end: 5, query: 'cost' })
    // A space between the slash and the caret: no command word.
    expect(slashToken('/sh x', 5)).toBeNull()
    expect(slashToken('/sh ', 4)).toBeNull()
    // A caret past the end is read at the end.
    expect(slashToken('/sh', 10)).toEqual({ start: 0, end: 3, query: 'sh' })
  })

  it('putCommand replaces only the word and puts the caret right after the space', () => {
    expect(putCommand('say /sh', { start: 4, end: 7, query: 'sh' }, 'ship-ticket')).toEqual({ text: 'say /ship-ticket ', caret: 17 })
    expect(putCommand('fix /sh then', { start: 4, end: 7, query: 'sh' }, 'ship-ticket')).toEqual({ text: 'fix /ship-ticket then', caret: 17 })
    expect(putCommand('/sh\nnext', { start: 0, end: 3, query: 'sh' }, 'ship-ticket')).toEqual({ text: '/ship-ticket \nnext', caret: 13 })
    expect(putCommand('/ship-ticket', { start: 0, end: 12, query: 'sh' }, 'ship-ticket')).toEqual({ text: '/ship-ticket ', caret: 13 })
  })

  it('lists names that start with the query first, then names that hold it, ignoring case', () => {
    expect(matchCommands(COMMANDS, 'SH').map((each) => each.name)).toEqual(['ship-ticket', 'reship'])
    expect(matchCommands(COMMANDS, '').map((each) => each.name)).toEqual(COMMANDS.map((each) => each.name))
    expect(matchCommands(COMMANDS, 'zzz')).toEqual([])
  })
})

// worfy-windows ticket 11: the hints name the Enter key of the system (src/renderer/session/hints.ts).
describe('the key hints of the field', () => {
  it.each([
    ['mac', '/ commands · ⇧⏎ new line · ↑↓ history', '↑↓ navigate · ⏎ select · esc'],
    ['windows', '/ commands · Shift+Enter new line · ↑↓ history', '↑↓ navigate · Enter select · esc'],
  ] as const)('on %s the field shows "%s" and the slash menu "%s"', async (system, composer, slash) => {
    document.documentElement.dataset.platform = system
    const { type } = await mount()
    expect(document.querySelector('.w-composer__hint')?.textContent).toBe(composer)
    await type('/sh')
    await vi.waitFor(() => expect(items()).toEqual(['ship-ticket', 'reship']))
    expect(screen.getByTestId('slash-menu').querySelector('.w-slash__head .w-mono')?.textContent).toBe(slash)
  })
})

describe('the slash menu', () => {
  // worfy-multi-vendor ticket 25: the capabilities of the Session's Vendor (src/shared/vendors/capabilities.ts).
  it('a Vendor whose list is not complete gets a last, inactive line, its reason in the tooltip', async () => {
    const { CLAUDE_CAPABILITIES } = await import('../../src/shared/vendors/capabilities')
    const reason = 'The other commands work only in the agent\'s own terminal.'
    answers['agent.capabilities'] = () => ({ ...CLAUDE_CAPABILITIES, commandsComplete: false, unsupported: { ...CLAUDE_CAPABILITIES.unsupported, commandsComplete: reason } })
    const { type } = await mount()
    await type('/sh')
    await vi.waitFor(() => expect(screen.queryByTestId('slash-incomplete')).not.toBeNull())
    const note = screen.getByTestId('slash-incomplete')
    expect(note.textContent).toBe('Not every command is listed')
    expect(note.title).toBe(reason)
    expect(note.getAttribute('aria-disabled')).toBe('true')
    expect(items()).toEqual(['ship-ticket', 'reship'])
  })

  it('a Vendor that lists every command gets no such line', async () => {
    const { CLAUDE_CAPABILITIES } = await import('../../src/shared/vendors/capabilities')
    answers['agent.capabilities'] = () => CLAUDE_CAPABILITIES
    const { type } = await mount()
    await type('/sh')
    await vi.waitFor(() => expect(items()).toEqual(['ship-ticket', 'reship']))
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(screen.queryByTestId('slash-incomplete')).toBeNull()
  })

  it('/sh shows /ship-ticket with its description; Tab puts it into the field', async () => {
    const { field, type, key, send } = await mount()
    await type('/sh')
    await vi.waitFor(() => expect(items()).toEqual(['ship-ticket', 'reship']))
    expect(screen.getByRole('listbox').textContent).toContain('Carry one ticket from claim to the finish')
    expect(asked.filter((each) => each.channel === 'agent.commands')).toEqual([{ channel: 'agent.commands', input: { sessionId: 's' } }])
    await key('Tab')
    expect(field.value).toBe('/ship-ticket ')
    expect(screen.queryByTestId('slash-menu')).toBeNull()
    expect(send).not.toHaveBeenCalled()
  })

  it('↑ and ↓ move the selection and wrap; Return picks instead of sending', async () => {
    const { field, type, key, send } = await mount()
    await type('/')
    await vi.waitFor(() => expect(items()).toHaveLength(4))
    expect(selected()).toBe('compact')
    await key('ArrowDown')
    expect(selected()).toBe('ship-ticket')
    await key('ArrowUp')
    await key('ArrowUp')
    expect(selected()).toBe('reship')
    await key('Enter')
    expect(field.value).toBe('/reship ')
    expect(send).not.toHaveBeenCalled()
    // With the menu closed, Return sends.
    await key('Enter')
    expect(send).toHaveBeenCalledWith({ text: '/reship ', attachments: [] })
  })

  it('a click on a row picks it', async () => {
    const { field, type } = await mount()
    await type('/ep')
    await vi.waitFor(() => expect(items()).toEqual(['epic-wave']))
    await act(async () => {
      fireEvent.click(screen.getByTestId('slash-item'))
    })
    expect(field.value).toBe('/epic-wave ')
  })

  it('Escape closes the menu until the field leaves the command name', async () => {
    const { type, key } = await mount()
    await type('/s')
    await vi.waitFor(() => expect(items()).not.toEqual([]))
    await key('Escape')
    expect(screen.queryByTestId('slash-menu')).toBeNull()
    await type('/sh')
    expect(screen.queryByTestId('slash-menu')).toBeNull()
    await type('')
    await type('/sh')
    await vi.waitFor(() => expect(items()).toEqual(['ship-ticket', 'reship']))
  })

  it('Escape on the open menu during a turn closes the menu and does not interrupt; the next Escape does', async () => {
    const { type, key, interrupt } = await mount(undefined, { busy: true })
    await type('/s')
    await vi.waitFor(() => expect(items()).not.toEqual([]))
    expect(await key('Escape')).toBe(false)
    expect(screen.queryByTestId('slash-menu')).toBeNull()
    expect(interrupt).not.toHaveBeenCalled()
    await key('Escape')
    expect(interrupt).toHaveBeenCalledTimes(1)
  })

  it('↑ and ↓ on the open menu move the selection only: the field keeps its text and the caret stays', async () => {
    const { field, type, key } = await mount(undefined, { history: ['first prompt', 'second prompt'] })
    await type('/')
    await vi.waitFor(() => expect(items()).toHaveLength(4))
    expect(await key('ArrowDown')).toBe(false)
    expect(selected()).toBe('ship-ticket')
    expect(await key('ArrowUp')).toBe(false)
    expect(await key('ArrowUp')).toBe(false)
    expect(selected()).toBe('reship')
    expect(field.value).toBe('/')
  })

  it('a slash command brought back from the history opens no menu: ↑/↓ keep stepping and Return sends it', async () => {
    const { field, key, send } = await mount(undefined, { history: ['first prompt', '/compact'] })
    await key('ArrowUp')
    expect(field.value).toBe('/compact')
    // The commands would match: only the history keeps the menu closed.
    await new Promise((settle) => setTimeout(settle, 20))
    expect(screen.queryByTestId('slash-menu')).toBeNull()
    await key('ArrowUp')
    expect(field.value).toBe('first prompt')
    await key('ArrowDown')
    expect(field.value).toBe('/compact')
    await key('Enter')
    expect(send).toHaveBeenCalledWith({ text: '/compact', attachments: [] })
  })

  it('a slash command from the history, once edited, opens the menu again', async () => {
    const { type, key } = await mount(undefined, { history: ['/comp'] })
    await key('ArrowUp')
    await type('/compa')
    await vi.waitFor(() => expect(items()).toEqual(['compact']))
  })

  it('stays closed without a match, and when the slash is inside a word', async () => {
    const { type } = await mount()
    await type('/zzz')
    await type('hello a/sh')
    await type('cd /Users/x')
    await new Promise((settle) => setTimeout(settle, 20))
    expect(screen.queryByTestId('slash-menu')).toBeNull()
  })

  it('opens after text; Return puts the command in place of the word and keeps the text before it', async () => {
    const { field, type, key, send } = await mount()
    await type('please run /sh')
    await vi.waitFor(() => expect(items()).toEqual(['ship-ticket', 'reship']))
    await key('Enter')
    expect(field.value).toBe('please run /ship-ticket ')
    expect(field.selectionStart).toBe('please run /ship-ticket '.length)
    expect(screen.queryByTestId('slash-menu')).toBeNull()
    expect(send).not.toHaveBeenCalled()
  })

  it('follows the caret: a word in the middle of the text opens the menu; a pick keeps the text after it', async () => {
    const { field, type, key, caretTo } = await mount()
    await type('fix /ep then the rest')
    // The caret at the end stands in "rest": no menu.
    await new Promise((settle) => setTimeout(settle, 20))
    expect(screen.queryByTestId('slash-menu')).toBeNull()
    await caretTo(7)
    await vi.waitFor(() => expect(items()).toEqual(['epic-wave']))
    await key('Tab')
    expect(field.value).toBe('fix /epic-wave then the rest')
    expect(field.selectionStart).toBe('fix /epic-wave '.length)
    await vi.waitFor(() => expect(screen.queryByTestId('slash-menu')).toBeNull())
  })

  it('a text the field gets back from a failed send has the caret at its end: the menu follows it there', async () => {
    const { field, type, caretTo } = await mount(() => Promise.resolve('Session s is closed'))
    await type('fix /ep then')
    await caretTo(7)
    await vi.waitFor(() => expect(items()).toEqual(['epic-wave']))
    await act(async () => {
      fireEvent.click(screen.getByTestId('input-send'))
    })
    expect(field.value).toBe('fix /ep then')
    expect(field.selectionStart).toBe(12)
    await new Promise((settle) => setTimeout(settle, 20))
    expect(screen.queryByTestId('slash-menu')).toBeNull()
  })

  it('picking the command a whole word already names leaves the text and moves the caret past its space', async () => {
    const { field, type, key, caretTo } = await mount()
    await type('/compact now')
    // The field has the focus, as when the user types: focusing it again tells nothing.
    await act(async () => {
      field.focus()
    })
    await caretTo(3)
    await vi.waitFor(() => expect(items()).toEqual(['compact']))
    await key('Tab')
    expect(field.value).toBe('/compact now')
    expect(field.selectionStart).toBe(9)
    expect(screen.queryByTestId('slash-menu')).toBeNull()
  })

  it('a caret moved into a finished command filters by the whole word: Return keeps that command', async () => {
    const { field, type, key, caretTo, send } = await mount()
    await type('/reship')
    await caretTo(1)
    // By the part before the caret (nothing) every command would match, /compact first.
    await vi.waitFor(() => expect(items()).toEqual(['reship']))
    await key('Enter')
    expect(field.value).toBe('/reship ')
    expect(send).not.toHaveBeenCalled()
  })

  it('a selection in the field keeps the menu closed and Return sends; a caret in the word opens it again', async () => {
    const { field, type, key, caretTo, select, send } = await mount()
    await type('/reship')
    await vi.waitFor(() => expect(items()).toEqual(['reship']))
    // A double click selects the word after the slash.
    await select(1, 7)
    expect(screen.queryByTestId('slash-menu')).toBeNull()
    expect(await key('Enter')).toBe(false)
    expect(send).toHaveBeenCalledWith({ text: '/reship', attachments: [] })
    await type('/reship')
    await select(1, 7)
    expect(screen.queryByTestId('slash-menu')).toBeNull()
    // The selection did not dismiss the word: a caret back in it opens the menu.
    await caretTo(4)
    await vi.waitFor(() => expect(items()).toEqual(['reship']))
    expect(field.value).toBe('/reship')
  })

  it('a text given back by a failed send ends the selection made before it: the caret at its end opens the menu', async () => {
    const { field, type, select } = await mount(() => Promise.resolve('Session s is closed'))
    await type('/reship')
    await select(1, 4)
    expect(screen.queryByTestId('slash-menu')).toBeNull()
    await act(async () => {
      fireEvent.click(screen.getByTestId('input-send'))
    })
    expect(field.value).toBe('/reship')
    expect([field.selectionStart, field.selectionEnd]).toEqual([7, 7])
    await vi.waitFor(() => expect(items()).toEqual(['reship']))
  })

  it('typing over a selection reads the caret the edit leaves', async () => {
    const { type, typeAt, select } = await mount()
    await type('say hello')
    await select(4, 9)
    await typeAt('say /e', 6)
    await vi.waitFor(() => expect(items()).toEqual(['epic-wave', 'ship-ticket', 'reship']))
  })

  it('a click in the field reads the caret too', async () => {
    const { field, type, caretTo } = await mount()
    await type('/co and more')
    expect(screen.queryByTestId('slash-menu')).toBeNull()
    await caretTo(3, 'click')
    await vi.waitFor(() => expect(items()).toEqual(['compact']))
    await caretTo(field.value.length, 'click')
    expect(screen.queryByTestId('slash-menu')).toBeNull()
  })

  it('Backspace inside a dismissed word in the middle of the text keeps the menu closed', async () => {
    const { type, key, caretTo, typeAt } = await mount()
    await type('one /ep two')
    await caretTo(7)
    await vi.waitFor(() => expect(items()).toEqual(['epic-wave']))
    await key('Escape')
    await typeAt('one /e two', 6)
    await new Promise((settle) => setTimeout(settle, 20))
    expect(screen.queryByTestId('slash-menu')).toBeNull()
  })

  it('Escape holds while the caret stays in the word; leaving it and coming back, or another word, opens the menu again', async () => {
    const { type, key, caretTo } = await mount()
    await type('one /sh two /ep')
    await vi.waitFor(() => expect(items()).toEqual(['epic-wave']))
    await key('Escape')
    expect(screen.queryByTestId('slash-menu')).toBeNull()
    // Inside the same word, typed on or with the caret moved, the menu stays closed.
    await caretTo(14)
    expect(screen.queryByTestId('slash-menu')).toBeNull()
    await type('one /sh two /e')
    expect(screen.queryByTestId('slash-menu')).toBeNull()
    // Another word opens it.
    await caretTo(7)
    await vi.waitFor(() => expect(items()).toEqual(['ship-ticket', 'reship']))
    // Out of any word, then back into the dismissed one: it opens again.
    await caretTo(9)
    expect(screen.queryByTestId('slash-menu')).toBeNull()
    await caretTo(14)
    await vi.waitFor(() => expect(items()).toEqual(['epic-wave', 'ship-ticket', 'reship']))
  })
})

describe('attachments', () => {
  const image: Attachment = { kind: 'image', name: 'shot.png', mediaType: 'image/png', size: 2048, data: 'AAAA' }
  const file: Attachment = { kind: 'file', name: 'notes.txt', path: '/data/alpha/attachments/1/notes.txt', size: 5, copied: true }

  it('"+" shows each taken file as a chip and names a refused one; Return sends them with the text', async () => {
    const results: AttachResult[] = [
      { ok: true, attachment: image },
      { ok: false, name: 'big.png', error: 'big.png is too large: images go up to 3.75 MB' },
      { ok: true, attachment: file },
    ]
    answers['agent.attachPick'] = () => ({ results })
    const { type, key, send } = await mount()
    await act(async () => {
      fireEvent.click(screen.getByTestId('input-attach'))
    })
    await vi.waitFor(() => expect(screen.getAllByTestId('attachment-chip')).toHaveLength(2))
    expect(screen.getAllByTestId('attachment-chip').map((chip) => chip.textContent)).toEqual(['shot.png2 KB×', 'notes.txt5 B×'])
    expect(screen.getByRole('alert').textContent).toBe('big.png is too large: images go up to 3.75 MB')
    await type('look')
    await key('Enter')
    expect(send).toHaveBeenCalledWith({ text: 'look', attachments: [image, file] })
    expect(screen.queryAllByTestId('attachment-chip')).toHaveLength(0)
  })

  it('a removed chip does not go; attachments alone can be sent', async () => {
    answers['agent.attachPick'] = () => ({ results: [{ ok: true, attachment: image }, { ok: true, attachment: file }] })
    const { send } = await mount()
    await act(async () => {
      fireEvent.click(screen.getByTestId('input-attach'))
    })
    await vi.waitFor(() => expect(screen.getAllByTestId('attachment-chip')).toHaveLength(2))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Remove shot.png' }))
    })
    expect((screen.getByTestId('input-send') as HTMLButtonElement).disabled).toBe(false)
    await act(async () => {
      fireEvent.click(screen.getByTestId('input-send'))
    })
    expect(send).toHaveBeenCalledWith({ text: '', attachments: [file] })
  })

  it('a failed send gives the chips back', async () => {
    answers['agent.attachPick'] = () => ({ results: [{ ok: true, attachment: file }] })
    const { type, key } = await mount(() => Promise.resolve('Session s is closed'))
    await act(async () => {
      fireEvent.click(screen.getByTestId('input-attach'))
    })
    await vi.waitFor(() => expect(screen.getAllByTestId('attachment-chip')).toHaveLength(1))
    await type('x')
    await key('Enter')
    expect(screen.getAllByTestId('attachment-chip')).toHaveLength(1)
    expect(screen.getByRole('alert').textContent).toBe('Session s is closed')
  })

  it('while a message with 20 attachments is being sent, nothing more is attached: they may come back', async () => {
    const twenty = Array.from({ length: 20 }, (_, index): AttachResult => ({ ok: true, attachment: { ...file, name: `n${index}.txt` } }))
    answers['agent.attachPick'] = () => ({ results: twenty })
    let finish: (failure: string | null) => void = () => undefined
    const { key } = await mount(() => new Promise((resolve) => (finish = resolve)))
    await act(async () => {
      fireEvent.click(screen.getByTestId('input-attach'))
    })
    await vi.waitFor(() => expect(screen.getAllByTestId('attachment-chip')).toHaveLength(20))
    await key('Enter')
    expect(screen.queryAllByTestId('attachment-chip')).toHaveLength(0)

    answers['agent.attachPick'] = () => ({ results: [{ ok: true, attachment: { ...file, name: 'extra.txt' } }] })
    await act(async () => {
      fireEvent.click(screen.getByTestId('input-attach'))
    })
    await vi.waitFor(() => expect(screen.getByRole('alert').textContent).toBe('A message takes up to 20 attachments: extra.txt left out'))
    expect(screen.queryAllByTestId('attachment-chip')).toHaveLength(0)

    await act(async () => finish('Session s is closed'))
    expect(screen.getAllByTestId('attachment-chip')).toHaveLength(20)
  })

  it('a pasted image goes to main as base64; pasted text stays text', async () => {
    answers['agent.attach'] = () => ({ results: [{ ok: true, attachment: image }] })
    const { field } = await mount()
    const png = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'image.png', { type: 'image/png' })
    await act(async () => {
      fireEvent.paste(field, { clipboardData: { files: [png], types: ['Files'] } })
    })
    await vi.waitFor(() => expect(screen.getAllByTestId('attachment-chip')).toHaveLength(1))
    expect(asked.find((each) => each.channel === 'agent.attach')?.input).toEqual({ sessionId: 's', sources: [{ kind: 'pasted', name: 'image.png', data: 'iVBORw==' }] })

    const before = asked.length
    await act(async () => {
      fireEvent.paste(field, { clipboardData: { files: [], types: ['text/plain'] } })
    })
    expect(asked.length).toBe(before)
  })

  it('takes 20 attachments at most: what comes past that is left out and named', async () => {
    const many = Array.from({ length: 21 }, (_, index): AttachResult => ({ ok: true, attachment: { ...file, name: `f${index}.txt`, path: `/data/alpha/attachments/${index}/f${index}.txt` } }))
    answers['agent.attachPick'] = () => ({ results: many })
    const { key, type, send } = await mount()
    await act(async () => {
      fireEvent.click(screen.getByTestId('input-attach'))
    })
    await vi.waitFor(() => expect(screen.getAllByTestId('attachment-chip')).toHaveLength(20))
    expect(screen.getByRole('alert').textContent).toBe('A message takes up to 20 attachments: f20.txt left out')

    // A full message reads no more dropped files and asks main nothing.
    const before = asked.length
    await act(async () => {
      input.current?.drop([new File(['x'], 'more.txt')])
    })
    expect(asked.length).toBe(before)
    expect(screen.getByRole('alert').textContent).toBe('A message takes up to 20 attachments: more.txt left out')
    expect(screen.getAllByTestId('attachment-chip')).toHaveLength(20)

    await type('all')
    await key('Enter')
    expect(send.mock.calls[0]?.[0].attachments).toHaveLength(20)
  })

  it('a dropped file goes to main as bytes; one too big is refused without being read', async () => {
    answers['agent.attach'] = () => ({ results: [{ ok: true, attachment: file }] })
    await mount()
    const small = new File(['notes'], 'notes.txt', { type: 'text/plain' })
    const big = new File(['x'], 'huge.bin')
    Object.defineProperty(big, 'size', { value: 20 * 1024 * 1024 + 1 })
    await act(async () => {
      input.current?.drop([small, big])
    })
    await vi.waitFor(() => expect(screen.getAllByTestId('attachment-chip')).toHaveLength(1))
    expect(asked.find((each) => each.channel === 'agent.attach')?.input).toEqual({ sessionId: 's', sources: [{ kind: 'dropped', name: 'notes.txt', data: 'bm90ZXM=' }] })
    expect(screen.getByRole('alert').textContent).toBe('huge.bin is too large: files from outside the Project go up to 20 MB')
  })
})
