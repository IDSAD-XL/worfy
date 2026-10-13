// What chokidar watches under a Tickets root with ticketsIgnored (src/main/workflow/watch.ts), over
// real folders, on any system: where chokidar is the watch (everywhere but Windows since
// worfy-windows ticket 20) and on Windows too, since chokidar runs there all the same. No link is
// made here.
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { watch, type FSWatcher } from 'chokidar'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { removeTree } from '../../src/main/storage/remove'
import { ticketsIgnored } from '../../src/main/workflow/watch'

let dir: string
let root: string
const watchers: FSWatcher[] = []

beforeEach(() => {
  dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-tickets-chokidar-')))
  root = join(dir, '.scratch')
})

afterEach(async () => {
  await Promise.all(watchers.splice(0).map((watcher) => watcher.close()))
  removeTree(dir)
})

/** Every path chokidar holds, files and folders alike. */
const watchedPaths = (watcher: FSWatcher): string[] =>
  Object.entries(watcher.getWatched())
    .flatMap(([folder, names]) => names.map((name) => join(folder, name)))
    .filter((path) => path.startsWith(join(root, 'x').slice(0, -1)))
    .sort()

async function started(): Promise<{ watcher: FSWatcher; events: string[] }> {
  const events: string[] = []
  const watcher = watch(root, { ignoreInitial: true, ignored: ticketsIgnored(root) })
  watchers.push(watcher)
  watcher.on('all', (event, path) => events.push(`${event} ${path}`))
  await new Promise<void>((done) => watcher.once('ready', () => done()))
  return { watcher, events }
}

async function until(what: string, done: () => boolean, ms = 5000): Promise<void> {
  const end = performance.now() + ms
  while (!done()) {
    if (performance.now() > end) throw new Error(`timed out after ${ms} ms waiting for ${what}`)
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

describe('chokidar with the filter of a Tickets root', () => {
  it('holds the Epic folders, their spec, map and issues, and the Tickets — and no file that lies right under the root', async () => {
    mkdirSync(join(root, 'demo', 'issues'), { recursive: true })
    mkdirSync(join(root, 'demo', 'logs'))
    writeFileSync(join(root, 'demo', 'spec.md'), '# Demo\n')
    writeFileSync(join(root, 'demo', 'issues', '01-a.md'), '# 01\n')
    writeFileSync(join(root, 'demo', 'logs', 'run.log'), 'x')
    // What an agent leaves next to the Epics: epic-status reads none of it.
    for (let index = 0; index < 20; index++) writeFileSync(join(root, `note-${index}.md`), 'x')
    writeFileSync(join(root, 'spec.md'), 'not an Epic')

    const { watcher, events } = await started()
    expect(watchedPaths(watcher)).toEqual([join(root, 'demo'), join(root, 'demo', 'issues'), join(root, 'demo', 'issues', '01-a.md'), join(root, 'demo', 'spec.md')].sort())

    // A new file right under the root is not reported; a new Epic with its first Ticket is.
    writeFileSync(join(root, 'late.md'), 'x')
    mkdirSync(join(root, 'next', 'issues'), { recursive: true })
    writeFileSync(join(root, 'next', 'issues', '01-first.md'), '# 01\n')
    await until('the Ticket of the new Epic', () => events.includes(`add ${join(root, 'next', 'issues', '01-first.md')}`))
    expect(events.filter((event) => event.endsWith('late.md'))).toEqual([])
    expect(watchedPaths(watcher)).not.toContain(join(root, 'late.md'))
  })

  // For a root that is not there chokidar says `ready` first and only then starts to watch the
  // folder above, which it does not list: a root made before that watch exists is never reported,
  // with this filter or without one (measured on Windows: lost 5 of 5 times when made in the tick
  // of `ready`, reported 5 of 5 times when made once the folder above is watched; the review of
  // PR #274 saw the same loss on macOS and in the Linux CI job). So the root is made after that,
  // and the folder above is written to while waiting, which makes chokidar look for the root
  // again. The time limit is above the one of `until`, so its message is the one shown.
  it('still follows a root made after the start, whose parent holds files of its own', async () => {
    writeFileSync(join(dir, 'README.md'), 'code')
    const { watcher, events } = await started()
    await until('the watch of the folder above', () => dir in watcher.getWatched())
    mkdirSync(join(root, 'demo', 'issues'), { recursive: true })
    writeFileSync(join(root, 'demo', 'issues', '01-a.md'), '# 01\n')
    await until('the first Ticket', () => {
      if (events.includes(`add ${join(root, 'demo', 'issues', '01-a.md')}`)) return true
      writeFileSync(join(dir, 'README.md'), `code ${events.length}`)
      return false
    })
  }, 15_000)
})
