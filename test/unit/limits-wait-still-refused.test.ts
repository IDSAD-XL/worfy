// LimitsWait.stillRefused (src/main/autopilot/limits-wait.ts, worfy-retry ticket 08): after a wait for the
// Limits on a Vendor other than Claude, the windows are read anew (usage.refresh with the Vendor and age 0),
// then judged. A run's Force stop or the quit (`cutShort`) does not wait for the read; a read that fails
// leaves the windows known to decide. Claude reads nothing. Shared by a run (run.ts) and Auto-continue of a
// manual turn (orchestrator-continue.ts).
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LimitsWait, type VendorUsage } from '../../src/main/autopilot/limits-wait'
import type { LimitWindow } from '../../src/shared/agent/limits'

const NOW = 1_793_000_000_000

/** Codex's 5-hour window `used` % full, resetting `inMinutes` after NOW. */
const fiveHour = (used: number, inMinutes: number): LimitWindow => ({
  vendor: 'codex',
  id: 'primary',
  label: '5h',
  usedPercent: used,
  windowMinutes: 300,
  resetsAt: NOW / 1000 + inMinutes * 60,
  state: used >= 100 ? 'reached' : 'ok',
  receivedAt: NOW,
  source: 'read',
})

function limitsWait(known: { windows: readonly LimitWindow[] | null }) {
  return new LimitsWait({
    state: () => ({ windows: {} }),
    windows: (vendor) => (vendor === 'codex' ? known.windows : null),
    observeSession: () => () => undefined,
    send: () => undefined,
    now: () => NOW,
    schedule: () => () => undefined,
  })
}

/** A read that never answers by itself. */
const heldUsage = (): VendorUsage & { calls: [number, string | undefined][] } => {
  const calls: [number, string | undefined][] = []
  return {
    calls,
    refresh: (olderThanMs, vendor) => {
      calls.push([olderThanMs, vendor])
      return new Promise<void>(() => undefined)
    },
  }
}

/** `promise`'s answer, or 'held' when it has not answered after a few turns of the event loop. */
const answerOrHeld = <T>(promise: Promise<T>): Promise<T | 'held'> => Promise.race([promise, new Promise<'held'>((done) => setTimeout(() => done('held'), 50))])

afterEach(() => {
  vi.restoreAllMocks()
})

describe('LimitsWait.stillRefused (worfy-retry ticket 08)', () => {
  it('Claude: reads nothing and answers null', async () => {
    const usage = heldUsage()
    expect(await limitsWait({ windows: [fiveHour(100, 60)] }).stillRefused('claude', usage)).toBeNull()
    expect(usage.calls).toEqual([])
  })

  it('reads the Vendor anew with age 0, then judges the windows read: one still used up is the hit to wait for; open ones answer null', async () => {
    const known = { windows: [fiveHour(100, -1)] as readonly LimitWindow[] }
    const wait = limitsWait(known)
    const reads: [number, string | undefined][] = []
    let next: readonly LimitWindow[] = [fiveHour(100, 60)]
    const usage: VendorUsage = {
      refresh: (olderThanMs, vendor) => {
        reads.push([olderThanMs, vendor])
        known.windows = next
        return Promise.resolve()
      },
    }
    expect(await wait.stillRefused('codex', usage)).toEqual({ window: 'primary', resetsAt: NOW / 1000 + 3600 })
    next = [fiveHour(10, 60)]
    expect(await wait.stillRefused('codex', usage)).toBeNull()
    expect(reads).toEqual([
      [0, 'codex'],
      [0, 'codex'],
    ])
  })

  it('a read that fails: the windows known decide, and the failure is a warning, not a rejection', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const failing: VendorUsage = { refresh: () => Promise.reject(new Error('no answer from Codex')) }
    expect(await limitsWait({ windows: [fiveHour(100, 60)] }).stillRefused('codex', failing)).toEqual({ window: 'primary', resetsAt: NOW / 1000 + 3600 })
    expect(await limitsWait({ windows: [fiveHour(100, -1)] }).stillRefused('codex', failing)).toBeNull()
    expect(warn).toHaveBeenCalledTimes(2)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('could not read the Limits of codex after the wait'), expect.any(Error))
  })

  it('cutShort (a Force stop or the quit) ends the wait for a read that does not answer: the windows known decide at once', async () => {
    const usage = heldUsage()
    let cut!: () => void
    const cutShort = new Promise<void>((done) => (cut = done))
    const answer = limitsWait({ windows: [fiveHour(100, 60)] }).stillRefused('codex', usage, cutShort)
    expect(await answerOrHeld(answer)).toBe('held')
    cut()
    expect(await answerOrHeld(answer)).toEqual({ window: 'primary', resetsAt: NOW / 1000 + 3600 })
    expect(usage.calls).toEqual([[0, 'codex']])
  })

  it('without usage nothing is read: the windows known decide', async () => {
    expect(await limitsWait({ windows: [fiveHour(100, 60)] }).stillRefused('codex', undefined)).toEqual({ window: 'primary', resetsAt: NOW / 1000 + 3600 })
    expect(await limitsWait({ windows: null }).stillRefused('codex', undefined)).toBeNull()
  })
})
