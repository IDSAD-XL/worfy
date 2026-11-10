// The rule that finds a reviewer's verdict in its answer exists twice: in the Harness (harness/lib/verdict.cjs, used
// by `bin/verdict`) and in worfy (src/shared/workflow/verdict.mjs, used by every reader of a verdict in the app). The
// grader rejected-first of the eval case reviewer-verdict says the same thing as a regular expression. All three read
// the Harness's shared fixtures here and must give the same answer (worfy-polish 91; the owner's decision of
// 2026-11-10: the verdict is the first line that starts with VERIFIED or REJECTED, a lead-in before it is dropped,
// and an answer without such a line has no verdict).
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

  // The grader passes when the verdict the rule reads is a plain `REJECTED:` with no VERIFIED on its line: the lead-in
  // is dropped as the rule drops it, and the format the reviewer agent owes (ticket worfy-polish 84) still holds.
  it('the rejected-first grader of reviewer-verdict agrees with the rule on every fixture', () => {
    const pattern = grader()
    for (const c of cases) {
      const read = findVerdict(c.answer)
      const want = read !== null && read.verdict === 'REJECTED' && !read.narrow && /^REJECTED:(?!.*VERIFIED)/.test(read.line)
      expect(pattern.test(c.answer), c.name).toBe(want)
    }
  })
})
