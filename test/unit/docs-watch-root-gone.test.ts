// DocsWatcher and a root that is removed (worfy-windows ticket 27). On Windows fs.watch of a folder
// that is removed neither closes nor fails: it sends an endless run of events that name the folder
// itself by its `\\?\` path. Here the watch of the system is a stand-in that the test drives, and
// the rule for a full path is path.win32's, so every case runs on any system; the documents are
// read from a real folder.
import { mkdirSync, mkdtempSync, realpathSync, renameSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, win32 } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DocsWatcher, errorEndsWatch, ROOT_RETRY_MS, SETTLE_READS_MS, type Docs, type DocsWatchOptions, type WatchRoot } from '../../src/main/docs/watch'
import { removeTestTree } from '../remove'

/** The time between two looks for the root, in these tests. */
const RETRY = 10
/** The name Windows gives in the events of a watched folder that is gone. */
const ITSELF = '\\\\?\\C:\\p\\repo'

let dir: string
let root: string
const watchers: DocsWatcher[] = []

beforeEach(() => {
  dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-docs-root-gone-')))
  root = join(dir, 'repo')
  mkdirSync(root)
  writeFileSync(join(root, 'HANDOFF.md'), '# handoff\n')
})

afterEach(async () => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  await Promise.all(watchers.splice(0).map((watcher) => watcher.close()))
  removeTestTree(dir)
})

interface Stand {
  watch: WatchRoot
  /** The watches made so far; `closed` once the watcher closed it. */
  made: { closed: boolean; event: (filename: string | null) => void; fail: (error: unknown) => void }[]
  /** Makes the next call of `watch` throw, as fs.watch does for a folder that is not there. */
  refuseNext: () => void
  /** Makes the next `times` calls of `watch` throw with `code` (0: no more refusals); `refused` counts them. */
  refuse: (code: string, times: number) => void
  refused: () => number
}

function stand(): Stand {
  const made: Stand['made'] = []
  let left = 0
  let code = 'ENOENT'
  let refused = 0
  return {
    made,
    refuseNext: () => {
      code = 'ENOENT'
      left = 1
    },
    refuse: (what, times) => {
      code = what
      left = times
    },
    refused: () => refused,
    watch: (_root, onEvent, onError) => {
      if (left > 0) {
        left -= 1
        refused += 1
        throw Object.assign(new Error(`${code}: watch`), { code })
      }
      const one = { closed: false, event: onEvent, fail: onError }
      made.push(one)
      return { close: () => void (one.closed = true) }
    },
  }
}

interface Started {
  watcher: DocsWatcher
  changes: Docs[]
  /** What rootThere answers; the test changes it. */
  there: { now: boolean; asked: number }
}

/** `extra` overrides the options; the stand-in watch dies at an error, as on macOS and Windows. */
async function start(model: Stand, extra: Partial<DocsWatchOptions> = {}): Promise<Started> {
  const changes: Docs[] = []
  const there = { now: true, asked: 0 }
  const watcher = await DocsWatcher.start({
    root,
    debounceMs: 0,
    onChange: (docs) => changes.push(docs),
    watch: model.watch,
    isAbsolute: win32.isAbsolute,
    rootThere: async () => {
      there.asked += 1
      return there.now
    },
    retryMs: RETRY,
    errorEnds: true,
    ...extra,
  })
  watchers.push(watcher)
  return { watcher, changes, there }
}

const gone = (): string => `[docs] the folder ${root} is gone: its documents are not watched until it is back`
const until = (done: () => void): Promise<void> => vi.waitFor(done, { timeout: 3000, interval: 5 })
const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
/** A wait on the real clock, also while the test has faked it: a look at the folder answers from the thread pool. */
const realTimeout = globalThis.setTimeout
const settled = (ms = 50): Promise<void> => new Promise((resolve) => realTimeout(resolve, ms))

describe('DocsWatcher and a root that is removed', () => {
  it('closes its watch at the first event that names the folder itself, says so once, and reports the documents as they are then', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const model = stand()
    const { watcher, changes, there } = await start(model)
    expect(watcher.current.handoff).not.toBeNull()
    expect(model.made).toHaveLength(1)

    // The folder goes, and Windows sends the run of events.
    removeTestTree(root)
    there.now = false
    for (let times = 0; times < 50; times++) model.made[0]!.event(ITSELF)
    expect(model.made[0]!.closed).toBe(true)
    await until(() => expect(changes).toEqual([{ handoff: null, adrs: [] }]))
    expect(warn.mock.calls).toEqual([[gone()]])
    // No second watch while the folder is not there: it is looked for again after the first answer.
    await until(() => expect(there.asked).toBeGreaterThan(1))
    expect(model.made).toHaveLength(1)
  })

  it('watches the root again when it is a folder again, and reads it: the documents come back, a later change is followed, and a second loss is met like the first', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const model = stand()
    const { changes, there } = await start(model)
    removeTestTree(root)
    there.now = false
    model.made[0]!.event(ITSELF)
    await until(() => expect(changes).toHaveLength(1))

    mkdirSync(root)
    writeFileSync(join(root, 'HANDOFF.md'), '# handoff, again\n')
    there.now = true
    await until(() => expect(model.made).toHaveLength(2))
    // Read at once: nothing tells of what was written before the watch began.
    await until(() => expect(changes.at(-1)?.handoff).not.toBeNull())
    expect(model.made[1]!.closed).toBe(false)

    const before = changes.length
    writeFileSync(join(root, 'HANDOFF.md'), '# handoff, changed\n')
    model.made[1]!.event('HANDOFF.md')
    await until(() => expect(changes).toHaveLength(before + 1))
    // An event of the watch that was closed changes nothing any more.
    const watches = model.made.length
    model.made[0]!.event(ITSELF)
    model.made[0]!.event('HANDOFF.md')
    await pause(RETRY * 5)
    expect(model.made).toHaveLength(watches)
    expect(model.made[1]!.closed).toBe(false)

    // The root goes a second time: the new watch is closed at its first such event, it is said
    // again, and the root is waited for again.
    removeTestTree(root)
    there.now = false
    model.made[1]!.event(ITSELF)
    expect(model.made[1]!.closed).toBe(true)
    await until(() => expect(changes.at(-1)).toEqual({ handoff: null, adrs: [] }))
    expect(warn.mock.calls).toEqual([[gone()], [gone()]])
    mkdirSync(root)
    writeFileSync(join(root, 'HANDOFF.md'), '# handoff, a third time\n')
    there.now = true
    await until(() => expect(model.made).toHaveLength(3))
    await until(() => expect(changes.at(-1)?.handoff).not.toBeNull())
    expect(model.made[2]!.closed).toBe(false)
  })

  it('a root that is gone again between the look and the watch is waited for again, and nothing more is said', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const model = stand()
    const { there } = await start(model)
    there.now = false
    model.made[0]!.event(ITSELF)
    await until(() => expect(there.asked).toBeGreaterThan(0))
    model.refuseNext()
    there.now = true
    await until(() => expect(model.made).toHaveLength(2))
    expect(model.made[1]!.closed).toBe(false)
    expect(model.refused()).toBe(1)
    expect(error).not.toHaveBeenCalled()
  })

  it('a root that is a folder but cannot be watched for another reason: the failure is said once, and the documents are read meanwhile', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const model = stand()
    const { changes, there } = await start(model)
    removeTestTree(root)
    there.now = false
    model.made[0]!.event(ITSELF)
    await until(() => expect(changes).toEqual([{ handoff: null, adrs: [] }]))

    mkdirSync(root)
    writeFileSync(join(root, 'HANDOFF.md'), '# handoff, again\n')
    model.refuse('EMFILE', 1_000_000)
    there.now = true
    // The folder is there with its HANDOFF.md: it is read while it cannot be watched.
    await until(() => expect(changes.at(-1)?.handoff).not.toBeNull())
    await until(() => expect(model.refused()).toBeGreaterThan(3))
    expect(model.made).toHaveLength(1)
    expect(error.mock.calls).toEqual([[`[docs] cannot watch ${root}: its documents are not followed until it can be`, expect.objectContaining({ code: 'EMFILE' })]])

    // Once it can be watched it is.
    model.refuse('EMFILE', 0)
    await until(() => expect(model.made).toHaveLength(2))
    expect(model.made[1]!.closed).toBe(false)
    expect(error).toHaveBeenCalledTimes(1)

    // That watch works for a while; then the root goes, and cannot be watched again: a new run of
    // failures, said again.
    await pause(RETRY * 5)
    const refusedBefore = model.refused()
    model.refuse('EMFILE', 1_000_000)
    model.made[1]!.event(ITSELF)
    await until(() => expect(error).toHaveBeenCalledTimes(2))
    await until(() => expect(model.refused()).toBeGreaterThan(refusedBefore + 3))
    expect(error).toHaveBeenCalledTimes(2)
    expect(model.made).toHaveLength(2)
  })

  it('a watch that fails again and again is said once; after a watch has worked — an event, or a retry period — a failure is said again', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const model = stand()
    await start(model, { retryMs: 200 })
    const failure = Object.assign(new Error('EPERM: operation not permitted, watch'), { code: 'EPERM' })
    model.made[0]!.fail(failure)
    await until(() => expect(model.made).toHaveLength(2))
    // Made anew and failed at once: the same run of failures.
    model.made[1]!.fail(failure)
    await until(() => expect(model.made).toHaveLength(3))
    expect(error).toHaveBeenCalledTimes(1)

    // This one delivers an event before it fails: it worked.
    model.made[2]!.event('HANDOFF.md')
    model.made[2]!.fail(failure)
    expect(error).toHaveBeenCalledTimes(2)
    await until(() => expect(model.made).toHaveLength(4))
    // This one lasts a retry period without an event: it worked too.
    await pause(300)
    model.made[3]!.fail(failure)
    expect(error).toHaveBeenCalledTimes(3)
  })

  it('an event of the watch that failed is no sign that the watch works: the next failure is the same run, not said', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const model = stand()
    await start(model, { retryMs: 200 })
    const failure = Object.assign(new Error('EPERM: operation not permitted, watch'), { code: 'EPERM' })
    model.made[0]!.fail(failure)
    await until(() => expect(model.made).toHaveLength(2))
    // The old watch still has an event on the way; then the new one fails within its retry period.
    model.made[0]!.event('HANDOFF.md')
    model.made[1]!.fail(failure)
    expect(error).toHaveBeenCalledTimes(1)
  })

  it('on Linux an error of the watch is only said: the watch goes on, and is not made anew', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const model = stand()
    const { changes } = await start(model, { errorEnds: false })
    const failure = Object.assign(new Error('ENOSPC: inotify watch limit reached'), { code: 'ENOSPC' })
    model.made[0]!.fail(failure)
    expect(error.mock.calls).toEqual([[`[docs] the watch of ${root} reported an error; it goes on`, failure]])
    expect(model.made[0]!.closed).toBe(false)
    writeFileSync(join(root, 'HANDOFF.md'), '# handoff, changed\n')
    model.made[0]!.event('HANDOFF.md')
    await until(() => expect(changes).toHaveLength(1))
    await pause(RETRY * 5)
    expect(model.made).toHaveLength(1)
  })

  it('unless told otherwise, an error ends the watch as this system does', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const model = stand()
    await start(model, { errorEnds: undefined })
    model.made[0]!.fail(new Error('EPERM: operation not permitted, watch'))
    expect(model.made[0]!.closed).toBe(errorEndsWatch(process.platform))
  })

  it('an error ends the watch on macOS and Windows, not on Linux', () => {
    expect(errorEndsWatch('darwin')).toBe(true)
    expect(errorEndsWatch('win32')).toBe(true)
    expect(errorEndsWatch('linux')).toBe(false)
  })

  it('a watch that fails is said with its error and made anew while the root is a folder; the watch that failed is heard no more', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const model = stand()
    const { changes } = await start(model)
    const failure = Object.assign(new Error('EPERM: operation not permitted, watch'), { code: 'EPERM' })
    model.made[0]!.fail(failure)
    expect(model.made[0]!.closed).toBe(true)
    expect(error.mock.calls).toEqual([[`[docs] the watch of ${root} failed: its documents are not followed until it is made anew`, failure]])
    await until(() => expect(model.made).toHaveLength(2))
    expect(model.made[1]!.closed).toBe(false)

    // The new watch is followed; the one that failed is not.
    model.made[0]!.fail(failure)
    model.made[0]!.event(ITSELF)
    writeFileSync(join(root, 'HANDOFF.md'), '# handoff, changed\n')
    model.made[1]!.event('HANDOFF.md')
    await until(() => expect(changes).toHaveLength(1))
    await pause(RETRY * 5)
    expect(model.made).toHaveLength(2)
    expect(model.made[1]!.closed).toBe(false)
    expect(error).toHaveBeenCalledTimes(1)
    expect(warn).not.toHaveBeenCalled()
  })

  it('a name under the root, or no name at all, does not close the watch', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const model = stand()
    const { changes } = await start(model)
    writeFileSync(join(root, 'HANDOFF.md'), '# handoff, changed\n')
    model.made[0]!.event(null)
    await until(() => expect(changes).toHaveLength(1))
    for (const name of ['HANDOFF.md', 'docs', 'src\\main\\index.ts', 'node_modules']) model.made[0]!.event(name)
    await pause(RETRY * 3)
    expect(model.made[0]!.closed).toBe(false)
    expect(model.made).toHaveLength(1)
    expect(warn).not.toHaveBeenCalled()
  })

  it('close ends the wait for the root: it is not looked for any more', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const model = stand()
    const { watcher, there } = await start(model)
    there.now = false
    model.made[0]!.event(ITSELF)
    await until(() => expect(there.asked).toBeGreaterThan(0))
    await watcher.close()
    const asked = there.asked
    there.now = true
    await pause(RETRY * 6)
    expect(there.asked).toBe(asked)
    expect(model.made).toHaveLength(1)
  })

  it('close while the root is being looked for: it is not watched when the answer comes', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const model = stand()
    let answer: (there: boolean) => void = () => undefined
    let asked = 0
    const watcher = await DocsWatcher.start({
      root,
      debounceMs: 0,
      onChange: () => undefined,
      watch: model.watch,
      isAbsolute: win32.isAbsolute,
      rootThere: () => {
        asked += 1
        return new Promise<boolean>((resolve) => (answer = resolve))
      },
      retryMs: RETRY,
    })
    watchers.push(watcher)
    model.made[0]!.event(ITSELF)
    await until(() => expect(asked).toBe(1))
    await watcher.close()
    answer(true)
    await pause(RETRY * 5)
    expect(model.made).toHaveLength(1)
    expect(asked).toBe(1)
  })

  it('unless told otherwise: takes the rule for a full path from the system, looks at the folder itself, and every two seconds', async () => {
    expect(ROOT_RETRY_MS).toBe(2000)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const model = stand()
    const watcher = await DocsWatcher.start({ root, debounceMs: 0, onChange: () => undefined, watch: model.watch })
    watchers.push(watcher)
    model.made[0]!.event('HANDOFF.md')
    expect(model.made[0]!.closed).toBe(false)
    removeTestTree(root)
    // The root by its full path, in the form of this system.
    model.made[0]!.event(root)
    expect(model.made[0]!.closed).toBe(true)

    // Looked at after two seconds; not a folder, so not watched.
    await vi.advanceTimersByTimeAsync(ROOT_RETRY_MS)
    await settled()
    expect(model.made).toHaveLength(1)
    // A folder again: watched at the next look, two seconds after the one before, not earlier.
    mkdirSync(root)
    await vi.advanceTimersByTimeAsync(ROOT_RETRY_MS - 1)
    await settled()
    expect(model.made).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    for (let tries = 0; tries < 200 && model.made.length < 2; tries++) await settled(5)
    expect(model.made).toHaveLength(2)
  })
})

// macOS (worfy-windows ticket 38): a root that is removed or renamed gives one event, named by the
// root's last name — not a full path, so the watch is kept — and nothing more. The same name comes
// when the root is back at its path, made again or renamed back.
describe('DocsWatcher and an event named by the root\'s last name', () => {
  /** Past the reads that follow the start of a watch: a read after this comes from an event. */
  const pastStartReads = (): Promise<void> => pause(Math.max(...SETTLE_READS_MS) + 100)

  it('reads the documents: a root that is gone reads as empty; the watch is kept and nothing is said', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const model = stand()
    const { watcher, changes } = await start(model)
    expect(watcher.current.handoff).not.toBeNull()
    await pastStartReads()
    removeTestTree(root)
    model.made[0]!.event('repo')
    await until(() => expect(changes).toEqual([{ handoff: null, adrs: [] }]))
    expect(model.made[0]!.closed).toBe(false)
    expect(model.made).toHaveLength(1)
    expect(warn).not.toHaveBeenCalled()
  })

  it('a root renamed away and back is read at each event, by the same watch', async () => {
    const model = stand()
    const { changes } = await start(model)
    await pastStartReads()
    const moved = join(dir, 'moved')
    renameSync(root, moved)
    model.made[0]!.event('repo')
    await until(() => expect(changes).toEqual([{ handoff: null, adrs: [] }]))
    renameSync(moved, root)
    model.made[0]!.event('repo')
    await until(() => expect(changes.at(-1)?.handoff).not.toBeNull())
    expect(changes).toHaveLength(2)
    expect(model.made).toHaveLength(1)
  })
})
