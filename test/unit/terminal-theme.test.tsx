// The colours a Terminal Node gives xterm.js (src/renderer/canvas/nodes/TerminalNode.tsx): they
// come from the tokens of the current theme (src/renderer/theme/tokens.css), colour 8 of the
// palette (bright black, which zsh draws the Terminal AI Suggestion in) included, and a change of
// the system theme recolours a running terminal without restarting it.
//
// xterm.js does not run in jsdom: the Terminal here is a fake that keeps the options it was given.
// The real tokens are put on the page, each theme in turn, because jsdom does not evaluate
// `prefers-color-scheme`. The look in both themes is checked against the built app
// (test/e2e/terminal-ai-suggest.spec.ts).
//
// The tokens are read from the stylesheet the app ships, as test/unit/contrast.test.ts does; vitest
// hands a jsdom test an empty string for an imported .css file, so it is read from disk.
/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, render } from '@testing-library/react'
import type { ITheme } from '@xterm/xterm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorfyBridge } from '../../src/shared/ipc/channels'

const PROJECT = 'alpha-0000000a'
const NODE = 'terminal-node-1'

const terminals = vi.hoisted(() => ({ made: [] as { options: { theme?: ITheme } }[] }))

vi.mock('@xterm/xterm', () => {
  class Terminal {
    cols = 80
    readonly parser = { registerOscHandler: () => ({ dispose: () => undefined }) }
    rows = 24
    options: { theme?: ITheme }
    constructor(options: { theme?: ITheme }) {
      this.options = { ...options }
      terminals.made.push(this)
    }
    attachCustomKeyEventHandler() {}
    loadAddon() {}
    open() {}
    resize() {}
    write() {}
    focus() {}
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

const css = readFileSync(join(import.meta.dirname, '../../src/renderer/theme/tokens.css'), 'utf8')

/** The declarations of the first `:root { … }` block at or after `marker`. */
function rootBlockAfter(marker: string): string {
  const start = css.indexOf(marker)
  if (start < 0) throw new Error(`tokens.css has no "${marker}"`)
  const root = css.indexOf(':root', start)
  const open = css.indexOf('{', root)
  const close = css.indexOf('}', open)
  return css.slice(open + 1, close)
}

/** The value of a 6-digit hex token in a block of declarations. */
function tokenIn(block: string, name: string): string {
  const match = new RegExp(`${name}\\s*:\\s*(#[0-9a-fA-F]{6})\\s*;`).exec(block)
  if (match?.[1] === undefined) throw new Error(`no ${name} in the block`)
  return match[1]
}

const lightBlock = rootBlockAfter(':root {')
const darkBlock = rootBlockAfter('@media (prefers-color-scheme: dark)')
const schemes = {
  light: { block: lightBlock, dim: tokenIn(lightBlock, '--terminal-dim'), bg: tokenIn(lightBlock, '--terminal-bg'), text: tokenIn(lightBlock, '--terminal-text') },
  dark: { block: darkBlock, dim: tokenIn(darkBlock, '--terminal-dim'), bg: tokenIn(darkBlock, '--terminal-bg'), text: tokenIn(darkBlock, '--terminal-text') },
}

// The tokens of one theme on every element: jsdom does not inherit custom properties from :root.
const sheet = document.createElement('style')
const showScheme = (scheme: keyof typeof schemes) => {
  sheet.textContent = `* { ${schemes[scheme].block} }`
}

const schemeListeners = new Set<() => void>()

function preload(): void {
  const bridge: WorfyBridge = {
    invoke: (channel) =>
      new Promise((resolve) => {
        if (channel === 'terminal.open') resolve({ ok: true, value: { replay: '', end: 0, shell: 'zsh', pid: 42, exited: null } })
        else if (channel === 'terminalAi.request.state' || channel === 'terminalAi.fix.state') resolve({ ok: true, value: { available: false, busy: false } })
        else resolve({ ok: true, value: undefined })
      }),
    on: () => 1,
    off: () => undefined,
  }
  ;(globalThis as { worfy?: WorfyBridge }).worfy = bridge
}

beforeEach(() => {
  terminals.made.length = 0
  schemeListeners.clear()
  document.head.append(sheet)
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  )
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: (_type: string, listener: () => void) => schemeListeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => schemeListeners.delete(listener),
  }))
  preload()
})

afterEach(() => {
  sheet.remove()
  delete (globalThis as { worfy?: WorfyBridge }).worfy
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const nodeProps = { id: NODE, data: { node: { id: NODE, kind: 'terminal', locked: false } }, selected: false } as unknown as Parameters<typeof TerminalNode>[0]

const lower = (value: string | undefined) => value?.toLowerCase()

function theTerminal() {
  expect(terminals.made).toHaveLength(1)
  return terminals.made[0] as { options: { theme?: ITheme } }
}

describe('the colours of a Terminal Node', () => {
  it.each(['light', 'dark'] as const)('take colour 8 and the rest from the tokens of the %s theme', (scheme) => {
    showScheme(scheme)
    render(<TerminalNode {...nodeProps} />)
    const theme = theTerminal().options.theme
    expect(lower(theme?.brightBlack)).toBe(lower(schemes[scheme].dim))
    expect(lower(theme?.background)).toBe(lower(schemes[scheme].bg))
    expect(lower(theme?.foreground)).toBe(lower(schemes[scheme].text))
  })

  it('follow a change of the system theme without a new terminal', () => {
    showScheme('light')
    render(<TerminalNode {...nodeProps} />)
    const terminal = theTerminal()
    expect(schemeListeners.size).toBe(1)

    showScheme('dark')
    act(() => {
      for (const listener of schemeListeners) listener()
    })
    expect(terminals.made).toHaveLength(1)
    expect(lower(terminal.options.theme?.brightBlack)).toBe(lower(schemes.dark.dim))
    expect(lower(terminal.options.theme?.background)).toBe(lower(schemes.dark.bg))

    showScheme('light')
    act(() => {
      for (const listener of schemeListeners) listener()
    })
    expect(lower(terminal.options.theme?.brightBlack)).toBe(lower(schemes.light.dim))
  })
})
