// The "Fix" button in the header of a Terminal Node (src/renderer/canvas/nodes/TerminalNode.tsx),
// over the real renderer IPC client and a fake preload: it is there only while main says so, a press
// shows "Fixing…" and calls `terminalAi.fix.run`, the answer takes it away and gives the focus to the
// terminal, a refusal shows its reason for a few seconds, and `terminalAi.fix.changed` hides it.
//
// xterm.js does not run in jsdom: the Terminal here is a fake that counts its focus. The look in both
// themes and the real shell are checked against the built app (test/e2e/terminal-ai-fix.spec.ts).
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcResult, WorfyBridge } from '../../src/shared/ipc/channels'
import type { TerminalAiFixState } from '../../src/shared/ipc/terminal-ai-fix'

const PROJECT = 'alpha-0000000a'
const NODE = 'terminal-node-1'

const focused = vi.hoisted(() => ({ count: 0 }))

vi.mock('@xterm/xterm', () => {
  class Terminal {
    cols = 80
    readonly parser = { registerOscHandler: () => ({ dispose: () => undefined }) }
    rows = 24
    options: Record<string, unknown> = {}
    attachCustomKeyEventHandler() {}
    loadAddon() {}
    open() {}
    resize() {}
    write() {}
    focus() {
      focused.count++
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
  /** Fires `terminalAi.fix.changed`, as main does after a change. */
  changed: (state: TerminalAiFixState & { nodeId?: string }) => void
}

/** The preload: the calls of the shell are answered at once, every other call waits for the test. */
function preload(): FakeMain {
  const handlers = new Map<number, { channel: string; handler: (payload: unknown) => void }>()
  let next = 0
  const main: FakeMain = {
    calls: [],
    changed: (state) => {
      for (const { channel, handler } of handlers.values()) if (channel === 'terminalAi.fix.changed') handler({ projectId: PROJECT, nodeId: NODE, ...state })
    },
  }
  const bridge: WorfyBridge = {
    invoke: (channel, input) =>
      new Promise((resolve) => {
        if (channel === 'terminal.open') resolve({ ok: true, value: { replay: '', end: 0, shell: 'zsh', pid: 42, exited: null } })
        else if (channel === 'terminal.input' || channel === 'terminal.resize' || channel === 'terminal.takeSize') resolve({ ok: true, value: undefined })
        else if (channel === 'terminalAi.request.state') resolve({ ok: true, value: { available: false, busy: false } })
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
  focused.count = 0
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
  vi.useRealTimers()
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

/** A Terminal Node whose Fix state main answered with `state`. */
async function terminalNode(state: TerminalAiFixState) {
  const main = preload()
  render(<TerminalNode {...nodeProps} />)
  expect(callsOf(main, 'terminalAi.fix.state').map((call) => call.input)).toEqual([{ projectId: PROJECT, nodeId: NODE }])
  await answer(callsOf(main, 'terminalAi.fix.state')[0], { ok: true, value: state })
  return main
}

const fixButton = () => screen.queryByRole('button', { name: /^Fix/ })

describe('the Fix button of a Terminal Node', () => {
  it('is in the header while main says Fix is available, and not otherwise', async () => {
    const main = await terminalNode({ available: false })
    expect(fixButton()).toBeNull()
    act(() => main.changed({ available: true }))
    const button = screen.getByRole('button', { name: 'Fix' })
    // In the header, beside the title.
    expect(button.closest('.w-terminal__header')).not.toBeNull()
    // An event about another Terminal changes nothing.
    act(() => main.changed({ available: false, nodeId: 'another-node' }))
    expect(fixButton()).not.toBeNull()
  })

  it('a press shows "Fixing…" and calls the channel; the answer takes the button away and gives the focus to the terminal', async () => {
    const main = await terminalNode({ available: true })
    fireEvent.click(screen.getByRole('button', { name: 'Fix' }))
    expect(callsOf(main, 'terminalAi.fix.run').map((call) => call.input)).toEqual([{ projectId: PROJECT, nodeId: NODE }])
    const pending = screen.getByRole('button', { name: 'Fixing…' })
    expect(pending).toHaveProperty('disabled', true)
    // A second press while it waits asks nothing more.
    fireEvent.click(pending)
    expect(callsOf(main, 'terminalAi.fix.run')).toHaveLength(1)
    // main takes the button away as the answer lands, before the call returns: "Fixing…" stays till then.
    act(() => main.changed({ available: false }))
    expect(screen.getByRole('button', { name: 'Fixing…' })).not.toBeNull()
    const focusBefore = focused.count
    await answer(callsOf(main, 'terminalAi.fix.run')[0], { ok: true, value: { ok: true } })
    expect(fixButton()).toBeNull()
    expect(focused.count).toBe(focusBefore + 1)
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('a refusal shows its reason in the header for a few seconds; the button stays', async () => {
    const main = await terminalNode({ available: true })
    vi.useFakeTimers()
    fireEvent.click(screen.getByRole('button', { name: 'Fix' }))
    await answer(callsOf(main, 'terminalAi.fix.run')[0], { ok: true, value: { ok: false, message: 'Limits reached until 14:20' } })
    expect(screen.getByRole('status').textContent).toBe('Limits reached until 14:20')
    expect(screen.getByRole('button', { name: 'Fix' })).not.toBeNull()
    act(() => vi.advanceTimersByTime(3000))
    expect(screen.queryByRole('status')).not.toBeNull()
    act(() => vi.advanceTimersByTime(1500))
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('an error of the channel shows the handler\'s own reason', async () => {
    const main = await terminalNode({ available: true })
    fireEvent.click(screen.getByRole('button', { name: 'Fix' }))
    await answer(callsOf(main, 'terminalAi.fix.run')[0], { ok: false, error: 'terminalAi.fix.run failed: something broke' })
    expect(screen.getByRole('status').textContent).toBe('something broke')
  })

  it('`terminalAi.fix.changed` with available false hides the button', async () => {
    const main = await terminalNode({ available: true })
    expect(fixButton()).not.toBeNull()
    act(() => main.changed({ available: false }))
    expect(fixButton()).toBeNull()
    act(() => main.changed({ available: true }))
    expect(fixButton()).not.toBeNull()
  })
})
