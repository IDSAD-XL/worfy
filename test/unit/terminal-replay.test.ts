// The replay of a Terminal at the sizes of the pty its output came at (worfy-windows ticket 89):
// main keeps the sizes with the output (src/main/terminal/replay-buffer.ts), and a new view writes
// the output with the resizes in their places (src/renderer/canvas/nodes/terminal-replay.ts), on
// xterm.js without a display: the same buffers as the views' xterm.js.
import { Terminal } from '@xterm/headless'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { REPLAY_LIMIT, ReplayBuffer, TerminalRegistry } from '../../src/main/terminal/pty'
import { RESIZE_RUN_MS, SIZES_LIMIT } from '../../src/main/terminal/replay-buffer'
import { writeReplay } from '../../src/renderer/canvas/nodes/terminal-replay'
import { terminalOpen, type ReplaySize } from '../../src/shared/ipc/terminal'
import { fakePty, SINK } from './terminal-fake-pty'

afterEach(() => {
  vi.restoreAllMocks()
})

/** A clock a second further on at each look: no two resizes are one run (RESIZE_RUN_MS). */
function slowClock(): () => number {
  let now = 0
  return () => (now += 1000)
}

describe('ReplayBuffer: the sizes of the pty', () => {
  it('starts with the size the pty was made with and adds each resize where the output stood', () => {
    const buffer = new ReplayBuffer({ cols: 117, rows: 30 }, slowClock())
    buffer.push('a'.repeat(10))
    buffer.resize(160, 40)
    buffer.push('b'.repeat(5))
    buffer.resize(72, 16)
    expect(buffer.sizes()).toEqual([
      { at: 0, cols: 117, rows: 30 },
      { at: 10, cols: 160, rows: 40 },
      { at: 15, cols: 72, rows: 16 },
    ])
  })

  it('a resize with no output since the last one replaces it; a resize to the same size adds nothing', () => {
    const buffer = new ReplayBuffer({ cols: 80, rows: 24 }, slowClock())
    buffer.resize(100, 30)
    expect(buffer.sizes()).toEqual([{ at: 0, cols: 100, rows: 30 }])
    buffer.push('x')
    buffer.resize(100, 30)
    buffer.resize(90, 20)
    buffer.resize(100, 30)
    expect(buffer.sizes()).toEqual([{ at: 0, cols: 100, rows: 30 }])
  })

  it('when old output is dropped, the first size is the one in force at the new start, and moves there', () => {
    const buffer = new ReplayBuffer({ cols: 117, rows: 30 }, slowClock())
    buffer.push('a'.repeat(100))
    buffer.resize(160, 40)
    buffer.push('b'.repeat(100))
    buffer.resize(72, 16)
    // Drops all of the a's and 50 of the b's.
    buffer.push('c'.repeat(REPLAY_LIMIT - 50))
    const text = buffer.text()
    expect(text).toBe(`${'b'.repeat(50)}${'c'.repeat(REPLAY_LIMIT - 50)}`)
    const start = buffer.end - text.length
    expect(start).toBe(150)
    expect(buffer.sizes()).toEqual([
      { at: 150, cols: 160, rows: 40 },
      { at: 200, cols: 72, rows: 16 },
    ])
  })

  it('a cut that reaches past a resize drops the size before it', () => {
    const buffer = new ReplayBuffer({ cols: 117, rows: 30 }, slowClock())
    buffer.push('a'.repeat(100))
    buffer.resize(160, 40)
    buffer.push('b'.repeat(REPLAY_LIMIT))
    expect(buffer.sizes()).toEqual([{ at: 100, cols: 160, rows: 40 }])
    buffer.push('c')
    expect(buffer.sizes()).toEqual([{ at: 101, cols: 160, rows: 40 }])
  })

  it('a cut inside an OSC sequence moves the first size to the end of the sequence, where the kept output starts', () => {
    const buffer = new ReplayBuffer({ cols: 80, rows: 24 }, slowClock())
    buffer.push(`\x1b]633;E;${'q'.repeat(20)}`)
    buffer.push('\x07after')
    buffer.push('z'.repeat(REPLAY_LIMIT - 'after'.length - 2))
    const text = buffer.text()
    expect(text.startsWith('after')).toBe(true)
    expect(buffer.sizes()).toEqual([{ at: buffer.end - text.length, cols: 80, rows: 24 }])
  })

  it('resizes closer together than RESIZE_RUN_MS are one run: it keeps the last size from where the run began', () => {
    let now = 0
    const buffer = new ReplayBuffer({ cols: 80, rows: 24 }, () => now)
    buffer.push('prompt')
    now = 1000
    for (const cols of [79, 78, 77, 76]) {
      buffer.resize(cols, 24)
      buffer.push('redraw')
      now += RESIZE_RUN_MS - 1
    }
    expect(buffer.sizes()).toEqual([
      { at: 0, cols: 80, rows: 24 },
      { at: 6, cols: 76, rows: 24 },
    ])
    // A resize after a pause is a size of its own.
    now += 1
    buffer.resize(90, 30)
    expect(buffer.sizes().at(-1)).toEqual({ at: 30, cols: 90, rows: 30 })
  })

  it('a run that ends at the size before it leaves one size', () => {
    let now = 0
    const buffer = new ReplayBuffer({ cols: 80, rows: 24 }, () => now)
    buffer.push('prompt')
    now = 1000
    buffer.resize(70, 24)
    buffer.push('redraw')
    now += 10
    buffer.resize(80, 24)
    expect(buffer.sizes()).toEqual([{ at: 0, cols: 80, rows: 24 }])
  })

  // A shell starts and prints its prompt well within RESIZE_RUN_MS on macOS (the Mac's contract run).
  it('the size the pty was made with is no part of a run: output, then a resize at once, keeps both', () => {
    const buffer = new ReplayBuffer({ cols: 80, rows: 24 }, () => 0)
    buffer.push('PS> ')
    buffer.resize(132, 40)
    expect(buffer.sizes()).toEqual([
      { at: 0, cols: 80, rows: 24 },
      { at: 4, cols: 132, rows: 40 },
    ])
  })

  it('a resize before any output, however soon, replaces the size the pty was made with', () => {
    const buffer = new ReplayBuffer({ cols: 80, rows: 24 }, () => 0)
    buffer.resize(132, 40)
    buffer.push('PS> ')
    expect(buffer.sizes()).toEqual([{ at: 0, cols: 132, rows: 40 }])
  })

  it.each([
    ['the size the pty was made with', false],
    ['a size of an earlier resize', true],
  ])('a run that comes back to %s leaves what came at it there: a resize right after begins a size of its own', (_name, resizedFirst) => {
    let now = 0
    const buffer = new ReplayBuffer({ cols: 80, rows: 24 }, () => now)
    if (resizedFirst) {
      buffer.push('start ')
      now = 500
      buffer.resize(90, 24)
    }
    const base = buffer.end
    const size = resizedFirst ? { cols: 90, rows: 24 } : { cols: 80, rows: 24 }
    buffer.push('prompt')
    now += 1000
    buffer.resize(70, 24)
    buffer.push('redraw')
    now += 10
    buffer.resize(size.cols, size.rows)
    buffer.push('redraw')
    now += 10
    buffer.resize(60, 24)
    expect(buffer.sizes().slice(-2)).toEqual([
      { at: resizedFirst ? 6 : 0, ...size },
      { at: base + 18, cols: 60, rows: 24 },
    ])
  })

  it('keeps at most SIZES_LIMIT sizes: past it the two oldest become one, at the later size', () => {
    const buffer = new ReplayBuffer({ cols: 20, rows: 10 }, slowClock())
    for (let index = 1; index <= SIZES_LIMIT + 2; index++) {
      buffer.push('x')
      buffer.resize(20 + index, 10)
    }
    const sizes = buffer.sizes()
    expect(sizes).toHaveLength(SIZES_LIMIT)
    expect(sizes[0]).toEqual({ at: 0, cols: 23, rows: 10 })
    expect(sizes[1]).toEqual({ at: 4, cols: 24, rows: 10 })
    expect(sizes.at(-1)).toEqual({ at: SIZES_LIMIT + 2, cols: 22 + SIZES_LIMIT, rows: 10 })
  })

  it('a shell that starts and prints at once, then a resize within RESIZE_RUN_MS: open gives both sizes', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000_000)
    const fake = fakePty(999_995_892, { deaf: true })
    const registry = new TerminalRegistry({ env: () => Promise.resolve({ SHELL: '/bin/sh' }), spawn: () => fake.pty, platform: 'linux' })
    const client = {}
    await registry.open('a', { cwd: '/p/repo', cols: 80, rows: 24 }, client, SINK)
    fake.print('$ marker-one\r\n$ ')
    registry.resize('a', 132, 40, client)
    const attached = await registry.open('a', { cwd: '/p/repo', cols: 132, rows: 40 }, client, SINK)
    expect(attached.sizes).toEqual([
      { at: 0, cols: 80, rows: 24 },
      { at: 16, cols: 132, rows: 40 },
    ])
  })

  it('the registry records the resizes of the pty, not those that failed, and open gives the sizes', async () => {
    const fake = fakePty(999_995_891, { deaf: true })
    let refuse = false
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const clock = slowClock()
    vi.spyOn(Date, 'now').mockImplementation(clock)
    fake.pty.resize = () => {
      if (refuse) throw new Error('the pty is gone')
    }
    const registry = new TerminalRegistry({ env: () => Promise.resolve({ SHELL: '/bin/sh' }), spawn: () => fake.pty, platform: 'linux' })
    const client = {}
    const started = await registry.open('a', { cwd: '/p/repo', cols: 117, rows: 30 }, client, SINK)
    expect(started.sizes).toEqual([])
    fake.print('first ')
    registry.resize('a', 160, 40, client)
    fake.print('second ')
    refuse = true
    registry.resize('a', 72, 16, client)
    // Another view of the same client opens at its own size: the pty takes it before the replay is read.
    refuse = false
    const attached = await registry.open('a', { cwd: '/p/repo', cols: 100, rows: 20 }, client, SINK)
    expect(attached.replay).toBe('first second ')
    expect(attached.sizes).toEqual([
      { at: 0, cols: 117, rows: 30 },
      { at: 6, cols: 160, rows: 40 },
      { at: 13, cols: 100, rows: 20 },
    ])
    expect(warn).toHaveBeenCalledTimes(1)
  })
})

// --- the view ---

const parsed = (terminal: Terminal, data: string): Promise<void> => new Promise((resolve) => terminal.write(data, resolve))
const replayed = (terminal: Terminal, replay: string, end: number, sizes: ReplaySize[] | undefined): Promise<void> =>
  new Promise((resolve) => writeReplay(terminal, { replay, end, sizes }, resolve))

/** Every line of the terminal, the scrollback too, with the trailing blanks cut. */
function lines(terminal: Terminal): string[] {
  const buffer = terminal.buffer.active
  return Array.from({ length: buffer.length }, (_, index) => buffer.getLine(index)?.translateToString(true) ?? '')
}

type Step = { data: string } | { cols: number; rows: number }

/**
 * Output that is right only at its size, as ConPTY's after a resize: a mark at column 35 of 40, and
 * after a resize to 20x5 a line drawn at the absolute position of the last row.
 */
const STEPS: Step[] = [
  { data: 'one\r\n\x1b[35Gx\r\ntwo\r\n' },
  { cols: 20, rows: 5 },
  { data: '\x1b[5;1Hmarker-one\x1b[K' },
  { cols: 30, rows: 8 },
]
const START = { cols: 40, rows: 10 }

/** The live view: it got the output and the resizes as they came. Also the replay and sizes main keeps. */
async function live(): Promise<{ terminal: Terminal; replay: string; sizes: ReplaySize[] }> {
  const terminal = new Terminal({ ...START, scrollback: 5000, allowProposedApi: true })
  const buffer = new ReplayBuffer(START, slowClock())
  for (const step of STEPS) {
    if ('data' in step) {
      buffer.push(step.data)
      await parsed(terminal, step.data)
    } else {
      buffer.resize(step.cols, step.rows)
      terminal.resize(step.cols, step.rows)
    }
  }
  return { terminal, replay: buffer.text(), sizes: buffer.sizes() }
}

/** A new view, made at 80x24 as TerminalNode makes it before the Node is measured. */
const newView = () => new Terminal({ cols: 80, rows: 24, scrollback: 5000, allowProposedApi: true })

describe('writeReplay: a new view writes the kept output at the sizes it came at', () => {
  it('draws the screen the live view has, and ends at the size the pty has now', async () => {
    const shown = await live()
    const view = newView()
    await replayed(view, shown.replay, shown.replay.length, shown.sizes)
    expect({ cols: view.cols, rows: view.rows }).toEqual({ cols: 30, rows: 8 })
    expect(lines(view)).toEqual(lines(shown.terminal))
    expect(lines(view).join('\n')).toContain('marker-one')
  })

  it('all of it written at the current size draws another screen (what the views did before)', async () => {
    const shown = await live()
    const view = newView()
    view.resize(30, 8)
    await parsed(view, shown.replay)
    expect(lines(view)).not.toEqual(lines(shown.terminal))
  })

  it('takes the offsets in the whole stream: a replay cut at its start lines up with its sizes', async () => {
    const view = newView()
    const sizes: ReplaySize[] = [
      { at: 1000, cols: 40, rows: 10 },
      { at: 1003, cols: 20, rows: 5 },
    ]
    const resizes: string[] = []
    view.onResize(({ cols, rows }) => resizes.push(`${cols}x${rows} after ${lines(view).join('|').replace(/\|+$/, '')}`))
    await replayed(view, 'abc\x1b[5;1Hdef', 1000 + 'abc\x1b[5;1Hdef'.length, sizes)
    expect(resizes).toEqual(['40x10 after ', '20x5 after abc'])
    expect(lines(view).slice(-5)).toEqual(['abc', '', '', '', 'def'])
  })

  it('a resize with no output after it still leaves the view at that size', async () => {
    const view = newView()
    await replayed(view, 'abc', 3, [
      { at: 0, cols: 40, rows: 10 },
      { at: 3, cols: 50, rows: 12 },
    ])
    expect({ cols: view.cols, rows: view.rows }).toEqual({ cols: 50, rows: 12 })
    expect(lines(view)[0]).toBe('abc')
  })

  it('without sizes (an older main) the replay is written at the view size, as before', async () => {
    const view = newView()
    await replayed(view, 'abc', 3, undefined)
    expect({ cols: view.cols, rows: view.rows }).toEqual({ cols: 80, rows: 24 })
    expect(lines(view)[0]).toBe('abc')
  })

  it('output before the first size is written at the view size first', async () => {
    const view = newView()
    const resizes: string[] = []
    view.onResize(({ cols }) => resizes.push(`${cols} after ${lines(view)[0] ?? ''}`))
    await replayed(view, 'abcdef', 6, [{ at: 3, cols: 40, rows: 10 }])
    expect(resizes).toEqual(['40 after abc'])
  })

  it('stops, without calling done, once the view is gone', async () => {
    const view = newView()
    let alive = true
    let done = false
    await new Promise<void>((resolve) => {
      writeReplay(
        view,
        { replay: 'abcdef', end: 6, sizes: [{ at: 0, cols: 40, rows: 10 }, { at: 3, cols: 20, rows: 5 }] },
        () => (done = true),
        () => {
          // Gone after the first piece was parsed.
          if (lines(view)[0] === 'abc') {
            alive = false
            resolve()
          }
          return alive
        },
      )
    })
    expect(done).toBe(false)
    expect({ cols: view.cols, rows: view.rows }).toEqual({ cols: 40, rows: 10 })
  })

  it('a drag of the Node corner (a resize per frame, a redraw of the prompt after each) keeps one size per run and draws the live screen', async () => {
    let now = 0
    const start = { cols: 80, rows: 24 }
    const shown = new Terminal({ ...start, scrollback: 5000, allowProposedApi: true })
    const buffer = new ReplayBuffer(start, () => now)
    const print = async (data: string) => {
      buffer.push(data)
      await parsed(shown, data)
    }
    const resize = (cols: number, rows: number) => {
      buffer.resize(cols, rows)
      shown.resize(cols, rows)
    }
    // As PSReadLine redraws its line after a resize: at the absolute position of the prompt.
    const redraw = `\x1b[3;1HPS C:\\p> \x1b[K`
    await print('one\r\ntwo\r\nPS C:\\p> ')
    for (const [from, to] of [[80, 41], [41, 70]] as const) {
      now += 1000
      const step = from < to ? 1 : -1
      for (let cols = from + step; cols !== to + step; cols += step) {
        resize(cols, 20 + (cols % 5))
        await print(redraw)
        now += 16
      }
      now += 1000
      await print('echo hi\r\nhi\r\nPS C:\\p> ')
    }
    const sizes = buffer.sizes()
    expect(sizes).toHaveLength(3)
    expect(sizes.at(-1)).toEqual({ at: expect.any(Number), cols: 70, rows: 20 })
    const view = newView()
    const replay = buffer.text()
    await replayed(view, replay, buffer.end, sizes)
    expect({ cols: view.cols, rows: view.rows }).toEqual({ cols: shown.cols, rows: shown.rows })
    expect(lines(view)).toEqual(lines(shown))
  })

  it('sizes out of order or past the end (from a main of another version) write no output twice', () => {
    const writes: string[] = []
    const resizes: string[] = []
    const terminal = {
      cols: 80,
      rows: 24,
      resize(cols: number, rows: number) {
        Object.assign(this, { cols, rows })
        resizes.push(`${cols}x${rows}`)
      },
      write: (data: string, callback?: () => void) => {
        writes.push(data)
        callback?.()
      },
    }
    const replay = 'abcdefghijklmno'
    let done = 0
    writeReplay(terminal, { replay, end: 115, sizes: [
      { at: 100, cols: 40, rows: 10 },
      { at: 110, cols: 20, rows: 5 },
      { at: 105, cols: 30, rows: 8 },
      { at: 900, cols: 50, rows: 9 },
    ] }, () => done++)
    expect(writes.join('')).toBe(replay)
    expect(writes).toEqual(['abcdefghij', 'klmno'])
    expect(resizes).toEqual(['40x10', '20x5', '30x8', '50x9'])
    expect(done).toBe(1)
  })

  it('a throw of xterm.js during the replay stops it and still calls done, once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const terminal = {
      cols: 80,
      rows: 24,
      resize(cols: number) {
        if (cols === 20) throw new Error('disposed')
      },
      write: (_data: string, callback?: () => void) => callback?.(),
    }
    let done = 0
    writeReplay(terminal, { replay: 'abcdef', end: 6, sizes: [
      { at: 0, cols: 40, rows: 10 },
      { at: 3, cols: 20, rows: 5 },
    ] }, () => done++)
    expect(done).toBe(1)
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('an empty replay with no sizes is done at once', () => {
    const view = newView()
    let done = false
    writeReplay(view, { replay: '', end: 0, sizes: [] }, () => (done = true))
    expect(done).toBe(true)
  })
})

describe('the answer of terminal.open: its sizes', () => {
  const answer = (sizes: ReplaySize[] | undefined) => ({ pid: 1, shell: 'zsh', replay: 'abc', end: 10, ...(sizes === undefined ? {} : { sizes }), started: false, exited: null })
  it.each([
    ['none', undefined, true],
    ['going up, the last at the end', [{ at: 7, cols: 80, rows: 24 }, { at: 9, cols: 90, rows: 24 }, { at: 10, cols: 70, rows: 20 }], true],
    ['two at one place', [{ at: 7, cols: 80, rows: 24 }, { at: 7, cols: 90, rows: 24 }], true],
    ['going down', [{ at: 9, cols: 80, rows: 24 }, { at: 8, cols: 90, rows: 24 }], false],
    ['past the end', [{ at: 7, cols: 80, rows: 24 }, { at: 11, cols: 90, rows: 24 }], false],
  ] as const)('sizes %s', (_name, sizes, valid) => {
    expect(terminalOpen.output.safeParse(answer(sizes === undefined ? undefined : [...sizes])).success).toBe(valid)
  })
})
