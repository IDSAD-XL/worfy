import { writeFile } from 'node:fs/promises'
import { basename } from 'node:path'
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { describeViolations, failingViolations, lesserViolations, type Result } from './axe-results'

export { describeViolations, FAILING_IMPACTS, failingViolations, lesserViolations, type Result } from './axe-results'

// axe-core against a screen of the built app (worfy-ui-kit ticket 18): every rule axe runs by default
// (WCAG 2.x A and AA and its best practices), and a screen fails on a violation of impact critical or
// serious. The lesser ones (moderate, minor) are written to the test's output as a list to read, not
// a failure.
//
// Legacy mode runs axe in the page itself. The default mode finishes the run in a new blank page of
// the browser context, and an Electron app has no such page to give.

export interface AxeScan {
  /** A CSS selector: only this part of the page is checked. The whole page when absent. */
  include?: string
}

/** Runs axe on the page (or its `include` part) and returns the violations of every impact. */
export async function axeViolations(page: Page, scan: AxeScan = {}): Promise<Result[]> {
  // axe reads the colours as painted: an element still fading in (the Story view's steps slide in from
  // opacity 0 for 0.3 s) has a lower contrast than at rest, so a scan in that window fails at random.
  // Wait for every finite animation and transition of the page to end first.
  // A string, as elsewhere in test/e2e: the e2e TypeScript project has no DOM types.
  await page.evaluate(
    'Promise.all(document.getAnimations().filter((a) => a.effect?.getComputedTiming().endTime !== Infinity).map((a) => a.finished.catch(() => undefined)))',
  )
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
  // A file in the test's output folder, so CI keeps it with the failure's other files.
  const file = test.info().outputPath(`axe-${screen.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.json`)
  await writeFile(file, JSON.stringify(violations, null, 2))
  await test.info().attach(basename(file), { path: file, contentType: 'application/json' })
  const failing = failingViolations(violations)
  const lesser = lesserViolations(violations)
  if (lesser.length > 0) console.log(`axe, ${screen}, below serious:\n  ${describeViolations(lesser).join('\n  ')}`)
  expect.soft(describeViolations(failing), `axe on ${screen}: no critical or serious violations`).toEqual([])
}
