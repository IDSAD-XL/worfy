// A wait for a condition that names no timeout gives up after vitest's 1 s times the run's
// multiplier (worfy-polish 70): the wrappers of test/scaled-waits.ts, and that every test file of
// this project runs with them, as with the default of expect.poll.

import { afterEach, chai, describe, expect, it, vi } from 'vitest'
import { scaledTimeoutOf, scaleWaits, WAIT_DEFAULT_TIMEOUT, withDefaultTimeout, type WaitOptions, type Waits } from '../scaled-waits'
import { ms, readTimeoutScale } from '../time-scale'

/** A stand-in of vitest's waits: gives up after the timeout it is given, on the timers of the test. */
function standIn(): Waits & { calls: (WaitOptions | undefined)[] } {
  const calls: (WaitOptions | undefined)[] = []
  const wait = (_callback: never, options?: WaitOptions): Promise<never> => {
    calls.push(options)
    const timeout = typeof options === 'number' ? options : (options?.timeout ?? WAIT_DEFAULT_TIMEOUT)
    return new Promise((_resolve, reject) => setTimeout(() => reject(new Error(`gave up after ${timeout} ms`)), timeout))
  }
  return { waitFor: wait, waitUntil: wait, calls }
}

/** Whether `promise` has settled once the microtasks queued so far ran. */
async function settled(promise: Promise<unknown>): Promise<boolean> {
  let done = false
  promise.then(
    () => (done = true),
    () => (done = true),
  )
  await Promise.resolve()
  await Promise.resolve()
  return done
}

afterEach(() => {
  vi.useRealTimers()
})

describe('the default timeout of a wait for a condition', () => {
  it('is filled in only when the call names none; a timeout of its own and the interval stay', () => {
    expect(withDefaultTimeout(undefined, 3_000)).toEqual({ timeout: 3_000 })
    expect(withDefaultTimeout({}, 3_000)).toEqual({ timeout: 3_000 })
    expect(withDefaultTimeout({ interval: 20 }, 3_000)).toEqual({ interval: 20, timeout: 3_000 })
    // unscaled: a timeout the call names, which the default must not replace
    expect(withDefaultTimeout({ timeout: 400, interval: 20 }, 3_000)).toEqual({ timeout: 400, interval: 20 })
    expect(withDefaultTimeout(700, 3_000)).toBe(700)
  })

  it('with a multiplier of 2.5 a waitFor and a waitUntil without a timeout wait 2.5 s, not 1 s', async () => {
    vi.useFakeTimers()
    const waits = standIn()
    scaleWaits(waits, readTimeoutScale('2.5'))
    for (const wait of [waits.waitFor, waits.waitUntil]) {
      const given = wait(undefined as never, { interval: 20 }) as Promise<never>
      given.catch(() => {})
      vi.advanceTimersByTime(2_499)
      expect(await settled(given)).toBe(false)
      vi.advanceTimersByTime(1)
      await expect(given).rejects.toThrow('gave up after 2500 ms')
    }
    expect(waits.calls).toEqual([
      { interval: 20, timeout: 2_500 },
      { interval: 20, timeout: 2_500 },
    ])
  })

  it('a wait that names its own timeout keeps it under any multiplier', async () => {
    vi.useFakeTimers()
    const waits = standIn()
    scaleWaits(waits, 4)
    // unscaled: a timeout the call names, on fake timers, which the multiplier must not reach
    const own = waits.waitFor(undefined as never, { timeout: 400 }) as Promise<never>
    own.catch(() => {})
    // unscaled: the same as a bare number
    const bare = waits.waitUntil(undefined as never, 700) as Promise<never>
    bare.catch(() => {})
    vi.advanceTimersByTime(400)
    await expect(own).rejects.toThrow('gave up after 400 ms')
    vi.advanceTimersByTime(300)
    await expect(bare).rejects.toThrow('gave up after 700 ms')
    expect(waits.calls).toEqual([{ timeout: 400 }, 700])
  })

  it('a second setup of the same waits leaves them as they are, so the multiplier is never applied twice', () => {
    const waits = standIn()
    scaleWaits(waits, 3)
    const once = waits.waitFor
    scaleWaits(waits, 3)
    expect(waits.waitFor).toBe(once)
    expect(scaledTimeoutOf(waits.waitFor)).toBe(3_000)
    expect(scaledTimeoutOf(standIn().waitFor)).toBeUndefined()
  })
})

describe('the waits of this run', () => {
  it('vi.waitFor and vi.waitUntil default to 1 s times the run\'s multiplier, and still answer', async () => {
    expect(scaledTimeoutOf(vi.waitFor)).toBe(ms(WAIT_DEFAULT_TIMEOUT))
    expect(scaledTimeoutOf(vi.waitUntil)).toBe(ms(WAIT_DEFAULT_TIMEOUT))
    await expect(vi.waitFor(() => 'found')).resolves.toBe('found')
    await expect(vi.waitUntil(() => 'found')).resolves.toBe('found')
  })

  it('expect.poll defaults to 1 s times the run\'s multiplier', () => {
    expect(chai.util.flag(expect.poll(() => 1), '_poll.timeout')).toBe(ms(WAIT_DEFAULT_TIMEOUT))
  })
})
