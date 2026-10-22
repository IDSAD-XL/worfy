// The request the console of Windows sends its terminal, taken out of the output of a shell and
// answered by main (worfy-windows ticket 22, src/main/terminal/console-request.ts): the scanner by
// itself, and the registry over a stand-in pty under the rules of each system.
import { createRequire } from 'node:module'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConsoleRequests, DEVICE_ATTRIBUTES_ANSWER, HOLD_LIMIT } from '../../src/main/terminal/console-request'
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

  // Review of PR #280 (ticket 42 of worfy-windows, item 1): a request inside the start of another
  // stayed in the text, in one chunk as in two.
  it('a request inside the start of another sequence is taken out, and the start is dropped as xterm.js drops it', async () => {
    expect(fed(`${ESC}[${ESC}[cc`)).toEqual({ out: ['c'], requests: 1, rest: '' })
    const cut = fed(`${ESC}[${ESC}[c`, 'c')
    expect([cut.out.join(''), cut.requests, cut.rest]).toEqual(['c', 1, ''])
    // xterm.js reads the original stream so: one answer, and the letter c on the screen.
    expect(await xtermReads(`${ESC}[${ESC}[cc`)).toEqual({ answers: 1, line: 'c' })
    expect(await xtermReads(cut.out.join(''))).toEqual({ answers: 0, line: 'c' })
  })

  // Review of PR #280 (item 1): forms xterm.js answers that the scanner did not know.
  it.each([
    ['ESC [ c', `${ESC}[c`],
    ['ESC [ 0 c', `${ESC}[0c`],
    ['ESC [ 0 0 c', `${ESC}[00c`],
    ['ESC [ ; c', `${ESC}[;c`],
    ['ESC [ 0 ; 0 c', `${ESC}[0;0c`],
    ['ESC [ 0 ; 1 c', `${ESC}[0;1c`],
    ['CSI c', '\x9bc'],
    ['CSI 0 c', '\x9b0c'],
    ['ESC [ CR c', `${ESC}[\rc`],
    ['ESC CR [ c', `${ESC}\r[c`],
    ['ESC [ 1 c', `${ESC}[1c`],
    ['ESC [ > c', `${ESC}[>c`],
    ['ESC [ = c', `${ESC}[=c`],
    ['ESC [ ? c', `${ESC}[?c`],
    ['ESC [ 0 > c', `${ESC}[0>c`],
    ['ESC [ SP c', `${ESC}[ c`],
    ['ESC [ CAN c', `${ESC}[${'\x18'}c`],
    ['ESC [ 6 n', `${ESC}[6n`],
  ])('%s: taken out exactly when xterm.js answers it with the device attributes', async (_name, form) => {
    const asked = await xtermReads(`a${form}b`)
    const read = fed(`a${form}b`)
    expect(read.requests).toBe(asked.answers)
    // What is left reads on a screen as the original does, without the answer.
    expect(await xtermReads(read.out.join(''))).toEqual({ answers: 0, line: asked.line })
  })

  it('the forms that are requests are known as such cut at any point between two chunks', () => {
    for (const form of [`${ESC}[00c`, `${ESC}[;c`, `${ESC}[0;0c`, '\x9bc', `${ESC}[\rc`]) {
      for (let cut = 0; cut <= form.length; cut++) {
        const read = fed(`one${form.slice(0, cut)}`, `${form.slice(cut)}two`)
        expect([read.out.join(''), read.requests], JSON.stringify(form) + ' cut at ' + cut).toEqual([form.includes('\r') ? 'one\rtwo' : 'onetwo', 1])
      }
    }
  })

  it('a start given up as text before its end came (rest) ends on the screens with CAN, not with an answer, when it was a request', async () => {
    const scanner = new ConsoleRequests()
    expect(scanner.feed(`one${ESC}[`)).toEqual({ text: 'one', requests: 0 })
    expect(scanner.rest()).toBe(`${ESC}[`)
    expect(scanner.holds).toBe(false)
    expect(scanner.feed('0')).toEqual({ text: '0', requests: 0 })
    expect(scanner.feed('ctwo')).toEqual({ text: `${CAN}two`, requests: 1 })
    expect(await xtermReads(`one${ESC}[0${CAN}two`)).toEqual({ answers: 0, line: 'onetwo' })
    // What turned out no request goes on as the text it is.
    expect(scanner.feed(`x${ESC}[`)).toEqual({ text: 'x', requests: 0 })
    expect(scanner.rest()).toBe(`${ESC}[`)
    expect(scanner.feed('32mgreen')).toEqual({ text: '32mgreen', requests: 0 })
    // Another sequence that starts before the end: the one given out is ended with CAN first.
    expect(scanner.feed(`y${ESC}`)).toEqual({ text: 'y', requests: 0 })
    expect(scanner.rest()).toBe(ESC)
    expect(scanner.feed(`[${ESC}[ctail`)).toEqual({ text: `[${CAN}tail`, requests: 1 })
    expect(await xtermReads(`y${ESC}[${CAN}tail`)).toEqual({ answers: 0, line: 'ytail' })
  })

  it(`holds back no more than HOLD_LIMIT (${HOLD_LIMIT}) characters, and still knows the request past them`, () => {
    const scanner = new ConsoleRequests()
    const long = `${ESC}[${';'.repeat(HOLD_LIMIT)}`
    const read = scanner.feed(long)
    expect(read.text).toBe(long)
    expect(scanner.holds).toBe(false)
    expect(scanner.feed('c')).toEqual({ text: CAN, requests: 1 })
  })

  // The risk of item 1: the scanner is on the way of all the output of the shells of Windows. The
  // review checked 20 000 random streams on the Mac; this is that check, with a fixed seed.
  it('20 000 streams of the start of the console and of programs, cut at random: no loss, no repeat, no change of order', () => {
    const random = seeded(42)
    for (let stream = 0; stream < 20_000; stream++) {
      const { tokens, expected, requests } = randomStream(random)
      const chunks = cutAtRandom(tokens.join(''), random)
      const read = fed(...chunks)
      expect([read.out.join('') + read.rest, read.requests], `stream ${stream}: ${JSON.stringify(chunks)}`).toEqual([expected, requests])
    }
  })

  // Review of PR #736 (ticket 42 of worfy-windows): in the raw stream the ESC of the request ended a
  // sequence of another program that had not ended yet; with the request cut out nothing ended it,
  // and the next character became its end.
  // null stands for rest() between chunks, as the registry calls it after HELD_OUTPUT_MS.
  it.each<[string, (string | null)[]]>([
    ['an unfinished CSI', [`${ESC}[1;3`, REQUEST, 'Hello']],
    ['an unfinished CSI with a prefix', [`${ESC}[?`, REQUEST, 'Hello']],
    ['an ESC with an intermediate', [`${ESC} `, REQUEST, 'Hello']],
    ['an OSC title without its end', [`${ESC}]0;title`, REQUEST, 'text']],
    ['a DCS string', [`${ESC}P1$r`, REQUEST, 'text']],
    ['an unfinished CSI, with the request given out by rest()', [`${ESC}[1;3`, `${ESC}[`, null, 'c', 'Hello']],
    ['an OSC title, with a request cut off by the next one and a control inside it', [`${ESC}]0;title`, `${ESC}[\n`, REQUEST, 'text']],
    ['an OSC title, with the C1 CSI of a request', [`${ESC}]0;title`, '\x9bc', 'text']],
  ])('a request that ends %s leaves the screen as the raw stream does', async (_name, chunks) => {
    const scanner = new ConsoleRequests()
    let text = ''
    let requests = 0
    for (const chunk of chunks) {
      if (chunk === null) {
        text += scanner.rest()
        continue
      }
      const read = scanner.feed(chunk)
      text += read.text
      requests += read.requests
    }
    text += scanner.rest()
    const raw = await xtermShows(chunks.join(''))
    expect(requests).toBe(raw.answers)
    expect(await xtermShows(text)).toEqual({ ...raw, answers: 0 })
  })

  it('the Hello case of the review: the screen shows Hello, at the start of the line', async () => {
    const read = fed(`${ESC}[1;3`, REQUEST, 'Hello')
    expect(read.requests).toBe(1)
    expect((await xtermShows(read.out.join(''))).screen.split('\n')[0]).toBe('HelloZ')
  })

  it('the OSC case of the review: the text is not taken into the title of the window', async () => {
    const read = fed(`${ESC}]0;title`, REQUEST, 'text')
    expect(read.requests).toBe(1)
    const shown = await xtermShows(read.out.join(''))
    expect([shown.title, shown.screen.split('\n')[0]]).toEqual(['title', 'textZ'])
  })

  it('a request at the start of the console still leaves nothing but its controls behind', () => {
    expect(fed(`${ESC}[1t`, `${ESC}[\n`, 'c').out.join('')).toBe(`${ESC}[1t\n`)
  })

  // The differential check of the review, with a fixed seed: random pieces — every form of the
  // request, foreign sequences cut anywhere (CSI, OSC, DCS, ESC with intermediates), controls, C1 —
  // cut into random chunks, with rest() between chunks at random. xterm.js must show the same
  // screen, cursor and title and give the same other answers for the raw and for the filtered
  // stream, answer no device attributes request of the filtered one, and as many of the raw one as
  // the scanner counted.
  it('2000 random streams with foreign sequences and rest() between chunks: xterm.js reads the filtered stream as the raw one, without the requests', async () => {
    const random = seeded(4242)
    const pieces = [ESC, '\x9b', '[', '0', '1', ';', ':', 'c', 'c', 'x', '?', '>', ' ', '\n', '\r', '\x18', '\x1a', '\x7f', '\x85', ']', '\x07', '\x90', '\\', 'P', '_', '6', 'n', `${ESC}[`, REQUEST, '\x9bc', `${ESC}[0;0c`, `${ESC}[;c`, `${ESC}]0;t`, '\x9c', 'é']
    const streams: { chunks: string[]; text: string; requests: number }[] = []
    for (let stream = 0; stream < 2000; stream++) {
      let raw = ''
      for (let count = 1 + Math.floor(random() * 14); count > 0; count--) raw += pieces[Math.floor(random() * pieces.length)]
      const scanner = new ConsoleRequests()
      let text = ''
      let requests = 0
      const chunks = cutAtRandom(raw, random)
      for (const chunk of chunks) {
        const read = scanner.feed(chunk)
        text += read.text
        requests += read.requests
        if (scanner.holds && random() < 0.5) text += scanner.rest()
      }
      streams.push({ chunks, text: text + scanner.rest(), requests })
    }
    const [before, after] = await Promise.all([xtermShowsAll(streams.map((one) => one.chunks.join(''))), xtermShowsAll(streams.map((one) => one.text))])
    const failures = streams.flatMap((one, index) => {
      const same = one.requests === before[index]?.answers && JSON.stringify({ ...before[index], answers: 0 }) === JSON.stringify(after[index])
      // C1 characters are invisible in a terminal: the report spells them out.
      const report = JSON.stringify({ ...one, before: before[index], after: after[index] }).replace(/[\x7f-￿]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`)
      return same ? [] : [report]
    })
    expect(failures.slice(0, 3)).toEqual([])
  })
})

const CAN = '\x18'

type Shown = { screen: string; title: string; answers: number; others: string[] }

/** What xterm.js shows for `data` followed by `Z`: the screen with the cursor, the title, its device attributes answers and its other answers. */
async function xtermShows(data: string): Promise<Shown> {
  const [shown] = await xtermShowsAll([data])
  if (shown === undefined) throw new Error('xterm.js showed nothing')
  return shown
}

/**
 * xtermShows for many streams at once, in one terminal: each one after a full reset (`ESC c`, which
 * ends any sequence first), read in the callback of its write, before the next one is parsed.
 */
async function xtermShowsAll(streams: string[]): Promise<Shown[]> {
  const { Terminal } = createRequire(import.meta.url)('@xterm/headless') as typeof import('@xterm/headless')
  // DEL outside a sequence is a parsing error to xterm.js: it says so on the console, and reads on.
  const terminal = new Terminal({ cols: 40, rows: 6, allowProposedApi: true, logLevel: 'off' })
  let answers = 0
  let others: string[] = []
  let title = ''
  terminal.onData((answer) => {
    if (answer === DEVICE_ATTRIBUTES_ANSWER) answers += 1
    else others.push(answer)
  })
  terminal.onTitleChange((next) => (title = next))
  const shown: Shown[] = []
  await new Promise<void>((resolve) => {
    for (const data of streams) {
      terminal.write(`${ESC}c${data}Z`, () => {
        const buffer = terminal.buffer.active
        const lines: string[] = []
        for (let row = 0; row < buffer.length; row++) lines.push(buffer.getLine(row)?.translateToString(true) ?? '')
        shown.push({ screen: `${lines.join('\n')}|${buffer.cursorX},${buffer.cursorY}`, title, answers, others })
        answers = 0
        others = []
        title = ''
        if (shown.length === streams.length) resolve()
      })
    }
  })
  terminal.dispose()
  return shown
}

/** What xterm.js makes of `data`: how many device attributes answers it gives, and the first line it shows. */
async function xtermReads(data: string): Promise<{ answers: number; line: string }> {
  const { Terminal } = createRequire(import.meta.url)('@xterm/headless') as typeof import('@xterm/headless')
  const terminal = new Terminal({ cols: 80, rows: 5, allowProposedApi: true })
  let answers = 0
  terminal.onData((answer) => {
    if (answer === DEVICE_ATTRIBUTES_ANSWER) answers += 1
  })
  await new Promise<void>((resolve) => terminal.write(data, resolve))
  const line = terminal.buffer.active.getLine(0)?.translateToString(true) ?? ''
  terminal.dispose()
  return { answers, line }
}

/** A generator of numbers in [0, 1) that gives the same row for the same seed (mulberry32). */
function seeded(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Pieces of what a shell of Windows prints; the requests are the ones the scanner knew before ticket 42 as well. */
const TOKENS: { text: string; shown: string; requests: number }[] = [
  { text: AT_START, shown: WITHOUT_THE_REQUEST, requests: 1 },
  { text: REQUEST, shown: '', requests: 1 },
  { text: `${ESC}[0c`, shown: '', requests: 1 },
  { text: 'PS C:\\p> ', shown: 'PS C:\\p> ', requests: 0 },
  { text: `${ESC}[32mgreen${ESC}[0m`, shown: `${ESC}[32mgreen${ESC}[0m`, requests: 0 },
  { text: `${ESC}[?25l${ESC}[?25h`, shown: `${ESC}[?25l${ESC}[?25h`, requests: 0 },
  { text: `${ESC}]0;title\x07`, shown: `${ESC}]0;title\x07`, requests: 0 },
  { text: `${ESC}[>c${ESC}[1c`, shown: `${ESC}[>c${ESC}[1c`, requests: 0 },
  { text: 'cc\r\n', shown: 'cc\r\n', requests: 0 },
  { text: ESC, shown: ESC, requests: 0 },
]

function randomStream(random: () => number): { tokens: string[]; expected: string; requests: number } {
  const tokens: string[] = []
  let expected = ''
  let requests = 0
  const count = 1 + Math.floor(random() * 12)
  for (let index = 0; index < count; index++) {
    let token = TOKENS[Math.floor(random() * TOKENS.length)] ?? TOKENS[0]!
    // A lone ESC only at the very end: anywhere else it would start a sequence with the next piece.
    if (token.text === ESC && index !== count - 1) token = TOKENS[3]!
    tokens.push(token.text)
    expected += token.shown
    requests += token.requests
  }
  return { tokens, expected, requests }
}

function cutAtRandom(stream: string, random: () => number): string[] {
  const chunks: string[] = []
  let at = 0
  while (at < stream.length) {
    const size = 1 + Math.floor(random() * 8)
    chunks.push(stream.slice(at, at + size))
    at += size
  }
  return chunks
}

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

  // Review of PR #280 (item 1): a request cut in two with more than HELD_OUTPUT_MS between the
  // pieces. Its start went out as text, the rest was not taken for a request, and every screen
  // answered it — once more when the kept output was replayed.
  it('a request whose second piece comes after the wait is answered by main, and the screens get CAN in place of its end', async () => {
    vi.useFakeTimers()
    const fake = fakePty(999_993_008)
    const registry = windowsRegistry(fake)
    const output: string[] = []
    await registry.open('a', OPEN, {}, sink(output))
    fake.print(`one${ESC}[`)
    await vi.advanceTimersByTimeAsync(80)
    expect(output).toEqual(['one', `${ESC}[`])
    fake.print('ctwo')
    expect(fake.written).toEqual([DEVICE_ATTRIBUTES_ANSWER])
    expect(output.join('')).toBe(`one${ESC}[${CAN}two`)
    const replay = (await registry.open('a', OPEN, {}, sink([]))).replay
    expect(replay).toBe(output.join(''))
    const closing = registry.closeAll()
    await vi.advanceTimersByTimeAsync(10_000)
    await closing
    // xterm.js parses on a timer of its own.
    vi.useRealTimers()
    expect(await xtermReads(replay)).toEqual({ answers: 0, line: 'onetwo' })
  })

  it('each shell has a scanner of its own: the start of a request in one is not ended by the output of another', async () => {
    const first = fakePty(999_993_009)
    const second = fakePty(999_993_010)
    const ptys = [first.pty, second.pty]
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const registry = new TerminalRegistry({ env: () => Promise.resolve({ ...WIN_ENV }), spawn: () => ptys.shift()!, platform: 'win32', endDescendants: () => undefined })
    const outputs: [string[], string[]] = [[], []]
    await registry.open('a', OPEN, {}, sink(outputs[0]))
    await registry.open('b', OPEN, {}, sink(outputs[1]))
    first.print(`one${ESC}[`)
    second.print('cats')
    expect([first.written, second.written]).toEqual([[], []])
    expect(outputs).toEqual([['one'], ['cats']])
    first.print('c')
    expect(first.written).toEqual([DEVICE_ATTRIBUTES_ANSWER])
    await registry.closeAll()
  })

  it('the answer goes to the console before the text of the same chunk goes to the screens', async () => {
    const fake = fakePty(999_993_012)
    const registry = windowsRegistry(fake)
    const told: string[] = []
    fake.pty.write = (data) => void told.push(`pty ${JSON.stringify(data)}`)
    await registry.open('a', OPEN, {}, { ...sink([]), output: (data) => void told.push(`screen ${JSON.stringify(data)}`) })
    fake.print(`${REQUEST}PS> `)
    expect(told).toEqual([`pty ${JSON.stringify(DEVICE_ATTRIBUTES_ANSWER)}`, 'screen "PS> "'])
    await registry.closeAll()
  })

  // The same check as the scanner's, through the registry: two screens and the kept output.
  it('200 random streams through the registry: both screens and the kept output get the same bytes, in order, and every request is answered once', async () => {
    const random = seeded(7)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    for (let stream = 0; stream < 200; stream++) {
      const fake = fakePty(999_993_100 + stream)
      const registry = new TerminalRegistry({ env: () => Promise.resolve({ ...WIN_ENV }), spawn: () => fake.pty, platform: 'win32', endDescendants: () => undefined })
      const screens: [string[], string[]] = [[], []]
      await registry.open('a', OPEN, {}, sink(screens[0]))
      await registry.open('a', OPEN, {}, sink(screens[1]))
      const { tokens, expected, requests } = randomStream(random)
      // Without the lone ESC at the end: what is held back at the end is the subject of another test.
      const withoutLoneEsc = (stream: string) => (stream.endsWith(ESC) ? stream.slice(0, -1) : stream)
      for (const chunk of cutAtRandom(withoutLoneEsc(tokens.join('')), random)) fake.print(chunk)
      const kept = (await registry.open('a', OPEN, {}, sink([]))).replay
      const shown = withoutLoneEsc(expected)
      expect([screens[0].join(''), screens[1].join(''), kept, fake.written.length], `stream ${stream}`).toEqual([shown, shown, shown, requests])
      await registry.closeAll()
    }
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
