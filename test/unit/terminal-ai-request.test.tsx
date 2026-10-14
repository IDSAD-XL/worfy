// The Command request panel of a Terminal Node (src/renderer/canvas/nodes/TerminalAiRequest.tsx and
// its key in TerminalNode.tsx), over the real renderer IPC client and a fake preload: ⌘I opens the
// panel only where main says it is available, Ctrl+I and ⌘I elsewhere go to xterm.js, Esc closes,
// a busy Terminal sends nothing, and the answer closes the panel and gives the focus back.
//
// xterm.js does not run in jsdom: the Terminal here is a fake that keeps the key handler the Node
// gives it, the way xterm.js asks it about every key. The look in both themes and the real keys are
// checked against the built app (test/e2e/terminal-ai-request.spec.ts).
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcResult, WorfyBridge } from '../../src/shared/ipc/channels'
import type { TerminalAiRequestState } from '../../src/shared/ipc/terminal-ai-request'

const PROJECT = 'alpha-0000000a'
const NODE = 'terminal-node-1'

/** The xterm.js of the Node: what the Node set up on it, and what it was told. */
interface FakeXterm {
  keyHandler: ((event: KeyboardEvent) => boolean) | null
  focused: number
}
const xterms = vi.hoisted(() => [] as FakeXterm[])

vi.mock('@xterm/xterm', () => {
  class Terminal {
    readonly fake: FakeXterm = { keyHandler: null, focused: 0 }
    cols = 80
    rows = 24
    options: Record<string, unknown> = {}
    constructor() {
      xterms.push(this.fake)
    }
    attachCustomKeyEventHandler(handler: (event: KeyboardEvent) => boolean) {
      this.fake.keyHandler = handler
    }
    loadAddon() {}
    open() {}
    resize() {}
    write() {}
    focus() {
      this.fake.focused++
    }
    dispose() {}
    onData() {
      return { dispose: () => undefined }
    }
    onResize() {
      return { dispose: () => undefined }
    }
  }
  return { Terminal }
})
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    proposeDimensions() {
      return undefined
    }
  },
}))
vi.mock('@xterm/xterm/css/xterm.css', () => ({}))
vi.mock('../../src/renderer/projects/useProjects', () => ({
  useProjects: () => undefined,
  activeProject: () => ({ id: PROJECT }),
}))
vi.mock('../../src/renderer/canvas/useLayout', () => ({ useLayoutOps: () => ({ apply: vi.fn() }) }))
vi.mock('../../src/renderer/canvas/NodeResizeClamp', () => ({ NodeResizeClamp: () => null }))

const { default: TerminalNode } = await import('../../src/renderer/canvas/nodes/TerminalNode')

interface Call {
  channel: string
  input: unknown
  answer: (result: IpcResult<unknown>) => void
}

interface FakeMain {
  calls: Call[]
  /** Fires `terminalAi.request.changed`, as main does after a change. */
  changed: (state: TerminalAiRequestState & { nodeId?: string }) => void
}

/** The preload: `terminal.open` and `terminal.input` are answered at once, every other call waits for the test. */
function preload(): FakeMain {
  const handlers = new Map<number, { channel: string; handler: (payload: unknown) => void }>()
  let next = 0
  const main: FakeMain = {
    calls: [],
    changed: (state) => {
      for (const { channel, handler } of handlers.values()) if (channel === 'terminalAi.request.changed') handler({ projectId: PROJECT, nodeId: NODE, ...state })
    },
  }
  const bridge: WorfyBridge = {
    invoke: (channel, input) =>
      new Promise((resolve) => {
        if (channel === 'terminal.open') resolve({ ok: true, value: { replay: '', end: 0, shell: 'zsh', pid: 42, exited: null } })
        else if (channel === 'terminal.input' || channel === 'terminal.resize' || channel === 'terminal.takeSize') resolve({ ok: true, value: undefined })
        else main.calls.push({ channel, input, answer: resolve })
      }),
    on: (channel, handler) => {
      handlers.set(++next, { channel, handler })
      return next
    },
    off: (subscription) => {
      handlers.delete(subscription)
    },
  }
  ;(globalThis as { worfy?: WorfyBridge }).worfy = bridge
  return main
}

beforeEach(() => {
  xterms.length = 0
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  )
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined }))
})

afterEach(() => {
  delete (globalThis as { worfy?: WorfyBridge }).worfy
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const callsOf = (main: FakeMain, channel: string): Call[] => main.calls.filter((call) => call.channel === channel)

const answer = (call: Call | undefined, result: IpcResult<unknown>) =>
  act(async () => {
    if (call === undefined) throw new Error('no such call')
    call.answer(result)
  })

const nodeProps = { id: NODE, data: { node: { id: NODE, kind: 'terminal', locked: false } }, selected: false } as unknown as Parameters<typeof TerminalNode>[0]

/** A Terminal Node whose panel state main answered with `state`. */
async function terminalNode(state: TerminalAiRequestState) {
  const main = preload()
  render(<TerminalNode {...nodeProps} />)
  await answer(callsOf(main, 'terminalAi.request.state')[0], { ok: true, value: state })
  const xterm = xterms.at(-1)
  if (xterm?.keyHandler === null || xterm === undefined) throw new Error('the Node set no key handler on xterm.js')
  expect(callsOf(main, 'terminalAi.request.state')[0]?.input).toEqual({ projectId: PROJECT, nodeId: NODE })
  /** Presses a key in the terminal: true when xterm.js gets it. */
  const press = (init: KeyboardEventInit) => {
    let toXterm = true
    act(() => {
      for (const type of ['keydown', 'keyup'] as const) {
        const got = xterm.keyHandler?.(new KeyboardEvent(type, { cancelable: true, ...init })) ?? true
        if (type === 'keydown') toXterm = got
      }
    })
    return toXterm
  }
  return { main, xterm, press }
}

const META_I: KeyboardEventInit = { key: 'i', code: 'KeyI', metaKey: true }
const CTRL_I: KeyboardEventInit = { key: 'i', code: 'KeyI', ctrlKey: true }
const panel = () => screen.queryByRole('dialog', { name: 'Command request' })

describe('⌘I in a Terminal Node', () => {
  it('opens the panel where it is available: xterm.js does not get the key, the field has the focus and a name', async () => {
    const { press } = await terminalNode({ available: true, busy: false })
    expect(panel()).toBeNull()
    expect(press(META_I)).toBe(false)
    expect(panel()).not.toBeNull()
    const field = screen.getByRole('textbox', { name: 'Describe the command' })
    expect(document.activeElement).toBe(field)
  })

  it('Ctrl+I is not ⌘I: it goes to xterm.js (Tab of the shell), no panel', async () => {
    const { press } = await terminalNode({ available: true, busy: false })
    expect(press(CTRL_I)).toBe(true)
    expect(press({ ...META_I, ctrlKey: true })).toBe(true)
    expect(press({ ...META_I, altKey: true })).toBe(true)
    expect(press({ key: 'i', code: 'KeyI' })).toBe(true)
    expect(panel()).toBeNull()
  })

  it('where it is not available, ⌘I goes to xterm.js and no panel opens; a change from main makes it available', async () => {
    const { main, press } = await terminalNode({ available: false, busy: false })
    expect(press(META_I)).toBe(true)
    expect(panel()).toBeNull()

    act(() => main.changed({ available: true, busy: false }))
    expect(press(META_I)).toBe(false)
    expect(panel()).not.toBeNull()
    // The zsh left: the panel goes with it, and ⌘I goes to the shell again.
    act(() => main.changed({ available: false, busy: false }))
    expect(panel()).toBeNull()
    expect(press(META_I)).toBe(true)
    // A new zsh connects: the panel does not come back by itself.
    act(() => main.changed({ available: true, busy: false }))
    expect(panel()).toBeNull()
  })

  it('a change for another Terminal leaves this one as it is', async () => {
    const { main, press } = await terminalNode({ available: false, busy: false })
    act(() => main.changed({ available: true, busy: false, nodeId: 'another-node' }))
    expect(press(META_I)).toBe(true)
  })

  it('⌘⇧I and ⌘ with another key are not it; the physical key I opens it in another keyboard layout too', async () => {
    const { press } = await terminalNode({ available: true, busy: false })
    expect(press({ ...META_I, key: 'I', shiftKey: true })).toBe(true)
    expect(press({ key: 'k', code: 'KeyK', metaKey: true })).toBe(true)
    expect(panel()).toBeNull()
    expect(press({ key: 'ш', code: 'KeyI', metaKey: true })).toBe(false)
    expect(panel()).not.toBeNull()
  })
})

describe('the panel', () => {
  it('Esc closes it and gives the focus back to the terminal; nothing is sent', async () => {
    const { main, press, xterm } = await terminalNode({ available: true, busy: false })
    press(META_I)
    const field = screen.getByRole('textbox', { name: 'Describe the command' })
    fireEvent.change(field, { target: { value: 'list big files' } })
    const focusedBefore = xterm.focused
    fireEvent.keyDown(field, { key: 'Escape' })
    expect(panel()).toBeNull()
    expect(xterm.focused).toBe(focusedBefore + 1)
    expect(callsOf(main, 'terminalAi.request')).toHaveLength(0)
  })

  it('Enter sends the words; the answer closes the panel and gives the focus back to the terminal', async () => {
    const { main, press, xterm } = await terminalNode({ available: true, busy: false })
    press(META_I)
    const field = screen.getByRole('textbox', { name: 'Describe the command' })
    fireEvent.change(field, { target: { value: '  list big files ' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    const [request] = callsOf(main, 'terminalAi.request')
    expect(request?.input).toEqual({ projectId: PROJECT, nodeId: NODE, text: 'list big files' })
    expect(screen.getByRole('status').textContent).toBe('Asking Claude…')
    const focusedBefore = xterm.focused
    await answer(request, { ok: true, value: { ok: true } })
    expect(panel()).toBeNull()
    expect(xterm.focused).toBe(focusedBefore + 1)
  })

  it('busy: says "Terminal is busy" and sends nothing', async () => {
    const { main, press } = await terminalNode({ available: true, busy: true })
    press(META_I)
    expect(screen.getByRole('status').textContent).toBe('Terminal is busy')
    const field = screen.getByRole('textbox', { name: 'Describe the command' })
    fireEvent.change(field, { target: { value: 'list big files' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(callsOf(main, 'terminalAi.request')).toHaveLength(0)
    expect(panel()).not.toBeNull()
    // The command ended: the same Enter sends now.
    act(() => main.changed({ available: true, busy: false }))
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(callsOf(main, 'terminalAi.request')).toHaveLength(1)
  })

  it('a refusal of the Limits stays in the panel, which stays open', async () => {
    const { main, press } = await terminalNode({ available: true, busy: false })
    press(META_I)
    const field = screen.getByRole('textbox', { name: 'Describe the command' })
    fireEvent.change(field, { target: { value: 'list big files' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    await answer(callsOf(main, 'terminalAi.request')[0], { ok: true, value: { ok: false, message: 'Limits reached until 14:20' } })
    expect(panel()).not.toBeNull()
    expect(screen.getByRole('status').textContent).toBe('Limits reached until 14:20')
    // A failure of the call itself is shown without the channel's name.
    fireEvent.keyDown(field, { key: 'Enter' })
    await answer(callsOf(main, 'terminalAi.request')[1], { ok: false, error: 'terminalAi.request failed: the Terminal has no zsh connected to Terminal AI' })
    expect(screen.getByRole('status').textContent).toBe('the Terminal has no zsh connected to Terminal AI')
  })

  it('Esc while the request waits cancels it in main', async () => {
    const { main, press } = await terminalNode({ available: true, busy: false })
    press(META_I)
    const field = screen.getByRole('textbox', { name: 'Describe the command' })
    fireEvent.change(field, { target: { value: 'list big files' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    fireEvent.keyDown(field, { key: 'Escape' })
    expect(panel()).toBeNull()
    expect(callsOf(main, 'terminalAi.request.cancel').map((call) => call.input)).toEqual([{ projectId: PROJECT, nodeId: NODE }])
  })
})
