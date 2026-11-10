// The rule that finds a reviewer's verdict in its answer exists twice: in the Harness (harness/lib/verdict.cjs, used
// by `bin/verdict`) and in worfy (src/shared/workflow/verdict.mjs, used by every reader of a verdict in the app). Both
// read the Harness's shared fixtures here and must give the same answer (worfy-polish 91; the owner's decision of
// 2026-11-10: the verdict is the first line that starts with VERIFIED or REJECTED, a lead-in before it is dropped,
// and an answer without such a line has no verdict). The readers are lenient about markdown in front of the word; the
// grader rejected-first of the eval case reviewer-verdict finds the same line but passes it only when it is a bare
// `REJECTED:`, so each fixture also says what the grader makes of it.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { findVerdict } from '../../src/shared/workflow/verdict.mjs'

interface VerdictCase {
  name: string
  answer: string
  verdict: 'VERIFIED' | 'REJECTED' | null
  narrow?: boolean
  text?: string
  line?: string
  grader: boolean
}

interface HarnessVerdictRules {
  findVerdict: (answer: unknown) => { verdict: string; narrow: boolean; text: string; line: string } | null
}

const harness = createRequire(join(process.cwd(), 'package.json'))('./harness/lib/verdict.cjs') as HarnessVerdictRules
const { cases } = JSON.parse(readFileSync(join(process.cwd(), 'harness', 'bin', 'tests', 'fixtures', 'verdict', 'cases.json'), 'utf8')) as { cases: VerdictCase[] }

const expected = (c: VerdictCase): ReturnType<HarnessVerdictRules['findVerdict']> =>
  c.verdict === null ? null : { verdict: c.verdict, narrow: c.narrow ?? false, text: c.text ?? '', line: c.line ?? '' }

/** The grader as `claude plugin eval` runs a regex grader: new RegExp(pattern, flags) on the saved answer as it is. */
function grader(): RegExp {
  const text = readFileSync(join(process.cwd(), 'harness', 'evals', 'reviewer-verdict', 'graders', 'rejected-first.md'), 'utf8')
  const field = (key: string): string | undefined => new RegExp(`^${key}:\\s*(.+)$`, 'm').exec(text)?.[1]?.trim()
  const pattern = field('pattern')?.replace(/^'|'$/g, '').replace(/''/g, "'") ?? '<none>'
  return new RegExp(pattern, field('flags') ?? '')
}

describe('the verdict of a reviewer answer, in the Harness and in worfy', () => {
  it('has fixtures for the three cases of the owner decision', () => {
    const names = cases.map((c) => c.name)
    expect(names.some((n) => n.startsWith('a lead-in sentence, then REJECTED'))).toBe(true)
    expect(names).toContain('no line starts with a verdict word')
    expect(names).toContain('VERIFIED inside a sentence later in the text is no verdict')
  })

  for (const c of cases) {
    it(`${c.name}: both copies read ${c.verdict ?? 'no verdict'}`, () => {
      expect(harness.findVerdict(c.answer)).toEqual(expected(c))
      expect(findVerdict(c.answer)).toEqual(expected(c))
    })
  }

  it('a value that is not text has no verdict', () => {
    for (const value of [undefined, null, 3, { verdict: 'VERIFIED' }]) {
      expect(harness.findVerdict(value)).toBeNull()
      expect(findVerdict(value as unknown as string)).toBeNull()
    }
  })

  // The grader is the strict side. It finds the verdict line as the readers do (markup in front of the word included,
  // fenced code skipped) and skips only the lead-in before it; that line must then be a bare `REJECTED:` with no
  // VERIFIED on it. When it passes, the readers read the same REJECTED; a marked-up verdict line fails it, even with a
  // bare `REJECTED:` below.
  it('the rejected-first grader of reviewer-verdict gives what each fixture says, and passes only what the readers read as a bare REJECTED:', () => {
    const pattern = grader()
    for (const c of cases) {
      expect(pattern.test(c.answer), c.name).toBe(c.grader)
      if (!c.grader) continue
      const read = findVerdict(c.answer)
      expect(read !== null && read.verdict === 'REJECTED' && !read.narrow && /^REJECTED:(?!.*VERIFIED)/.test(read.line), c.name).toBe(true)
    }
  })

  it('the split: a bold or heading-marked REJECTED reads as REJECTED and fails the grader', () => {
    const pattern = grader()
    for (const answer of ['**REJECTED**', '**REJECTED:** node --test exits 1', '## REJECTED: node --test exits 1', 'Lead-in.\n*REJECTED*: x', '`REJECTED: src/a.ts:16`']) {
      expect(findVerdict(answer)?.verdict, answer).toBe('REJECTED')
      expect(harness.findVerdict(answer)?.verdict, answer).toBe('REJECTED')
      expect(pattern.test(answer), answer).toBe(false)
    }
    expect(cases.some((c) => c.verdict === 'REJECTED' && !c.grader && /^\s*(?:#|\*|_)/.test(c.answer))).toBe(true)
  })

  it('a marked-up VERIFIED above a bare REJECTED: the readers read VERIFIED, and the grader does not skip it as a lead-in', () => {
    const answer = '**VERIFIED**\nREJECTED: x'
    expect(findVerdict(answer)?.verdict).toBe('VERIFIED')
    expect(harness.findVerdict(answer)?.verdict).toBe('VERIFIED')
    expect(grader().test(answer)).toBe(false)
    expect(grader().test('Lead-in.\nREJECTED: x')).toBe(true)
  })
})
