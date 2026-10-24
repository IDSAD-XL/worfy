// The "Sign in with gh" view marks its xterm.js answers to gh (worfy-windows ticket 39): main
// answers gh's cursor-position requests itself and drops a marked answer to them; an unmarked one
// would reach gh as a second answer. Typed keys go unmarked. It writes the kept output at the sizes
// of the pty it came at, as a Terminal Node does (worfy-windows ticket 89).
//
// The real SignInTerminal (src/renderer/projects/GithubAccount.tsx) with the real xterm.js (without
// drawing: jsdom has no canvas), over a stand-in of the renderer IPC client that records the calls.
import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Terminal as XtermTerminal } from '@xterm/xterm'

const ESC = '\x1b'
const SIGN_IN = 'signin-view-1'

const xterms = vi.hoisted(() => [] as XtermTerminal[])
/** What `projects.connect.signIn` answers: the kept output of the sign-in and the sizes of the pty it came at. */
const opened = vi.hoisted(() => ({ replay: '', sizes: undefined as { at: number; cols: number; rows: number }[] | undefined }))
/** Every non-empty text handed to xterm.js, with the size the terminal had then. */
const writes = vi.hoisted(() => [] as { data: string; cols: number; rows: number }[])
/** Runs once, right after the next write of a non-empty text is handed to xterm.js and before xterm.js parses it. */
const whileParsing = vi.hoisted(() => ({ run: null as ((xterm: XtermTerminal) => void) | null }))
const wire = vi.hoisted(() => ({
  calls: [] as { channel: string; input: unknown }[],
  handlers: new Map<string, (payload: unknown) => void>(),
}))

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
      if (typeof data === 'string' && data !== '') writes.push({ data, cols: this.cols, rows: this.rows })
      super.write(data, callback)
      const run = whileParsing.run
      if (run === null || data.length === 0) return
      whileParsing.run = null
      run(this)
    }
  }
  return { ...real, Terminal }
})
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    activate() {}
    dispose() {}
    proposeDimensions() {
      return undefined
    }
  },
}))
vi.mock('@xterm/xterm/css/xterm.css', () => ({}))
vi.mock('../../src/renderer/ipc', () => ({
  invoke: (channel: string, input: unknown) => {
    wire.calls.push({ channel, input })
    if (channel === 'projects.connect.signIn') return Promise.resolve({ ok: true, value: { replay: opened.replay, end: opened.replay.length, sizes: opened.sizes, exited: null } })
    return Promise.resolve({ ok: true, value: undefined })
  },
  invokeOn: () => Promise.resolve({ ok: false, error: 'not served here' }),
  subscribe: (channel: string, handler: (payload: unknown) => void) => {
    wire.handlers.set(channel, handler)
    return () => wire.handlers.delete(channel)
  },
  hasPreloadBridge: () => (globalThis as { worfy?: unknown }).worfy !== undefined,
}))

const { SignInTerminal } = await import('../../src/renderer/projects/GithubAccount')

beforeEach(() => {
  xterms.length = 0
  opened.replay = ''
  opened.sizes = undefined
  writes.length = 0
  whileParsing.run = null
  wire.calls.length = 0
  wire.handlers.clear()
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined }))
})
afterEach(() => vi.unstubAllGlobals())

/** What the view sent on `projects.connect.signInInput`. */
const inputs = () => wire.calls.filter((call) => call.channel === 'projects.connect.signInInput').map((call) => call.input)

describe('the sign-in view (worfy-windows ticket 39)', () => {
  it('its answer to a cursor request goes marked as an answer; typed keys do not', async () => {
    render(<SignInTerminal signInId={SIGN_IN} onExit={() => undefined} onClose={() => undefined} />)
    await waitFor(() => expect(screen.getByTestId('connect-signin').dataset.state).toBe('running'))
    const xterm = xterms.at(-1)
    if (xterm === undefined) throw new Error('no xterm.js')

    const output = `? Where do you use GitHub? ${ESC}[6n`
    act(() => wire.handlers.get('projects.connect.signInOutput')?.({ signInId: SIGN_IN, data: output, end: output.length }))
    await act(() => new Promise<void>((resolve) => xterm.write('', resolve)))
    act(() => xterm.input('\r'))

    expect(inputs()).toEqual([
      { signInId: SIGN_IN, data: `${ESC}[1;28R`, reply: true },
      { signInId: SIGN_IN, data: '\r' },
    ])
  })

  it('the requests in the kept output were answered when they came: the view attaches once it has parsed it, and a key typed meanwhile is sent then', async () => {
    opened.replay = `? Where do you use GitHub? ${ESC}[c${ESC}[6n`
    whileParsing.run = (xterm) => xterm.input('x')
    render(<SignInTerminal signInId={SIGN_IN} onExit={() => undefined} onClose={() => undefined} />)
    await waitFor(() => expect(screen.getByTestId('connect-signin').dataset.state).toBe('running'))
    const xterm = xterms.at(-1)
    if (xterm === undefined) throw new Error('no xterm.js')
    await act(() => new Promise<void>((resolve) => xterm.write('', resolve)))

    expect(inputs()).toEqual([{ signInId: SIGN_IN, data: 'x' }])
  })
})

describe('the kept output of the sign-in view (worfy-windows ticket 89)', () => {
  it('is written at the sizes of the pty it came at; then the view has its own size again', async () => {
    opened.replay = 'at forty|at sixty'
    opened.sizes = [
      { at: 0, cols: 40, rows: 10 },
      { at: 'at forty|'.length, cols: 60, rows: 12 },
    ]
    render(<SignInTerminal signInId={SIGN_IN} onExit={() => undefined} onClose={() => undefined} />)
    await waitFor(() => expect(screen.getByTestId('connect-signin').dataset.state).toBe('running'))
    const xterm = xterms.at(-1)
    if (xterm === undefined) throw new Error('no xterm.js')

    expect(writes).toEqual([
      { data: 'at forty|', cols: 40, rows: 10 },
      { data: 'at sixty', cols: 60, rows: 12 },
    ])
    // The view's own size: xterm.js's default here, since the fit proposes none in jsdom.
    expect({ cols: xterm.cols, rows: xterm.rows }).toEqual({ cols: 80, rows: 24 })
    // Back at its own size before it attached: the view sent main no resize of the pty.
    expect(wire.calls.filter((call) => call.channel === 'projects.connect.signInResize')).toEqual([])
  })

  it('gh exits while it is written: what gh printed last comes after all of it', async () => {
    opened.replay = 'first|second'
    opened.sizes = [
      { at: 0, cols: 40, rows: 10 },
      { at: 'first|'.length, cols: 60, rows: 12 },
    ]
    const onExit = vi.fn()
    // While xterm.js parses the first piece: gh's last output, then its exit.
    whileParsing.run = () => {
      wire.handlers.get('projects.connect.signInOutput')?.({ signInId: SIGN_IN, data: '|last', end: 'first|second|last'.length })
      wire.handlers.get('projects.connect.signInExit')?.({ signInId: SIGN_IN, exitCode: 0 })
    }
    render(<SignInTerminal signInId={SIGN_IN} onExit={onExit} onClose={() => undefined} />)
    await waitFor(() => expect(screen.getByTestId('connect-signin').dataset.state).toBe('exited'))
    await waitFor(() => expect(writes.map((write) => write.data)).toEqual(['first|', 'second', '|last']))
    expect(onExit).toHaveBeenCalledTimes(1)
  })
})
