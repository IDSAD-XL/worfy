// A file or an image dropped on a Session Node (src/renderer/canvas/nodes/SessionNode.tsx): the
// Node of a Session worfy runs takes it the way the input field of the Session view does —
// `agent.attach` checks it, it shows as a chip above the Node's input field, and the next message
// carries it. A read-only Node takes nothing.
import { act, createEvent, fireEvent, render, screen } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CanvasNodeProps } from '../../src/renderer/canvas/nodes/index'
import { FILE_COPY_LIMIT_BYTES, fileTooLarge, imageTooLarge, tooManyAttachments, type Attachment, type AttachmentSource } from '../../src/shared/agent/attachments'
import type { WorfyBridge } from '../../src/shared/ipc/channels'
import type { SessionNodeView } from '../../src/shared/ipc/sessions'

// Imported once while the file is collected, as its static imports are: the first import
// transforms the Node and every renderer module it reaches, which took more than the 5 s of a test
// on a loaded Mac when the first test did it. Each test still evaluates a fresh copy after
// vi.resetModules(), from the transforms this import left behind.
await import('../../src/renderer/canvas/nodes/SessionNode')

const ROOT = '/Users/test/projects/demo'
const PROJECT = { id: 'demo-0000000a', name: 'demo', path: ROOT, branch: 'main' }
const NODE = 'session-node-1'
const SAVED = 'dddddddd-0000-4000-8000-000000000004'

const view = (sessionId: string, version = 1): SessionNodeView => ({
  projectId: PROJECT.id,
  nodeId: NODE,
  sessionId,
  sdkSessionId: null,
  state: 'idle',
  error: null,
  cwd: ROOT,
  model: null,
  version,
})

/** Every call that reached the preload, in order. */
let calls: { channel: string; input: unknown }[]
/** main's views of the Node's Session when the window asks: none means the Session is not running. */
let views: SessionNodeView[]
/** What `agent.send` answers; a test may hold it back. */
let sendAnswer: () => Promise<unknown>
/** What `sessions.start` (Resume) answers; a test may hold it back. */
let startAnswer: () => Promise<unknown>

/** main's answer to `agent.attach`: an image block for an image, a copy for any other file. */
function attachInMain(sources: AttachmentSource[]) {
  return {
    results: sources.map((source) => {
      const name = source.kind === 'path' ? source.path : source.name
      const attachment: Attachment = name.endsWith('.png')
        ? { kind: 'image', name, mediaType: 'image/png', size: 4, data: 'AAAA' }
        : { kind: 'file', name, path: `/data/attachments/${name}`, size: 5, copied: true }
      return { ok: true, attachment }
    }),
  }
}

beforeEach(() => {
  vi.resetModules()
  calls = []
  views = [view('live-1')]
  sendAnswer = () => Promise.resolve({ ok: true, value: undefined })
  startAnswer = () => Promise.resolve({ ok: true, value: view('started-1', 2) })
  ;(globalThis as { worfy?: WorfyBridge }).worfy = {
    invoke: (channel: string, input: unknown) => {
      calls.push({ channel, input })
      if (channel === 'agent.send') return sendAnswer()
      if (channel === 'sessions.start') return startAnswer()
      const value: unknown =
        channel === 'projects.list'
          ? { projects: [PROJECT], activeId: PROJECT.id, revision: 1 }
          : channel === 'claudeHome.sessions'
            ? { live: [], history: [] }
            : channel === 'claudeHome.live'
              ? { live: [] }
              : channel === 'sessions.views'
                ? { views }
                : channel === 'agent.attach'
                  ? attachInMain((input as { sources: AttachmentSource[] }).sources)
                  : undefined
      return Promise.resolve(value === undefined ? { ok: false, error: `no ${channel}` } : { ok: true, value })
    },
    on: () => 1,
    off: () => undefined,
  } as unknown as WorfyBridge
})

afterEach(() => {
  delete (globalThis as { worfy?: WorfyBridge }).worfy
  vi.doUnmock('../../src/renderer/ipc')
  vi.restoreAllMocks()
})

const called = (channel: string) => calls.filter((each) => each.channel === channel).map((each) => each.input)

/**
 * Renders a Session Node with `data` inside a parent that records the drops reaching it, and
 * answers the Node once its status chip says `status` (the Node is drawn again once the Project
 * is known).
 */
async function mount(data: Record<string, unknown>, status: string | null, onParentDrop = vi.fn()): Promise<HTMLElement> {
  const { default: SessionNode } = await import('../../src/renderer/canvas/nodes/SessionNode')
  const props = { id: NODE, data: { node: { id: NODE, kind: 'session', data } }, selected: false } as unknown as CanvasNodeProps
  render(
    <ReactFlowProvider>
      <div data-testid="canvas" onDrop={onParentDrop}>
        <SessionNode {...props} />
      </div>
    </ReactFlowProvider>,
  )
  await vi.waitFor(() => expect(screen.getByTestId('session-node').getAttribute('data-status')).toBe(status))
  return screen.getByTestId('session-node')
}

/** A live Node whose Session runs, once the Node shows it running. */
async function mountRunning(onParentDrop = vi.fn()) {
  return mount({ origin: 'worfy' }, 'idle', onParentDrop)
}

const png = (name = 'shot.png') => new File([new Uint8Array([137, 80, 78, 71])], name, { type: 'image/png' })
const text = (name = 'notes.txt', body = 'hello') => new File([body], name, { type: 'text/plain' })
const sized = (file: File, size: number) => {
  Object.defineProperty(file, 'size', { value: size })
  return file
}

/** Drops `files` on `target`, as the OS drag from Finder does; answers whether the default was prevented. */
async function drop(target: HTMLElement, files: File[]): Promise<boolean> {
  let prevented = false
  await act(async () => {
    prevented = !fireEvent.drop(target, { dataTransfer: { types: ['Files'], files, dropEffect: 'none' } })
  })
  return prevented
}

const chips = () => screen.queryAllByTestId('attachment-chip')

/** A `dragleave` of `node` toward `to`: jsdom has no DragEvent, so the target is set by hand. */
function leave(node: HTMLElement, dataTransfer: object, to: Element) {
  const event = createEvent.dragLeave(node, { dataTransfer })
  Object.defineProperty(event, 'relatedTarget', { value: to })
  act(() => {
    fireEvent(node, event)
  })
}

describe('a file dropped on the Node of a Session worfy runs', () => {
  it('an image and a text file become two chips, and Send carries them with the text', async () => {
    const node = await mountRunning()
    await drop(node, [png(), text()])
    await vi.waitFor(() => expect(chips()).toHaveLength(2))
    expect(chips().map((chip) => chip.getAttribute('data-kind'))).toEqual(['image', 'file'])
    expect(called('agent.attach')).toEqual([
      {
        sessionId: 'live-1',
        sources: [
          { kind: 'dropped', name: 'shot.png', data: btoa(String.fromCharCode(137, 80, 78, 71)) },
          { kind: 'dropped', name: 'notes.txt', data: btoa('hello') },
        ],
      },
    ])

    fireEvent.change(screen.getByTestId('session-node-input'), { target: { value: 'look at this' } })
    await act(async () => {
      fireEvent.click(screen.getByTestId('session-node-send'))
    })
    await vi.waitFor(() => expect(called('agent.send')).toHaveLength(1))
    const attached = attachInMain([
      { kind: 'dropped', name: 'shot.png', data: '' },
      { kind: 'dropped', name: 'notes.txt', data: '' },
    ]).results.map((result) => result.attachment)
    expect(called('agent.send')).toEqual([{ sessionId: 'live-1', text: 'look at this', attachments: attached }])
    // Sent: the chips are gone with the text.
    await vi.waitFor(() => expect(chips()).toHaveLength(0))
    expect((screen.getByTestId('session-node-input') as HTMLInputElement).value).toBe('')
  })

  it('a message of attachments only is sent too', async () => {
    const node = await mountRunning()
    await drop(node, [text()])
    await vi.waitFor(() => expect(chips()).toHaveLength(1))
    const button = screen.getByTestId('session-node-send') as HTMLButtonElement
    expect(button.disabled).toBe(false)
    await act(async () => {
      fireEvent.click(button)
    })
    await vi.waitFor(() => expect(called('agent.send')).toEqual([{ sessionId: 'live-1', text: '', attachments: [{ kind: 'file', name: 'notes.txt', path: '/data/attachments/notes.txt', size: 5, copied: true }] }]))
  })

  it('keeps the chips when the message was not sent', async () => {
    sendAnswer = () => Promise.resolve({ ok: false, error: 'the Session is gone' })
    const node = await mountRunning()
    await drop(node, [text()])
    await vi.waitFor(() => expect(chips()).toHaveLength(1))
    await act(async () => {
      fireEvent.click(screen.getByTestId('session-node-send'))
    })
    await vi.waitFor(() => expect(screen.getByTestId('session-node-error').textContent).toBe('the Session is gone'))
    expect(chips()).toHaveLength(1)
  })

  it('while a message is on its way, the next one waits in the field for Send again', async () => {
    let answer: (value: unknown) => void = () => undefined
    sendAnswer = () => new Promise((resolve) => (answer = resolve))
    const node = await mountRunning()
    await drop(node, [text()])
    await vi.waitFor(() => expect(chips()).toHaveLength(1))
    const form = screen.getByTestId('session-node-input').closest('form') as HTMLFormElement
    await act(async () => {
      fireEvent.submit(form)
      fireEvent.submit(form)
    })
    // Typed and sent while the first is still on its way: it stays in the field.
    fireEvent.change(screen.getByTestId('session-node-input'), { target: { value: 'two' } })
    await act(async () => {
      fireEvent.submit(form)
    })
    expect(called('agent.send')).toHaveLength(1)
    expect((screen.getByTestId('session-node-input') as HTMLInputElement).value).toBe('two')
    await act(async () => {
      answer({ ok: true, value: undefined })
    })
    expect(called('agent.send')).toHaveLength(1)
    sendAnswer = () => Promise.resolve({ ok: true, value: undefined })
    await act(async () => {
      fireEvent.submit(form)
    })
    await vi.waitFor(() => expect(called('agent.send').map((each) => (each as { text: string }).text)).toEqual(['', 'two']))
  })

  it('a chip removed with × does not go with the message', async () => {
    const node = await mountRunning()
    await drop(node, [png(), text()])
    await vi.waitFor(() => expect(chips()).toHaveLength(2))
    fireEvent.click(screen.getByRole('button', { name: 'Remove shot.png' }))
    expect(chips()).toHaveLength(1)
    await act(async () => {
      fireEvent.click(screen.getByTestId('session-node-send'))
    })
    await vi.waitFor(() => expect(called('agent.send')).toHaveLength(1))
    expect((called('agent.send')[0] as { attachments: Attachment[] }).attachments.map((each) => each.name)).toEqual(['notes.txt'])
  })

  it('refuses a file over the limit in the problem line: no chip, and main never sees it', async () => {
    const node = await mountRunning()
    await drop(node, [sized(text('big.bin'), FILE_COPY_LIMIT_BYTES + 1)])
    await vi.waitFor(() => expect(screen.getByTestId('session-node-error').textContent).toBe(fileTooLarge('big.bin')))
    expect(chips()).toHaveLength(0)
    expect(called('agent.attach')).toEqual([])

    await drop(node, [sized(png('huge.png'), FILE_COPY_LIMIT_BYTES + 1), text('small.txt')])
    await vi.waitFor(() => expect(chips()).toHaveLength(1))
    expect(screen.getByTestId('session-node-error').textContent).toBe(imageTooLarge('huge.png'))
    expect(called('agent.attach').flatMap((each) => (each as { sources: AttachmentSource[] }).sources.map((source) => (source.kind === 'path' ? source.path : source.name)))).toEqual(['small.txt'])
  })

  it('of 21 files takes 20 and names the last in the problem line', async () => {
    const node = await mountRunning()
    await drop(
      node,
      Array.from({ length: 21 }, (_, index) => text(`f${index}.txt`)),
    )
    await vi.waitFor(() => expect(chips()).toHaveLength(20))
    expect(screen.getByTestId('session-node-error').textContent).toBe(tooManyAttachments(['f20.txt']))
    // The 21st is neither read nor sent to main: `agent.attach` takes 20 sources at most.
    expect(called('agent.attach').map((each) => (each as { sources: AttachmentSource[] }).sources.length)).toEqual([20])
  })

  it('counts the chips already there against the 20', async () => {
    const node = await mountRunning()
    await drop(
      node,
      Array.from({ length: 19 }, (_, index) => text(`f${index}.txt`)),
    )
    await vi.waitFor(() => expect(chips()).toHaveLength(19))
    await drop(node, [text('a.txt'), text('b.txt')])
    await vi.waitFor(() => expect(screen.getByTestId('session-node-error').textContent).toBe(tooManyAttachments(['b.txt'])))
    expect(chips()).toHaveLength(20)
    expect(called('agent.attach').map((each) => (each as { sources: AttachmentSource[] }).sources.length)).toEqual([19, 1])
  })

  it('lights the Node while files are over it, and takes the drop away from the Canvas', async () => {
    const onParentDrop = vi.fn()
    const node = await mountRunning(onParentDrop)
    let allowed = false
    const dataTransfer = { types: ['Files'], files: [], dropEffect: 'none' }
    act(() => {
      allowed = !fireEvent.dragOver(node, { dataTransfer })
    })
    expect(allowed).toBe(true)
    expect(dataTransfer.dropEffect).toBe('copy')
    expect(node.hasAttribute('data-dragging')).toBe(true)
    leave(node, dataTransfer, document.body)
    expect(node.hasAttribute('data-dragging')).toBe(false)

    expect(await drop(node, [text()])).toBe(true)
    expect(onParentDrop).not.toHaveBeenCalled()
    expect(node.hasAttribute('data-dragging')).toBe(false)
  })

  it('stays lit while the drag moves onto a child of the Node', async () => {
    const node = await mountRunning()
    const dataTransfer = { types: ['Files'], files: [], dropEffect: 'none' }
    act(() => {
      fireEvent.dragOver(node, { dataTransfer })
    })
    leave(node, dataTransfer, screen.getByTestId('session-node-input'))
    expect(node.hasAttribute('data-dragging')).toBe(true)
  })

  it('ignores a drag of text, not files', async () => {
    const node = await mountRunning()
    let allowed = false
    act(() => {
      allowed = !fireEvent.dragOver(node, { dataTransfer: { types: ['text/plain'], files: [], dropEffect: 'none' } })
    })
    expect(allowed).toBe(false)
    expect(node.hasAttribute('data-dragging')).toBe(false)
  })
})

describe('a file dropped on the Node of a Session that is not running', () => {
  it('resumes the Session first, then attaches to the Session it started', async () => {
    views = []
    const node = await mount({ origin: 'worfy', sessionId: SAVED }, 'finished')
    await drop(node, [text()])
    await vi.waitFor(() => expect(chips()).toHaveLength(1))
    const order = calls.map((each) => each.channel).filter((channel) => channel === 'sessions.start' || channel === 'agent.attach')
    expect(order).toEqual(['sessions.start', 'agent.attach'])
    expect(called('sessions.start')).toEqual([{ projectId: PROJECT.id, nodeId: NODE }])
    expect(called('agent.attach')).toEqual([{ sessionId: 'started-1', sources: [{ kind: 'dropped', name: 'notes.txt', data: btoa('hello') }] }])
  })

  it('does not start the Session for a file it refuses anyway', async () => {
    views = []
    const node = await mount({ origin: 'worfy', sessionId: SAVED }, 'finished')
    await drop(node, [sized(text('big.bin'), FILE_COPY_LIMIT_BYTES + 1)])
    await vi.waitFor(() => expect(screen.getByTestId('session-node-error').textContent).toBe(fileTooLarge('big.bin')))
    expect(called('sessions.start')).toEqual([])
    expect(called('agent.attach')).toEqual([])
  })
})

describe('a file dropped on a Node that takes none', () => {
  it('a read-only Session Node: the cursor says no, and nothing is attached', async () => {
    const onParentDrop = vi.fn()
    const node = await mount({ origin: 'external', sessionId: SAVED, source: 'terminal', cwd: ROOT }, 'finished', onParentDrop)
    const dataTransfer = { types: ['Files'], files: [], dropEffect: 'copy' }
    act(() => {
      fireEvent.dragOver(node, { dataTransfer })
    })
    expect(dataTransfer.dropEffect).toBe('none')
    expect(node.hasAttribute('data-dragging')).toBe(false)
    // The window never opens the file in place of the app, and the Canvas does not get it either.
    expect(await drop(node, [text()])).toBe(true)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    expect(called('agent.attach')).toEqual([])
    expect(called('sessions.start')).toEqual([])
    expect(onParentDrop).not.toHaveBeenCalled()
    expect(chips()).toHaveLength(0)
  })

  it('a Session Node with no Session: nothing is attached', async () => {
    const node = await mount({ something: 'else' }, null)
    expect(node.textContent).toBe('This Session Node has no Session')
    const dataTransfer = { types: ['Files'], files: [], dropEffect: 'copy' }
    act(() => {
      fireEvent.dragOver(node, { dataTransfer })
    })
    expect(dataTransfer.dropEffect).toBe('none')
    await drop(node, [text()])
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    expect(called('agent.attach')).toEqual([])
  })
})

/** Holds every `sessions.start` back until `release(count)` sees `count` of them: Resume on its way. */
function holdResume(): { release: (count: number) => Promise<void> } {
  const waiting: (() => void)[] = []
  startAnswer = () => new Promise((resolve) => waiting.push(() => resolve({ ok: true, value: view('started-1', 2) })))
  return {
    release: async (count) => {
      await vi.waitFor(() => expect(waiting.length).toBe(count))
      await act(async () => {
        for (const resolve of waiting.splice(0)) resolve()
      })
    },
  }
}

const input = () => screen.getByTestId('session-node-input') as HTMLInputElement
const sentTexts = () => called('agent.send').map((each) => (each as { text: string }).text)
const sentNames = (at: number) => (called('agent.send')[at] as { attachments: Attachment[] }).attachments.map((each) => each.name)

async function submit(message?: string) {
  if (message !== undefined) fireEvent.change(input(), { target: { value: message } })
  await act(async () => {
    fireEvent.submit(input().closest('form') as HTMLFormElement)
  })
}

describe('one send after another', () => {
  it('sends again once the first send has finished', async () => {
    await mountRunning()
    await submit('one')
    await vi.waitFor(() => expect(sentTexts()).toEqual(['one']))
    await submit('two')
    await vi.waitFor(() => expect(sentTexts()).toEqual(['one', 'two']))
  })

  it('after a send the bridge rejected, the text and the chips are back and the next Send carries them', async () => {
    let first = true
    sendAnswer = () => {
      if (!first) return Promise.resolve({ ok: true, value: undefined })
      first = false
      return Promise.reject(new Error('the bridge is gone'))
    }
    const node = await mountRunning()
    await drop(node, [text()])
    await vi.waitFor(() => expect(chips()).toHaveLength(1))
    await submit('hi')
    await vi.waitFor(() => expect(screen.getByTestId('session-node-error').textContent).toBe('the bridge is gone'))
    expect(chips()).toHaveLength(1)
    expect(input().value).toBe('hi')
    await submit()
    await vi.waitFor(() => expect(sentTexts()).toEqual(['hi', 'hi']))
    expect(sentNames(1)).toEqual(['notes.txt'])
    await vi.waitFor(() => expect(chips()).toHaveLength(0))
  })

  it('when agent.send throws in the renderer, the text and the chips come back and Send works again', async () => {
    let throwOnce = true
    vi.doMock('../../src/renderer/ipc', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../../src/renderer/ipc')>()
      const invoke = ((channel: string, ...args: unknown[]) => {
        if (channel === 'agent.send' && throwOnce) {
          throwOnce = false
          throw new Error('renderer broke')
        }
        return (actual.invoke as (channel: string, ...rest: unknown[]) => unknown)(channel, ...args)
      }) as typeof actual.invoke
      return { ...actual, invoke }
    })
    const node = await mountRunning()
    await drop(node, [text()])
    await vi.waitFor(() => expect(chips()).toHaveLength(1))
    await submit('hi')
    await vi.waitFor(() => expect(screen.getByTestId('session-node-error').textContent).toBe('renderer broke'))
    expect(chips()).toHaveLength(1)
    expect(input().value).toBe('hi')
    await submit()
    await vi.waitFor(() => expect(sentTexts()).toEqual(['hi']))
    expect(sentNames(0)).toEqual(['notes.txt'])
  })
})

describe('a send while Resume is on its way', () => {
  it('the message leaves the field at once: its chips cannot be removed meanwhile, and a file dropped meanwhile waits for the next message', async () => {
    views = []
    const node = await mount({ origin: 'worfy', sessionId: SAVED }, 'finished')
    await drop(node, [text('a.txt'), text('b.txt')])
    await vi.waitFor(() => expect(chips()).toHaveLength(2))
    const resume = holdResume()
    await submit('go')
    // Resume is on its way: the message is no longer on the field.
    expect(chips()).toHaveLength(0)
    expect(input().value).toBe('')
    await drop(node, [text('c.txt')])
    // Two Resumes: the send's, and the drop's (main answers both with the one Session).
    await resume.release(2)
    await vi.waitFor(() => expect(sentTexts()).toEqual(['go']))
    expect(sentNames(0)).toEqual(['a.txt', 'b.txt'])
    await vi.waitFor(() => expect(chips()).toHaveLength(1))
    expect(screen.getByRole('button', { name: 'Remove c.txt' })).toBeTruthy()
  })

  it('a drop meanwhile takes the room the message on its way leaves: 10 chips sent, 10 more taken', async () => {
    views = []
    const node = await mount({ origin: 'worfy', sessionId: SAVED }, 'finished')
    await drop(
      node,
      Array.from({ length: 10 }, (_, index) => text(`a${index}.txt`)),
    )
    await vi.waitFor(() => expect(chips()).toHaveLength(10))
    const resume = holdResume()
    await submit('go')
    await drop(
      node,
      Array.from({ length: 10 }, (_, index) => text(`b${index}.txt`)),
    )
    // Two Resumes: the send's, and the drop's (main answers both with the one Session).
    await resume.release(2)
    await vi.waitFor(() => expect(chips()).toHaveLength(10))
    expect(screen.queryByTestId('session-node-error')).toBeNull()
    expect(sentNames(0)).toEqual(Array.from({ length: 10 }, (_, index) => `a${index}.txt`))
    expect(chips().map((chip) => chip.textContent?.split(' ')[0])).toEqual(Array.from({ length: 10 }, (_, index) => expect.stringContaining(`b${index}.txt`)))
  })

  it('the message on its way still counts against the 20: of 10 dropped beside 15 on their way, 5 are taken', async () => {
    views = []
    const node = await mount({ origin: 'worfy', sessionId: SAVED }, 'finished')
    await drop(
      node,
      Array.from({ length: 15 }, (_, index) => text(`a${index}.txt`)),
    )
    await vi.waitFor(() => expect(chips()).toHaveLength(15))
    const resume = holdResume()
    await submit('go')
    const late = Array.from({ length: 10 }, (_, index) => `b${index}.txt`)
    await drop(
      node,
      late.map((name) => text(name)),
    )
    await resume.release(2)
    await vi.waitFor(() => expect(chips()).toHaveLength(5))
    expect(screen.getByTestId('session-node-error').textContent).toBe(tooManyAttachments(late.slice(5)))
  })

  it('a Resume that fails brings the text and the chips back, with its reason', async () => {
    views = []
    const node = await mount({ origin: 'worfy', sessionId: SAVED }, 'finished')
    await drop(node, [text()])
    await vi.waitFor(() => expect(chips()).toHaveLength(1))
    startAnswer = () => Promise.resolve({ ok: false, error: 'the transcript is gone' })
    await submit('go')
    await vi.waitFor(() => expect(screen.getByTestId('session-node-error').textContent).toBe('the transcript is gone'))
    expect(chips()).toHaveLength(1)
    expect(input().value).toBe('go')
    expect(called('agent.send')).toEqual([])
  })
})

describe('on the screen of a Linked machine that shares its Projects read-only (worfy-link ticket 25)', () => {
  const MINI = '22222222-2222-4222-8222-222222222222'
  const HINT = 'Mini gives this Machine read-only access'
  let readOnly: boolean

  // The window shows Mini: its `project` channels go through this Machine's main as `linked.invoke`
  // and answer as above; main says Mini's level in `linked.state`.
  beforeEach(() => {
    readOnly = true
    window.history.replaceState(null, '', `/?machine=${MINI}&project=${PROJECT.id}`)
    const inner = (globalThis as unknown as { worfy: WorfyBridge }).worfy
    ;(globalThis as { worfy?: WorfyBridge }).worfy = {
      ...inner,
      invoke: (channel, input) => {
        if (channel === 'linked.invoke') {
          const call = input as { channel: string; input: unknown }
          return inner.invoke(call.channel, call.input).then((value) => ({ ok: true, value }))
        }
        if (channel === 'linked.state') return Promise.resolve({ ok: true, value: { revision: 1, machines: [{ id: MINI, online: true, sharing: 'yes', readOnly, epoch: 1 }] } })
        if (channel === 'link.state') return Promise.resolve({ ok: true, value: { revision: 1, machine: null, linked: [{ id: MINI, name: 'Mini', state: 'online', certificateChanged: false, access: 'all' }] } })
        if (channel === 'linked.open') return Promise.resolve({ ok: true, value: { projectId: PROJECT.id } })
        return inner.invoke(channel, input)
      },
    }
  })

  afterEach(() => {
    window.history.replaceState(null, '', '/')
  })

  it('a running Session: Close, Hide and Remove are inactive and say why; the field takes no message and no file', async () => {
    const node = await mountRunning()
    const close = screen.getByTestId('session-node-close')
    await vi.waitFor(() => expect(close.getAttribute('title')).toBe(HINT))
    for (const button of [close, screen.getByRole('button', { name: 'Hide' }), screen.getByTestId('session-node-remove')]) {
      expect(button.getAttribute('aria-disabled')).toBe('true')
      expect(button.getAttribute('title')).toBe(HINT)
      fireEvent.click(button)
    }
    const field = screen.getByTestId('session-node-input') as HTMLInputElement
    expect(field.readOnly).toBe(true)
    expect(field.placeholder).toBe(HINT)
    expect(screen.getByTestId('session-node-send').getAttribute('aria-disabled')).toBe('true')
    await act(async () => {
      fireEvent.submit(field.closest('form')!)
    })
    await drop(node, [text()])
    expect(screen.getByTestId('session-node-error').textContent).toBe(HINT)
    expect(calls.filter((call) => ['sessions.close', 'agent.send', 'agent.attach', 'sessions.start', 'layout.apply'].includes(call.channel))).toEqual([])
  })

  it('a finished Session: Resume is inactive and starts nothing', async () => {
    views = []
    await mount({ origin: 'worfy', sessionId: SAVED }, 'finished')
    const resume = screen.getByTestId('session-node-resume')
    await vi.waitFor(() => expect(resume.getAttribute('title')).toBe(HINT))
    expect(resume.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(resume)
    expect(called('sessions.start')).toEqual([])
  })

  it('with Full access the running Session sends a message as before', async () => {
    readOnly = false
    await mountRunning()
    const field = screen.getByTestId('session-node-input') as HTMLInputElement
    await vi.waitFor(() => expect(screen.getByTestId('session-node-close').getAttribute('title')).toBe('Close the Session; the Node stays'))
    expect(field.readOnly).toBe(false)
    fireEvent.change(field, { target: { value: 'hello' } })
    await act(async () => {
      fireEvent.submit(field.closest('form')!)
    })
    await vi.waitFor(() => expect(called('agent.send')).toHaveLength(1))
  })
})
