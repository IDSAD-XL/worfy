// The watcher while the layout of a Project has failed (worfy-harness ticket 37): nothing is
// watched, the layout is asked again on a schedule that backs off, close() stops the asking, and a
// close that comes while the watch of a recovered layout starts does not hang.
import { mkdirSync, mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { failedLayout, fullLayout, type ProjectLayout } from '../../src/main/workflow/folder'
import { LAYOUT_RETRY_MS, WorkflowWatcher } from '../../src/main/workflow/watch'
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

const start = (layout: (at: string) => Promise<ProjectLayout>, layoutRetryMs?: number | readonly number[]): Promise<WorkflowWatcher> =>
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
  // was waiting for it never ended, and close() waited for that read for good.
  it.each([
    ['silent', 0],
    ['silent', 4],
    ['silent', 8],
    ['silent', 20],
    ['silent', 40],
    ['full', 0],
    ['full', 4],
    ['full', 8],
    ['full', 20],
    ['full', 40],
  ] as const)('close() while the watch of a recovered layout starts settles (%s, after %i microtasks)', async (mode, ticks) => {
    let answers = 0
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
    opened.watcher = await start(layout, 20)
    for (let i = 0; i < 200 && closing === undefined; i++) await sleep(10)
    expect(closing).toBeDefined()
    expect(await Promise.race([closing!.then(() => 'closed'), sleep(3000).then(() => 'hung')])).toBe('closed')
  })
})
