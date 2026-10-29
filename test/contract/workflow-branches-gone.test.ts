// The watch of git branches over real folders and the real chokidar when a folder it watches is
// removed (worfy-windows ticket 37). Windows only: there fs.watch of a removed folder sends events
// without end that name the folder by its full path, and chokidar kept the handle. Measured on the
// owner's PC before the fix: about 1.3 s of processor time a second after `git worktree remove` of
// the last worktree, and the same after the repository was removed. The same cases on a stand-in
// chokidar, for any system, are test/unit/workflow-branches-gone.test.ts.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fullLayout } from '../../src/main/workflow/folder'
import { WorkflowWatcher } from '../../src/main/workflow/watch'
import { removeTestTree } from '../remove'
import { ms } from '../time-scale'

// The real chokidar; each watch it makes is kept, to see that the one made anew still follows the refs.
const made = vi.hoisted(() => ({ watches: [] as { paths: unknown; watcher: import('chokidar').FSWatcher }[] }))
vi.mock('chokidar', async (original) => {
  const real = await original<typeof import('chokidar')>()
  return {
    ...real,
    watch: (...args: Parameters<typeof real.watch>) => {
      const watcher = real.watch(...args)
      made.watches.push({ paths: args[0], watcher })
      return watcher
    },
  }
})

const WINDOWS = process.platform === 'win32'
const EPIC_JSON = JSON.stringify({ ref: 'main', epics: [{ epic: 'demo', hasSpec: false, hasMap: false }], tickets: [] })
const pause = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms))

let dir: string
let repo: string
const watchers: WorkflowWatcher[] = []

function git(...args: string[]): void {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t.invalid', '-c', 'init.defaultBranch=main', '-c', 'commit.gpgsign=false', '-c', 'gc.auto=0', ...args], { cwd: repo, env, stdio: 'ignore' })
}

beforeEach(() => {
  dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-branches-gone-')))
  repo = join(dir, 'repo')
  mkdirSync(join(repo, '.scratch', 'demo', 'issues'), { recursive: true })
  git('init', '-q')
  writeFileSync(join(repo, 'a.txt'), 'a\n')
  git('add', 'a.txt')
  git('commit', '-q', '-m', 'one')
  made.watches.length = 0
})

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(watchers.splice(0).map((watcher) => watcher.close()))
  removeTestTree(dir)
})

/** Processor time this process spends in one second, in ms. */
async function spentInASecond(): Promise<number> {
  const before = process.cpuUsage()
  await pause(1000)
  const spent = process.cpuUsage(before)
  return (spent.user + spent.system) / 1000
}

describe.runIf(WINDOWS)('the watch of the branches on Windows, real folders: a folder it watches is removed', () => {
  it('`git worktree remove` of the last worktree, then the repository itself: each costs one line in the log and no processor time after it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const lines = (): string[] => warn.mock.calls.map(([line]) => String(line)).filter((line) => line.startsWith('[workflow] the folder '))
    const worktree = join(dir, 'wt')
    git('worktree', 'add', '-q', '-b', 'side', worktree)
    const watcher = await WorkflowWatcher.start({ root: repo, claudeHome: '/h', env: () => Promise.resolve({}), run: () => Promise.resolve(EPIC_JSON), layout: (at) => Promise.resolve(fullLayout(at)), onChange: () => undefined })
    watchers.push(watcher)
    const branches = (): import('chokidar').FSWatcher[] => made.watches.filter((each) => Array.isArray(each.paths)).map((each) => each.watcher)
    expect(branches()).toHaveLength(1)
    // chokidar opens its handles a moment after 'ready'; a folder removed before that keeps none.
    await pause(1000)

    git('worktree', 'remove', worktree)
    await vi.waitFor(() => expect(lines()).toHaveLength(1), { timeout: ms(5000), interval: 50 })
    // `worktrees` or `worktrees\wt`, whichever handle says it first.
    expect(lines()[0]!.startsWith(`[workflow] the folder ${join(repo, '.git', 'worktrees')}`)).toBe(true)
    expect(lines()[0]!.endsWith(' is gone: the watch of the branches is made anew')).toBe(true)
    expect(await spentInASecond()).toBeLessThan(300)
    expect(branches()).toHaveLength(2)

    // The watch made anew follows the refs: a new worktree is seen.
    let seen = 0
    branches()[1]!.on('all', () => (seen += 1))
    await pause(500)
    git('worktree', 'add', '-q', '-b', 'side2', join(dir, 'wt2'))
    await vi.waitFor(() => expect(seen).toBeGreaterThan(0), { timeout: ms(5000), interval: 50 })

    // The repository goes: one more line, and the handles of `.git` and `refs\heads` are let go.
    await pause(1000)
    removeTestTree(repo)
    await vi.waitFor(() => expect(lines().length).toBeGreaterThanOrEqual(2), { timeout: ms(5000), interval: 50 })
    expect(await spentInASecond()).toBeLessThan(300)
    expect(lines()).toHaveLength(2)
    expect(lines()[1]!.startsWith(`[workflow] the folder ${join(repo, '.git')}`)).toBe(true)
    expect(lines()[1]!.endsWith(' is gone: the watch of the branches is made anew')).toBe(true)
  })

  // Before the fix each of these kept the handles of `.git` and `refs\heads`, even with a branch file.
  it.each([
    ['after `git pack-refs --all` (refs\\heads is empty)', ['pack-refs', '--all']],
    ['after `git gc`', ['gc', '-q']],
    ['with one branch file in refs\\heads', null],
  ])('the repository is removed %s: one line in the log and no processor time after it', async (_case, before) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const lines = (): string[] => warn.mock.calls.map(([line]) => String(line)).filter((line) => line.startsWith('[workflow] the folder '))
    if (before) git(...before)
    const watcher = await WorkflowWatcher.start({ root: repo, claudeHome: '/h', env: () => Promise.resolve({}), run: () => Promise.resolve(EPIC_JSON), layout: (at) => Promise.resolve(fullLayout(at)), onChange: () => undefined })
    watchers.push(watcher)
    await pause(1000)
    removeTestTree(repo)
    await vi.waitFor(() => expect(lines()).toHaveLength(1), { timeout: ms(5000), interval: 50 })
    expect(await spentInASecond()).toBeLessThan(300)
    expect(lines()).toHaveLength(1)
    // `.git` or `.git\refs\heads`, whichever handle says it first; with `\` only.
    expect(lines()[0]!.startsWith(`[workflow] the folder ${join(repo, '.git')}`)).toBe(true)
  }, ms(20_000))
})
