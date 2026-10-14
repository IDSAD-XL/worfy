// The output tail of Fix (src/shared/terminal-ai/output-tail.ts): what a failed command printed, as
// the plain lines a terminal would show, the last 50 of them.
import { describe, expect, it } from 'vitest'
import { MAX_OUTPUT_LINES } from '../../src/shared/terminal-ai/context'
import { outputLines, outputTail } from '../../src/shared/terminal-ai/output-tail'

describe('the output tail of Fix', () => {
  it('drops colours, cursor moves and OSC strings, and keeps the text', () => {
    const output = [
      '\x1b[1;31merror\x1b[0m TS2307: Cannot find module \x1b[36m\'axios\'\x1b[39m\r\n',
      '\x1b]0;a title\x07\x1b]8;;https://example.com\x1b\\a link\x1b]8;;\x1b\\\r\n',
      '\x1b[2A\x1b[10;5Hmoved\x1b[?25l\x1b(B\x1b=\r\n',
    ].join('')
    expect(outputTail(output)).toEqual(["error TS2307: Cannot find module 'axios'", 'a link', 'moved'])
  })

  it('a progress line drawn over `\\r` is its last state, an erase-in-line clears what it left', () => {
    expect(outputTail('Downloading  10%\rDownloading  55%\rDownloading 100%\r\ndone\r\n')).toEqual(['Downloading 100%', 'done'])
    // A shorter state over a longer one: what the terminal shows, unless the program erases the rest.
    expect(outputLines('progress: working\rdone')).toEqual(['doneress: working'])
    expect(outputLines('progress: working\r\x1b[Kdone')).toEqual(['done'])
    expect(outputLines('abc\bd')).toEqual(['abd'])
  })

  it('120 lines give the last 50', () => {
    const output = Array.from({ length: 120 }, (_, at) => `line ${at + 1}\r\n`).join('')
    const tail = outputTail(output)
    expect(MAX_OUTPUT_LINES).toBe(50)
    expect(tail).toHaveLength(50)
    expect(tail[0]).toBe('line 71')
    expect(tail.at(-1)).toBe('line 120')
  })

  it('no output gives an empty tail; empty lines at the end do not count', () => {
    expect(outputTail('')).toEqual([])
    expect(outputTail(null)).toEqual([])
    expect(outputTail('\x1b[0m\r\n\r\n')).toEqual([])
    expect(outputTail('one\r\n\r\ntwo\r\n\r\n\r\n')).toEqual(['one', '', 'two'])
  })

  it('a sequence cut at the end, or aborted by the next one, leaves no part of itself', () => {
    expect(outputLines('text\x1b[1')).toEqual(['text'])
    expect(outputLines('a\x1b[1\x1b[0mb')).toEqual(['ab'])
    expect(outputLines('a\x1b]0;never ended')).toEqual(['a'])
    expect(outputLines('bell\x07 and \x00null')).toEqual(['bell and null'])
  })
})
