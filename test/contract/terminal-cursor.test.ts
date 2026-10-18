// main answers the cursor-position requests of a shell itself (src/main/terminal/cursor-answers.ts,
// worfy-windows ticket 39): once per request, with the position a screen of the pty's size has at
// that point of the output, whether no view, one view or two views are open; a view's own answer
// to such a request goes nowhere. The console of node-pty 1.2.0-beta.15 asks about ten times after
// every resize, and PowerShell echoes nothing until it is answered (PR #498).
//
// The real TerminalRegistry and @xterm/headless, over a stand-in pty that prints what the test gives
// it and records what it is typed; no process starts.
import { createRequire } from 'node:module'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CursorAnswers, isCursorAnswer, SCROLLBACK } from '../../src/main/terminal/cursor-answers'
import { ROWS_MAX, TerminalRegistry, type PtyProcess, type TerminalSink } from '../../src/main/terminal/pty'

const KEY = JSON.stringify(['alpha-0000000a', 'terminal-node-1'])
const ESC = '\x1b'
const REQUEST = `${ESC}[6n`

/** A pty that prints what the test gives it and records its writes and resizes, in order. */
class StandInPty implements PtyProcess {
  // No process has this pid: closing the registry signals it, and the signal must reach nobody.
  readonly pid = 999_999_995
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
  print(text: string): void {
    for (const listener of this.data) listener(text)
  }
  kill(): void {
    if (this.ended) return
    this.ended = true
    for (const listener of this.exits) listener({ exitCode: 0 })
  }
  get writes(): string[] {
    return this.calls.flatMap((call) => (call[0] === 'write' ? [call[1]] : []))
  }
}

const ptys: StandInPty[] = []
afterEach(() => {
  ptys.splice(0).forEach((pty) => pty.kill())
  vi.restoreAllMocks()
})

const nothing: TerminalSink = { output: () => undefined, exit: () => undefined, started: () => undefined }

/** A registry of `platform` with a running stand-in shell, opened by client `a` with `size`. */
async function shell(platform: NodeJS.Platform = 'linux', size = { cols: 80, rows: 24 }, sink: TerminalSink = nothing) {
  const registry = new TerminalRegistry({
    env: async () => ({ SHELL: '/bin/sh' }),
    spawn: () => {
      const pty = new StandInPty()
      ptys.push(pty)
      return pty
    },
    platform,
    endDescendants: () => undefined,
  })
  const a = {}
  await registry.open(KEY, { cwd: '/', ...size }, a, sink)
  const pty = ptys.at(-1)
  if (pty === undefined) throw new Error('no pty')
  return { registry, pty, a }
}

/** Waits until the pty was written `count` things, and a moment more to see that nothing else comes. */
async function writtenSoon(pty: StandInPty, count: number): Promise<string[]> {
  await vi.waitFor(() => expect(pty.writes.length).toBeGreaterThanOrEqual(count))
  await new Promise((resolve) => setTimeout(resolve, 50))
  return pty.writes
}

describe('main answers the cursor-position requests (worfy-windows ticket 39)', () => {
  it('with no view open: once per request, with the position of the cursor at that point of the output', async () => {
    const { pty } = await shell()
    pty.print(`abc\r\nde${REQUEST}`)
    pty.print(`fgh${ESC}[?6n`)
    expect(await writtenSoon(pty, 2)).toEqual([`${ESC}[2;3R`, `${ESC}[?2;6R`])
  })

  it('a request split between two chunks is answered once', async () => {
    const { pty } = await shell()
    pty.print(`ab${ESC}[`)
    pty.print('6n')
    expect(await writtenSoon(pty, 1)).toEqual([`${ESC}[1;3R`])
  })

  it('after a resize the position is that of a screen of the new size: the request after it sees the line reflowed', async () => {
    const { registry, pty, a } = await shell()
    // A line of 100 characters takes two rows of 80 columns; the cursor is in the third row.
    pty.print(`${'x'.repeat(100)}\r\nab`)
    pty.print(REQUEST)
    expect(await writtenSoon(pty, 1)).toEqual([`${ESC}[3;3R`])
    pty.calls.length = 0

    // The pty takes 120 columns (a resize from the owner), and the console asks right after it: the
    // long line fits one row now, so the cursor is in the second.
    registry.resize(KEY, 120, 24, a)
    pty.print(REQUEST)
    expect(pty.calls[0]).toEqual(['resize', 120, 24])
    expect(await writtenSoon(pty, 1)).toEqual([`${ESC}[2;3R`])
  })

  it('about ten requests after a resize, as the console of node-pty 1.2.0-beta.15 sends them: ten answers, no more, and a second screen opening adds none', async () => {
    const { registry, pty, a } = await shell('win32')
    registry.resize(KEY, 100, 30, a)
    pty.print(`PS C:\\> ${REQUEST.repeat(10)}`)
    // `PS C:\> ` is eight characters: the cursor is in the ninth column.
    expect(await writtenSoon(pty, 10)).toEqual(Array.from({ length: 10 }, () => `${ESC}[1;9R`))

    // Another screen opens: the kept output holds the ten requests, and main answers none of them again.
    await registry.open(KEY, { cwd: '/', cols: 80, rows: 24 }, {}, nothing)
    expect(await writtenSoon(pty, 10)).toHaveLength(10)
  })

  it('on Windows main answers the device attributes request of the console and the cursor requests, each once', async () => {
    const { pty } = await shell('win32')
    pty.print(`${ESC}[1t${ESC}[c${ESC}[?1004h${ESC}[?9001h${REQUEST}`)
    expect(await writtenSoon(pty, 2)).toEqual([`${ESC}[?1;2c`, `${ESC}[1;1R`])
  })

  it('a view’s answer to a cursor request goes nowhere; two views answering leave the shell one answer, main’s', async () => {
    const { registry, pty, a } = await shell()
    const b = {}
    await registry.open(KEY, { cwd: '/', cols: 120, rows: 40 }, b, nothing)
    pty.print(`$ ${REQUEST}`)
    // Both screens' xterm.js answer, marked as answers; one of them has another size and another position.
    registry.write(KEY, `${ESC}[1;3R`, a, { reply: true })
    registry.write(KEY, `${ESC}[5;3R${ESC}[5;3R`, b, { reply: true })
    expect(await writtenSoon(pty, 1)).toEqual([`${ESC}[1;3R`])
    // No resize either: the answers were not typing.
    expect(pty.calls.filter((call) => call[0] === 'resize')).toEqual([])
  })

  it('what is dropped is only a marked cursor answer: other answers, and the same bytes typed (Shift+F3), reach the shell', async () => {
    const { registry, pty, a } = await shell()
    registry.write(KEY, `${ESC}[?1;2c`, a, { reply: true })
    registry.write(KEY, `${ESC}[O`, a, { reply: true })
    registry.write(KEY, `${ESC}[1;2R`, a)
    registry.write(KEY, `${ESC}[1;2R`, a, { reply: false })
    expect(pty.writes).toEqual([`${ESC}[?1;2c`, `${ESC}[O`, `${ESC}[1;2R`, `${ESC}[1;2R`])
  })

  it('a shell that has exited is not answered', async () => {
    const { pty } = await shell()
    pty.kill()
    pty.print(REQUEST)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(pty.writes).toEqual([])
  })

  it('output, a resize and a request back to back: the output is read at the old size, then the resize', async () => {
    const { registry, pty, a } = await shell()
    // `ESC[30;1H` on 24 rows stops at the last row; on a screen already 40 rows tall it would reach row 30.
    pty.print(`${ESC}[30;1Hx`)
    registry.resize(KEY, 120, 40, a)
    pty.print(REQUEST)
    expect(await writtenSoon(pty, 1)).toEqual([`${ESC}[24;2R`])
  })

  it('main’s screen is taken apart when the shell exits on its own and when it is closed', async () => {
    const dispose = vi.spyOn(CursorAnswers.prototype, 'dispose')
    for (const platform of ['linux', 'win32'] as const) {
      const { pty } = await shell(platform)
      expect(dispose).not.toHaveBeenCalled()
      pty.kill()
      expect(dispose).toHaveBeenCalledTimes(1)
      dispose.mockClear()
    }
    const { registry, pty } = await shell()
    // close() sends SIGHUP to a pid no process has; the stand-in shell exits as a shell would.
    const closing = registry.close(KEY)
    pty.kill()
    await closing
    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it('an answer main’s screen gives after the exit is not written, even while that screen is still there', async () => {
    // The screen is not taken apart here: only the check of the exit in the registry stands between the answer and the pty.
    vi.spyOn(CursorAnswers.prototype, 'dispose').mockImplementation(() => undefined)
    const { pty } = await shell()
    pty.kill()
    // Off Windows the output after an exit is kept for the next open, and main's screen reads it.
    pty.print(REQUEST)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(pty.writes).toEqual([])
  })

  it('when main’s screen refuses output (xterm.js past 50 MB queued), every screen still gets it, main stops answering and the views’ answers reach the shell', async () => {
    const headless = createRequire(import.meta.url)('@xterm/headless') as typeof import('@xterm/headless')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const outputs: string[] = []
    const { registry, pty, a } = await shell('linux', { cols: 80, rows: 24 }, { ...nothing, output: (data) => void outputs.push(data) })
    const write = vi.spyOn(headless.Terminal.prototype, 'write').mockImplementation(() => {
      throw new Error('write data discarded, use flow control to avoid losing data')
    })
    pty.print(`$ ${REQUEST}`)
    expect(outputs).toEqual([`$ ${REQUEST}`])
    write.mockRestore()

    // The view answers, marked: with main silent now, its answer goes to the shell.
    registry.write(KEY, `${ESC}[1;3R`, a, { reply: true })
    pty.print(REQUEST)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(pty.writes).toEqual([`${ESC}[1;3R`])
    expect(outputs).toEqual([`$ ${REQUEST}`, REQUEST])
    expect(warn).toHaveBeenCalledTimes(1)
  })
})

describe('isCursorAnswer', () => {
  it.each([
    [`${ESC}[1;1R`, true],
    [`${ESC}[?12;80R`, true],
    [`${ESC}[1;1R${ESC}[2;3R`, true],
    [`${ESC}[1;1Rx`, false],
    [`x${ESC}[1;1R`, false],
    [`${ESC}[?1;2c`, false],
    [`${ESC}[O`, false],
    ['', false],
    [`${ESC}[1R`, false],
  ])('%j → %s', (data, expected) => {
    expect(isCursorAnswer(data)).toBe(expected)
  })

  it('the screen of main keeps more lines above the visible rows than the tallest screen has', () => {
    expect(SCROLLBACK).toBeGreaterThan(ROWS_MAX)
  })
})
