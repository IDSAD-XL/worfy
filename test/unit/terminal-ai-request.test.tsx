// The Command request panel of a Terminal Node (src/renderer/canvas/nodes/TerminalAiRequest.tsx and
// its key in TerminalNode.tsx), over the real renderer IPC client and a fake preload: ⌘I opens the
// panel only where main says it is available, Ctrl+I and ⌘I elsewhere go to xterm.js, Esc closes,
// a busy Terminal sends nothing, and the answer closes the panel and gives the focus back.
//
// xterm.js does not draw in jsdom: the Terminal here is a fake that keeps the key handler the Node
// gives it, the way xterm.js asks it about every key. Its buffer and its parser are those of a real
// xterm.js that draws nothing, so the line the panel sends is read off a real buffer
// (src/renderer/canvas/nodes/terminal-line.ts, tested on its own below). The look in both themes, the
// place of the panel and the real keys are checked against the built app
// (test/e2e/terminal-ai-request.spec.ts).
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcResult, WorfyBridge } from '../../src/shared/ipc/channels'
import type { TerminalAiRequestState } from '../../src/shared/ipc/terminal-ai-request'
import { MAX_FIELD_CHARS } from '../../src/shared/terminal-ai/context'

const PROJECT = 'alpha-0000000a'
const NODE = 'terminal-node-1'

/** The xterm.js of the Node: what the Node set up on it, and what it was told. */
interface FakeXterm {
  keyHandler: ((event: KeyboardEvent) => boolean) | null
  focused: number
  /** Writes output as the shell would; resolves once xterm.js has parsed it. */
  output: (data: string) => Promise<void>
}
const xterms = vi.hoisted(() => [] as FakeXterm[])

vi.mock('@xterm/xterm', async () => {
  const real = await vi.importActual<typeof import('@xterm/xterm')>('@xterm/xterm')
  class Terminal {
    readonly core = new real.Terminal({ cols: 80, rows: 24, allowProposedApi: true })
    readonly fake: FakeXterm = { keyHandler: null, focused: 0, output: (data) => new Promise((resolve) => this.core.write(data, resolve)) }
    rows = 24
    options: Record<string, unknown> = {}
    readonly parser = this.core.parser
    readonly buffer = this.core.buffer
    get cols() {
      return this.core.cols
    }
    constructor() {
      xterms.push(this.fake)
    }
    registerMarker(offset?: number) {
      return this.core.registerMarker(offset)
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
    dispose() {
      this.core.dispose()
    }
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
    // No prompt on the screen: no line.
    expect(request?.input).toEqual({ projectId: PROJECT, nodeId: NODE, text: 'list big files', line: '' })
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

/** The marks of the zsh integration (src/main/terminal/zsh/integration.zsh), with a nonce. */
const A = '\x1b]633;A;n0nce\x07'
const B = '\x1b]633;B;n0nce\x07'
const C = '\x1b]633;C;n0nce\x07'
const PROMPT = `${A}e2e% ${B}`
/** Grey as zsh draws `fg=8`, and back. */
const GREY = (text: string) => `\x1b[90m${text}\x1b[39m`
/** The cursor `n` cells left. */
const LEFT = (n: number) => `\x1b[${n}D`

describe('the line the panel sends', () => {
  it('is what is typed after the prompt, as the Terminal reads it when Enter is pressed', async () => {
    const { main, press, xterm } = await terminalNode({ available: true, busy: false })
    await act(() => xterm.output(`${PROMPT}git status --short`))
    press(META_I)
    const field = screen.getByRole('textbox', { name: 'Describe the command' })
    fireEvent.change(field, { target: { value: 'only the changed files' } })
    // Read at Enter, not at ⌘I.
    await act(() => xterm.output(' -uno'))
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(callsOf(main, 'terminalAi.request')[0]?.input).toEqual({ projectId: PROJECT, nodeId: NODE, text: 'only the changed files', line: 'git status --short -uno' })
  })

  it('a grey Suggestion after the line stays out of it', async () => {
    const { main, press, xterm } = await terminalNode({ available: true, busy: false })
    // zsh draws POSTDISPLAY after the line and puts the cursor back at the end of the line.
    await act(() => xterm.output(`${PROMPT}git st${GREY('atus --short')}${LEFT(12)}`))
    press(META_I)
    const field = screen.getByRole('textbox', { name: 'Describe the command' })
    fireEvent.change(field, { target: { value: 'what changed' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(callsOf(main, 'terminalAi.request')[0]?.input).toMatchObject({ line: 'git st' })
  })
})

describe('terminal-line: the line typed after the prompt, read off the buffer', async () => {
  const real = await vi.importActual<typeof import('@xterm/xterm')>('@xterm/xterm')
  const { watchTypedLine, lineWithinLimit, RIGHT_PROMPT_GAP } = await import('../../src/renderer/canvas/nodes/terminal-line')

  /** A terminal `cols` wide that drew `output`, and the line it reads. */
  async function lineAfter(output: string, cols = 40): Promise<string> {
    const terminal = new real.Terminal({ cols, rows: 10, allowProposedApi: true })
    const watch = watchTypedLine(terminal)
    await new Promise<void>((resolve) => terminal.write(output, resolve))
    const line = watch.line()
    watch.dispose()
    terminal.dispose()
    return line
  }

  it('without the prompt; empty when nothing is typed', async () => {
    expect(await lineAfter(`${PROMPT}git status --short`)).toBe('git status --short')
    expect(await lineAfter(PROMPT)).toBe('')
    // A prompt of several rows: the line starts at the mark, at the end of the last.
    expect(await lineAfter(`${A}~/work on main\r\ne2e% ${B}ls -la`)).toBe('ls -la')
  })

  it('no mark of a prompt, a command started, a new prompt: an empty line until the next mark', async () => {
    expect(await lineAfter('e2e% git status')).toBe('')
    expect(await lineAfter(`${PROMPT}sleep 5\r\n${C}output of it`)).toBe('')
    expect(await lineAfter(`${PROMPT}ls\r\n${C}a b\r\n${A}e2e% `)).toBe('')
    expect(await lineAfter(`${PROMPT}ls\r\n${C}a b\r\n${PROMPT}echo next`)).toBe('echo next')
  })

  it('a line longer than the row, wrapped onto the next rows, is one line', async () => {
    const long = `echo ${'x'.repeat(30)} ${'y'.repeat(20)}`
    expect(long.length + 'e2e% '.length).toBeGreaterThan(40)
    expect(await lineAfter(`${PROMPT}${long}`)).toBe(long)
    // As zsh draws it: the row full to its last cell, then a line feed of its own, so xterm.js does not mark the next row wrapped.
    const head = long.slice(0, 40 - 'e2e% '.length)
    expect(await lineAfter(`${PROMPT}${head}\r\n${long.slice(head.length)}`)).toBe(long)
    // A prompt that fills its row: the line starts on the next.
    expect(await lineAfter(`${A}${'p'.repeat(40)}${B}ls`)).toBe('ls')
    expect(await lineAfter(`${A}${'p'.repeat(40)}${B}\r\nls`)).toBe('ls')
    // The row under the line that is not wrapped from it (a list of completions) is not the line.
    expect(await lineAfter(`${PROMPT}git ch\r\ncheckout  cherry-pick\x1b[A\x1b[12G`)).toBe('git ch')
  })

  it('grey text after the line stays out: the Suggestion and a grey note; grey text typed before the cursor stays', async () => {
    expect(await lineAfter(`${PROMPT}git st${GREY('atus --short')}${LEFT(12)}`)).toBe('git st')
    expect(await lineAfter(`${PROMPT}ls${GREY('  Asking Claude…')}${LEFT(16)}`)).toBe('ls')
    // A Suggestion that wraps onto the next row; the cursor back after `echo`.
    expect(await lineAfter(`${PROMPT}echo${GREY(' ' + 'z'.repeat(40))}\x1b[A\x1b[10G`)).toBe('echo')
    // Highlighting of the user's that paints typed text grey: the cursor is after it, so it is typed.
    expect(await lineAfter(`${PROMPT}${GREY('# note')}`)).toBe('# note')
  })

  it('a right prompt at the edge of the row stays out; text typed with spaces stays in', async () => {
    // zsh draws RPROMPT at the edge, `indent` cells from it, and puts the cursor back after the line.
    const right = (typed: string, rprompt: string, indent = 1, cols = 40) => `${PROMPT}${typed}\x1b[${cols - indent - rprompt.length + 1}G${rprompt}\x1b[${'e2e% '.length + typed.length + 1}G`
    expect(await lineAfter(right('git log', '[main] 14:20'))).toBe('git log')
    expect(await lineAfter(right('git log', '%', 0))).toBe('git log')
    // The cursor moved left into the line: the text right of it is still typed.
    expect(await lineAfter(`${right('git log --oneline', 'rp')}${LEFT(10)}`)).toBe('git log --oneline')
    // Text after a gap that does not reach the edge is typed.
    expect(await lineAfter(`${PROMPT}echo a${' '.repeat(RIGHT_PROMPT_GAP + 2)}b`)).toBe(`echo a${' '.repeat(RIGHT_PROMPT_GAP + 2)}b`)
    // A gap shorter than RIGHT_PROMPT_GAP up to the edge is typed too.
    const typed = `echo ${'w'.repeat(24)}${' '.repeat(RIGHT_PROMPT_GAP - 1)}e`
    expect(typed.length + 'e2e% '.length).toBe(39)
    expect(await lineAfter(`${PROMPT}${typed}`)).toBe(typed)
    // A gap at the edge, but the line wraps on: typed.
    const wrapped = `echo a${' '.repeat(28)}b${'c'.repeat(10)}`
    expect(await lineAfter(`${PROMPT}${wrapped}`)).toBe(wrapped)
  })

  it('a line with a space at its start keeps it: the context drops such a line (prepareContext)', async () => {
    expect(await lineAfter(`${PROMPT} export TOKEN=abc`)).toBe(' export TOKEN=abc')
  })

  it('a line on the screen longer than the channel takes comes cut to it', async () => {
    const line = `echo ${Array.from({ length: 250 }, () => 'w'.repeat(9)).join(' ')}`
    expect(line.length).toBeGreaterThan(MAX_FIELD_CHARS)
    const read = await lineAfter(`${PROMPT}${line}`, 200)
    expect(read.length).toBeLessThanOrEqual(MAX_FIELD_CHARS)
    expect(line.startsWith(read)).toBe(true)
  })

  it('a line longer than the channel takes is cut before the word the cut falls in', () => {
    const word = 'w'.repeat(10)
    const line = Array.from({ length: 300 }, () => word).join(' ')
    const cut = lineWithinLimit(line)
    expect(cut.length).toBeLessThanOrEqual(MAX_FIELD_CHARS)
    expect(cut.length).toBeGreaterThan(MAX_FIELD_CHARS - word.length - 1)
    expect(cut.trimEnd().split(' ').every((part) => part === word)).toBe(true)
    expect(line.startsWith(cut)).toBe(true)
    expect(lineWithinLimit('short')).toBe('short')
  })
})
