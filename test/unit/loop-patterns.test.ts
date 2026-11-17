// The loop patterns of the Harness call log (harness/hooks/loop-patterns.mjs, worfy-stuck-agents ticket 07): the
// same call with the same failed outcome, an edit back and forth, a pair of calls repeated (A-B-A-B). A repeat
// with a new outcome is no loop, and the commands that wait for CI do not count. The module is pure: these
// calls are the records calls.mjs keeps, newest last.
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'

interface Call {
  tool: string
  in: string
  out: string
  fail: boolean | null
  files?: [string, string][]
}
interface Repeat {
  pattern: string
  count: number
}
interface LoopPatterns {
  MAX_CALLS: number
  HINT_AT: number
  DENY_AT: number
  isCiWait: (command: string) => boolean
  repeats: (calls: Call[]) => Repeat[]
  levelOf: (count: number) => 'would-hint' | 'would-deny' | null
}

let lp: LoopPatterns

beforeAll(async () => {
  lp = (await import(pathToFileURL(join(import.meta.dirname, '..', '..', 'harness', 'hooks', 'loop-patterns.mjs')).href)) as LoopPatterns
})

const bash = (input: string, out: string, fail: boolean | null): Call => ({ tool: 'Bash', in: input, out, fail })
const edit = (file: string, content: string, fail: boolean | null = false): Call => ({ tool: 'Edit', in: `${file}:${content}`, out: fail ? 'fail:e' : 'ok', fail, files: [[file, content]] })
const pattern = (calls: Call[], name: string) => lp.repeats(calls).find((r) => r.pattern === name)?.count ?? 0

describe('the levels', () => {
  it('a hint on the 3rd repeat, a deny from the 4th, nothing before', () => {
    expect([lp.MAX_CALLS, lp.HINT_AT, lp.DENY_AT]).toEqual([20, 3, 4])
    expect([0, 1, 2, 3, 4, 7].map(lp.levelOf)).toEqual([null, null, null, 'would-hint', 'would-deny', 'would-deny'])
  })
})

describe('the same call with the same failed outcome', () => {
  it('counts the repeats of the newest call among the calls it is given, apart or in a row; one call is no repeat', () => {
    const a = bash('a', 'fail:1', true)
    expect(pattern([a], 'same-failure')).toBe(0)
    expect(pattern([a, a], 'same-failure')).toBe(2)
    expect(pattern([a, bash('x', 'ok', false), a, bash('y', 'ok', false), a], 'same-failure')).toBe(3)
    expect(pattern([a, a, a, a], 'same-failure')).toBe(4)
  })

  it('is no loop with a new outcome each time, or when the call succeeds', () => {
    expect(pattern([bash('a', 'fail:1', true), bash('a', 'fail:2', true), bash('a', 'fail:3', true)], 'same-failure')).toBe(0)
    expect(lp.repeats([bash('a', 'ok', false), bash('a', 'ok', false), bash('a', 'ok', false), bash('a', 'ok', false)])).toEqual([])
    // A Codex outcome with exit code 0 is a success too.
    const zero = bash('a', 'exit:0:h', false)
    expect(lp.repeats([zero, zero, zero, zero])).toEqual([])
  })

  it('does not count an outcome of unknown success (a Codex shell call without an exit code) as a failure', () => {
    const unknown = bash('a', 'out:h', null)
    expect(lp.repeats([unknown, unknown, unknown, unknown])).toEqual([])
  })

  it('is about the newest call: older repeats of another call do not count for it', () => {
    const a = bash('a', 'fail:1', true)
    expect(pattern([a, a, a, bash('b', 'fail:1', true)], 'same-failure')).toBe(0)
  })
})

describe('an edit back and forth', () => {
  it('counts the returns of a file to the content of two edits before, in a row: two returns are the 3rd repeat', () => {
    expect(pattern([edit('f', 'B'), edit('f', 'A'), edit('f', 'B')], 'edit-back-and-forth')).toBe(2)
    expect(pattern([edit('f', 'B'), edit('f', 'A'), edit('f', 'B'), edit('f', 'A')], 'edit-back-and-forth')).toBe(3)
    expect(pattern([edit('f', 'B'), edit('f', 'A'), edit('f', 'B'), edit('f', 'A'), edit('f', 'B')], 'edit-back-and-forth')).toBe(4)
  })

  it('follows one file across other calls, and not another file', () => {
    const between = bash('pnpm test', 'fail:1', true)
    expect(pattern([edit('f', 'B'), between, edit('g', 'X'), edit('f', 'A'), between, edit('f', 'B'), edit('g', 'Y'), edit('f', 'A')], 'edit-back-and-forth')).toBe(3)
    expect(pattern([edit('f', 'B'), edit('f', 'A'), edit('f', 'B'), edit('g', 'A')], 'edit-back-and-forth')).toBe(0)
  })

  it('is no loop for edits that move on, and a failed edit, which changed nothing, does not count', () => {
    expect(pattern([edit('f', 'A'), edit('f', 'B'), edit('f', 'C'), edit('f', 'D')], 'edit-back-and-forth')).toBe(0)
    expect(pattern([edit('f', 'A'), edit('f', 'A'), edit('f', 'A')], 'edit-back-and-forth')).toBe(0)
    expect(pattern([edit('f', 'B'), edit('f', 'A'), edit('f', 'A', true), edit('f', 'B'), edit('f', 'A')], 'edit-back-and-forth')).toBe(3)
  })

  it('does not count an edit of unknown outcome (an apply_patch without an exit code) as a successful one', () => {
    const unknown = (content: string): Call => ({ ...edit('f', content), out: 'out:h', fail: null })
    expect(pattern([edit('f', 'B'), unknown('A'), edit('f', 'B'), unknown('A')], 'edit-back-and-forth')).toBe(0)
    expect(pattern([edit('f', 'B'), unknown('A'), edit('f', 'B'), edit('f', 'A'), edit('f', 'B'), edit('f', 'A')], 'edit-back-and-forth')).toBe(3)
  })
})

describe('A-B-A-B', () => {
  const a = bash('pnpm test', 'fail:1', true)
  const b = edit('f', 'A')

  it('counts the pairs repeated in a row at the end: three pairs are the 3rd repeat', () => {
    expect(pattern([a, b, a, b], 'abab')).toBe(2)
    expect(pattern([a, b, a, b, a, b], 'abab')).toBe(3)
    expect(pattern([b, a, b, a, b, a, b, a], 'abab')).toBe(4)
  })

  it('is no loop with a new outcome inside, with a broken rhythm, for one call repeated, or when both calls succeed', () => {
    expect(pattern([a, b, bash('pnpm test', 'fail:2', true), b, a, b], 'abab')).toBe(0)
    expect(pattern([a, b, b, a, b, a, b], 'abab')).toBe(2)
    expect(pattern([a, a, a, a, a, a], 'abab')).toBe(0)
    const ok = bash('git status', 'ok', false)
    expect(pattern([ok, b, ok, b, ok, b, ok, b], 'abab')).toBe(0)
  })

  it('is no loop for calls of unknown outcome with a success, and counts them in a pair with a failure', () => {
    const unknown = bash('cat notes', 'out:h', null)
    expect(pattern([unknown, b, unknown, b, unknown, b], 'abab')).toBe(0)
    expect(pattern([unknown, bash('ls', 'out:g', null), unknown, bash('ls', 'out:g', null), unknown, bash('ls', 'out:g', null)], 'abab')).toBe(0)
    expect(pattern([unknown, a, unknown, a, unknown, a], 'abab')).toBe(3)
  })
})

describe('the commands that wait for CI', () => {
  it('are told by gh pr checks, gh run watch and gh run view anywhere in the command', () => {
    for (const command of ['gh pr checks 12', 'gh pr checks 12 --watch; echo "EXIT=$?"', 'sleep 60 && gh run watch 123 --exit-status', 'gh run view 99 --exit-status', 'cd x && gh  pr  checks']) {
      expect(lp.isCiWait(command), command).toBe(true)
    }
  })

  it('are not other gh commands', () => {
    for (const command of ['gh pr view 12', 'gh pr create --title checks', 'pnpm test', 'echo gh-pr-checks', 'gh run list']) {
      expect(lp.isCiWait(command), command).toBe(false)
    }
  })
})
