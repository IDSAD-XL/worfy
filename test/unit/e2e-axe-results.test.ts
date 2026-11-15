// What fails a screen in the e2e axe check (test/e2e/axe-results.ts, worfy-ui-kit ticket 18): the scan of
// every screen and the self-test with a nameless dialog in test/e2e/a11y.spec.ts both go through
// failingViolations, so these cases pin the filter the e2e check fails on.
import { describe, expect, it } from 'vitest'
import { describeViolations, FAILING_IMPACTS, failingViolations, lesserViolations, type Result } from '../e2e/axe-results'

const violation = (id: string, impact: Result['impact'], nodes = 1): Result =>
  ({
    id,
    impact,
    help: `${id} help`,
    tags: [],
    description: '',
    helpUrl: '',
    nodes: Array.from({ length: nodes }, (_, at) => ({ target: [`#n${at}`], html: `<div id="n${at}"></div>`, any: [], all: [], none: [] })),
  }) as unknown as Result

describe('the violations that fail a screen', () => {
  it('fail on critical and serious only', () => {
    expect(FAILING_IMPACTS).toEqual(['critical', 'serious'])
  })

  it('keep a nameless dialog (aria-dialog-name, serious) and a field without a label (label, critical)', () => {
    const all = [violation('aria-dialog-name', 'serious'), violation('label', 'critical'), violation('region', 'moderate'), violation('landmark-unique', 'minor')]
    expect(failingViolations(all).map((each) => each.id)).toEqual(['aria-dialog-name', 'label'])
    expect(lesserViolations(all).map((each) => each.id)).toEqual(['region', 'landmark-unique'])
  })

  it('leave out a violation with no impact from the failing list', () => {
    expect(failingViolations([violation('odd', null)])).toEqual([])
    expect(lesserViolations([violation('odd', null)]).map((each) => each.id)).toEqual(['odd'])
  })

  it('describe each violation on one line, with at most five elements', () => {
    const [line] = describeViolations([violation('aria-dialog-name', 'serious', 7)])
    expect(line).toMatch(/^aria-dialog-name \[serious\] aria-dialog-name help: #n0 <div id="n0"><\/div>/)
    expect(line).toContain('#n4')
    expect(line).not.toContain('#n5')
    expect(line).toMatch(/\(\+2 more\)$/)
  })
})
