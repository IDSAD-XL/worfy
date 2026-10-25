// Attachments in the chat (worfy-ui ticket 28): a sent message shows its images as thumbnails that
// open at full size, and its documents as chips with a type icon, the format and the name — no
// paths, no attachment lines; an image without a copy is a chip, never a broken picture. Files
// dropped anywhere on the chat go to the input field; the window opens no file dropped elsewhere.
import { act, cleanup, createEvent, fireEvent, render, screen, within } from '@testing-library/react'
import { createRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MessageAttachment } from '../../src/shared/agent/attachments'
import type { AgentEvent } from '../../src/shared/agent/events'
import type { WorfyBridge } from '../../src/shared/ipc/channels'
import { guardFileDrops } from '../../src/renderer/drop-guard'
import { dropRefusal, useChatDrop } from '../../src/renderer/session/chat-drop'
import { foldTranscript } from '../../src/renderer/session/fold'
import { documentKind, formatLabel } from '../../src/renderer/session/attachment-format'
import type { MessageInputHandle } from '../../src/renderer/session/MessageInput'
import { Transcript } from '../../src/renderer/session/Transcript'
import { parseTranscriptLine } from '../../src/shared/transcript/parse'

// The window's Machine (null: this one) and the read-only hint of the screen, as the test sets them.
const screenState = vi.hoisted(() => ({ machine: null as string | null, readOnly: null as string | null }))
vi.mock('../../src/renderer/ipc', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/renderer/ipc')>()),
  windowMachine: () => screenState.machine,
}))
vi.mock('../../src/renderer/projects/useProjects', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/renderer/projects/useProjects')>()),
  useReadOnly: () => screenState.readOnly,
}))

afterEach(() => {
  screenState.machine = null
  screenState.readOnly = null
})

const REF = 'ab'.repeat(32)
const shot: MessageAttachment = { kind: 'image', name: 'shot.png', mediaType: 'image/png', ref: REF }
const spec: MessageAttachment = { kind: 'file', name: 'spec.pdf', ext: 'pdf', size: 2048 }
const notes: MessageAttachment = { kind: 'file', name: 'notes.md', ext: 'md' }
const sent = (text: string, attachments: MessageAttachment[]): AgentEvent => ({ type: 'notice', kind: 'user', text, attachments })

afterEach(cleanup)

describe('a sent message with attachments', () => {
  it('folds into a prompt row that keeps them; a message without has none', () => {
    const [row] = foldTranscript([sent('look', [shot, spec])])
    expect(row).toMatchObject({ kind: 'prompt', text: 'look', attachments: [shot, spec] })
    expect(foldTranscript([{ type: 'notice', kind: 'user', text: 'plain' }])[0]).toMatchObject({ kind: 'prompt', attachments: [] })
  })

  it('the event store keeps a prompt\'s attachments on its user notice', async () => {
    const store = await import('../../src/renderer/session/store')
    store.acceptAgentEvent({ sessionId: 'with-attachments', event: { type: 'prompt', text: 'look', attachments: [shot, spec] } })
    store.acceptAgentEvent({ sessionId: 'with-attachments', event: { type: 'prompt', text: 'plain', attachments: [] } })
    const events = store.useSessionLogs.getState().logs['with-attachments']?.events ?? []
    expect(events.map((event) => ({ ...event, at: undefined }))).toEqual([
      { type: 'notice', kind: 'user', text: 'look', attachments: [shot, spec] },
      { type: 'notice', kind: 'user', text: 'plain' },
    ])
  })

  it('shows a thumbnail of the image from its copy and a chip of each document: icon, format, name, size; no path', () => {
    render(<Transcript events={[sent('what is this?', [shot, spec, notes])]} />)
    const row = screen.getByTestId('transcript-prompt')
    expect(within(row).getByText('what is this?')).toBeTruthy()
    const image = within(row).getByTestId('message-image').querySelector('img')
    expect(image?.getAttribute('src')).toBe(`worfy-image://attachments/${REF}.png`)
    expect(image?.getAttribute('alt')).toBe('shot.png')
    const [pdf, md] = within(row).getAllByTestId('message-file')
    expect(pdf?.dataset.docKind).toBe('pdf')
    expect(pdf?.querySelector('[data-icon="pdf"]')).not.toBeNull()
    expect(pdf?.textContent).toBe('PDFspec.pdf2 KB')
    expect(md?.dataset.docKind).toBe('text')
    expect(md?.textContent).toBe('MDnotes.md')
    expect(row.textContent).not.toMatch(/Attached (files|images)|\//)
  })

  it('in a window on a Linked machine, takes the image from that Machine: its label in the address', () => {
    screenState.machine = '01234567-89AB-cdef-0123-456789abcdef'
    render(<Transcript events={[sent('there', [shot])]} />)
    const image = screen.getByTestId('message-image').querySelector('img')
    expect(image?.getAttribute('src')).toBe(`worfy-image://attachments.0123456789abcdef0123456789abcdef/${REF}.png`)
  })

  it('in a window on a Machine whose id gives no label, an image is a chip', () => {
    screenState.machine = 'not-a-uuid'
    render(<Transcript events={[sent('there', [shot])]} />)
    expect(screen.queryByTestId('message-image')).toBeNull()
    expect(screen.getByTestId('message-image-chip').textContent).toBe('PNGshot.png')
  })

  it('a message read back from a transcript shows no path and no attachment line either', () => {
    const line = JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' } },
          { type: 'text', text: 'read\n\nAttached files: /Users/a/Downloads/spec.pdf, /p/build.log\n\nAttached images: shot.png' },
        ],
      },
    })
    render(<Transcript events={parseTranscriptLine(line).map((entry) => entry.event)} />)
    const row = screen.getByTestId('transcript-prompt')
    expect(within(row).getAllByTestId('message-file').map((chip) => chip.textContent)).toEqual(['PDFspec.pdf', 'LOGbuild.log'])
    expect(within(row).getByTestId('message-image-chip').textContent).toBe('PNGshot.png')
    expect(row.textContent).not.toContain('/Users/a')
    expect(row.textContent).not.toContain('Attached')
  })

  it('an image with no copy is a chip with its name and format, not a picture', () => {
    render(<Transcript events={[sent('', [{ ...shot, ref: null }])]} />)
    const row = screen.getByTestId('transcript-prompt')
    expect(within(row).queryByRole('img')).toBeNull()
    expect(within(row).getByTestId('message-image-chip').textContent).toBe('PNGshot.png')
    // No text was typed: no empty bubble above the chip.
    expect(row.querySelector('.w-tr__prompt')).toBeNull()
  })

  it('an image whose copy does not load becomes the same chip', () => {
    render(<Transcript events={[sent('x', [shot])]} />)
    const image = screen.getByTestId('message-image').querySelector('img') as HTMLImageElement
    fireEvent.error(image)
    expect(screen.queryByTestId('message-image')).toBeNull()
    expect(screen.getByTestId('message-image-chip').textContent).toBe('PNGshot.png')
  })

  it('a click on the thumbnail opens the image at full size; Escape closes it and gives the focus back', () => {
    render(<Transcript events={[sent('x', [shot])]} />)
    const thumbnail = screen.getByTestId('message-image')
    thumbnail.focus()
    fireEvent.click(thumbnail)
    const overlay = screen.getByTestId('image-overlay')
    expect(overlay.getAttribute('role')).toBe('dialog')
    expect(document.activeElement).toBe(overlay)
    expect(screen.getByTestId('image-overlay-image').getAttribute('src')).toBe(`worfy-image://attachments/${REF}.png`)
    const outside = vi.fn()
    document.addEventListener('keydown', outside)
    fireEvent.keyDown(overlay, { key: 'Escape' })
    document.removeEventListener('keydown', outside)
    expect(screen.queryByTestId('image-overlay')).toBeNull()
    // Escape stopped at the picture: the input field does not take it for Interrupt.
    expect(outside).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(thumbnail)
    fireEvent.click(thumbnail)
    fireEvent.click(screen.getByTestId('image-overlay-close'))
    expect(screen.queryByTestId('image-overlay')).toBeNull()
    fireEvent.click(thumbnail)
    fireEvent.keyDown(screen.getByTestId('image-overlay'), { key: 'Enter' })
    expect(screen.getByTestId('image-overlay')).toBeTruthy()
    fireEvent.click(screen.getByTestId('image-overlay'))
    expect(screen.queryByTestId('image-overlay')).toBeNull()
  })

  it.each([
    ['pdf', 'pdf'],
    ['md', 'text'],
    ['txt', 'text'],
    ['docx', 'text'],
    ['ts', 'code'],
    ['py', 'code'],
    ['json', 'code'],
    ['csv', 'sheet'],
    ['xlsx', 'sheet'],
    ['zip', 'archive'],
    ['gz', 'archive'],
    ['bin', 'other'],
    ['', 'other'],
  ])('a .%s document gets the %s icon', (ext, kind) => {
    expect(documentKind(ext)).toBe(kind)
  })

  it('names the format by the extension in capitals, FILE without one', () => {
    expect(formatLabel('pdf')).toBe('PDF')
    expect(formatLabel('')).toBe('FILE')
  })
})

/** A chat of one element with the drop handlers, as the Session view has it. */
function Chat({ refusal, onFiles }: { refusal: string | null; onFiles: (files: File[]) => void }) {
  const drop = useChatDrop(refusal, onFiles)
  return (
    <section data-testid="chat" {...drop.handlers}>
      {drop.overlay}
      <div data-testid="rows">rows</div>
    </section>
  )
}

/** A dragleave towards `to`: jsdom has no DragEvent, and its Event takes no relatedTarget. */
function leave(from: Element, to: EventTarget | null) {
  const event = createEvent.dragLeave(from, { dataTransfer: { types: ['Files'], files: [] } })
  Object.defineProperty(event, 'relatedTarget', { value: to })
  fireEvent(from, event)
}

const files = (...names: string[]) => names.map((name) => new File(['x'], name))
const dragData = (list: File[], types = ['Files']) => ({ types, files: list, dropEffect: 'none' })

describe('the chat as a drop target', () => {
  it('shows «Drop files to attach» while files are dragged over it, and hands the dropped files on', () => {
    const onFiles = vi.fn()
    render(<Chat refusal={null} onFiles={onFiles} />)
    const chat = screen.getByTestId('chat')
    const data = dragData(files('a.png', 'b.pdf'))
    expect(fireEvent.dragOver(screen.getByTestId('rows'), { dataTransfer: data })).toBe(false)
    expect(data.dropEffect).toBe('copy')
    expect(screen.getByTestId('chat-drop-zone').textContent).toBe('Drop files to attach')
    // Moving onto a row inside is not leaving.
    leave(chat, screen.getByTestId('rows'))
    expect(screen.getByTestId('chat-drop-zone')).toBeTruthy()
    expect(fireEvent.drop(screen.getByTestId('rows'), { dataTransfer: data })).toBe(false)
    expect(onFiles).toHaveBeenCalledWith(data.files)
    expect(screen.queryByTestId('chat-drop-zone')).toBeNull()
  })

  it('hides the target when the drag leaves the chat', () => {
    render(<Chat refusal={null} onFiles={vi.fn()} />)
    fireEvent.dragOver(screen.getByTestId('chat'), { dataTransfer: dragData(files('a.png')) })
    leave(screen.getByTestId('chat'), document.body)
    expect(screen.queryByTestId('chat-drop-zone')).toBeNull()
  })

  it('a chat that takes no files says why, the cursor says no, and the drop still reaches the field to say so', () => {
    const onFiles = vi.fn()
    const why = dropRefusal(null, null)
    render(<Chat refusal={why} onFiles={onFiles} />)
    const data = dragData(files('a.png'))
    fireEvent.dragOver(screen.getByTestId('chat'), { dataTransfer: data })
    expect(data.dropEffect).toBe('none')
    expect(screen.getByTestId('chat-drop-zone').textContent).toBe('The Session is not running: files cannot be attached')
    expect(screen.getByTestId('chat-drop-zone').dataset.refused).toBe('true')
    expect(fireEvent.drop(screen.getByTestId('chat'), { dataTransfer: data })).toBe(false)
    expect(onFiles).toHaveBeenCalledTimes(1)
  })

  it('takes no part in a drag of text or a Node', () => {
    const onFiles = vi.fn()
    render(<Chat refusal={null} onFiles={onFiles} />)
    expect(fireEvent.dragOver(screen.getByTestId('chat'), { dataTransfer: dragData([], ['text/plain']) })).toBe(true)
    expect(screen.queryByTestId('chat-drop-zone')).toBeNull()
    expect(fireEvent.drop(screen.getByTestId('chat'), { dataTransfer: dragData([], ['text/plain']) })).toBe(true)
    expect(onFiles).not.toHaveBeenCalled()
  })

  it('says why: a read-only screen first, then a Session that is not running', () => {
    expect(dropRefusal('s', null)).toBeNull()
    expect(dropRefusal(null, null)).toBe('The Session is not running: files cannot be attached')
    expect(dropRefusal('s', 'Read-only: another window edits')).toBe('Read-only: another window edits')
    expect(dropRefusal(null, 'Read-only: another window edits')).toBe('Read-only: another window edits')
  })
})

describe('the input field with files dropped while it takes none', () => {
  const asked: string[] = []
  beforeEach(() => {
    asked.length = 0
    ;(globalThis as { worfy?: WorfyBridge }).worfy = {
      invoke: (channel: string) => {
        asked.push(channel)
        return Promise.resolve({ ok: false, error: `no ${channel}` })
      },
      on: () => 1,
      off: () => undefined,
    } as unknown as WorfyBridge
  })
  afterEach(() => {
    delete (globalThis as { worfy?: WorfyBridge }).worfy
  })

  it('takes none, asks main nothing, and says why under the field', async () => {
    const { MessageInput } = await import('../../src/renderer/session/MessageInput')
    const input = createRef<MessageInputHandle>()
    render(<MessageInput ref={input} sessionId={null} busy={false} history={[]} recipient="Orchestrator" onSend={() => Promise.resolve(null)} onInterrupt={() => undefined} />)
    await act(async () => {
      input.current?.drop(files('a.png'))
    })
    expect(screen.getByTestId('input-error').textContent).toBe('The Session is not running: files cannot be attached')
    expect(screen.queryAllByTestId('attachment-chip')).toHaveLength(0)
    expect(asked.filter((channel) => channel === 'agent.attach')).toEqual([])
  })

  const dropOnRunning = async () => {
    const { MessageInput } = await import('../../src/renderer/session/MessageInput')
    const input = createRef<MessageInputHandle>()
    render(<MessageInput ref={input} sessionId="s1" busy={false} history={[]} recipient="Orchestrator" onSend={() => Promise.resolve(null)} onInterrupt={() => undefined} />)
    await act(async () => {
      input.current?.drop(files('a.png'))
      // Reading the file and asking main take a few turns of the event loop.
      await new Promise((settle) => setTimeout(settle, 50))
    })
  }

  it('with its Session running, asks main to check a dropped file', async () => {
    await dropOnRunning()
    expect(asked.filter((channel) => channel === 'agent.attach')).toEqual(['agent.attach'])
  })

  it('a drop of no files keeps the error under the field', async () => {
    const { MessageInput } = await import('../../src/renderer/session/MessageInput')
    const input = createRef<MessageInputHandle>()
    render(<MessageInput ref={input} sessionId="s1" busy={false} history={[]} recipient="Orchestrator" onSend={() => Promise.resolve(null)} onInterrupt={() => undefined} />)
    // main refuses the first file (the bridge here answers every call with an error).
    await act(async () => {
      input.current?.drop(files('a.png'))
      await new Promise((settle) => setTimeout(settle, 50))
    })
    expect(screen.getByTestId('input-error').textContent).toBe('no agent.attach')
    await act(async () => {
      input.current?.drop([])
      await new Promise((settle) => setTimeout(settle, 50))
    })
    expect(screen.getByTestId('input-error').textContent).toBe('no agent.attach')
    expect(asked.filter((channel) => channel === 'agent.attach')).toEqual(['agent.attach'])
  })

  it('on a read-only screen takes none, though its Session runs, and says why', async () => {
    screenState.readOnly = 'Read-only: the Linked machine gives this Machine read-only access'
    await dropOnRunning()
    expect(screen.getByTestId('input-error').textContent).toBe('Read-only: the Linked machine gives this Machine read-only access')
    expect(screen.queryAllByTestId('attachment-chip')).toHaveLength(0)
    expect(asked.filter((channel) => channel === 'agent.attach')).toEqual([])
  })
})

describe('the window guard against opening a dropped file', () => {
  type Listener = (event: DragEvent) => void
  function fakeWindow() {
    const listeners = new Map<string, Listener>()
    return {
      listeners,
      target: {
        addEventListener: (type: string, listener: Listener) => listeners.set(type, listener),
        // Removes only the very listener that was added for that type.
        removeEventListener: (type: string, listener: Listener) => {
          if (listeners.get(type) === listener) listeners.delete(type)
        },
      } as unknown as Window,
    }
  }
  const dragEvent = (types: string[], defaultPrevented = false) => {
    const event = { dataTransfer: { types, dropEffect: 'copy' }, defaultPrevented, preventDefault: vi.fn() }
    return event as unknown as DragEvent & { preventDefault: ReturnType<typeof vi.fn> }
  }

  it('refuses a drag of files nothing took, and a drop of them; leaves what a target took, and other drags', () => {
    const { listeners, target } = fakeWindow()
    const remove = guardFileDrops(target)
    const over = dragEvent(['Files'])
    listeners.get('dragover')?.(over)
    expect(over.preventDefault).toHaveBeenCalled()
    expect(over.dataTransfer?.dropEffect).toBe('none')
    const taken = dragEvent(['Files'], true)
    listeners.get('dragover')?.(taken)
    expect(taken.dataTransfer?.dropEffect).toBe('copy')
    const drop = dragEvent(['Files'])
    listeners.get('drop')?.(drop)
    expect(drop.preventDefault).toHaveBeenCalled()
    const text = dragEvent(['text/plain'])
    listeners.get('dragover')?.(text)
    listeners.get('drop')?.(text)
    expect(text.preventDefault).not.toHaveBeenCalled()
    remove()
    expect(listeners.size).toBe(0)
  })
})
