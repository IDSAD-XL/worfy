// The chokidar watch of git branches and a watched folder that is removed (worfy-windows ticket 37).
// On Windows fs.watch of a removed folder neither closes nor fails: it sends an endless run of
// events that name the folder itself by its full path, and chokidar passes each one on as a `raw`
// event and keeps the handle. Measured on the owner's PC: `git worktree remove` of the last
// worktree, or removing the repository, cost about 1.3 s of processor time a second for as long as
// the Project stayed open. Here chokidar is a stand-in the test drives, and the rule for a full
// path is path.win32's, so every case runs on any system; `git` itself is real.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, win32 } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fullLayout } from '../../src/main/workflow/folder'
import { WorkflowWatcher } from '../../src/main/workflow/watch'
import { removeTestTree } from '../remove'

interface StandWatcher {
  readonly paths: unknown
  readonly options: { ignoreInitial?: boolean; ignored?: unknown }
  closed: boolean
  /** Sends a `raw` event as chokidar's fs.watch does: the event, the name the system gave, the watched path. */
  raw: (name: string | null, watchedPath: string) => void
  /** Sends a `raw` event with any details, as chokidar's polling does (`{ curr, prev }`, no `watchedPath`). */
  rawWith: (event: string, name: string, details: unknown) => void
  close: () => Promise<void>
}

const stand = vi.hoisted(() => ({
  made: [] as StandWatcher[],
  /** While set, a close does not resolve until `release` is called. */
  holdClose: false,
  release: [] as (() => void)[],
  /** While set, the next watch of the branches made never says it is ready (a close comes first). */
  holdReady: false,
}))

vi.mock('chokidar', async () => {
  const { EventEmitter } = await import('node:events')
  class Stand extends EventEmitter implements StandWatcher {
    closed = false
    private closing: Promise<void> | null = null
    constructor(
      readonly paths: unknown,
      readonly options: { ignoreInitial?: boolean; ignored?: unknown },
    ) {
      super()
      if (stand.holdReady && Array.isArray(paths)) stand.holdReady = false
      else setTimeout(() => this.emit('ready'), 0)
    }
    raw(name: string | null, watchedPath: string): void {
      this.emit('raw', 'rename', name, { watchedPath })
    }
    rawWith(event: string, name: string, details: unknown): void {
      this.emit('raw', event, name, details)
    }
    close(): Promise<void> {
      this.closed = true
      this.closing ??= stand.holdClose ? new Promise((done) => stand.release.push(done)) : Promise.resolve()
      return this.closing
    }
  }
  return {
    watch: (paths: unknown, options: { ignoreInitial?: boolean; ignored?: unknown }) => {
      const made = new Stand(paths, options)
      stand.made.push(made)
      return made
    },
  }
})

// The real reader; each read of the worktree list (`git worktree list`, the first step of every read
// of the branches) is counted.
const reads = vi.hoisted(() => ({ worktrees: 0 }))
vi.mock('../../src/main/workflow/reader', async (original) => {
  const real = await original<typeof import('../../src/main/workflow/reader')>()
  return {
    ...real,
    ticketWorktrees: (...args: Parameters<typeof real.ticketWorktrees>) => {
      reads.worktrees += 1
      return real.ticketWorktrees(...args)
    },
  }
})

const EPIC_JSON =JSON.stringify({ ref: 'main', epics: [{ epic: 'demo', hasSpec: false, hasMap: false }], tickets: [] })
const pause = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms))
/** The name Windows gives in the events of a watched `worktrees` folder that is gone. */
const WORKTREES = 'C:\\p\\repo\\.git\\worktrees'
const SAID = `[workflow] the folder ${WORKTREES} is gone: the watch of the branches is made anew`

let dir: string
let repo: string
const watchers: WorkflowWatcher[] = []

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-branches-gone-')))
  repo = join(dir, 'repo')
  mkdirSync(join(repo, '.scratch', 'demo', 'issues'), { recursive: true })
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  execFileSync('git', ['-c', 'init.defaultBranch=main', 'init', '-q'], { cwd: repo, env })
  stand.made.length = 0
  stand.holdClose = false
  stand.release.length = 0
  stand.holdReady = false
  reads.worktrees = 0
})

afterEach(async () => {
  stand.holdClose = false
  for (const release of stand.release.splice(0)) release()
  await Promise.all(watchers.splice(0).map((watcher) => watcher.close()))
  vi.restoreAllMocks()
  removeTestTree(dir)
})

/** The watches of the branches made so far: the one chokidar call that is given a list of paths. */
const branches = (): StandWatcher[] => stand.made.filter((made) => Array.isArray(made.paths))

function begin(): Promise<WorkflowWatcher> {
  return WorkflowWatcher.start({
    root: repo,
    claudeHome: '/h',
    env: () => Promise.resolve({}),
    run: () => Promise.resolve(EPIC_JSON),
    layout: (at) => Promise.resolve(fullLayout(at)),
    ticketsWatch: 'chokidar',
    isAbsolute: win32.isAbsolute,
    debounceMs: 10,
    onChange: () => undefined,
  }).then((watcher) => {
    watchers.push(watcher)
    return watcher
  })
}

async function start(): Promise<WorkflowWatcher> {
  const watcher = await begin()
  expect(branches()).toHaveLength(1)
  return watcher
}

function warnings(): () => unknown[][] {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  return () => warn.mock.calls.filter(([line]) => String(line).startsWith('[workflow] the folder '))
}

describe('the watch of the branches when a folder it watches is gone', () => {
  it('a name that is a full path closes the watch and makes it anew on the same paths, with one line in the log', async () => {
    const lines = warnings()
    await start()
    const [first] = branches()
    first!.raw(WORKTREES, WORKTREES)
    await vi.waitFor(() => expect(branches()).toHaveLength(2), { timeout: 2000, interval: 5 })
    const second = branches()[1]!
    expect(first!.closed).toBe(true)
    expect(second.closed).toBe(false)
    expect(second.paths).toEqual(first!.paths)
    expect(second.options.ignoreInitial).toBe(true)
    expect(second.options.ignored).toBe(first!.options.ignored)
    expect(lines()).toEqual([[SAID]])

    // The run of events goes on from the closed watch until its close is through: none of them
    // makes another watch or another line.
    for (let i = 0; i < 50; i++) first!.raw(WORKTREES, WORKTREES)
    await pause(30)
    expect(branches()).toHaveLength(2)
    expect(lines()).toEqual([[SAID]])
  })

  it('names under the watched folder, or no name, leave the watch as it is', async () => {
    const lines = warnings()
    await start()
    const [first] = branches()
    first!.raw('main', 'C:\\p\\repo\\.git\\refs\\heads')
    first!.raw('feature\\x', 'C:\\p\\repo\\.git\\refs\\heads')
    first!.raw('HEAD', WORKTREES)
    first!.raw(null, WORKTREES)
    await pause(50)
    expect(branches()).toHaveLength(1)
    expect(first!.closed).toBe(false)
    expect(lines()).toEqual([])
  })

  it('the watch made anew is made anew again when a folder goes a second time, and close() closes the latest', async () => {
    const lines = warnings()
    const watcher = await start()
    branches()[0]!.raw(WORKTREES, WORKTREES)
    await vi.waitFor(() => expect(branches()).toHaveLength(2), { timeout: 2000, interval: 5 })
    branches()[1]!.raw(WORKTREES, WORKTREES)
    await vi.waitFor(() => expect(branches()).toHaveLength(3), { timeout: 2000, interval: 5 })
    expect(branches().map((made) => made.closed)).toEqual([true, true, false])
    expect(lines()).toEqual([[SAID], [SAID]])

    await watcher.close()
    expect(stand.made.every((made) => made.closed)).toBe(true)
  })

  it('the branches are read again once the watch is made anew', async () => {
    warnings()
    await start()
    await pause(50)
    const before = reads.worktrees
    branches()[0]!.raw(WORKTREES, WORKTREES)
    await vi.waitFor(() => expect(branches()).toHaveLength(2), { timeout: 2000, interval: 5 })
    // The stand-in sends no change of its own: only the remake asks for this read.
    await vi.waitFor(() => expect(reads.worktrees).toBeGreaterThan(before), { timeout: 2000, interval: 5 })
  })

  it('a watch that goes before it is ready: the start does not wait for it, but for the watch made anew', async () => {
    warnings()
    stand.holdReady = true
    const starting = begin()
    await vi.waitFor(() => expect(branches()).toHaveLength(1), { timeout: 5000, interval: 5 })
    branches()[0]!.raw(WORKTREES, WORKTREES)
    const outcome = await Promise.race([starting.then(() => 'started'), pause(3000).then(() => 'still waiting')])
    expect(outcome).toBe('started')
    expect(branches()).toHaveLength(2)
    expect(branches()[0]!.closed).toBe(true)
  })

  it('a polled event names the changed file by its full path and has no watchedPath: the watch is left as it is', async () => {
    const lines = warnings()
    await start()
    const [first] = branches()
    // chokidar's polling (fs.watchFile) sends `raw` as ('change', file, { curr, prev }).
    expect(() => first!.rawWith('change', 'C:\\p\\repo\\.git\\packed-refs', { curr: {}, prev: {} })).not.toThrow()
    await pause(50)
    expect(branches()).toHaveLength(1)
    expect(first!.closed).toBe(false)
    expect(lines()).toEqual([])
  })

  it('a close while the gone watch is being closed: no watch is made after it', async () => {
    warnings()
    const watcher = await start()
    stand.holdClose = true
    branches()[0]!.raw(WORKTREES, WORKTREES)
    await pause(10)
    const closing = watcher.close()
    stand.holdClose = false
    for (const release of stand.release.splice(0)) release()
    await closing
    await pause(30)
    expect(branches()).toHaveLength(1)
    expect(stand.made.every((made) => made.closed)).toBe(true)
  })
})
