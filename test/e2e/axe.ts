import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

// axe-core against a screen of the built app (worfy-ui-kit ticket 18): every rule axe runs by default
// (WCAG 2.x A and AA and its best practices), and a screen fails on a violation of impact critical or
// serious. The lesser ones (moderate, minor) are written to the test's output as a list to read, not
// a failure.
//
// Legacy mode runs axe in the page itself. The default mode finishes the run in a new blank page of
// the browser context, and an Electron app has no such page to give.

/** One violation of axe: a rule and the elements that break it. */
export type Result = Awaited<ReturnType<AxeBuilder['analyze']>>['violations'][number]

/** The impacts that fail a screen. */
export const FAILING_IMPACTS: readonly string[] = ['critical', 'serious']

export interface AxeScan {
  /** A CSS selector: only this part of the page is checked. The whole page when absent. */
  include?: string
}

/** One line per violation: the rule, its impact, what it asks, and up to five of the elements it found. */
export function describeViolations(violations: Result[]): string[] {
  return violations.map((violation) => {
    const targets = violation.nodes.slice(0, 5).map((node) => node.target.join(' '))
    const more = violation.nodes.length > 5 ? ` (+${violation.nodes.length - 5} more)` : ''
    return `${violation.id} [${violation.impact ?? 'no impact'}] ${violation.help}: ${targets.join(' | ')}${more}`
  })
}

/** Runs axe on the page (or its `include` part) and returns the violations of every impact. */
export async function axeViolations(page: Page, scan: AxeScan = {}): Promise<Result[]> {
  let builder = new AxeBuilder({ page }).setLegacyMode(true)
  if (scan.include !== undefined) builder = builder.include(scan.include)
  const results = await builder.analyze()
  return results.violations
}

/**
 * Checks the screen named `screen` with axe: a violation of impact critical or serious fails the test,
 * as a soft failure, so one run lists the violations of every screen the test checks. The whole result
 * is attached to the test as `axe-<screen>.json`.
 */
export async function expectAccessible(page: Page, screen: string, scan: AxeScan = {}): Promise<void> {
  const violations = await axeViolations(page, scan)
  await test.info().attach(`axe-${screen.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.json`, { body: JSON.stringify(violations, null, 2), contentType: 'application/json' })
  const failing = violations.filter((violation) => FAILING_IMPACTS.includes(violation.impact ?? ''))
  const lesser = violations.filter((violation) => !FAILING_IMPACTS.includes(violation.impact ?? ''))
  if (lesser.length > 0) console.log(`axe, ${screen}, below serious:\n  ${describeViolations(lesser).join('\n  ')}`)
  expect.soft(describeViolations(failing), `axe on ${screen}: no critical or serious violations`).toEqual([])
}
