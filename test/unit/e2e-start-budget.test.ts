// The budget of the Auberge-sized start in test/e2e/epic-frame.spec.ts: test/e2e/start-budget.ts.
import { describe, expect, it } from 'vitest'
import * as budget from '../e2e/start-budget'
import { measuresReference, START_MS, START_RATIO, startBudget } from '../e2e/start-budget'

const CI = { GITHUB_ACTIONS: 'true' }

describe('the budget of an Auberge-sized start (startBudget)', () => {
  it('is 3 s off GitHub Actions, whatever the one-Ticket start took', () => {
    for (const env of [{}, { GITHUB_ACTIONS: 'false' }, { GITHUB_ACTIONS: '1' }, { CI: 'true' }]) {
      for (const referenceMs of [100, 721, 1274, 5_000]) expect(startBudget(referenceMs, env), JSON.stringify(env)).toBe(3_000)
    }
    expect(START_MS).toBe(3_000)
  })

  it('on GitHub Actions is 6 times the one-Ticket start of the runner', () => {
    expect(START_RATIO).toBe(6)
    expect(startBudget(721, CI)).toBe(4_326)
    expect(startBudget(909, CI)).toBe(5_454)
  })

  it('on GitHub Actions holds every Auberge-sized start the runner measured against its reference', () => {
    const measured = [
      // 2026-10-28, when the ratio was set.
      { auberge: 3897, reference: 1274 },
      { auberge: 3911, reference: 909 },
      { auberge: 2739, reference: 721 },
      { auberge: 1736, reference: 565 },
      // The four red first attempts of the 84 macos-e2e jobs of 2026-11-22..25 (worfy-polish 150), red against the
      // former 7300 ms ceiling: the runner was slow, the Project was not slower against its one-Ticket start.
      { auberge: 10_258, reference: 3857 },
      { auberge: 7716, reference: 1916 },
      { auberge: 8227, reference: 2007 },
      { auberge: 9436, reference: 1880 },
    ]
    for (const { auberge, reference } of measured) expect(auberge, `${auberge} against ${reference}`).toBeLessThanOrEqual(startBudget(reference, CI))
  })

  it('on GitHub Actions follows the measured base, not a ceiling: the highest N / R of the 84 jobs, 5.19, is inside it, a Project 6.5 times its base is not', () => {
    for (const referenceMs of [640, 1384, 3857]) {
      expect(5.19 * referenceMs, `${referenceMs}`).toBeLessThanOrEqual(startBudget(referenceMs, CI))
      expect(6.5 * referenceMs, `${referenceMs}`).toBeGreaterThan(startBudget(referenceMs, CI))
    }
    // The former ceiling of 7.3 s, which the runner's speed hit in 58 of the 84 jobs, is gone, not raised.
    expect('RUNNER_START_CAP_MS' in budget).toBe(false)
  })

  it('on GitHub Actions is never below 3 s', () => {
    expect(startBudget(100, CI)).toBe(3_000)
    expect(startBudget(0, CI)).toBe(3_000)
  })
})

describe('whether the start test measures the one-Ticket reference (measuresReference)', () => {
  it('only on GitHub Actions, where the budget depends on it', () => {
    expect(measuresReference(CI)).toBe(true)
    for (const env of [{}, { GITHUB_ACTIONS: 'false' }, { CI: 'true' }]) expect(measuresReference(env), JSON.stringify(env)).toBe(false)
  })
})
