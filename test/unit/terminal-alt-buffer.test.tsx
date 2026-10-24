// The alternate screen of a Terminal keeps exactly its rows (src/renderer/canvas/nodes/terminal-alt-buffer.ts),
// on xterm.js without a display: the same buffers as the views' xterm.js.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Terminal } from '@xterm/headless'
import { describe, expect, it } from 'vitest'
import { fitAltBuffer, keepAltBufferFitted, type AltBufferTerminal } from '../../src/renderer/canvas/nodes/terminal-alt-buffer'

const write = (terminal: Terminal, data: string): Promise<void> => new Promise((resolve) => terminal.write(data, resolve))

/** A terminal made at 80x24, as TerminalNode makes it before the Node is measured, then fitted to 81x21. */
function fittedTerminal(keep: boolean): Terminal {
  const terminal = new Terminal({ cols: 80, rows: 24, scrollback: 5000, allowProposedApi: true })
  if (keep) keepAltBufferFitted(terminal as unknown as AltBufferTerminal)
  terminal.resize(81, 21)
  return terminal
}

/** Enters the alternate screen and prints past its last row, as `printf '\033[?1049h'; cat -v` and a few lines do. */
const ALT_SCREEN_LINES = '\x1b[?1049h' + 'line\r\n'.repeat(40)

describe('the alternate screen after the rows shrink', () => {
  it('xterm.js alone gives it room for the rows the terminal was made with: a scrollback of three lines', async () => {
    // When this fails, xterm.js trims the empty alternate buffer itself and terminal-alt-buffer.ts can go.
    const terminal = fittedTerminal(false)
    await write(terminal, ALT_SCREEN_LINES)
    expect(terminal.buffer.active.type).toBe('alternate')
    expect({ length: terminal.buffer.active.length, baseY: terminal.buffer.active.baseY }).toEqual({ length: 24, baseY: 3 })
    terminal.dispose()
  })

  it('kept fitted, it has as many lines as the screen has rows and no scrollback', async () => {
    const terminal = fittedTerminal(true)
    await write(terminal, ALT_SCREEN_LINES)
    expect(terminal.buffer.active.type).toBe('alternate')
    expect({ length: terminal.buffer.active.length, baseY: terminal.buffer.active.baseY }).toEqual({ length: 21, baseY: 0 })
    terminal.dispose()
  })

  it('a shrink while the alternate screen is shown keeps what it shows; back on the normal screen it fits again', async () => {
    const terminal = new Terminal({ cols: 81, rows: 30, scrollback: 5000, allowProposedApi: true })
    keepAltBufferFitted(terminal as unknown as AltBufferTerminal)
    await write(terminal, '\x1b[?1049h\x1b[1;1Htop row')
    terminal.resize(81, 21)
    expect(terminal.buffer.active.type).toBe('alternate')
    expect(terminal.buffer.active.getLine(terminal.buffer.active.baseY)?.translateToString(true)).toBe('top row')
    await write(terminal, '\x1b[?1049l')
    terminal.resize(81, 18)
    await write(terminal, ALT_SCREEN_LINES)
    expect({ length: terminal.buffer.active.length, baseY: terminal.buffer.active.baseY }).toEqual({ length: 18, baseY: 0 })
    terminal.dispose()
  })

  it('an alternate screen that is shown is never cleared, even one with room to spare', async () => {
    const terminal = fittedTerminal(false)
    await write(terminal, `${ALT_SCREEN_LINES}last`)
    expect(fitAltBuffer(terminal as unknown as AltBufferTerminal)).toBe(false)
    expect(terminal.buffer.active.type).toBe('alternate')
    expect(terminal.buffer.active.getLine(terminal.buffer.active.length - 1)?.translateToString(true)).toBe('last')
    terminal.dispose()
  })

  it('once disposed, it stops fitting: a later shrink leaves the room to xterm.js again', async () => {
    const terminal = new Terminal({ cols: 81, rows: 21, scrollback: 5000, allowProposedApi: true })
    keepAltBufferFitted(terminal as unknown as AltBufferTerminal).dispose()
    terminal.resize(81, 18)
    await write(terminal, ALT_SCREEN_LINES)
    expect({ length: terminal.buffer.active.length, baseY: terminal.buffer.active.baseY }).toEqual({ length: 21, baseY: 3 })
    terminal.dispose()
  })

  const onResize = (): { dispose: () => void } => ({ dispose: () => undefined })
  const clear = (): void => undefined
  it.each([
    ['no internals at all', {}],
    ['an alternate buffer of another shape', { _core: { buffers: { alt: {} } } }],
    ['an alternate buffer without its lines', { _core: { buffers: { alt: { clear } } } }],
    ['lines without a maximum length', { _core: { buffers: { alt: { clear, lines: { length: 0 } } } } }],
    ['no clear()', { _core: { buffers: { alt: { lines: { length: 0, maxLength: 24 } } } } }],
  ])('does nothing to a terminal with %s', (_name, internals) => {
    const terminal = { rows: 21, onResize, ...internals } as AltBufferTerminal
    expect(() => fitAltBuffer(terminal)).not.toThrow()
    expect(fitAltBuffer(terminal)).toBe(false)
  })
})

describe('the xterm.js these tests run on', () => {
  it('is the version the app draws with: @xterm/headless and @xterm/xterm are pinned alike in package.json', () => {
    // The canary above runs on @xterm/headless; the views draw with @xterm/xterm. Of two versions, it
    // would tell what the headless one does, not what the views do.
    const manifest = JSON.parse(readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf8')) as { dependencies: Record<string, string> }
    expect(manifest.dependencies['@xterm/xterm']).toBeDefined()
    expect(manifest.dependencies['@xterm/headless']).toBe(manifest.dependencies['@xterm/xterm'])
  })
})
