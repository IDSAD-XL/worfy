// What chokidar watches under a Tickets root with ticketsIgnored (src/main/workflow/watch.ts), over
// real folders, on any system: where chokidar is the watch (everywhere but Windows since
// worfy-windows ticket 20) and on Windows too, since chokidar runs there all the same. No link is
// made here.
import { existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { watch, type FSWatcher } from 'chokidar'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { removeTree } from '../../src/main/storage/remove'
import { ticketsIgnored } from '../../src/main/workflow/watch'
import { removeTestTree } from '../remove'
import { ms } from '../time-scale'

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

async function started(at = root): Promise<{ watcher: FSWatcher; events: string[] }> {
  const events: string[] = []
  const watcher = watch(at, { ignoreInitial: true, ignored: ticketsIgnored(at) })
  watchers.push(watcher)
  watcher.on('all', (event, path) => events.push(`${event} ${path}`))
  await new Promise<void>((done) => watcher.once('ready', () => done()))
  return { watcher, events }
}

async function until(what: string, done: () => boolean, limit = 5000): Promise<void> {
  const wait = ms(limit)
  const end = performance.now() + wait
  while (!done()) {
    if (performance.now() > end) throw new Error(`timed out after ${wait} wait waiting for ${what}`)
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
    // A write made in the tick of `ready` can be lost on macOS while the watch is alive; one more
    // write into the root makes chokidar look again.
    await until('the Ticket of the new Epic', () => {
      if (events.includes(`add ${join(root, 'next', 'issues', '01-first.md')}`)) return true
      writeFileSync(join(root, 'late.md'), `x ${events.length}`)
      return false
    })
    expect(events.filter((event) => event.endsWith('late.md'))).toEqual([])
    expect(watchedPaths(watcher)).not.toContain(join(root, 'late.md'))
  }, ms(15_000))

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
  }, ms(15_000))

  // Records of what chokidar 5 does not see (worfy-harness ticket 41): the watcher looks for such a
  // root itself (src/main/workflow/watch.ts, `awaitTicketsRoot`). If a new chokidar starts to see
  // them, these tests say so, and that code may go.

  // For a missing path chokidar goes up one level but keeps waiting for the root's own name: with
  // the Workflow folder missing too it waits for `.scratch` in the folder above that one.
  it('does not see a root whose parent is not there at the start either, made later with it', async () => {
    const folder = join(dir, 'workflow-folder')
    const deep = join(folder, '.scratch')
    const { watcher, events } = await started(deep)
    await until('the watch of the folder two levels up', () => dir in watcher.getWatched())
    mkdirSync(join(deep, 'demo', 'issues'), { recursive: true })
    writeFileSync(join(deep, 'demo', 'issues', '01-a.md'), '# 01\n')
    for (let index = 0; index < 5; index++) {
      await new Promise((resolve) => setTimeout(resolve, 300))
      writeFileSync(join(deep, 'demo', 'issues', '01-a.md'), `# 01 ${index}\n`)
    }
    expect(events).toEqual([])
  }, ms(15_000))

  // After the root is removed chokidar does not watch the folder above for it again. Measured on
  // macOS only: on Windows a removed folder chokidar watches sends events without end
  // (worfy-windows ticket 37), and Linux was not measured.
  //
  // The claim needs chokidar to have taken the removal in (`unlinkDir` of the root): a removal it
  // missed leaves the old watch on the path, and that watch would report the new root. On macOS
  // fs.watch of a folder runs through one FSEvents stream that is made again, on a thread of its
  // own, for every new folder; a change made before that is done is lost for good, as the first
  // test of this file says of a write in the tick of `ready`. Under the load of a full run that
  // takes longer, and a removal made right after `ready` went unreported, so a longer wait would
  // not help. So the root is removed only once the watch is seen to report: a new Ticket is
  // written until chokidar reports it.
  it.skipIf(process.platform !== 'darwin')('does not see a root that is removed and made again under the same name', async () => {
    mkdirSync(join(root, 'demo', 'issues'), { recursive: true })
    writeFileSync(join(root, 'demo', 'issues', '01-a.md'), '# 01\n')
    const { events } = await started()
    const probe = join(root, 'demo', 'issues', '02-probe.md')
    await until('a report of the watch before the removal', () => {
      if (events.some((event) => event.endsWith(` ${probe}`))) return true
      writeFileSync(probe, `# 02 ${events.length}\n`)
      return false
    })
    removeTestTree(root)
    expect(existsSync(root)).toBe(false)
    await until('the removal of the root', () => events.includes(`unlinkDir ${root}`))
    await new Promise((resolve) => setTimeout(resolve, 500))
    const afterRemoval = events.length
    mkdirSync(join(root, 'next', 'issues'), { recursive: true })
    writeFileSync(join(root, 'next', 'issues', '01-b.md'), '# 01\n')
    for (let index = 0; index < 5; index++) {
      await new Promise((resolve) => setTimeout(resolve, 300))
      writeFileSync(join(root, 'next', 'issues', '01-b.md'), `# 01 ${index}\n`)
    }
    expect(events.slice(afterRemoval)).toEqual([])
  }, ms(15_000))
})
