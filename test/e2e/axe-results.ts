import type AxeBuilder from '@axe-core/playwright'

// What fails a screen in the axe check (test/e2e/axe.ts), as pure functions of axe's results: the scan of
// a screen and the check's own self-test in test/e2e/a11y.spec.ts go through the same failingViolations,
// and test/unit/e2e-axe-results.test.ts pins it without a browser (worfy-ui-kit ticket 18).

/** One violation of axe: a rule and the elements that break it. */
export type Result = Awaited<ReturnType<AxeBuilder['analyze']>>['violations'][number]

/** The impacts that fail a screen. */
export const FAILING_IMPACTS: readonly string[] = ['critical', 'serious']

/** The violations that fail a screen: those of impact critical or serious. */
export function failingViolations(violations: readonly Result[]): Result[] {
  return violations.filter((violation) => FAILING_IMPACTS.includes(violation.impact ?? ''))
}

/** The violations below that: reported, not failed. */
export function lesserViolations(violations: readonly Result[]): Result[] {
  return violations.filter((violation) => !FAILING_IMPACTS.includes(violation.impact ?? ''))
}

/** One line per violation: the rule, its impact, what it asks, and up to five of the elements it found with their HTML. */
export function describeViolations(violations: readonly Result[]): string[] {
  return violations.map((violation) => {
    const targets = violation.nodes.slice(0, 5).map((node) => `${node.target.join(' ')} ${node.html.slice(0, 160)}`)
    const more = violation.nodes.length > 5 ? ` (+${violation.nodes.length - 5} more)` : ''
    return `${violation.id} [${violation.impact ?? 'no impact'}] ${violation.help}: ${targets.join(' | ')}${more}`
  })
}
