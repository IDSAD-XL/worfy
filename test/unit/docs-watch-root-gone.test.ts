// DocsWatcher and a root that is removed (worfy-windows ticket 27). On Windows fs.watch of a folder
// that is removed neither closes nor fails: it sends an endless run of events that name the folder
// itself by its `\\?\` path. Here the watch of the system is a stand-in that the test drives, and
// the rule for a full path is path.win32's, so every case runs on any system; the documents are
// read from a real folder.
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, win32 } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DocsWatcher, ROOT_RETRY_MS, type Docs, type WatchRoot } from '../../src/main/docs/watch'
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
}

function stand(): Stand {
  const made: Stand['made'] = []
  let refuse = false
  return {
    made,
    refuseNext: () => void (refuse = true),
    watch: (_root, onEvent, onError) => {
      if (refuse) {
        refuse = false
        throw Object.assign(new Error('ENOENT: no such file or directory, watch'), { code: 'ENOENT' })
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

async function start(model: Stand): Promise<Started> {
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
  })
  watchers.push(watcher)
  return { watcher, changes, there }
}

const until = (done: () => void): Promise<void> => vi.waitFor(done, { timeout: 3000, interval: 5 })
const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

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
    expect(warn.mock.calls).toEqual([[`[docs] the folder ${root} is gone: its documents are not watched until it is back`]])
    // No second watch while the folder is not there.
    await pause(RETRY * 5)
    expect(model.made).toHaveLength(1)
    expect(there.asked).toBeGreaterThan(1)
  })

  it('watches the root again when it is a folder again, and reads it: the documents come back, and a later change is followed', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
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
  })

  it('a root that is gone again between the look and the watch is waited for again', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const model = stand()
    const { there } = await start(model)
    there.now = false
    model.made[0]!.event(ITSELF)
    await until(() => expect(there.asked).toBeGreaterThan(0))
    model.refuseNext()
    there.now = true
    await until(() => expect(model.made).toHaveLength(2))
    expect(model.made[1]!.closed).toBe(false)
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

  it('looks for the root every two seconds unless told otherwise', () => {
    expect(ROOT_RETRY_MS).toBe(2000)
  })
})
