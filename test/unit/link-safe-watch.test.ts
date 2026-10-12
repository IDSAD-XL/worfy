// src/main/link-safe-watch.ts (worfy-windows ticket 20): a watch that never calls through a link
// to `\\host\share\…`. The disk is a model (test/unit/windows-disk.ts) under path.win32, so
// every case runs on any system. The model writes down each call and marks the ones Windows would
// answer by contacting the host: `contacts` must stay empty.
import { win32 } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { LinkSafeWatch, MAX_SCAN_DEPTH, type WatchState } from '../../src/main/link-safe-watch'
import { FILE, FOLDER, linkTo, windowsDisk, type DiskEntry, type WindowsDisk } from './windows-disk'

const REPO = 'C:\\p\\repo'
const ROOT = `${REPO}\\.scratch`
const EVIL = '\\\\evil\\share'

/** A Tickets root with one Epic: its spec, its issues folder with one Ticket, and a folder of logs. */
const TICKETS: Record<string, DiskEntry> = {
  [`${ROOT}\\demo\\spec.md`]: FILE,
  [`${ROOT}\\demo\\issues\\01-a.md`]: FILE,
  [`${ROOT}\\demo\\logs\\run.log`]: FILE,
}

/** What the watch of a Tickets root is asked to care about: Epic folders, spec.md, issues and the Tickets. */
function cares(path: string): boolean {
  const [epic, second, third, ...deeper] = win32.relative(ROOT, path).split('\\')
  if (epic === undefined || epic === '' || epic === '..') return false
  if (second === undefined) return true
  if (third === undefined) return second === 'spec.md' || second === 'issues'
  return second === 'issues' && third.endsWith('.md') && deeper.length === 0
}

const open: LinkSafeWatch[] = []
afterEach(() => {
  for (const watch of open.splice(0)) watch.close()
})

interface Started {
  watch: LinkSafeWatch
  state: WatchState
  changes: string[]
  errors: unknown[]
}
async function start(disk: WindowsDisk, root: string = ROOT, allowed: readonly string[] = [REPO, ROOT]): Promise<Started> {
  const changes: string[] = []
  const errors: unknown[] = []
  const watch = new LinkSafeWatch({
    root,
    allowed,
    paths: win32,
    links: disk.links,
    fs: disk.fs,
    enter: cares,
    wanted: cares,
    onChange: (path) => changes.push(path),
    onError: (error) => errors.push(error),
    scanDelayMs: 0,
  })
  open.push(watch)
  const state = await watch.start()
  return { watch, state, changes, errors }
}

/** The calls that name a path through the link, other than lstat and readlink of the link itself. */
const through = (disk: WindowsDisk, link: string): string[] =>
  disk.calls.filter((call) => {
    const path = call.replace(/^\S+ /, '').replace(/ \(recursive\)$/, '')
    if (path.toLowerCase() === link.toLowerCase()) return !/^(lstat|readlink) /.test(call)
    return path.toLowerCase().startsWith(`${link.toLowerCase()}\\`)
  })

describe('a folder with no link in it', () => {
  it('is watched by one recursive watch; a change of a path that matters is reported, another is not', async () => {
    const disk = windowsDisk(TICKETS)
    const { watch, state, changes, errors } = await start(disk)
    expect(state).toBe('watching')
    expect(disk.open()).toEqual([`${ROOT} (recursive)`])
    expect(watch.watched()).toEqual({ root: ROOT, waitingAt: null, links: {} })

    disk.put(`${ROOT}\\demo\\issues\\02-b.md`, FILE)
    disk.put(`${ROOT}\\demo\\logs\\more.log`, FILE)
    disk.put(`${ROOT}\\next`, FOLDER)
    await watch.settled()
    expect(changes).toEqual([`${ROOT}\\demo\\issues\\02-b.md`, `${ROOT}\\next`])
    expect(errors).toEqual([])
    expect(disk.contacts).toEqual([])
    // Only the folders that matter are listed: the logs are not.
    expect(disk.calls.filter((call) => call.startsWith('readdir '))).not.toContain(`readdir ${ROOT}\\demo\\logs`)
    expect(disk.calls).toContain(`readdir ${ROOT}\\demo\\issues`)
  })

  it('reports the root itself when the system names no path', async () => {
    const disk = windowsDisk(TICKETS)
    const { watch, changes } = await start(disk)
    // An event without a name: something changed, nothing more is known.
    disk.nameless(ROOT)
    await watch.settled()
    expect(changes).toEqual([ROOT])
  })
})

describe('a link to a share', () => {
  const cases: [string, string, DiskEntry | null][] = [
    ['an Epic folder', `${ROOT}\\away`, null],
    ['the issues folder of an Epic', `${ROOT}\\demo2\\issues`, null],
    ['a Ticket file', `${ROOT}\\demo\\issues\\09-away.md`, null],
    ['the spec of an Epic', `${ROOT}\\demo2\\spec.md`, null],
  ]

  it.each(cases)('in place of %s: no call goes through it, it is left alone, and the folder is watched as before', async (_what, link) => {
    const disk = windowsDisk({ ...TICKETS, [`${ROOT}\\demo2\\map.md`]: FILE, [link]: linkTo(`${EVIL}\\x`) })
    const { watch, state, changes, errors } = await start(disk)
    expect(state).toBe('watching')
    expect(watch.skipped()).toEqual([link])
    expect(watch.watched().links).toEqual({})
    expect(disk.open()).toEqual([`${ROOT} (recursive)`])

    // A new Ticket next to it reaches the canvas all the same.
    disk.put(`${ROOT}\\demo\\issues\\02-b.md`, FILE)
    await watch.settled()
    expect(changes).toEqual([`${ROOT}\\demo\\issues\\02-b.md`])
    expect(errors).toEqual([])
    expect(disk.contacts).toEqual([])
    expect(through(disk, link)).toEqual([])
    // The link was read, not followed.
    expect(disk.calls).toContain(`readlink ${link}`)
  })

  it('in place of the root itself: the root is refused and nothing is asked of the file system about it', async () => {
    const disk = windowsDisk({ [`${REPO}\\README.md`]: FILE, [ROOT]: linkTo(`${EVIL}\\scratch`) })
    const { watch, state, changes } = await start(disk)
    expect(state).toBe('refused')
    expect(disk.open()).toEqual([])
    expect(disk.contacts).toEqual([])
    expect(through(disk, ROOT)).toEqual([])
    expect(disk.calls.every((call) => /^(lstat|readlink) /.test(call))).toBe(true)
    await watch.settled()
    expect(changes).toEqual([])
  })

  it('in place of the folder the caller works in, above the root: refused as well, after one look at that link', async () => {
    const disk = windowsDisk({ 'C:\\p\\elsewhere\\x': FILE, [REPO]: linkTo(`${EVIL}\\repo`) })
    const { state } = await start(disk)
    expect(state).toBe('refused')
    expect(disk.contacts).toEqual([])
    expect(disk.open()).toEqual([])
    expect(disk.calls).toEqual([`lstat ${REPO}`, `readlink ${REPO}`])
  })

  it('a root that lies on a share of the caller is watched: the share is the caller\'s own', async () => {
    const share = '\\\\nas\\work\\repo'
    const disk = windowsDisk({ [`${share}\\.scratch\\demo\\issues\\01-a.md`]: FILE })
    const { state } = await start(disk, `${share}\\.scratch`, [share, `${share}\\.scratch`])
    expect(state).toBe('watching')
    expect(disk.open()).toEqual([`${share}\\.scratch (recursive)`])
  })

  it('a link that cannot be read, or looked at, is left alone like one that leads to a share', async () => {
    const unread = `${ROOT}\\unread`
    const denied = `${ROOT}\\denied`
    const disk = windowsDisk({ ...TICKETS, [unread]: linkTo('C:\\other\\epic'), [denied]: linkTo('C:\\other\\epic'), 'C:\\other\\epic\\issues\\01.md': FILE })
    disk.breakLink(unread)
    const { watch } = await start(disk)
    expect(watch.skipped()).toEqual([unread])
    expect(watch.watched().links).toEqual({ [denied]: 'C:\\other\\epic' })

    // Now the other one cannot be looked at any more.
    disk.deny(denied)
    disk.put(`${ROOT}\\demo\\issues\\03-c.md`, FILE)
    await watch.settled()
    expect(watch.skipped()).toEqual([denied, unread])
    expect(watch.watched().links).toEqual({})
    expect(disk.open()).toEqual([`${ROOT} (recursive)`])
  })

  it('a local link that is pointed at a share later loses its watch', async () => {
    const link = `${ROOT}\\linked`
    const disk = windowsDisk({ ...TICKETS, [link]: linkTo('C:\\other\\epic'), 'C:\\other\\epic\\issues\\01.md': FILE })
    const { watch } = await start(disk)
    expect(disk.open()).toEqual([`${ROOT} (recursive)`, 'C:\\other\\epic (recursive)'])
    disk.put(link, linkTo(`${EVIL}\\epic`))
    await watch.settled()
    expect(disk.open()).toEqual([`${ROOT} (recursive)`])
    expect(watch.skipped()).toEqual([link])
    expect(disk.contacts).toEqual([])
  })
})

describe('a link that stays on the machine', () => {
  it('in place of an Epic folder: what it leads to is watched by its real path, and a change behind it is reported by the path under the root', async () => {
    const link = `${ROOT}\\linked`
    const disk = windowsDisk({ ...TICKETS, [link]: linkTo('..\\..\\..\\other\\epic'), 'C:\\other\\epic\\issues\\01.md': FILE, 'C:\\other\\epic\\logs\\x.log': FILE })
    const { watch, changes } = await start(disk)
    expect(watch.watched().links).toEqual({ [link]: 'C:\\other\\epic' })
    expect(disk.open()).toEqual([`${ROOT} (recursive)`, 'C:\\other\\epic (recursive)'])

    disk.put('C:\\other\\epic\\issues\\02.md', FILE)
    disk.put('C:\\other\\epic\\logs\\y.log', FILE)
    await watch.settled()
    expect(changes).toEqual([`${link}\\issues\\02.md`])
    expect(disk.contacts).toEqual([])
  })

  it('in place of a Ticket file and of an issues folder; a link inside what a link leads to is found too', async () => {
    const ticket = `${ROOT}\\demo\\issues\\07-linked.md`
    const epic = `${ROOT}\\linked`
    const disk = windowsDisk({
      ...TICKETS,
      [ticket]: linkTo('C:\\notes\\seven.md'),
      'C:\\notes\\seven.md': FILE,
      [epic]: linkTo('C:\\other\\epic'),
      'C:\\other\\epic\\spec.md': FILE,
      'C:\\other\\epic\\issues': linkTo('C:\\third\\issues'),
      'C:\\third\\issues\\01.md': FILE,
    })
    const { watch, changes } = await start(disk)
    expect(watch.watched().links).toEqual({ [ticket]: 'C:\\notes\\seven.md', [epic]: 'C:\\other\\epic', [`${epic}\\issues`]: 'C:\\third\\issues' })
    // A file is watched without "recursive".
    expect(disk.open()).toContain('C:\\notes\\seven.md')

    disk.put('C:\\notes\\seven.md', FILE)
    disk.put('C:\\third\\issues\\02.md', FILE)
    await watch.settled()
    expect(changes).toEqual([ticket, `${epic}\\issues\\02.md`])
  })

  it('made after the start is found at the next look, and one that is removed loses its watch', async () => {
    const link = `${ROOT}\\late`
    const disk = windowsDisk({ ...TICKETS, 'C:\\other\\epic\\issues\\01.md': FILE })
    const { watch, changes } = await start(disk)
    disk.put(link, linkTo('C:\\other\\epic'))
    await watch.settled()
    expect(changes).toEqual([link])
    expect(watch.watched().links).toEqual({ [link]: 'C:\\other\\epic' })

    disk.remove(link)
    await watch.settled()
    expect(watch.watched().links).toEqual({})
    expect(disk.open()).toEqual([`${ROOT} (recursive)`])
  })

  it('a link that leads nowhere, and one where no link is looked for, get no watch', async () => {
    const disk = windowsDisk({ ...TICKETS, [`${ROOT}\\nowhere`]: linkTo('C:\\gone'), [`${ROOT}\\demo\\logs\\modules`]: linkTo('C:\\other\\modules'), 'C:\\other\\modules\\x.js': FILE })
    const { watch, errors } = await start(disk)
    expect(watch.watched().links).toEqual({})
    expect(watch.skipped()).toEqual([])
    expect(errors).toEqual([])
    // The link among the logs was never read: nothing there matters.
    expect(disk.calls).not.toContain(`readlink ${ROOT}\\demo\\logs\\modules`)
  })

  it('links that lead to each other end the look: no folder is listed twice, and the depth has a bound', async () => {
    const disk = windowsDisk({ [`${ROOT}\\a`]: linkTo('C:\\ring\\one'), 'C:\\ring\\one\\issues': linkTo('C:\\ring\\one'), 'C:\\ring\\one\\spec.md': FILE })
    const { watch } = await start(disk)
    expect(disk.calls.filter((call) => call === 'readdir C:\\ring\\one')).toHaveLength(1)
    expect(Object.keys(watch.watched().links)).toEqual([`${ROOT}\\a`, `${ROOT}\\a\\issues`])
    expect(MAX_SCAN_DEPTH).toBe(8)
  })
})

describe('a root that is not there, or goes away', () => {
  it('is waited for at the nearest folder above it; only the next name on the way wakes the watch', async () => {
    const disk = windowsDisk({ [`${REPO}\\README.md`]: FILE })
    const root = `${REPO}\\.scratch\\tickets`
    const { watch, state, changes } = await start(disk, root, [REPO, root])
    expect(state).toBe('waiting')
    expect(watch.watched()).toEqual({ root: null, waitingAt: REPO, links: {} })
    expect(disk.open()).toEqual([REPO])

    const before = disk.calls.length
    disk.put(`${REPO}\\src\\main.ts`, FILE)
    disk.put(`${REPO}\\README.md`, FILE)
    await watch.settled()
    expect(disk.calls.length).toBe(before)

    // The first folder on the way: the wait moves down to it.
    disk.put(`${REPO}\\.SCRATCH`, FOLDER)
    await watch.settled()
    // (The name on the disk differs from the root's by the case of its letters: it is the same folder.)
    expect(watch.watched().waitingAt).toBe(`${REPO}\\.scratch`)
    expect(disk.open()).toEqual([`${REPO}\\.scratch`])

    disk.put(`${REPO}\\.scratch\\tickets\\demo\\issues\\01-a.md`, FILE)
    await watch.settled()
    expect(watch.state).toBe('watching')
    expect(disk.open()).toEqual([`${REPO}\\.scratch\\tickets (recursive)`])
    expect(changes).toEqual([])
  })

  it('a root that comes between the look for it and the start of the wait is found: the wait looks once more', async () => {
    const disk = windowsDisk({ [`${REPO}\\README.md`]: FILE })
    const watch = disk.fs.watch
    let first = true
    const fs = {
      ...disk.fs,
      watch: (...args: Parameters<typeof watch>) => {
        const handle = watch(...args)
        // Made right after the wait began, with no event: the system had sent it before.
        if (first) disk.putQuietly(`${ROOT}\\demo\\issues\\01-a.md`, FILE)
        first = false
        return handle
      },
    }
    const changes: string[] = []
    const late = new LinkSafeWatch({ root: ROOT, allowed: [REPO, ROOT], paths: win32, links: disk.links, fs, enter: cares, wanted: cares, onChange: (path) => changes.push(path), onError: () => undefined, scanDelayMs: 0 })
    open.push(late)
    expect(await late.start()).toBe('watching')
    expect(disk.open()).toEqual([`${ROOT} (recursive)`])
  })

  it('a root that comes as a link to a share is refused when it comes', async () => {
    const disk = windowsDisk({ [`${REPO}\\README.md`]: FILE })
    const { watch } = await start(disk)
    expect(watch.state).toBe('waiting')
    disk.put(ROOT, linkTo(`${EVIL}\\scratch`))
    await watch.settled()
    expect(watch.state).toBe('refused')
    expect(disk.open()).toEqual([])
    expect(disk.contacts).toEqual([])
    expect(through(disk, ROOT)).toEqual([])
  })

  it('a watched root that is removed: its watch is closed at the first event that names the folder itself, the root is reported once and waited for; made again, it is watched again', async () => {
    const link = `${ROOT}\\linked`
    const disk = windowsDisk({ ...TICKETS, [link]: linkTo('C:\\other\\epic'), 'C:\\other\\epic\\spec.md': FILE })
    const { watch, changes } = await start(disk)
    disk.remove(ROOT)
    await watch.settled()
    expect(changes).toEqual([ROOT])
    expect(watch.watched()).toEqual({ root: null, waitingAt: REPO, links: {} })
    expect(disk.open()).toEqual([REPO])

    disk.put(`${ROOT}\\demo\\issues\\01-a.md`, FILE)
    await watch.settled()
    expect(watch.state).toBe('watching')
    disk.put(`${ROOT}\\demo\\issues\\02-b.md`, FILE)
    await watch.settled()
    expect(changes).toEqual([ROOT, `${ROOT}\\demo\\issues\\02-b.md`])
  })

  it('an error of the watch of the root is passed on, and the root is looked at again', async () => {
    const disk = windowsDisk(TICKETS)
    const { watch, changes, errors } = await start(disk)
    const failure = new Error('EPERM: operation not permitted, watch')
    disk.fail(ROOT, failure)
    await watch.settled()
    expect(errors).toEqual([failure])
    expect(changes).toEqual([ROOT])
    expect(watch.state).toBe('watching')
    expect(disk.open()).toEqual([`${ROOT} (recursive)`])
  })
})

describe('close', () => {
  it('ends every watch, and nothing is reported or looked for after it', async () => {
    const disk = windowsDisk({ ...TICKETS, [`${ROOT}\\linked`]: linkTo('C:\\other\\epic'), 'C:\\other\\epic\\spec.md': FILE })
    const { watch, changes } = await start(disk)
    expect(disk.open()).toHaveLength(2)
    watch.close()
    expect(disk.open()).toEqual([])
    expect(watch.state).toBe('closed')
    const before = disk.calls.length
    disk.put(`${ROOT}\\demo\\issues\\02-b.md`, FILE)
    disk.put('C:\\other\\epic\\spec.md', FILE)
    await watch.settled()
    expect(changes).toEqual([])
    expect(disk.calls.length).toBe(before)
  })

  it('while the root is waited for ends the wait', async () => {
    const disk = windowsDisk({ [`${REPO}\\README.md`]: FILE })
    const { watch } = await start(disk)
    expect(disk.open()).toEqual([REPO])
    watch.close()
    expect(disk.open()).toEqual([])
  })
})
