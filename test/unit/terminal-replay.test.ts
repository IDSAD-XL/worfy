// The replay of a Terminal at the sizes of the pty its output came at (worfy-windows ticket 89):
// main keeps the sizes with the output (src/main/terminal/replay-buffer.ts), and a new view writes
// the output with the resizes in their places (src/renderer/canvas/nodes/terminal-replay.ts), on
// xterm.js without a display: the same buffers as the views' xterm.js.
import { Terminal } from '@xterm/headless'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { REPLAY_LIMIT, ReplayBuffer, TerminalRegistry } from '../../src/main/terminal/pty'
import { writeReplay } from '../../src/renderer/canvas/nodes/terminal-replay'
import type { ReplaySize } from '../../src/shared/ipc/terminal'
import { fakePty, SINK } from './terminal-fake-pty'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ReplayBuffer: the sizes of the pty', () => {
  it('starts with the size the pty was made with and adds each resize where the output stood', () => {
    const buffer = new ReplayBuffer({ cols: 117, rows: 30 })
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
    const buffer = new ReplayBuffer({ cols: 80, rows: 24 })
    buffer.resize(100, 30)
    expect(buffer.sizes()).toEqual([{ at: 0, cols: 100, rows: 30 }])
    buffer.push('x')
    buffer.resize(100, 30)
    buffer.resize(90, 20)
    buffer.resize(100, 30)
    expect(buffer.sizes()).toEqual([{ at: 0, cols: 100, rows: 30 }])
  })

  it('when old output is dropped, the first size is the one in force at the new start, and moves there', () => {
    const buffer = new ReplayBuffer({ cols: 117, rows: 30 })
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
    const buffer = new ReplayBuffer({ cols: 117, rows: 30 })
    buffer.push('a'.repeat(100))
    buffer.resize(160, 40)
    buffer.push('b'.repeat(REPLAY_LIMIT))
    expect(buffer.sizes()).toEqual([{ at: 100, cols: 160, rows: 40 }])
    buffer.push('c')
    expect(buffer.sizes()).toEqual([{ at: 101, cols: 160, rows: 40 }])
  })

  it('a cut inside an OSC sequence moves the first size to the end of the sequence, where the kept output starts', () => {
    const buffer = new ReplayBuffer({ cols: 80, rows: 24 })
    buffer.push(`\x1b]633;E;${'q'.repeat(20)}`)
    buffer.push('\x07after')
    buffer.push('z'.repeat(REPLAY_LIMIT - 'after'.length - 2))
    const text = buffer.text()
    expect(text.startsWith('after')).toBe(true)
    expect(buffer.sizes()).toEqual([{ at: buffer.end - text.length, cols: 80, rows: 24 }])
  })

  it('the registry records the resizes of the pty, not those that failed, and open gives the sizes', async () => {
    const fake = fakePty(999_995_891, { deaf: true })
    let refuse = false
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
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
  const buffer = new ReplayBuffer(START)
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

  it('an empty replay with no sizes is done at once', () => {
    const view = newView()
    let done = false
    writeReplay(view, { replay: '', end: 0, sizes: [] }, () => (done = true))
    expect(done).toBe(true)
  })
})
