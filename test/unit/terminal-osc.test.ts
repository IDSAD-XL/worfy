// The shell integration sequences of a Terminal (OSC 633 with the nonce of its shell), read by main
// out of the pty output: what changes the state of the Terminal, what does not, and that a sequence
// cut between two chunks reads the same as a whole one.
import { describe, expect, it } from 'vitest'
import { COMMANDS_KEPT, decodeValue, encodeValue, ShellTracker, type ShellEvent } from '../../src/main/terminal/osc'
import { ReplayBuffer, REPLAY_LIMIT } from '../../src/main/terminal/pty'

const NONCE = '0123456789abcdef0123456789abcdef'
const osc = (body: string, end = '\x07') => `\x1b]633;${body};${NONCE}${end}`
const A = osc('A')
const B = osc('B')
const C = osc('C')
const D = (code: number) => osc(`D;${code}`)
const E = (command: string) => osc(`E;${encodeValue(command)}`)
const P = (cwd: string) => osc(`P;Cwd=${encodeValue(cwd)}`)

/** One prompt, one command with output, the next prompt: what a zsh with the integration prints. */
const session = [
  P('/work'),
  A,
  '%~ ',
  B,
  'ls\r\n',
  E('ls'),
  C,
  // A program's own OSC (a window title) and a CSI aborted by ESC are output too.
  'file-1\r\n\x1b]0;title\x07\x1b[1\x1b[0mfile-2\r\n',
  D(0),
  osc(`P;Cwd=${encodeValue('/work/a\u009cb')}`, '\x1b\\'),
  P('/work/sub'),
  A,
  '%~ ',
  B,
].join('')

function feedAll(chunks: string[]): { tracker: ShellTracker; events: ShellEvent[] } {
  const tracker = new ShellTracker(NONCE)
  const events = chunks.flatMap((chunk) => tracker.feed(chunk))
  return { tracker, events }
}

describe('ShellTracker: the sequences of its own shell', () => {
  it('A, B, C, D, E and P with the nonce of the shell change the state', () => {
    const tracker = new ShellTracker(NONCE)
    expect(tracker.state).toMatchObject({ cwd: null, awaitingInput: false, commandRunning: false, altScreen: false, exitCode: null, commands: [], lastOutput: null })

    expect(tracker.feed(P('/work'))).toEqual([])
    expect(tracker.state.cwd).toBe('/work')
    expect(tracker.feed(`${A}$ `)).toEqual([])
    expect(tracker.feed(B)).toEqual([{ type: 'prompt' }])
    expect(tracker.state.awaitingInput).toBe(true)

    expect(tracker.feed(`false\r\n${E('false')}`)).toEqual([])
    expect(tracker.feed(C)).toEqual([{ type: 'command-started', command: 'false' }])
    expect(tracker.state).toMatchObject({ awaitingInput: false, commandRunning: true, commands: ['false'] })

    expect(tracker.feed(D(1))).toEqual([{ type: 'command-finished', command: 'false', exitCode: 1 }])
    expect(tracker.state).toMatchObject({ commandRunning: false, exitCode: 1 })
  })

  it('accepts ST (ESC \\) as the end of a sequence as well as BEL', () => {
    const tracker = new ShellTracker(NONCE)
    tracker.feed(osc('P;Cwd=/st', '\x1b\\'))
    expect(tracker.state.cwd).toBe('/st')
  })

  it('without the nonce, with another nonce, and OSC 133: nothing changes', () => {
    const tracker = new ShellTracker(NONCE)
    tracker.feed(`${P('/work')}${A}$ ${B}`)
    const before = tracker.state
    const forged = [
      '\x1b]633;D;0\x07',
      '\x1b]633;P;Cwd=/elsewhere\x07',
      '\x1b]633;E;rm\\x20-rf;ffffffffffffffffffffffffffffffff\x07',
      '\x1b]633;C;ffffffffffffffffffffffffffffffff\x07',
      `\x1b]633;C;${NONCE}x\x07`,
      '\x1b]133;A\x07',
      '\x1b]133;C\x07',
      '\x1b]133;D;0\x07',
      `\x1b]133;D;3;${NONCE}\x07`,
    ]
    for (const sequence of forged) expect(tracker.feed(sequence)).toEqual([])
    expect(tracker.state).toEqual(before)
  })

  it('a sequence cut between two chunks at any position reads the same as a whole one', () => {
    const whole = feedAll([session])
    expect(whole.events.map((event) => event.type)).toEqual(['prompt', 'command-started', 'command-finished', 'prompt'])
    for (let at = 0; at <= session.length; at++) {
      const cut = feedAll([session.slice(0, at), session.slice(at)])
      expect({ at, events: cut.events }).toEqual({ at, events: whole.events })
      expect({ at, state: cut.tracker.state }).toEqual({ at, state: whole.tracker.state })
    }
  })

  it('a stream cut into single characters reads the same as a whole one', () => {
    const whole = feedAll([session])
    const single = feedAll([...session])
    expect(single.events).toEqual(whole.events)
    expect(single.tracker.state).toEqual(whole.tracker.state)
  })

  it('the command line with ;, \\, a newline, ESC, a space and non-ASCII is decoded exactly', () => {
    const command = 'printf "a;b\\\\c\\n" \x1b[1m\nfor x in ä 日本; do echo $x; done\t\x07'
    const tracker = new ShellTracker(NONCE)
    tracker.feed(`${E(command)}${C}`)
    expect(tracker.state.commands).toEqual([command])
  })

  it('encodes as the zsh script does: \\ to \\\\, ; and codes 0x20 and below to \\xHH', () => {
    expect(encodeValue('a b;c\\d\n\x1b')).toBe('a\\x20b\\x3bc\\\\d\\x0a\\x1b')
    // C1 controls too: xterm.js ends an OSC on U+009C.
    expect(encodeValue('a\u0080b\u009cc\u009fd\u00a0e')).toBe('a\\x80b\\x9cc\\x9fd\u00a0e')
    expect(decodeValue('a\\x9cb')).toBe('a\u009cb')
    expect(decodeValue('a\\x20b\\x3bc\\\\d\\x0A\\x1B')).toBe('a b;c\\d\n\x1b')
    // A backslash that escapes nothing stays as it is.
    expect(decodeValue('a\\qb\\x2')).toBe('a\\qb\\x2')
  })

  it('a command without E does not reach the list (a line that starts with a space)', () => {
    const tracker = new ShellTracker(NONCE)
    const events = tracker.feed(`${C}secret\r\n${D(0)}`)
    expect(events).toEqual([
      { type: 'command-started', command: null },
      { type: 'command-finished', command: null, exitCode: 0 },
    ])
    expect(tracker.state.commands).toEqual([])
    // Even a forged E with the right nonce for a line that starts with a space stays out of the list.
    tracker.feed(`${E(' echo secret')}${C}${D(0)}`)
    expect(tracker.state.commands).toEqual([])
  })

  it(`keeps the last ${COMMANDS_KEPT} commands`, () => {
    const tracker = new ShellTracker(NONCE)
    for (let n = 1; n <= COMMANDS_KEPT + 5; n++) tracker.feed(`${E(`echo ${n}`)}${C}${D(0)}`)
    const { commands } = tracker.state
    expect(commands).toHaveLength(COMMANDS_KEPT)
    expect(commands[0]).toBe('echo 6')
    expect(commands.at(-1)).toBe(`echo ${COMMANDS_KEPT + 5}`)
  })

  it('the output of the last finished command is the text between C and D', () => {
    const whole = feedAll([session])
    expect(whole.tracker.state.lastOutput).toBe('file-1\r\n\x1b]0;title\x07\x1b[1\x1b[0mfile-2\r\n')
    // A forged sequence inside the output is output, not a boundary.
    const tracker = new ShellTracker(NONCE)
    tracker.feed(`${C}one\x1b]633;D;0\x07two${D(0)}`)
    expect(tracker.state.lastOutput).toBe('one\x1b]633;D;0\x07two')
    // While the next command runs, the output of the last finished one stays.
    tracker.feed(`${C}three`)
    expect(tracker.state.lastOutput).toBe('one\x1b]633;D;0\x07two')
  })

  it('keeps no more than the limit of the output of a command, the end of it', () => {
    const tracker = new ShellTracker(NONCE, { limit: 10 })
    tracker.feed(`${C}0123456789`)
    tracker.feed('abcdef')
    tracker.feed(D(0))
    expect(tracker.state.lastOutput).toBe('6789abcdef')
  })

  it('the alternate screen goes on and off with CSI ? 1049, ? 1047 and ? 47', () => {
    for (const mode of ['1049', '1047', '47']) {
      const tracker = new ShellTracker(NONCE)
      tracker.feed(`text\x1b[?${mode}h`)
      expect({ mode, on: tracker.state.altScreen }).toEqual({ mode, on: true })
      tracker.feed(`more\x1b[?${mode}l`)
      expect({ mode, on: tracker.state.altScreen }).toEqual({ mode, on: false })
    }
    const tracker = new ShellTracker(NONCE)
    tracker.feed('\x1b[?1;1049h')
    expect(tracker.state.altScreen).toBe(true)
    tracker.feed('\x1b[?25l\x1b[1049l\x1b[?1049')
    expect(tracker.state.altScreen).toBe(true)
    tracker.feed('l')
    expect(tracker.state.altScreen).toBe(false)
  })

  it('an OSC that never ends does not grow without bound', () => {
    const tracker = new ShellTracker(NONCE, { limit: 1000 })
    tracker.feed('\x1b]633;E;')
    for (let n = 0; n < 50; n++) tracker.feed('x'.repeat(1000))
    tracker.feed(`${P('/after')}`)
    expect(tracker.state.cwd).toBe('/after')
  })
})

describe('ShellTracker: sequences that end early or never', () => {
  it('a CSI aborted by ESC does not swallow the D after it (output ending in a broken ESC [)', () => {
    const tracker = new ShellTracker(NONCE)
    const events = tracker.feed(`${E('printf x')}${C}x\x1b[${D(0)}${P('/after')}`)
    expect(events).toEqual([
      { type: 'command-started', command: 'printf x' },
      { type: 'command-finished', command: 'printf x', exitCode: 0 },
    ])
    expect(tracker.state).toMatchObject({ commandRunning: false, cwd: '/after', lastOutput: 'x\x1b[' })
    // The same with the cut right after the broken CSI.
    const cut = new ShellTracker(NONCE)
    cut.feed(`${C}x\x1b[`)
    expect(cut.feed(D(0))).toEqual([{ type: 'command-finished', command: null, exitCode: 0 }])
  })

  it('CAN and SUB abort a CSI; other C0 controls inside it do not', () => {
    const tracker = new ShellTracker(NONCE)
    tracker.feed('\x1b[?10\x1849h')
    expect(tracker.state.altScreen).toBe(false)
    tracker.feed('\x1b[?1049\x1ah')
    expect(tracker.state.altScreen).toBe(false)
    tracker.feed('\x1b[?10\r49h')
    expect(tracker.state.altScreen).toBe(true)
  })

  it('U+009C (ST) ends an OSC, as in xterm.js; a folder with U+009C in its name is decoded exactly', () => {
    const tracker = new ShellTracker(NONCE)
    tracker.feed(`\x1b]0;title\u009c${P('/a\u009cb')}`)
    expect(tracker.state.cwd).toBe('/a\u009cb')
    // Raw (not escaped), U+009C would end worfy's sequence too: the rest is not a sequence.
    const raw = new ShellTracker(NONCE)
    raw.feed(`\x1b]633;P;Cwd=/a\u009cb;${NONCE}\x07`)
    expect(raw.state.cwd).toBeNull()
  })

  it('an OSC that comes one character at a time is read in linear time', () => {
    const tracker = new ShellTracker(NONCE)
    const command = 'x'.repeat(200_000)
    const started = performance.now()
    for (const char of `\x1b]633;E;${command};${NONCE}`) tracker.feed(char)
    tracker.feed('\x07')
    const ms = performance.now() - started
    tracker.feed(C)
    expect(tracker.state.commands).toEqual([command])
    // Read again with every chunk, 200 000 characters take seconds; once, tens of milliseconds.
    expect(ms).toBeLessThan(1000)
  })
})

describe('ReplayBuffer: a cut inside a sequence', () => {
  it('a replay whose start fell inside an OSC 633 starts after the end of that sequence', () => {
    const buffer = new ReplayBuffer()
    const sequence = E('echo hello; echo world')
    // The cut falls in the middle of the sequence: its tail with the nonce must not be redrawn as text.
    const before = 'x'.repeat(100)
    buffer.push(before + sequence)
    buffer.push('after')
    const cutAt = Math.floor(sequence.length / 2)
    buffer.push('y'.repeat(REPLAY_LIMIT - 'after'.length - (sequence.length - cutAt)))
    const replay = buffer.text()
    expect(replay.startsWith('after')).toBe(true)
    expect(replay).not.toContain(NONCE)
    expect(buffer.end).toBe(before.length + sequence.length + 'after'.length + REPLAY_LIMIT - 'after'.length - (sequence.length - cutAt))
  })

  it('a cut between the ESC and the backslash of ST drops the backslash too', () => {
    const buffer = new ReplayBuffer()
    const sequence = osc('P;Cwd=/x', '\x1b\\')
    buffer.push(sequence)
    // Keep exactly the last character of the sequence: the backslash of ST.
    buffer.push('z'.repeat(REPLAY_LIMIT - 1))
    expect(buffer.text()).toBe('z'.repeat(REPLAY_LIMIT - 1))
  })

  it('a cut in plain text keeps exactly the last REPLAY_LIMIT units, as before', () => {
    const buffer = new ReplayBuffer()
    buffer.push(`${A}$ ${B}${'a'.repeat(REPLAY_LIMIT)}`)
    buffer.push('bcd')
    expect(buffer.text()).toBe(`${'a'.repeat(REPLAY_LIMIT - 3)}bcd`)
  })

  it('U+009C ends the sequence for the cut as well', () => {
    const buffer = new ReplayBuffer()
    buffer.push('\x1b]0;title\u009c')
    buffer.push('z'.repeat(REPLAY_LIMIT - 3))
    expect(buffer.text()).toBe('z'.repeat(REPLAY_LIMIT - 3))
  })

  it('a sequence whose end has not come yet is dropped as it arrives', () => {
    const buffer = new ReplayBuffer()
    buffer.push(`\x1b]633;E;${'q'.repeat(REPLAY_LIMIT + 10)}`)
    expect(buffer.text()).toBe('')
    buffer.push(`${NONCE}\x07after`)
    expect(buffer.text()).toBe('after')
  })
})
