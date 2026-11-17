// main's clock (src/main/clock.ts, worfy-polish ticket 121): the machine's, or, in a dev run started with
// WORFY_NOW (the e2e tests), one that starts at that moment and runs on from it. The automatic archive, the
// Layout's touchedAt, the Limits and the Run history read it when they are given no clock of their own,
// so an e2e test can pin the date its fixture's times are counted from.
import { mkdtempSync, realpathSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { appNow, clockFrom, mainClock, setAppClock } from '../../src/main/clock'
import { LimitsTracker } from '../../src/main/agent/limits'
import { AutoArchiver, type AutoArchiveDeps } from '../../src/main/layout/archive'
import type { LayoutNode, LayoutState } from '../../src/shared/layout/types'

const PINNED = '2030-06-15T09:00:00.000Z'
const AT = Date.parse(PINNED)

afterEach(() => {
  setAppClock(clockFrom(undefined))
})

describe('clockFrom', () => {
  it('without a moment is the machine clock', () => {
    for (const given of [undefined, '']) {
      const clock = clockFrom(given)
      const before = Date.now()
      const read = clock()
      expect(read).toBeGreaterThanOrEqual(before)
      expect(read).toBeLessThanOrEqual(Date.now())
    }
  })

  it('starts at the moment named and runs on with the machine clock', () => {
    let real = 1_000_000
    const clock = clockFrom(PINNED, () => real)
    expect(clock()).toBe(AT)
    real += 5_000
    expect(clock()).toBe(AT + 5_000)
  })

  it('a value that is not a date stops the start, naming the variable', () => {
    expect(() => clockFrom('tomorrow')).toThrow(/WORFY_NOW/)
  })
})

describe('mainClock', () => {
  it('a dev run (the unpacked bundle the e2e tests start) starts at WORFY_NOW', () => {
    expect(mainClock({ packaged: false, env: { WORFY_NOW: PINNED } })()).toBeGreaterThanOrEqual(AT)
    expect(mainClock({ packaged: false, env: { WORFY_NOW: PINNED } })()).toBeLessThan(AT + 60_000)
  })

  it('a packaged worfy.app ignores WORFY_NOW: the machine clock', () => {
    const read = mainClock({ packaged: true, env: { WORFY_NOW: PINNED } })()
    expect(Math.abs(read - Date.now())).toBeLessThan(60_000)
  })
})

describe('appNow', () => {
  it('is the machine clock until main sets another', () => {
    expect(Math.abs(appNow() - Date.now())).toBeLessThan(60_000)
  })

  const message = { type: 'rate_limit_event', rate_limit_info: { status: 'allowed', rateLimitType: 'five_hour', resetsAt: 1_800_000_000 } }

  /** A tracker over a new temporary data folder given no clock, the record of `message` on it, and its snapshot. */
  async function recorded(): Promise<number | undefined> {
    const dataDir = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-main-clock-')))
    const tracker = new LimitsTracker({ dataDir, watch: null })
    try {
      tracker.recordSdkMessage(message)
      return tracker.snapshot().windows.five_hour?.receivedAt
    } finally {
      tracker.stop()
      await rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    }
  }

  it('without a set clock the Limits record the machine clock', async () => {
    expect(Math.abs((await recorded())! - Date.now())).toBeLessThan(60_000)
  })

  it('reaches the Limits: a tracker given no clock records the set time', async () => {
    setAppClock(clockFrom(PINNED, () => 0))
    expect(await recorded()).toBe(AT)
  })

  it('a date 8 days on reaches the Limits the same way', async () => {
    setAppClock(clockFrom(new Date(AT + 8 * 24 * 3_600_000).toISOString(), () => 0))
    expect(await recorded()).toBe(AT + 8 * 24 * 3_600_000)
  })

  /**
   * An archiver given no clock, over one finished Session Node whose transcript ended two days before
   * PINNED: idle past the 24 h threshold by the set clock, and ended in the future by the machine clock
   * of today (PINNED is in 2030).
   */
  function archiver(): AutoArchiver {
    const SESSION = 'a0000000-0000-4000-8000-000000000001'
    const node = { id: 'session-1', kind: 'session', x: 0, y: 0, w: 340, h: 220, data: { origin: 'worfy', vendor: 'claude', sessionId: SESSION } } as unknown as LayoutNode
    const state = { layout: { nodes: [node], viewport: { x: 0, y: 0, zoom: 1 } }, revision: 1 } as unknown as LayoutState
    const deps: AutoArchiveDeps = {
      store: { get: () => state, peek: () => state, apply: () => state, onFirstRead: () => () => undefined } as unknown as AutoArchiveDeps['store'],
      projects: () => [{ id: 'demo-0a1b2c3d', path: '/projects/demo' }],
      live: () => Promise.resolve([]),
      history: () => Promise.resolve([{ sessionId: SESSION, lastAt: new Date(AT - 2 * 24 * 3_600_000).toISOString() }]),
      running: () => new Set(),
      workflow: () => Promise.resolve(undefined),
      bindings: () => Promise.resolve(new Map()),
      settings: () => ({ idleMs: 24 * 3_600_000, ticketDone: false }),
      batchId: () => 'batch-1',
      worktreeFailures: () => 0,
    }
    return new AutoArchiver(deps)
  }

  it('reaches the automatic archive: an archiver given no clock judges idle time by the set one', async () => {
    setAppClock(clockFrom(PINNED))
    await expect(archiver().candidatesNow('demo-0a1b2c3d')).resolves.toEqual([{ id: 'session-1', sessionId: 'a0000000-0000-4000-8000-000000000001', rule: 'idle' }])
  })

  it('without a set clock the archive judges by the machine clock', async () => {
    await expect(archiver().candidatesNow('demo-0a1b2c3d')).resolves.toEqual([])
  })
})
