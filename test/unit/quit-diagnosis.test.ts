// The pure parts of the diagnosis of an e2e app that did not quit in time (test/e2e/quit-diagnosis.ts,
// used by close() of launchApp in test/e2e/helpers.ts): it runs only when a quit hangs, so the
// stack it picks out of a `sample` report, the output tail and the attached text are checked here.
import { describe, expect, it } from 'vitest'
import { lastLines, mainThreadStack, QUIT_OUTPUT_LINES, QUIT_STACK_LINES, quitDiagnosisText, quitLogLines, type QuitFindings } from '../e2e/quit-diagnosis'

/** A `sample` report cut down to its shape: a header, the main thread, then two more threads. */
const SAMPLE = [
  'Analysis of sampling Electron (pid 17928) every 1 millisecond',
  'Process:         Electron [17928]',
  '----',
  '',
  'Call graph:',
  '    2364 Thread_893824897   DispatchQueue_1: com.apple.main-thread  (serial)',
  '    + 2364 start  (in dyld) + 6992  [0x1897fc4e4]',
  '    +   2364 ElectronMain  (in Electron Framework) + 388  [0x112c838f4]',
  '    +     2364 -[NSApplication run]  (in AppKit) + 368  [0x18e0ad13c]',
  '    +       2364 -[NSWindow _close]  (in AppKit) + 380  [0x18e335f44]',
  '    +         2364 -[NSAlert runModal]  (in AppKit) + 116  [0x18e2c1a10,0x18e2c1a14]',
  '    +           2364 mach_msg2_trap  (in libsystem_kernel.dylib) + 8  [0x189b5ec34]',
  '    2364 Thread_893824937',
  '      2364 start_wqthread  (in libsystem_pthread.dylib) + 8  [0x189b9cb9c]',
  '    2364 Thread_893824960: com.apple.NSEventThread',
  '      2364 thread_start  (in libsystem_pthread.dylib) + 8  [0x189b98c08]',
  '',
  'Total number in stack (recursive counted multiple times):',
].join('\n')

const findings = (overrides: Partial<QuitFindings> = {}): QuitFindings => ({
  quitTimeoutMs: 20_000,
  pid: 17928,
  sample: { value: SAMPLE },
  output: 'first line\n[link] the link service started\nlast line\n',
  ...overrides,
})

describe('mainThreadStack', () => {
  it('gives the frames of the main thread alone, outermost first, without the tree drawing and the addresses', () => {
    expect(mainThreadStack(SAMPLE)).toEqual([
      '2364 start  (in dyld) + 6992',
      '2364 ElectronMain  (in Electron Framework) + 388',
      '2364 -[NSApplication run]  (in AppKit) + 368',
      '2364 -[NSWindow _close]  (in AppKit) + 380',
      '2364 -[NSAlert runModal]  (in AppKit) + 116',
      '2364 mach_msg2_trap  (in libsystem_kernel.dylib) + 8',
    ])
  })

  it('keeps the innermost frames when there are more than asked for: there the thread waits', () => {
    expect(mainThreadStack(SAMPLE, 2)).toEqual(['2364 -[NSAlert runModal]  (in AppKit) + 116', '2364 mach_msg2_trap  (in libsystem_kernel.dylib) + 8'])
    expect(mainThreadStack(SAMPLE, 0)).toEqual([])
  })

  it('ends at a blank line when the main thread is the last one', () => {
    const lastThread = ['Call graph:', '    9 Thread_1   DispatchQueue_1: com.apple.main-thread  (serial)', '    + 9 start  (in dyld) + 1  [0x1]', '', 'Total number in stack:'].join('\n')
    expect(mainThreadStack(lastThread)).toEqual(['9 start  (in dyld) + 1'])
  })

  it('is empty for a report without a main thread', () => {
    expect(mainThreadStack('sample cannot examine process 1 for unknown reasons')).toEqual([])
  })

  it('shows 40 frames by default', () => {
    const deep = ['    5 Thread_1   DispatchQueue_1: com.apple.main-thread  (serial)', ...Array.from({ length: 50 }, (_, i) => `    + 5 frame${i}  (in x) + 1  [0x${i}]`)].join('\n')
    const stack = mainThreadStack(deep)
    expect(QUIT_STACK_LINES).toBe(40)
    expect(stack).toHaveLength(40)
    expect(stack.at(-1)).toBe('5 frame49  (in x) + 1')
  })
})

describe('lastLines', () => {
  it('gives the last lines without the empty one a final newline leaves', () => {
    expect(lastLines('a\nb\nc\n', 2)).toEqual(['b', 'c'])
    expect(lastLines('a\nb', 5)).toEqual(['a', 'b'])
    expect(lastLines('a\n', 0)).toEqual([])
  })

  it('keeps 80 lines by default', () => {
    const text = Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n')
    expect(QUIT_OUTPUT_LINES).toBe(80)
    expect(lastLines(text)).toHaveLength(80)
    expect(lastLines(text)[0]).toBe('line 20')
  })
})

describe('quitLogLines', () => {
  it('names the PID and the timeout, then the innermost frames of the main thread', () => {
    const lines = quitLogLines(findings())
    expect(lines[0]).toBe('[quit diagnosis] the app (PID 17928) did not quit within 20 s; the innermost 6 frames of its main thread:')
    expect(lines.at(-2)).toBe('  2364 -[NSAlert runModal]  (in AppKit) + 116')
  })

  it('says why there is no stack: no sample on the system, sample failed, no main thread in the report', () => {
    expect(quitLogLines(findings({ sample: undefined, pid: undefined }))).toEqual([
      "[quit diagnosis] the app (PID unknown) did not quit within 20 s; no `sample` on this system: the app's output is attached",
    ])
    expect(quitLogLines(findings({ sample: { problem: 'exit code 1: no such process' } }))[0]).toMatch(/`sample` failed: exit code 1: no such process$/)
    expect(quitLogLines(findings({ sample: { value: 'nothing' } }))[0]).toMatch(/has no main thread: it is attached$/)
  })
})

describe('quitDiagnosisText', () => {
  it('holds the log lines, the tail of the output and the whole sample report', () => {
    const text = quitDiagnosisText(findings())
    expect(text).toContain('the innermost 6 frames of its main thread:')
    expect(text).toContain("--- the last 3 lines of the app's stdout and stderr ---\nfirst line\n[link] the link service started\nlast line\n")
    expect(text).toContain(`--- sample 17928 3 ---\n${SAMPLE}`)
  })

  it('has the output tail alone where there is no sample report', () => {
    const text = quitDiagnosisText(findings({ sample: undefined }))
    expect(text).toContain('last line')
    expect(text).not.toContain('--- sample')
    expect(quitDiagnosisText(findings({ sample: { problem: 'timed out' } }))).not.toContain('--- sample')
  })
})
