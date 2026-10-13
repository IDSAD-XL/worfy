// The request the console of Windows sends its terminal, taken out of the output of a shell and
// answered by main (worfy-windows ticket 22, src/main/terminal/console-request.ts): the scanner by
// itself, and the registry over a stand-in pty under the rules of each system.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConsoleRequests, DEVICE_ATTRIBUTES_ANSWER } from '../../src/main/terminal/console-request'
import { HELD_OUTPUT_MS, TerminalRegistry, type PtyProcess, type TerminalSink } from '../../src/main/terminal/pty'

const ESC = '\x1b'
const REQUEST = `${ESC}[c`
/** What the console of the node-pty package sends when a shell starts, as measured on the PC. */
const AT_START = `${ESC}[1t${REQUEST}${ESC}[?1004h${ESC}[?9001h`
const WITHOUT_THE_REQUEST = `${ESC}[1t${ESC}[?1004h${ESC}[?9001h`

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('ConsoleRequests: the scanner', () => {
  /** Feeds the chunks; answers the text that came out of each, and the requests found in all. */
  const fed = (...chunks: string[]): { out: string[]; requests: number; rest: string } => {
    const scanner = new ConsoleRequests()
    const out: string[] = []
    let requests = 0
    for (const chunk of chunks) {
      const read = scanner.feed(chunk)
      out.push(read.text)
      requests += read.requests
    }
    return { out, requests, rest: scanner.rest() }
  }

  it('takes the request out of what the console sends at the start, and nothing else', () => {
    expect(fed(`${AT_START}PS C:\\p> `)).toEqual({ out: [`${WITHOUT_THE_REQUEST}PS C:\\p> `], requests: 1, rest: '' })
    expect(DEVICE_ATTRIBUTES_ANSWER).toBe(`${ESC}[?1;2c`)
  })

  it('knows the request with its default parameter, and counts every one in a chunk', () => {
    expect(fed(`a${ESC}[0cb${REQUEST}c${REQUEST}`)).toEqual({ out: ['abc'], requests: 3, rest: '' })
    // A chunk that is nothing but the request gives no text at all.
    expect(fed(REQUEST)).toEqual({ out: [''], requests: 1, rest: '' })
  })

  it.each([
    ['after ESC', [`one${ESC}`, '[ctwo']],
    ['after ESC [', [`one${ESC}[`, 'ctwo']],
    ['after ESC [ 0', [`one${ESC}[0`, 'ctwo']],
    ['into three', [`one${ESC}`, '[', 'ctwo']],
  ])('finds a request cut between two chunks %s', (_where, chunks) => {
    const { out, requests, rest } = fed(...chunks)
    expect(out.join('')).toBe('onetwo')
    expect(requests).toBe(1)
    expect(rest).toBe('')
    // What was kept back is not in the text of the chunk it ended.
    expect(out[0]).toBe('one')
  })

  it('gives back, in order, what only looked like the start of a request', () => {
    // A color: ESC [ at the end of a chunk, then 32m.
    expect(fed(`one${ESC}[`, '32mgreen')).toEqual({ out: ['one', `${ESC}[32mgreen`], requests: 0, rest: '' })
    // Another sequence that begins ESC [ 0.
    expect(fed(`one${ESC}[0`, 'mplain')).toEqual({ out: ['one', `${ESC}[0mplain`], requests: 0, rest: '' })
    // A lone ESC followed by something that is no CSI at all.
    expect(fed(`one${ESC}`, ']0;title')).toEqual({ out: ['one', `${ESC}]0;title`], requests: 0, rest: '' })
  })

  it('leaves alone the requests that only a screen can answer, and other device attributes', () => {
    const others = `${ESC}[>c${ESC}[=c${ESC}[6n${ESC}[5n${ESC}[?1;2c${ESC}[1c${ESC}]11;?${ESC}\\`
    expect(fed(others)).toEqual({ out: [others], requests: 0, rest: '' })
  })

  it('says what it holds back, and gives it up when asked: the end of a stream', () => {
    const scanner = new ConsoleRequests()
    expect(scanner.holds).toBe(false)
    expect(scanner.feed(`tail${ESC}[`)).toEqual({ text: 'tail', requests: 0 })
    expect(scanner.holds).toBe(true)
    expect(scanner.rest()).toBe(`${ESC}[`)
    expect(scanner.holds).toBe(false)
    expect(scanner.rest()).toBe('')
  })
})

/** A pty that records what is written to it and prints what the test says. */
function fakePty(pid: number) {
  const written: string[] = []
  let onData: (data: string) => void = () => undefined
  let onExit: (event: { exitCode: number }) => void = () => undefined
  const pty: PtyProcess = {
    pid,
    onData: (listener) => void (onData = listener),
    onExit: (listener) => void (onExit = listener),
    write: (data) => void written.push(data),
    resize: () => undefined,
    kill: () => onExit({ exitCode: 0 }),
  }
  return { pty, written, print: (data: string) => onData(data), exit: (exitCode = 0) => onExit({ exitCode }) }
}

const OPEN = { cwd: 'C:\\p\\repo', cols: 80, rows: 24 }
const WIN_ENV = { Path: 'C:\\Tools', SystemRoot: 'C:\\Windows' }
const sink = (output: string[]): TerminalSink => ({ output: (data) => void output.push(data), exit: () => undefined, started: () => undefined })

function windowsRegistry(fake: ReturnType<typeof fakePty>): TerminalRegistry {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  return new TerminalRegistry({ env: () => Promise.resolve({ ...WIN_ENV }), spawn: () => fake.pty, platform: 'win32', endDescendants: () => undefined })
}

describe('TerminalRegistry on Windows and the request of the console', () => {
  it('answers the request once, and neither screen nor the kept output ever holds it', async () => {
    const fake = fakePty(999_993_001)
    const registry = windowsRegistry(fake)
    const first: string[] = []
    const second: string[] = []
    await registry.open('a', OPEN, {}, sink(first))
    const other = await registry.open('a', OPEN, {}, sink(second))
    expect(other.started).toBe(false)

    fake.print(`${AT_START}PS C:\\p\\repo> `)
    expect(fake.written).toEqual([DEVICE_ATTRIBUTES_ANSWER])
    expect(first).toEqual([`${WITHOUT_THE_REQUEST}PS C:\\p\\repo> `])
    expect(second).toEqual(first)
    // A screen that comes later gets the kept output: the request is not in it either.
    const late = await registry.open('a', OPEN, {}, sink([]))
    expect(late.replay).toBe(`${WITHOUT_THE_REQUEST}PS C:\\p\\repo> `)
    expect(late.replay).not.toContain(REQUEST)
    expect(fake.written).toEqual([DEVICE_ATTRIBUTES_ANSWER])
    await registry.closeAll()
  })

  it('answers every request — the console passes on the ones a program writes as well — also one cut between two chunks', async () => {
    const fake = fakePty(999_993_002)
    const registry = windowsRegistry(fake)
    const output: string[] = []
    await registry.open('a', OPEN, {}, sink(output))
    fake.print(`${AT_START}prompt> `)
    fake.print(`vim asks${ESC}[`)
    // Nothing is answered, and nothing of the cut sequence is sent, before the rest came.
    expect(fake.written).toHaveLength(1)
    expect(output.join('')).toBe(`${WITHOUT_THE_REQUEST}prompt> vim asks`)
    fake.print('c and goes on')
    expect(fake.written).toEqual([DEVICE_ATTRIBUTES_ANSWER, DEVICE_ATTRIBUTES_ANSWER])
    expect(output.join('')).toBe(`${WITHOUT_THE_REQUEST}prompt> vim asks and goes on`)
    // Two in one chunk: two answers.
    fake.print(`${REQUEST}${ESC}[0c`)
    expect(fake.written).toHaveLength(4)
    await registry.closeAll()
  })

  // Review round 2 of PR #280: what comes after the exit was kept for the next open, and after a
  // Restart it reached the screens of the new shell. Now it is dropped (terminal-console.test.ts).
  it('a request that comes after the shell exited is not answered — its pty takes no input — and nothing that comes then is shown or kept', async () => {
    const fake = fakePty(999_993_007)
    const registry = windowsRegistry(fake)
    const output: string[] = []
    await registry.open('a', OPEN, {}, sink(output))
    fake.print('before the exit')
    fake.exit(3)
    fake.print(`last${REQUEST} words`)
    expect(fake.written).toEqual([])
    expect(output).toEqual(['before the exit'])
    expect((await registry.open('a', OPEN, {}, sink([]))).replay).toBe('before the exit')
    await registry.closeAll()
  })

  it('a chunk that is only the request sends nothing to the screens; a command for the new shell waits for real output', async () => {
    const fake = fakePty(999_993_003)
    const registry = new TerminalRegistry({ env: () => Promise.resolve({ ...WIN_ENV }), spawn: () => fake.pty, platform: 'win32', endDescendants: () => undefined, commandDelayMs: 60_000 })
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const output: string[] = []
    await registry.open('a', { ...OPEN, command: 'gh auth login' }, {}, sink(output))
    fake.print(REQUEST)
    expect(output).toEqual([])
    expect(fake.written).toEqual([DEVICE_ATTRIBUTES_ANSWER])
    // The first real output of the shell: now the command is typed.
    fake.print('PS C:\\p\\repo> ')
    await vi.waitFor(() => expect(fake.written).toEqual([DEVICE_ATTRIBUTES_ANSWER, 'gh auth login\r']))
    await registry.closeAll()
  })

  it('what only looked like the start of a request reaches the screens with the next chunk, or after a short wait when none comes', async () => {
    vi.useFakeTimers()
    const fake = fakePty(999_993_004)
    const registry = windowsRegistry(fake)
    const output: string[] = []
    await registry.open('a', OPEN, {}, sink(output))
    fake.print(`red${ESC}[`)
    fake.print('31m!')
    expect(output).toEqual(['red', `${ESC}[31m!`])
    // A lone ESC at the end, and nothing after it.
    fake.print(`wait${ESC}`)
    expect(output).toEqual(['red', `${ESC}[31m!`, 'wait'])
    await vi.advanceTimersByTimeAsync(HELD_OUTPUT_MS - 1)
    expect(output).toHaveLength(3)
    await vi.advanceTimersByTimeAsync(1)
    expect(output).toEqual(['red', `${ESC}[31m!`, 'wait', ESC])
    expect(fake.written).toEqual([])
    expect(HELD_OUTPUT_MS).toBe(50)
    // The wait starts again with every chunk: a second piece that comes late gets its full time.
    output.length = 0
    fake.print(`more${ESC}`)
    await vi.advanceTimersByTimeAsync(HELD_OUTPUT_MS - 10)
    fake.print('[')
    await vi.advanceTimersByTimeAsync(HELD_OUTPUT_MS - 10)
    expect(output).toEqual(['more'])
    await vi.advanceTimersByTimeAsync(10)
    expect(output).toEqual(['more', `${ESC}[`])
    const closing = registry.closeAll()
    await vi.advanceTimersByTimeAsync(10_000)
    await closing
  })

  it('what is held back when the shell exits is kept with the rest of its output', async () => {
    const fake = fakePty(999_993_005)
    const registry = windowsRegistry(fake)
    const output: string[] = []
    await registry.open('a', OPEN, {}, sink(output))
    fake.print(`bye${ESC}[`)
    fake.exit(3)
    expect(output).toEqual(['bye', `${ESC}[`])
    expect((await registry.open('a', OPEN, {}, sink([]))).replay).toBe(`bye${ESC}[`)
    await registry.closeAll()
  })

  it('a request that comes when the pty takes no input any more is taken out all the same, and the failure is said', async () => {
    const fake = fakePty(999_993_006)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const registry = new TerminalRegistry({ env: () => Promise.resolve({ ...WIN_ENV }), spawn: () => fake.pty, platform: 'win32', endDescendants: () => undefined })
    const output: string[] = []
    await registry.open('a', OPEN, {}, sink(output))
    fake.pty.write = () => {
      throw new Error('the pty is closed')
    }
    fake.print(`${REQUEST}text`)
    expect(output).toEqual(['text'])
    expect(warn).toHaveBeenCalledWith('[terminal] a: the request of the console could not be answered', expect.any(Error))
    await registry.closeAll()
  })
})

describe('TerminalRegistry off Windows and the same bytes', () => {
  it.each(['darwin', 'linux'] as const)('on %s the output passes untouched, chunk by chunk, and nothing is written to the pty', async (platform) => {
    const fake = fakePty(platform === 'darwin' ? 999_993_011 : 999_993_013)
    vi.spyOn(process, 'kill').mockImplementation(() => true)
    const registry = new TerminalRegistry({ env: () => Promise.resolve({ SHELL: '/bin/sh' }), spawn: () => fake.pty, platform })
    const output: string[] = []
    await registry.open('a', { cwd: '/p/repo', cols: 80, rows: 24 }, {}, sink(output))
    fake.print(`${AT_START}$ `)
    fake.print(`cut${ESC}[`)
    fake.print('c')
    expect(output).toEqual([`${AT_START}$ `, `cut${ESC}[`, 'c'])
    expect(fake.written).toEqual([])
    const closed = registry.close('a')
    fake.exit()
    await closed
  })
})
