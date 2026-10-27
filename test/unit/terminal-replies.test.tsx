// The automatic answers of a screen's terminal to the program in the shell (worfy-windows tickets
// 39 and 68): xterm.js answers a request for the device attributes (`ESC[c`), for the cursor
// position (`ESC[6n`), for a mode or a setting, for a colour (`ESC]11;?`) and, once a program turns
// focus reports on (`ESC[?1004h`), reports the focus (`ESC[I`, `ESC[O`). main answers the requests
// whose answer does not depend on the screen itself and drops the view's marked answer to them;
// the colours stay with the view. Those answers are not the user's input:
//   - they reach the shell, but leave the size of the pty with the screen that typed or clicked
//     last (ADR-0053, decision 5);
//   - the answers a new view gives while it redraws the kept output (the replay) go nowhere: the
//     requests in it were answered when they came.
//
// The Terminal Node is the real component with the real xterm.js; only `open()` draws nothing, as
// xterm.js cannot draw in jsdom. main is the real TerminalRegistry over a stand-in pty that prints
// what the test gives it and records what it is told. The renderer IPC client is replaced by a
// direct call into the registry, through the real schema of each channel.
//
// The registry is main's code, outside the files of the web test project of tsc
// (tsconfig.test.web.json): it is loaded here by a path tsc does not follow, and described by the
// part of its interface this test calls (Registry). tsc does not compare that part with pty.ts: a
// change there shows here when the test runs. The handler's own call of `write` with `reply` is
// typed against the registry (src/main/ipc/terminal.ts) and tested in test/contract/terminal.test.ts.
//
// The last part: a new view writes the kept output at the pty sizes it came at, and is not fitted
// to its Node until it is all written (worfy-windows ticket 89).
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Terminal as HeadlessTerminal } from '@xterm/headless'
import type { Terminal as XtermTerminal } from '@xterm/xterm'
import { watchUserInput } from '../../src/renderer/canvas/nodes/terminal-user-input'
import { terminalInput, terminalOpen, terminalResize, terminalTakeSize } from '../../src/shared/ipc/terminal'

/** What the registry sends a subscriber (TerminalSink of src/main/terminal/pty.ts). */
interface Sink {
  output(data: string, end: number): void
  exit(exitCode: number, signal: number | null): void
  started(pid: number): void
}
/** The part of TerminalRegistry (src/main/terminal/pty.ts) this test calls. */
interface Registry {
  open(key: string, request: { cwd: string; cols: number; rows: number; restart?: boolean | undefined }, client: object, sink: Sink): Promise<unknown>
  write(key: string, data: string, client: object, options: { reply?: boolean }): void
  resize(key: string, cols: number, rows: number, client: object): void
  takeSize(key: string, cols: number, rows: number, client: object): void
}
type RegistryOptions = { env: () => Promise<Record<string, string>>; spawn: () => StandInPty; platform: 'linux' }
const ptyModule = '../../src/main/terminal/pty'
const { TerminalRegistry } = (await import(/* @vite-ignore */ ptyModule)) as { TerminalRegistry: new (options: RegistryOptions) => Registry }

const PROJECT = 'alpha-0000000a'
const NODE = 'terminal-node-1'
const KEY = JSON.stringify([PROJECT, NODE])
const ESC = '\x1b'
/** What xterm.js 6.0.0 answers to `ESC[c`. */
const DEVICE_ATTRIBUTES = `${ESC}[?1;2c`
/** The focus report of a screen whose terminal does not have the focus. */
const FOCUS_OUT = `${ESC}[O`
/**
 * Output only a view answers: focus reports turned on, and a view reports its focus at once (main's
 * screen has none). The colour queries are the view's too, but its xterm.js answers them from the
 * theme of its renderer, which jsdom does not give it (open() draws nothing here).
 */
const VIEW_REQUEST = `${ESC}[?1004h`
/** What the view answers to VIEW_REQUEST. */
const VIEW_ANSWER = FOCUS_OUT
/** What the view sent main on `terminal.input`, in order. */
const inputs: { data: string; reply?: boolean | undefined }[] = []
/** The size the Node asks for in jsdom, where it cannot measure itself (SIZE_BEFORE_LAYOUT). */
const VIEW_SIZE = { cols: 80, rows: 24 }
/** The size of the other screen: it opened the terminal first. */
const OTHER_SIZE = { cols: 120, rows: 40 }

/** The xterm.js instances of the Nodes, in the order they were made. */
const xterms = vi.hoisted(() => [] as XtermTerminal[])
/**
 * Runs once, right after the next write that has a callback has been handed to xterm.js and before
 * xterm.js parses it: the Node's write of the kept output, when the test sets it before mounting.
 * `parsed` is that write's callback: a test may call it itself, to end the parse at a moment it picks.
 */
const whileReplaying = vi.hoisted(() => ({ run: null as ((xterm: XtermTerminal, parsed: () => void) => void) | null }))
/** What FitAddon proposes: nothing (jsdom cannot measure), unless a test sets a size. */
const fitted = vi.hoisted(() => ({ size: undefined as { cols: number; rows: number } | undefined }))
/** The callbacks of the ResizeObservers made: a test calls them as a new layout of the Node would. */
const observers = vi.hoisted(() => [] as (() => void)[])
/** The renderer IPC client as the Node sees it; each test points it at its registry. */
const wire = vi.hoisted(() => {
  const invoke: (channel: string, input: unknown) => Promise<unknown> = () => Promise.reject(new Error('no registry'))
  const subscribe: (channel: string, handler: (payload: never) => void) => () => void = () => () => undefined
  return { invoke, subscribe }
})

vi.mock('@xterm/xterm', async () => {
  const real = await vi.importActual<typeof import('@xterm/xterm')>('@xterm/xterm')
  class Terminal extends real.Terminal {
    constructor(...args: ConstructorParameters<typeof real.Terminal>) {
      super(...args)
      xterms.push(this)
    }
    // xterm.js does not draw in jsdom; its parser, buffer and answers work without a screen.
    override open(): void {}
    override write(data: string | Uint8Array, callback?: () => void): void {
      super.write(data, callback)
      const run = whileReplaying.run
      if (callback === undefined || run === null) return
      whileReplaying.run = null
      run(this, callback)
    }
  }
  return { ...real, Terminal }
})
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    activate() {}
    dispose() {}
    proposeDimensions() {
      return fitted.size
    }
  },
}))
vi.mock('@xterm/xterm/css/xterm.css', () => ({}))
vi.mock('../../src/renderer/ipc', () => ({
  invoke: (channel: string, input: unknown) => wire.invoke(channel, input),
  subscribe: (channel: string, handler: (payload: never) => void) => wire.subscribe(channel, handler),
  hasPreloadBridge: () => (globalThis as { worfy?: unknown }).worfy !== undefined,
}))
vi.mock('../../src/renderer/projects/useProjects', () => ({
  useProjects: () => undefined,
  activeProject: () => ({ id: 'alpha-0000000a' }),
}))
vi.mock('../../src/renderer/canvas/useLayout', () => ({ useLayoutOps: () => ({ apply: vi.fn() }) }))
vi.mock('../../src/renderer/canvas/NodeResizeClamp', () => ({ NodeResizeClamp: () => null }))

const { default: TerminalNode } = await import('../../src/renderer/canvas/nodes/TerminalNode')

/** A pty (PtyProcess of src/main/terminal/pty.ts) that prints what the test gives it and records its writes and resizes, in order. */
class StandInPty {
  // No process has this pid: closing the registry signals it, and the signal must reach nobody.
  readonly pid = 999_999_999
  readonly calls: (['resize', number, number] | ['write', string])[] = []
  private readonly data: ((data: string) => void)[] = []
  private readonly exits: ((event: { exitCode: number }) => void)[] = []
  private ended = false
  onData(listener: (data: string) => void): void {
    this.data.push(listener)
  }
  onExit(listener: (event: { exitCode: number }) => void): void {
    this.exits.push(listener)
  }
  write(data: string): void {
    this.calls.push(['write', data])
  }
  resize(cols: number, rows: number): void {
    this.calls.push(['resize', cols, rows])
  }
  /** The shell prints `text`. */
  print(text: string): void {
    for (const listener of this.data) listener(text)
  }
  kill(): void {
    if (this.ended) return
    this.ended = true
    for (const listener of this.exits) listener({ exitCode: 0 })
  }
  /** What was written into the shell. */
  get writes(): string[] {
    return this.calls.flatMap((call) => (call[0] === 'write' ? [call[1]] : []))
  }
  get resizes(): [number, number][] {
    return this.calls.flatMap((call) => (call[0] === 'resize' ? [[call[1], call[2]] as [number, number]] : []))
  }
}

const ptys: StandInPty[] = []
const nodeProps = { id: NODE, data: { node: { id: NODE, kind: 'terminal', locked: false } }, selected: false } as unknown as Parameters<typeof TerminalNode>[0]

/**
 * A registry with a running stand-in shell, opened first by another screen with OTHER_SIZE, and the
 * IPC client of this screen pointed at it. `duringOpen` runs after main attached this screen and
 * before its answer reaches the Node.
 */
async function terminal(options: { otherScreen: boolean; duringOpen?: (pty: StandInPty) => void } = { otherScreen: true }) {
  const spawn = () => {
    const pty = new StandInPty()
    ptys.push(pty)
    return pty
  }
  const registry = new TerminalRegistry({ env: async () => ({ SHELL: '/bin/sh' }), spawn, platform: 'linux' })
  const nothing: Sink = { output: () => undefined, exit: () => undefined, started: () => undefined }
  const other = {}
  const view = {}
  if (options.otherScreen) await registry.open(KEY, { cwd: '/', ...OTHER_SIZE }, other, nothing)
  else await registry.open(KEY, { cwd: '/', ...VIEW_SIZE }, view, nothing)
  const pty = ptys.at(-1)
  if (pty === undefined) throw new Error('no pty')

  const handlers = new Map<string, Set<(payload: never) => void>>()
  const emit = (channel: string, payload: unknown) => {
    for (const handler of handlers.get(channel) ?? []) (handler as (payload: unknown) => void)(payload)
  }
  const sink: Sink = {
    output: (data, end) => emit('terminal.output', { projectId: PROJECT, nodeId: NODE, data, end }),
    exit: (exitCode, signal) => emit('terminal.exit', { projectId: PROJECT, nodeId: NODE, exitCode, signal }),
    started: (pid) => emit('terminal.started', { projectId: PROJECT, nodeId: NODE, pid }),
  }
  wire.subscribe = (channel, handler) => {
    const set = handlers.get(channel) ?? new Set()
    set.add(handler)
    handlers.set(channel, set)
    return () => set.delete(handler)
  }
  wire.invoke = async (channel, input) => {
    try {
      switch (channel) {
        case 'terminal.open': {
          const { cols, rows, restart } = terminalOpen.input.parse(input)
          const value = await registry.open(KEY, { cwd: '/', cols, rows, restart }, view, sink)
          options.duringOpen?.(pty)
          return { ok: true, value }
        }
        case 'terminal.input': {
          const { data, reply } = terminalInput.input.parse(input)
          inputs.push({ data, reply })
          registry.write(KEY, data, view, { reply: reply === true })
          return { ok: true, value: undefined }
        }
        case 'terminal.resize': {
          const { cols, rows } = terminalResize.input.parse(input)
          registry.resize(KEY, cols, rows, view)
          return { ok: true, value: undefined }
        }
        case 'terminal.takeSize': {
          const { cols, rows } = terminalTakeSize.input.parse(input)
          registry.takeSize(KEY, cols, rows, view)
          return { ok: true, value: undefined }
        }
        default:
          return { ok: false, error: `${channel} is not served here` }
      }
    } catch (error) {
      return { ok: false, error: String(error) }
    }
  }
  return { registry, pty, other, view }
}

/** Mounts the Node and waits until it shows the shell in `state` and xterm.js has parsed all it was given. */
async function mount(state: 'running' | 'exited' = 'running') {
  const shown = render(<TerminalNode {...nodeProps} />)
  await waitFor(() => expect(screen.getByTestId('terminal-node').dataset.state).toBe(state))
  const xterm = xterms.at(-1)
  if (xterm === undefined) throw new Error('no xterm.js')
  await parsed(xterm)
  return { shown, xterm }
}

/** Resolves once xterm.js has parsed everything written to it so far, and the answers it gave went out. */
async function parsed(xterm: XtermTerminal): Promise<void> {
  await act(() => new Promise<void>((resolve) => xterm.write('', resolve)))
}

/** The shell prints `text`; resolves once the Node's xterm.js has parsed it. */
async function print(pty: StandInPty, xterm: XtermTerminal, text: string): Promise<void> {
  pty.print(text)
  await parsed(xterm)
}

beforeEach(() => {
  xterms.length = 0
  inputs.length = 0
  whileReplaying.run = null
  fitted.size = undefined
  observers.length = 0
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        observers.push(callback)
      }
      observe() {}
      disconnect() {}
    },
  )
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined }))
})

afterEach(() => {
  ptys.splice(0).forEach((pty) => pty.kill())
  vi.unstubAllGlobals()
})

describe('the answers of a screen to the program in the shell (worfy-windows ticket 39)', () => {
  it('a second screen that only opens the Terminal leaves the size of the pty where it is, whatever the kept output asks', async () => {
    const { pty } = await terminal()
    pty.print(`PS C:\\> ${ESC}[c${ESC}[?1004h${ESC}[6nvim is waiting`)
    // main answers the device attributes and the cursor request when they come (cursor-answers.ts).
    await waitFor(() => expect(pty.writes).toEqual([DEVICE_ATTRIBUTES, `${ESC}[1;9R`]))
    pty.calls.length = 0

    await mount()

    expect(pty.resizes).toEqual([])
    // The requests in the kept output were answered when they came: the redraw sends nothing.
    expect(pty.writes).toEqual([])
  })

  it('an answer to a live request and a focus report reach the shell and leave the size; typing takes it', async () => {
    const { pty, registry, other } = await terminal()
    const { xterm } = await mount()
    pty.calls.length = 0

    await print(pty, xterm, `${ESC}[?1004h`)
    await print(pty, xterm, `${ESC}[c`)
    await print(pty, xterm, `${ESC}[6n`)
    // The focus report is the view's answer. The device attributes and the cursor position are
    // main's (cursor-answers.ts), a moment later; the view's own go nowhere.
    await waitFor(() => expect(pty.calls).toHaveLength(3))
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(pty.calls).toEqual([
      ['write', FOCUS_OUT],
      ['write', DEVICE_ATTRIBUTES],
      // Nothing visible was printed: the cursor is in the first cell.
      ['write', `${ESC}[1;1R`],
    ])

    // Typed keys, as xterm.js sends a key or a paste: the screen that typed owns the size.
    act(() => xterm.input('ls\r'))
    expect(pty.calls.slice(3)).toEqual([
      ['resize', VIEW_SIZE.cols, VIEW_SIZE.rows],
      ['write', 'ls\r'],
    ])

    // An answer after typing is an answer again: the mark of the typed keys does not stay.
    await act(() => registry.takeSize(KEY, OTHER_SIZE.cols, OTHER_SIZE.rows, other))
    pty.calls.length = 0
    await print(pty, xterm, VIEW_REQUEST)
    expect(pty.calls).toEqual([['write', VIEW_ANSWER]])
  })

  it('the view marks its answers to the requests main now answers too (DA2, DSR, DECRQM, DECRQSS); the shell gets one answer to each, main’s (worfy-windows ticket 68)', async () => {
    const { pty } = await terminal()
    const { xterm } = await mount()
    pty.calls.length = 0
    inputs.length = 0

    for (const request of [`${ESC}[>c`, `${ESC}[5n`, `${ESC}[?2004$p`, `${ESC}[4$p`, `${ESC}P$qm${ESC}\\`]) await print(pty, xterm, request)

    const answers = [`${ESC}[>0;276;0c`, `${ESC}[0n`, `${ESC}[?2004;2$y`, `${ESC}[4;2$y`, `${ESC}P1$r0m${ESC}\\`]
    expect(inputs).toEqual(answers.map((data) => ({ data, reply: true })))
    await waitFor(() => expect(pty.writes).toHaveLength(answers.length))
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(pty.writes).toEqual(answers)
    expect(pty.resizes).toEqual([])
  })

  it('a view mounted again writes nothing while it redraws the kept output; a live request after that is answered', async () => {
    const { pty } = await terminal({ otherScreen: false })
    // Focus reports turned on: the view's to answer (main answers the device attributes itself, ticket 68).
    pty.print(`$ vim${ESC}[1t${VIEW_REQUEST}${ESC}[?1004h${ESC}[?9001h`)
    const first = await mount()
    first.shown.unmount()
    pty.calls.length = 0

    // The Node left the viewport and came back: a new xterm.js redraws the kept output.
    const again = await mount()
    expect(pty.writes).toEqual([])

    await print(pty, again.xterm, VIEW_REQUEST)
    expect(pty.writes).toEqual([VIEW_ANSWER])
  })

  it('a request that comes while the view opens is answered once, after the kept output is redrawn', async () => {
    const { pty } = await terminal({ otherScreen: true, duringOpen: (shell) => shell.print(VIEW_REQUEST) })
    pty.print(VIEW_REQUEST)
    pty.calls.length = 0

    await mount()

    expect(pty.writes).toEqual([VIEW_ANSWER])
    expect(pty.resizes).toEqual([])
  })

  it('cursor requests before, while and after a view opens (about ten after a resize, as node-pty 1.2.0-beta.15 sends them): each answered once, by main', async () => {
    const tenAfterResize = `${ESC}[6n`.repeat(10)
    const { pty } = await terminal({ otherScreen: true, duringOpen: (shell) => shell.print(`${ESC}[6n`) })
    // No view yet: main answers the ten at once.
    pty.print(`PS> ${tenAfterResize}`)
    await waitFor(() => expect(pty.writes).toHaveLength(10))
    whileReplaying.run = () => pty.print(`${ESC}[6n`)

    const { xterm } = await mount()
    await print(pty, xterm, `${ESC}[6n`)

    // Ten before the view, one while it opened, one while it parsed the kept output, one live.
    await waitFor(() => expect(pty.writes).toHaveLength(13))
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(pty.writes).toEqual(Array.from({ length: 13 }, () => `${ESC}[1;5R`))
    expect(pty.resizes).toEqual([])
  })

  it('output that comes while the kept output is parsed is shown after it, in order, and its request is answered once', async () => {
    const { pty } = await terminal()
    pty.print(`first|${VIEW_REQUEST}`)
    pty.calls.length = 0
    whileReplaying.run = () => {
      pty.print('second|')
      pty.print(`third|${VIEW_REQUEST}`)
    }

    const { xterm } = await mount()

    expect(firstLine(xterm)).toBe('first|second|third|')
    expect(pty.writes).toEqual([VIEW_ANSWER])
    expect(pty.resizes).toEqual([])
  })

  it('keys typed while the kept output is parsed reach the shell once the view attaches, and take the size', async () => {
    const { pty } = await terminal()
    pty.print(`first|${VIEW_REQUEST}`)
    pty.calls.length = 0
    whileReplaying.run = (xterm) => xterm.input('x')

    await mount()

    expect(pty.calls).toEqual([
      ['resize', VIEW_SIZE.cols, VIEW_SIZE.rows],
      ['write', 'x'],
    ])
  })

  it('a click while the kept output is parsed takes the size once the view attaches', async () => {
    const { pty } = await terminal()
    pty.print(`first|${VIEW_REQUEST}`)
    pty.calls.length = 0
    whileReplaying.run = () => fireEvent.mouseDown(screen.getByTestId('terminal-screen'))

    await mount()

    expect(pty.calls).toEqual([['resize', VIEW_SIZE.cols, VIEW_SIZE.rows]])
  })

  it('a shell that exits while the kept output is parsed: its last output is shown, the header keeps its name, nothing is written', async () => {
    const { pty } = await terminal()
    pty.print(`first|${VIEW_REQUEST}`)
    pty.calls.length = 0
    whileReplaying.run = (xterm) => {
      pty.print(`bye|${VIEW_REQUEST}`)
      xterm.input('x')
      pty.kill()
    }

    const { xterm, shown } = await mount('exited')

    // The parse has ended by now (mount waits for it): the view did not attach to the gone shell.
    expect(screen.getByTestId('terminal-node').dataset.state).toBe('exited')
    expect(firstLine(xterm)).toBe('first|bye|')
    expect(shown.container.querySelector('.w-terminal__shell')?.textContent).toBe('sh')
    expect(pty.calls).toEqual([])
  })

  it('a view that goes while the kept output is parsed does not attach when the parse ends: what it typed before going is not sent', async () => {
    const { pty } = await terminal()
    pty.print(`first|${VIEW_REQUEST}`)
    pty.calls.length = 0
    const view: { shown?: ReturnType<typeof render> } = {}
    let ended = false
    whileReplaying.run = (xterm, parsed) => {
      xterm.input('x')
      act(() => view.shown?.unmount())
      // The end of the parse comes after the view went.
      parsed()
      ended = true
    }

    view.shown = render(<TerminalNode {...nodeProps} />)

    await waitFor(() => expect(ended).toBe(true))
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(pty.calls).toEqual([])
  })
})

// Off Windows main keeps what reaches the pty after the shell exited on its own and sends it to the
// screens (pty.ts, deliver); the open view shows it too, until a new shell starts on the Node
// (worfy-polish ticket 38). The registry here runs as on Linux.
describe('output after the shell exited on its own (worfy-polish ticket 38)', () => {
  const state = () => screen.getByTestId('terminal-node').dataset.state

  it('an open view writes what comes after the exit; a view mounted again shows it once', async () => {
    const { pty } = await terminal()
    const { xterm, shown } = await mount()
    await print(pty, xterm, 'first|')
    act(() => pty.kill())
    await waitFor(() => expect(state()).toBe('exited'))

    await print(pty, xterm, 'late|')

    expect(firstLine(xterm)).toBe('first|late|')
    shown.unmount()
    const again = await mount('exited')
    expect(firstLine(again.xterm)).toBe('first|late|')
  })

  it('what comes after an exit while the kept output is parsed is written once, after it', async () => {
    const { pty } = await terminal()
    pty.print('first|')
    whileReplaying.run = () => {
      pty.print('bye|')
      pty.kill()
      pty.print('late|')
    }

    const { xterm } = await mount('exited')
    await print(pty, xterm, 'later|')

    expect(firstLine(xterm)).toBe('first|bye|late|later|')
  })

  it('a view of a shell that had exited writes what comes while it redraws the kept output and after, once', async () => {
    const { pty } = await terminal()
    pty.print('first|')
    pty.kill()
    pty.print('kept|')
    whileReplaying.run = () => pty.print('during|')

    const { xterm } = await mount('exited')
    await print(pty, xterm, 'after|')

    expect(firstLine(xterm)).toBe('first|kept|during|after|')
  })

  it('once a new shell starts on the Node, the view shows that one: what the old shell prints after it does not reach the new screen', async () => {
    const { pty, registry, other } = await terminal()
    const { xterm } = await mount()
    await print(pty, xterm, 'old|')
    act(() => pty.kill())
    await waitFor(() => expect(state()).toBe('exited'))

    // Restart on the other screen: the view opens again, on the new shell.
    const nothing: Sink = { output: () => undefined, exit: () => undefined, started: () => undefined }
    await act(async () => {
      await registry.open(KEY, { cwd: '/', ...OTHER_SIZE, restart: true }, other, nothing)
      // Before React runs the view again: the old view, still subscribed, leaves it alone.
      ptys.at(-1)?.print('early|')
    })
    const fresh = ptys.at(-1)
    await waitFor(() => expect([xterms.length, state()]).toEqual([2, 'running']))
    const next = xterms[1]
    if (fresh === undefined || fresh === pty || next === undefined) throw new Error('no new shell')
    await parsed(next)
    pty.print('stale|')
    await print(fresh, next, 'new|')

    expect(firstLine(xterm)).toBe('old|')
    expect(firstLine(next)).toBe('early|new|')
  })
})

describe('watchUserInput', () => {
  it('an xterm.js that does not say which data is the user’s: the answers main gives itself and the colour answers count as answers, the rest as typed', () => {
    const watch = watchUserInput({} as XtermTerminal)
    // Shift+F3 is the same bytes as an answer: in this fallback it is taken for one.
    const answers = [
      `${ESC}[1;2R`,
      `${ESC}[12;40R${ESC}[12;40R`,
      DEVICE_ATTRIBUTES,
      `${ESC}[>0;276;0c`,
      `${ESC}[0n`,
      `${ESC}[?2004;2$y`,
      `${ESC}[4;2$y`,
      `${ESC}P1$r0m${ESC}\\`,
      `${ESC}]11;rgb:1e1e/1e1e/1e1e${ESC}\\`,
      `${ESC}]4;1;rgb:cdcd/3131/3131${ESC}\\`,
    ]
    const typed = ['ls\r', FOCUS_OUT, `${ESC}[1;2Rx`, `${DEVICE_ATTRIBUTES}ls`, `${ESC}]11;?${ESC}\\`]
    expect(answers.map((data) => watch.take(data))).toEqual(answers.map(() => false))
    expect(typed.map((data) => watch.take(data))).toEqual(typed.map(() => true))
    watch.dispose()
  })
})

/** The first row of the normal buffer, as text. */
function firstLine(xterm: XtermTerminal): string | undefined {
  return xterm.buffer.active.getLine(0)?.translateToString(true)
}

/** Every line of a terminal, the scrollback too, with the trailing blanks cut. */
function allLines(terminal: { buffer: { active: { length: number; getLine(index: number): { translateToString(trim: boolean): string } | undefined } } }): string[] {
  const buffer = terminal.buffer.active
  return Array.from({ length: buffer.length }, (_, index) => buffer.getLine(index)?.translateToString(true) ?? '')
}

describe('the replay at the sizes of the pty (worfy-windows ticket 89)', () => {
  /** The size of the Node the view fills. */
  const NODE_SIZE = { cols: 30, rows: 8 }
  /** Output right only at its size, as ConPTY's after a resize: a mark at column 35 of 40, then a line at the last row of 20x5. */
  const AT_40X10 = 'one\r\n\x1b[35Gx\r\ntwo\r\n'
  const AT_20X5 = '\x1b[5;1Hmarker-one\x1b[K'
  let now = 0

  beforeEach(() => {
    now = 0
    // The clock of main's runs of resizes: each resize below is a second after the one before.
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    // The Node has a layout, and FitAddon proposes NODE_SIZE for it.
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(640)
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(320)
    fitted.size = { ...NODE_SIZE }
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  /**
   * A shell that drew output at 40x10 and at 20x5, through main, and the screen of a view that got
   * it live: xterm.js without a display, given the same output and resizes as they came, then the
   * size of the new view, which main gives the pty when the view opens.
   */
  async function drawn() {
    const shell = await terminal({ otherScreen: false })
    const live = new HeadlessTerminal({ cols: 40, rows: 10, scrollback: 5000, allowProposedApi: true })
    const write = (data: string) => new Promise<void>((resolve) => live.write(data, resolve))
    now += 1000
    shell.registry.resize(KEY, 40, 10, shell.view)
    shell.pty.print(AT_40X10)
    await write(AT_40X10)
    now += 1000
    shell.registry.resize(KEY, 20, 5, shell.view)
    live.resize(20, 5)
    shell.pty.print(AT_20X5)
    await write(AT_20X5)
    now += 1000
    live.resize(NODE_SIZE.cols, NODE_SIZE.rows)
    shell.pty.calls.length = 0
    return { ...shell, live }
  }

  it('a new view draws the screen the live view has', async () => {
    const { pty, live } = await drawn()

    const { xterm } = await mount()

    expect({ cols: xterm.cols, rows: xterm.rows }).toEqual(NODE_SIZE)
    expect(allLines(xterm)).toEqual(allLines(live))
    expect(allLines(xterm).join('\n')).toContain('marker-one')
    // The pty took the view's size when it opened, and nothing after.
    expect(pty.resizes).toEqual([[NODE_SIZE.cols, NODE_SIZE.rows]])
  })

  it('after the replay a new layout of the Node fits the view again, and the pty takes its size', async () => {
    const { pty } = await drawn()
    const { xterm } = await mount()
    fitted.size = { cols: 40, rows: 12 }

    act(() => {
      for (const callback of observers) callback()
    })

    expect({ cols: xterm.cols, rows: xterm.rows }).toEqual({ cols: 40, rows: 12 })
    expect(pty.resizes.at(-1)).toEqual([40, 12])
  })

  it('a layout that changes while the kept output is written is taken once it is all written', async () => {
    const { pty } = await drawn()
    whileReplaying.run = () => {
      fitted.size = { cols: 40, rows: 12 }
      for (const callback of observers) callback()
    }

    const { xterm } = await mount()

    expect({ cols: xterm.cols, rows: xterm.rows }).toEqual({ cols: 40, rows: 12 })
    expect(pty.resizes).toEqual([
      [NODE_SIZE.cols, NODE_SIZE.rows],
      [40, 12],
    ])
  })

  it('a new layout of the Node while the kept output is written fits the view only once it is all written', async () => {
    const { pty, live } = await drawn()
    // Right after the first piece is handed to xterm.js, before it is parsed: as the ResizeObserver
    // fires on the frame after it observes, racing the answer to terminal.open.
    whileReplaying.run = () => {
      for (const callback of observers) callback()
    }

    const { xterm } = await mount()

    expect(whileReplaying.run).toBeNull()
    expect({ cols: xterm.cols, rows: xterm.rows }).toEqual(NODE_SIZE)
    expect(allLines(xterm)).toEqual(allLines(live))
    expect(pty.resizes).toEqual([[NODE_SIZE.cols, NODE_SIZE.rows]])
  })
})
