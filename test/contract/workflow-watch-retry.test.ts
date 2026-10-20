// The watcher while the layout of a Project has failed (worfy-harness ticket 37): nothing is
// watched, the layout is asked again on a schedule that backs off, close() stops the asking, and a
// close that comes while the watch of a recovered layout starts does not hang. First run's "Check
// again" asks every failed layout at once, with a plain request (WorkflowHub.retryFailedLayouts).
import { mkdirSync, mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { failedLayout, fullLayout, type ProjectLayout } from '../../src/main/workflow/folder'
import type { HarnessScriptEnvRequest } from '../../src/main/harness/script-env'
import { LAYOUT_RETRY_MS, WorkflowHub, WorkflowWatcher } from '../../src/main/workflow/watch'
import { removeTestTree } from '../remove'

// The real chokidar, counted: how many watches the watcher starts.
const watches = vi.hoisted(() => ({ count: 0 }))
vi.mock('chokidar', async (original) => {
  const real = await original<typeof import('chokidar')>()
  return {
    ...real,
    watch: (...args: Parameters<typeof real.watch>) => {
      watches.count += 1
      return real.watch(...args)
    },
  }
})

const EPIC_JSON = JSON.stringify({ ref: 'main', epics: [{ epic: 'demo', hasSpec: false, hasMap: false }], tickets: [] })
const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms))

let root: string

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-watch-retry-')))
  // The Full-mode values a failed layout carries name this folder: it exists, so a watch of it would start.
  mkdirSync(join(root, '.scratch', 'demo', 'issues'), { recursive: true })
  watches.count = 0
})

afterEach(() => {
  vi.useRealTimers()
  removeTestTree(root)
})

type Layout = (at: string, request?: HarnessScriptEnvRequest) => Promise<ProjectLayout>

const start = (layout: Layout, layoutRetryMs?: number | readonly number[]): Promise<WorkflowWatcher> =>
  WorkflowWatcher.start({ root, claudeHome: '/h', env: () => Promise.resolve({}), run: () => Promise.resolve(EPIC_JSON), layout, ticketsWatch: 'chokidar', onChange: () => undefined, ...(layoutRetryMs === undefined ? {} : { layoutRetryMs }) })

describe('a failed layout in the watcher', () => {
  it('nothing is watched while the layout is failed; the watch starts once it answers', async () => {
    let cured = false
    const watcher = await start((at) => Promise.resolve(cured ? { ...fullLayout(at), mode: 'silent', ticketsRoot: join(at, '.scratch') } : failedLayout(at, 'the profile script did not answer within 15 s')), 30)
    try {
      expect(watcher.current.error?.code).toBe('failed')
      await sleep(120)
      expect(watches.count).toBe(0)
      cured = true
      for (let i = 0; i < 100 && watcher.current.error !== null; i++) await sleep(20)
      expect(watcher.current.epics.map((epic) => epic.epic)).toEqual(['demo'])
      expect(watches.count).toBe(1)
    } finally {
      await watcher.close()
    }
  })

  it('a close while the layout is asked again: no watch and no read after it', async () => {
    let answers = 0
    let runs = 0
    let answer: (layout: ProjectLayout) => void = () => undefined
    const layout = (at: string): Promise<ProjectLayout> => {
      answers += 1
      if (answers === 1) return Promise.resolve(failedLayout(at, 'the profile script did not answer within 15 s'))
      return new Promise((done) => {
        answer = done
      })
    }
    const watcher = await WorkflowWatcher.start({ root, claudeHome: '/h', env: () => Promise.resolve({}), run: () => ((runs += 1), Promise.resolve(EPIC_JSON)), layout, layoutRetryMs: 20, ticketsWatch: 'chokidar', onChange: () => undefined })
    for (let i = 0; i < 100 && answers < 2; i++) await sleep(10)
    expect(answers).toBe(2)
    const closing = watcher.close()
    answer({ ...fullLayout(root), mode: 'silent', ticketsRoot: join(root, '.scratch') })
    await closing
    expect({ watches: watches.count, runs }).toEqual({ watches: 0, runs: 0 })
  })

  it('the default schedule backs off: 10 s, 30 s, 60 s, then every 5 minutes; close() leaves no timer', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    expect(LAYOUT_RETRY_MS).toEqual([10_000, 30_000, 60_000, 300_000])
    let asks = 0
    const watcher = await start((at) => ((asks += 1), Promise.resolve(failedLayout(at, 'the profile script failed with exit code 1: registry is broken'))))
    expect(asks).toBe(1)
    const after = async (ms: number): Promise<number> => {
      await vi.advanceTimersByTimeAsync(ms)
      return asks
    }
    expect(await after(9_999)).toBe(1)
    expect(await after(1)).toBe(2)
    expect(await after(29_999)).toBe(2)
    expect(await after(1)).toBe(3)
    expect(await after(59_999)).toBe(3)
    expect(await after(1)).toBe(4)
    expect(await after(299_999)).toBe(4)
    expect(await after(1)).toBe(5)
    expect(await after(300_000)).toBe(6)
    expect(vi.getTimerCount()).toBe(1)
    await watcher.close()
    // The retry's timer is cleared, not only ignored when it fires.
    expect(vi.getTimerCount()).toBe(0)
    expect(await after(3_600_000)).toBe(6)
  })

  // Found by the review of PR #311: chokidar's close removes the 'ready' listener, so a watch that
  // was waiting for it never ended, and close() waited for that read for good. Review round 2: after
  // the close nothing stays watched — on Windows the Tickets root is watched by link-safe-watch.ts,
  // which only the second unwatch of close() reaches — and no epic-status runs.
  it.each([
    ['chokidar', 'silent', 0],
    ['chokidar', 'silent', 4],
    ['chokidar', 'silent', 8],
    ['chokidar', 'silent', 20],
    ['chokidar', 'silent', 40],
    ['chokidar', 'full', 0],
    ['chokidar', 'full', 4],
    ['chokidar', 'full', 8],
    ['chokidar', 'full', 20],
    ['chokidar', 'full', 40],
    ['links-read-first', 'silent', 0],
    ['links-read-first', 'silent', 4],
    ['links-read-first', 'silent', 8],
    ['links-read-first', 'silent', 20],
    ['links-read-first', 'full', 4],
    ['links-read-first', 'full', 20],
  ] as const)('close() while the watch of a recovered layout starts settles, leaves nothing watched and runs no read (%s, %s, after %i microtasks)', async (ticketsWatch, mode, ticks) => {
    let answers = 0
    let runs = 0
    const opened: { watcher?: WorkflowWatcher } = {}
    let closing: Promise<void> | undefined
    const layout = (at: string): Promise<ProjectLayout> => {
      answers += 1
      if (answers === 1) return Promise.resolve(failedLayout(at, 'the profile script did not answer within 15 s'))
      // The retry answers; close() comes `ticks` microtasks later (the last subscriber leaves).
      void (async () => {
        for (let i = 0; i < ticks; i++) await Promise.resolve()
        closing = opened.watcher!.close()
      })()
      return Promise.resolve({ ...fullLayout(at), mode, ticketsRoot: join(at, '.scratch') })
    }
    opened.watcher = await WorkflowWatcher.start({ root, claudeHome: '/h', env: () => Promise.resolve({}), run: () => ((runs += 1), Promise.resolve(EPIC_JSON)), layout, layoutRetryMs: 20, ticketsWatch, onChange: () => undefined })
    const runsAtStart = runs
    for (let i = 0; i < 200 && closing === undefined; i++) await sleep(10)
    expect(closing).toBeDefined()
    expect(await Promise.race([closing!.then(() => 'closed'), sleep(3000).then(() => 'hung')])).toBe('closed')
    await sleep(100)
    const internals = opened.watcher as unknown as { watchers: unknown[]; tickets: unknown; retry: unknown }
    expect({ watchers: internals.watchers.length, tickets: internals.tickets, retry: internals.retry, runsAfterStart: runs - runsAtStart }).toEqual({ watchers: 0, tickets: null, retry: null, runsAfterStart: 0 })
  })
})

describe('"Check again": a failed layout is asked at once', () => {
  const NO_NODE = 'the profile script failed with exit code 127: env: node: No such file or directory'
  const healthyLayout = (at: string): ProjectLayout => ({ ...fullLayout(at), mode: 'silent', ticketsRoot: join(at, '.scratch') })
  /** The watcher's own retry timer: null when none is pending. */
  const retryTimer = (watcher: WorkflowWatcher): unknown => (watcher as unknown as { retry: unknown }).retry

  // Review of PR #311, round 3: each show of Settings -> Health runs the checks, and the back-off
  // used to start over at 10 s after each of them. The ask now takes the place of the pending
  // timer's ask, and the step of the back-off stays where it was.
  it('retryFailedLayout: asked now with a plain request (no shell of its own); the pending timer is dropped and the back-off goes on from its step', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const asked: (HarnessScriptEnvRequest | undefined)[] = []
    const watcher = await start((at, request) => (asked.push(request), Promise.resolve(failedLayout(at, NO_NODE, true))))
    await vi.advanceTimersByTimeAsync(10_000)
    await vi.advanceTimersByTimeAsync(30_000)
    // The timer's asks take the login shell again: the failure points at the environment.
    expect(asked).toEqual([undefined, { fresh: 'always' }, { fresh: 'always' }])
    expect(vi.getTimerCount()).toBe(1)

    // The next timer was 60 s away. "Check again" has just captured the shell: this ask starts none.
    expect(watcher.retryFailedLayout()).toBe(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(asked).toEqual([undefined, { fresh: 'always' }, { fresh: 'always' }, {}])
    // Still failed: one timer, at the step after the 60 s one it replaced (5 minutes), not 10 s again.
    expect(vi.getTimerCount()).toBe(1)
    await vi.advanceTimersByTimeAsync(299_999)
    expect(asked).toHaveLength(4)
    await vi.advanceTimersByTimeAsync(1)
    expect(asked).toEqual([undefined, { fresh: 'always' }, { fresh: 'always' }, {}, { fresh: 'always' }])
    // A second "Check again" at the last step: still one ask now and one every 5 minutes after it.
    expect(watcher.retryFailedLayout()).toBe(true)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(asked).toHaveLength(6)
    await vi.advanceTimersByTimeAsync(290_000)
    expect(asked).toHaveLength(7)
    await watcher.close()
    expect(vi.getTimerCount()).toBe(0)
  })

  // Review of PR #311, round 3 (mutant K13: only an environment failure was asked again): a
  // failure that is not about the environment — an old node on the captured PATH exits with 1 —
  // is asked by "Check again" too, and the Project recovers once it answers.
  it('retryFailedLayout: a failure that is not about the environment is asked too, plainly, and the Epic is read once it answers', async () => {
    const OLD_NODE = 'the profile script failed with exit code 1: SyntaxError: Unexpected token'
    const asked: (HarnessScriptEnvRequest | undefined)[] = []
    let cured = false
    const watcher = await start((at, request) => (asked.push(request), Promise.resolve(cured ? healthyLayout(at) : failedLayout(at, OLD_NODE, false))), 3_600_000)
    try {
      expect(watcher.current.error?.message).toMatch(/exit code 1: SyntaxError/)
      cured = true
      expect(watcher.retryFailedLayout()).toBe(true)
      for (let i = 0; i < 100 && watcher.current.error !== null; i++) await sleep(10)
      await watcher.idle()
      expect(asked).toEqual([undefined, {}])
      expect(watcher.current.epics.map((epic) => epic.epic)).toEqual(['demo'])
      expect(watches.count).toBe(1)
      expect(retryTimer(watcher)).toBeNull()
    } finally {
      await watcher.close()
    }
  })

  it('retryFailedLayout does nothing for a healthy layout or a closed watcher', async () => {
    let asks = 0
    const healthy = await start((at) => ((asks += 1), Promise.resolve(healthyLayout(at))))
    expect(healthy.retryFailedLayout()).toBe(false)
    await healthy.idle()
    expect({ asks, watches: watches.count }).toEqual({ asks: 1, watches: 1 })
    await healthy.close()

    let failedAsks = 0
    const failed = await start((at) => ((failedAsks += 1), Promise.resolve(failedLayout(at, NO_NODE, true))), 3_600_000)
    await failed.close()
    expect(failed.retryFailedLayout()).toBe(false)
    await sleep(50)
    expect({ failedAsks, watches: watches.count }).toEqual({ failedAsks: 1, watches: 1 })
  })

  it('WorkflowHub.retryFailedLayouts asks only the failed Projects; a healthy one is not read again, a closed one is not asked', async () => {
    const healthyRoot = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-watch-healthy-')))
    mkdirSync(join(healthyRoot, '.scratch'), { recursive: true })
    const asked = new Map<string, (HarnessScriptEnvRequest | undefined)[]>()
    let runs = 0
    const layout: Layout = (at, request) => {
      asked.set(at, [...(asked.get(at) ?? []), request])
      return Promise.resolve(at === root ? failedLayout(at, NO_NODE, true) : healthyLayout(at))
    }
    const hub = new WorkflowHub({ claudeHome: '/h', env: () => Promise.resolve({}), run: () => ((runs += 1), Promise.resolve(EPIC_JSON)), layout, layoutRetryMs: 3_600_000, ticketsWatch: 'chokidar' })
    try {
      expect((await hub.open(root, { id: 1, send: () => undefined })).error?.code).toBe('failed')
      expect((await hub.open(healthyRoot, { id: 1, send: () => undefined })).error).toBeNull()
      const runsBefore = runs
      expect(await hub.retryFailedLayouts()).toBe(1)
      for (let i = 0; i < 100 && (asked.get(root)?.length ?? 0) < 2; i++) await sleep(10)
      await sleep(50)
      expect(asked.get(root)).toEqual([undefined, {}])
      expect(asked.get(healthyRoot)).toEqual([undefined])
      expect(runs).toBe(runsBefore)
      expect(watches.count).toBe(1)

      await hub.close(root, 1)
      expect(await hub.retryFailedLayouts()).toBe(0)
      await sleep(50)
      expect(asked.get(root)).toHaveLength(2)
    } finally {
      await hub.closeAll()
      removeTestTree(healthyRoot)
    }
  })

  // Review of PR #311, round 3: the hub waited for every Project to finish its start before it
  // asked any, so one slow start (profile up to 15 s, the first epic-status up to 60 s) held back
  // the recovery of all the others.
  it('WorkflowHub.retryFailedLayouts: a failed Project is asked while another Project is still starting', async () => {
    const slowRoot = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-watch-slow-')))
    mkdirSync(join(slowRoot, '.scratch'), { recursive: true })
    const asked = new Map<string, (HarnessScriptEnvRequest | undefined)[]>()
    let answerSlow: (layout: ProjectLayout) => void = () => undefined
    const layout: Layout = (at, request) => {
      asked.set(at, [...(asked.get(at) ?? []), request])
      if (at === root) return Promise.resolve(failedLayout(at, NO_NODE, true))
      return new Promise((done) => (answerSlow = done))
    }
    const hub = new WorkflowHub({ claudeHome: '/h', env: () => Promise.resolve({}), run: () => Promise.resolve(EPIC_JSON), layout, layoutRetryMs: 3_600_000, ticketsWatch: 'chokidar' })
    try {
      expect((await hub.open(root, { id: 1, send: () => undefined })).error?.code).toBe('failed')
      const opening = hub.open(slowRoot, { id: 1, send: () => undefined })
      for (let i = 0; i < 100 && !asked.has(slowRoot); i++) await sleep(10)
      const retried = hub.retryFailedLayouts()
      for (let i = 0; i < 100 && (asked.get(root)?.length ?? 0) < 2; i++) await sleep(10)
      // The slow Project has not answered its first ask yet.
      expect(asked.get(slowRoot)).toEqual([undefined])
      expect(asked.get(root)).toEqual([undefined, {}])
      answerSlow(failedLayout(slowRoot, NO_NODE, true))
      await opening
      // The slow one failed too, but only after the "Check again": its own start's ask was answered after it.
      expect(await retried).toBe(2)
    } finally {
      // A failed expectation above leaves the slow start waiting: close() would wait for it for good.
      answerSlow(failedLayout(slowRoot, NO_NODE, true))
      await hub.closeAll()
      removeTestTree(slowRoot)
    }
  })

  it('a hub whose Project is still starting and then fails its first read: nothing to ask, and no rejection', async () => {
    const layout: Layout = (at) => new Promise((_, reject) => setTimeout(() => reject(new Error(`no layout for ${at}`)), 50))
    const hub = new WorkflowHub({ claudeHome: '/h', env: () => Promise.resolve({}), run: () => Promise.resolve(EPIC_JSON), layout, ticketsWatch: 'chokidar' })
    const opening = hub.open(root, { id: 1, send: () => undefined })
    const retried = hub.retryFailedLayouts()
    await expect(opening).rejects.toThrow(/no layout for/)
    expect(await retried).toBe(0)
    await hub.closeAll()
  })

  // Races: a second "Check again" while the first one's ask is in flight. The retry timer is an
  // hour away, so a timer left behind by the failing ask stays visible.
  it.each([
    ['the ask in flight recovers', 'recovers'],
    ['the ask in flight fails again', 'fails'],
  ] as const)('a second "Check again" during the ask of the first — %s: one watch, the Epic read, and no timer left', async (_case, inFlight) => {
    const asked: (HarnessScriptEnvRequest | undefined)[] = []
    let answer: (layout: ProjectLayout) => void = () => undefined
    const layout: Layout = (at, request) => {
      asked.push(request)
      if (asked.length === 1) return Promise.resolve(failedLayout(at, NO_NODE, true))
      if (asked.length === 2) return new Promise((done) => (answer = done))
      return Promise.resolve(healthyLayout(at))
    }
    const watcher = await start(layout, 3_600_000)
    try {
      expect(watcher.retryFailedLayout()).toBe(true)
      for (let i = 0; i < 100 && asked.length < 2; i++) await sleep(10)
      expect(watcher.retryFailedLayout()).toBe(true)
      answer(inFlight === 'recovers' ? healthyLayout(root) : failedLayout(root, NO_NODE, true))
      for (let i = 0; i < 100 && watcher.current.error !== null; i++) await sleep(10)
      await watcher.idle()
      expect(watcher.current.epics.map((epic) => epic.epic)).toEqual(['demo'])
      expect(watches.count).toBe(1)
      expect(retryTimer(watcher)).toBeNull()
      // A recovered layout is not asked again by the queued "Check again"; a failed one is, plainly.
      expect(asked).toEqual(inFlight === 'recovers' ? [undefined, {}] : [undefined, {}, {}])
    } finally {
      await watcher.close()
    }
  })
})
