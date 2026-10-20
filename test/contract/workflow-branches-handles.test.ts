// The handles of the watch of git branches after its Project closes, when the folders it watches
// are removed by another process (worfy-windows ticket 75). With `git worktree remove` and then
// `rmdir /s /q` of the repository run in a child process — as Explorer or a terminal removes a
// repository — the watch made anew while `.git` was still being removed opened an fs.watch on
// `.git` that no close() closed: on Windows it then sent some 200 000 events a second, a whole
// processor core, until the process ended. Measured on the owner's PC in about one round of three.
//
// So the test runs the removal again and again and counts the handles of fs.watch (`FSEventWrap`)
// of this process after WorkflowWatcher.close(): each round must give back every one it took. It
// stops at the first round that does not; such a handle keeps spinning, and this file holds no
// other test for it to slow down (vitest runs each test file in a process of its own).
//
// The same rounds run on every system: on macOS the removal goes through `rm -rf`, and chokidar
// remakes nothing there (src/main/workflow/watch.ts, watchBranches), but every handle must be given
// back all the same.
import { execFile, execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fullLayout } from '../../src/main/workflow/folder'
import { WorkflowWatcher } from '../../src/main/workflow/watch'
import { removeTestTree } from '../remove'

const WINDOWS = process.platform === 'win32'
const EPIC_JSON = JSON.stringify({ ref: 'main', epics: [{ epic: 'demo', hasSpec: false, hasMap: false }], tickets: [] })
/** Rounds of removal; one leaking round fails the test. */
const ROUNDS = 16
/** How long chokidar is given to open its handles, and the watch to be made anew after a removal. */
const SETTLE_MS = 400
const pause = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms))
const gitEnv = (): NodeJS.ProcessEnv => Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
const GIT_CONFIG = ['-c', 'user.name=t', '-c', 'user.email=t@t.invalid', '-c', 'init.defaultBranch=main', '-c', 'commit.gpgsign=false', '-c', 'gc.auto=0']

/** The handles of fs.watch this process holds. */
const fsWatches = (): number => process.getActiveResourcesInfo().filter((resource) => resource === 'FSEventWrap').length

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', [...GIT_CONFIG, ...args], { cwd, env: gitEnv(), stdio: 'ignore' })
}

/** Runs a command in a child process: this process's event loop runs meanwhile, as when another program removes the folders. */
function inChild(file: string, args: string[], cwd: string): Promise<void> {
  return new Promise((done, fail) => execFile(file, args, { cwd, env: gitEnv(), windowsHide: true }, (error) => (error ? fail(error) : done())))
}

const removeFromChild = (path: string, cwd: string): Promise<void> =>
  WINDOWS ? inChild('cmd.exe', ['/d', '/c', 'rmdir', '/s', '/q', path], cwd) : inChild('rm', ['-rf', path], cwd)

/** Waits until the handles are back to `count`, or the time is up; answers how many are held. */
async function settledAt(count: number): Promise<number> {
  for (let waited = 0; waited < 1000 && fsWatches() > count; waited += 50) await pause(50)
  return fsWatches()
}

const dirs: string[] = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const dir of dirs.splice(0)) removeTestTree(dir)
})

/** One round: a repository with a worktree; the worktree, then the repository, removed by another process. */
async function round(): Promise<void> {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-branches-handles-')))
  dirs.push(dir)
  const repo = join(dir, 'repo')
  mkdirSync(join(repo, '.scratch', 'demo', 'issues'), { recursive: true })
  git(repo, 'init', '-q')
  writeFileSync(join(repo, 'a.txt'), 'a\n')
  git(repo, 'add', 'a.txt')
  git(repo, 'commit', '-q', '-m', 'one')
  git(repo, 'worktree', 'add', '-q', '-b', 'side', join(dir, 'wt'))
  const watcher = await WorkflowWatcher.start({ root: repo, claudeHome: '/h', env: () => Promise.resolve({}), run: () => Promise.resolve(EPIC_JSON), layout: (at) => Promise.resolve(fullLayout(at)), onChange: () => undefined })
  try {
    await pause(SETTLE_MS)
    await inChild('git', [...GIT_CONFIG, 'worktree', 'remove', join(dir, 'wt')], repo)
    await pause(SETTLE_MS)
    git(repo, 'worktree', 'add', '-q', '-b', 'side2', join(dir, 'wt2'))
    await pause(SETTLE_MS)
    await removeFromChild(repo, dir)
    await pause(SETTLE_MS)
  } finally {
    await watcher.close()
  }
}

describe('the watch of the branches gives back its fs.watch handles when another process removes the repository', () => {
  it(`${ROUNDS} rounds of a worktree and then the repository removed from a child process: after each close() the fs.watch handles are back to where they were`, async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const before = fsWatches()
    const held: number[] = []
    for (let n = 0; n < ROUNDS; n++) {
      await round()
      held.push(await settledAt(before))
      // A handle left behind spins on Windows: no further round would measure anything sound.
      if (held.at(-1) !== before) break
    }
    expect(held, `fs.watch handles before: ${before}; after each round: ${held.join(', ')}`).toEqual(Array.from({ length: ROUNDS }, () => before))
  }, ROUNDS * 6_000)
})
