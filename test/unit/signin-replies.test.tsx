// The "Sign in with gh" view marks its xterm.js answers to gh (worfy-windows ticket 39): main
// answers gh's cursor-position requests itself and drops a marked answer to them; an unmarked one
// would reach gh as a second answer. Typed keys go unmarked.
//
// The real SignInTerminal (src/renderer/projects/GithubAccount.tsx) with the real xterm.js (without
// drawing: jsdom has no canvas), over a stand-in of the renderer IPC client that records the calls.
import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Terminal as XtermTerminal } from '@xterm/xterm'

const ESC = '\x1b'
const SIGN_IN = 'signin-view-1'

const xterms = vi.hoisted(() => [] as XtermTerminal[])
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
    if (channel === 'projects.connect.signIn') return Promise.resolve({ ok: true, value: { replay: '', end: 0, exited: null } })
    return Promise.resolve({ ok: true, value: undefined })
  },
  invokeOn: () => Promise.resolve({ ok: false, error: 'not served here' }),
  subscribe: (channel: string, handler: (payload: unknown) => void) => {
    wire.handlers.set(channel, handler)
    return () => wire.handlers.delete(channel)
  },
}))

const { SignInTerminal } = await import('../../src/renderer/projects/GithubAccount')

beforeEach(() => {
  xterms.length = 0
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
})
