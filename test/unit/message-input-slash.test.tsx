// The input field's slash menu and attachments (ticket 20) over a mocked bridge: what the user
// does with the keyboard and the chips, and what goes to main.
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Attachment, AttachResult } from '../../src/shared/agent/attachments'
import type { SlashCommand } from '../../src/shared/agent/commands'
import type { WorfyBridge } from '../../src/shared/ipc/channels'
import { matchCommands, slashQuery } from '../../src/renderer/session/SlashMenu'
import type { OutgoingMessage } from '../../src/renderer/session/MessageInput'

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

async function mount(onSend: (message: OutgoingMessage) => Promise<string | null> = () => Promise.resolve(null)) {
  const { MessageInput } = await import('../../src/renderer/session/MessageInput')
  const send = vi.fn(onSend)
  render(<MessageInput sessionId="s" busy={false} history={[]} recipient="Orchestrator" onSend={send} onInterrupt={() => undefined} />)
  const field = screen.getByRole('textbox', { name: 'Message Orchestrator' }) as HTMLTextAreaElement
  const type = async (value: string) => {
    await act(async () => {
      fireEvent.change(field, { target: { value } })
    })
  }
  const key = async (name: string, init: Record<string, unknown> = {}) => {
    await act(async () => {
      fireEvent.keyDown(field, { key: name, ...init })
    })
  }
  return { field, send, type, key }
}

const items = () => screen.queryAllByTestId('slash-item').map((item) => item.getAttribute('data-name'))
const selected = () => screen.getAllByTestId('slash-item').find((item) => item.getAttribute('aria-selected') === 'true')?.getAttribute('data-name')

describe('slashQuery and matchCommands', () => {
  it('reads the command name only while it is being typed', () => {
    expect(slashQuery('/')).toBe('')
    expect(slashQuery('/sh')).toBe('sh')
    expect(slashQuery('/ship-ticket ')).toBeNull()
    expect(slashQuery('say /sh')).toBeNull()
    expect(slashQuery('')).toBeNull()
  })

  it('lists names that start with the query first, then names that hold it, ignoring case', () => {
    expect(matchCommands(COMMANDS, 'SH').map((each) => each.name)).toEqual(['ship-ticket', 'reship'])
    expect(matchCommands(COMMANDS, '').map((each) => each.name)).toEqual(COMMANDS.map((each) => each.name))
    expect(matchCommands(COMMANDS, 'zzz')).toEqual([])
  })
})

describe('the slash menu', () => {
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

  it('stays closed without a match, and when the slash is not at the start', async () => {
    const { type } = await mount()
    await type('/zzz')
    await type('hello /sh')
    expect(screen.queryByTestId('slash-menu')).toBeNull()
  })
})

describe('attachments', () => {
  const image: Attachment = { kind: 'image', name: 'shot.png', mediaType: 'image/png', size: 2048, data: 'AAAA' }
  const file: Attachment = { kind: 'file', name: 'notes.txt', path: '/data/alpha/attachments/1/notes.txt', size: 5, copied: true }

  it('"+" shows each taken file as a chip and names a refused one; Return sends them with the text', async () => {
    const results: AttachResult[] = [
      { ok: true, attachment: image },
      { ok: false, name: 'big.png', error: 'big.png is too large: images go up to 5 MB' },
      { ok: true, attachment: file },
    ]
    answers['agent.attachPick'] = () => ({ results })
    const { type, key, send } = await mount()
    await act(async () => {
      fireEvent.click(screen.getByTestId('input-attach'))
    })
    await vi.waitFor(() => expect(screen.getAllByTestId('attachment-chip')).toHaveLength(2))
    expect(screen.getAllByTestId('attachment-chip').map((chip) => chip.textContent)).toEqual(['shot.png2 KB×', 'notes.txt5 B×'])
    expect(screen.getByRole('alert').textContent).toBe('big.png is too large: images go up to 5 MB')
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

  it('a dropped file goes to main as bytes; one too big is refused without being read', async () => {
    answers['agent.attach'] = () => ({ results: [{ ok: true, attachment: file }] })
    await mount()
    const box = screen.getByTestId('message-input-box')
    const small = new File(['notes'], 'notes.txt', { type: 'text/plain' })
    const big = new File(['x'], 'huge.bin')
    Object.defineProperty(big, 'size', { value: 20 * 1024 * 1024 + 1 })
    await act(async () => {
      fireEvent.drop(box, { dataTransfer: { files: [small, big], types: ['Files'] } })
    })
    await vi.waitFor(() => expect(screen.getAllByTestId('attachment-chip')).toHaveLength(1))
    expect(asked.find((each) => each.channel === 'agent.attach')?.input).toEqual({ sessionId: 's', sources: [{ kind: 'dropped', name: 'notes.txt', data: 'bm90ZXM=' }] })
    expect(screen.getByRole('alert').textContent).toBe('huge.bin is too large: files from outside the Project go up to 20 MB')
  })
})
