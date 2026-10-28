// The budget of the Auction-sized start in test/e2e/epic-frame.spec.ts: test/e2e/start-budget.ts.
import { describe, expect, it } from 'vitest'
import { measuresReference, RUNNER_START_CAP_MS, START_MS, START_RATIO, startBudget } from '../e2e/start-budget'

const CI = { GITHUB_ACTIONS: 'true' }

describe('the budget of an Auction-sized start (startBudget)', () => {
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

  it('on GitHub Actions holds every Auction-sized start the runner measured against its reference', () => {
    const measured = [
      { auction: 3897, reference: 1274 },
      { auction: 3911, reference: 909 },
      { auction: 2739, reference: 721 },
      { auction: 1736, reference: 565 },
    ]
    for (const { auction, reference } of measured) expect(auction, `${auction} against ${reference}`).toBeLessThanOrEqual(startBudget(reference, CI))
  })

  it('on GitHub Actions is never below 3 s', () => {
    expect(startBudget(100, CI)).toBe(3_000)
    expect(startBudget(0, CI)).toBe(3_000)
  })

  it('on GitHub Actions stops at 7.3 s, the slowest measured 4853 ms times 1.5, however slow the one-Ticket start', () => {
    expect(RUNNER_START_CAP_MS).toBe(7_300)
    expect(RUNNER_START_CAP_MS).toBeGreaterThanOrEqual(4853 * 1.5)
    expect(startBudget(1_274, CI)).toBe(7_300)
    // A one-Ticket start 10 times slower does not raise the budget 10 times.
    expect(startBudget(7_210, CI)).toBe(7_300)
    // A fixed 2.5 s added to every start (721 + 2500 ms) leaves the budget at the ceiling.
    expect(startBudget(3_221, CI)).toBe(7_300)
  })
})

describe('whether the start test measures the one-Ticket reference (measuresReference)', () => {
  it('only on GitHub Actions, where the budget depends on it', () => {
    expect(measuresReference(CI)).toBe(true)
    for (const env of [{}, { GITHUB_ACTIONS: 'false' }, { CI: 'true' }]) expect(measuresReference(env), JSON.stringify(env)).toBe(false)
  })
})
