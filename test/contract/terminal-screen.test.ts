// The screen of the Terminal contract tests (terminal-harness.ts): the window the calls come from
// answers the cursor-position requests of a shell, as xterm.js does in the app. The console of the
// node-pty package 1.2.0-beta.15 asks them after a resize, and a shell that is not answered stops
// echoing on Windows (PR #498). A stand-in pty here, so this runs on any system.
import { describe, expect, it, vi } from 'vitest'
import type { PtyProcess, SpawnPty } from '../../src/main/terminal/pty'
import { CURSOR_ANSWER, CURSOR_REQUEST, cursorRequests, harness, NODE, PROJECT, useTerminalScratch } from './terminal-harness'

vi.mock('electron', () => ({ app: { on: vi.fn() }, BrowserWindow: { getAllWindows: () => [] } }))

useTerminalScratch()

/** A shell that prints what the test says and records what it is typed. No process has its pid. */
function printingPty() {
  const typed: string[] = []
  let print: (data: string) => void = () => undefined
  let exit: (event: { exitCode: number }) => void = () => undefined
  const pty: PtyProcess = {
    pid: 999_999_996,
    onData: (listener) => void (print = listener),
    onExit: (listener) => void (exit = listener),
    write: (data) => void typed.push(data),
    resize: () => undefined,
    kill: () => exit({ exitCode: 0 }),
  }
  return { pty, typed, print: (data: string) => print(data) }
}

describe('the screen of the Terminal contract tests', () => {
  it('counts each request once, a request split across chunks too', () => {
    const count = cursorRequests()
    expect(count(`a${CURSOR_REQUEST}b${CURSOR_REQUEST}`)).toBe(2)
    expect(count('\x1b[')).toBe(0)
    expect(count('6n')).toBe(1)
    // The end of a request already counted is not counted again.
    expect(count('n')).toBe(0)
    expect(count('plain text')).toBe(0)
  })

  it('the window of the calls answers each cursor request with a position; another window does not', async () => {
    const shell = printingPty()
    const spawn: SpawnPty = () => shell.pty
    const h = await harness({ spawn, platform: 'darwin' })
    await h.open(NODE)
    const other = h.makeWindow()
    await h.open(NODE, { cols: 80, rows: 24 }, other)

    shell.print(`prompt${CURSOR_REQUEST}`)
    shell.print('\x1b[6')
    shell.print('n more')
    await vi.waitFor(() => expect(shell.typed.filter((data) => data === CURSOR_ANSWER)).toHaveLength(2))
    // Nothing else was typed, and no third answer comes.
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(shell.typed).toEqual([CURSOR_ANSWER, CURSOR_ANSWER])
    expect(CURSOR_ANSWER).toBe('\x1b[1;1R')
    // A close off Windows signals the pid, which is nobody's here: the stand-in ends itself.
    shell.pty.kill()
    await vi.waitFor(() => expect(h.registry.has(`["${PROJECT}","${NODE}"]`)).toBe(false))
  })
})
