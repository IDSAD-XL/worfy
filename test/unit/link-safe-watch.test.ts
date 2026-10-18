// src/main/link-safe-watch.ts (worfy-windows ticket 20): a watch that never calls through a link
// to `\\host\share\…`. The disk is a model (test/unit/windows-disk.ts) under path.win32, so
// every case runs on any system. The model writes down each call and marks the ones Windows would
// answer by contacting the host: `contacts` must stay empty.
import { win32 } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LinkSafeWatch, MAX_SCAN_DEPTH, RETRY_DELAY_MS, RETRY_SLOW_AFTER, ROOT_ERRORS_BEFORE_PAUSE, SLOW_RETRY_DELAY_MS, type LinkSafeWatchOptions, type WatchFs, type WatchState } from '../../src/main/link-safe-watch'
import { UNCHECKED } from '../../src/main/remote-links'
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
/** A watch that is not started yet; `extra` replaces what the disk gives, or sets the time between two looks. */
function made(disk: WindowsDisk, root: string = ROOT, allowed: readonly string[] = [REPO, ROOT], extra: Partial<LinkSafeWatchOptions> = {}): Omit<Started, 'state'> {
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
    ...extra,
  })
  open.push(watch)
  return { watch, changes, errors }
}

async function start(disk: WindowsDisk, root: string = ROOT, allowed: readonly string[] = [REPO, ROOT], extra: Partial<LinkSafeWatchOptions> = {}): Promise<Started> {
  const all = made(disk, root, allowed, extra)
  return { ...all, state: await all.watch.start() }
}

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** The time between two looks at a root that could not be watched, in these tests. */
const RETRY = 5

/** Waits until the watch has looked again and is where the test expects it. */
async function until(what: string, done: () => boolean): Promise<void> {
  const end = performance.now() + 2000
  while (!done()) {
    if (performance.now() > end) throw new Error(`timed out waiting for ${what}`)
    await pause(RETRY)
  }
}

const coded = (code: string, what: string): Error => Object.assign(new Error(`${code}: ${what}`), { code })

type Asked = 'kind' | 'list' | 'realpath' | 'isFolder'

/** The calls given, with the next `times` calls of one kind for one path failing. */
function failing(base: WatchFs, call: Asked | 'watch', path: string, error: Error): { fs: WatchFs; fail: (times: number) => void } {
  let left = 0
  const hit = (asked: string): boolean => asked.toLowerCase() === path.toLowerCase() && left-- > 0
  const fs: WatchFs = { ...base }
  if (call === 'watch') {
    fs.watch = (asked, ...rest) => {
      if (hit(asked)) throw error
      return base.watch(asked, ...rest)
    }
  } else {
    const real = base[call] as (asked: string) => Promise<never>
    ;(fs[call] as unknown) = async (asked: string) => {
      if (hit(asked)) throw error
      return real(asked)
    }
  }
  return { fs, fail: (times) => void (left = times) }
}

/** The calls given, with the nth call of one kind for one path held back until `release`; `asked` resolves when it comes. */
function holding(base: WatchFs, call: Asked, path: string, nth = 1): { fs: WatchFs; asked: Promise<void>; release: () => void } {
  let release = (): void => undefined
  let reached = (): void => undefined
  const gate = new Promise<void>((done) => (release = done))
  const asked = new Promise<void>((done) => (reached = done))
  const real = base[call] as (asked: string) => Promise<never>
  const fs: WatchFs = { ...base }
  ;(fs[call] as unknown) = async (given: string) => {
    if (given.toLowerCase() === path.toLowerCase() && --nth === 0) {
      reached()
      await gate
    }
    return real(given)
  }
  return { fs, asked, release }
}

/**
 * The calls given, with what each new watch of the root does right after it is made, in the next
 * turn of the timers: fails, says the root went (by its `\\?\` path), or nothing.
 */
function erring(disk: WindowsDisk, next: () => 'error' | 'gone' | 'quiet', root: string = ROOT): { fs: WatchFs; failure: Error } {
  const failure = new Error('EPERM: operation not permitted, watch')
  const fs: WatchFs = {
    ...disk.fs,
    watch: (path, recursive, onEvent, onError) => {
      const handle = disk.fs.watch(path, recursive, onEvent, onError)
      if (path.toLowerCase() !== root.toLowerCase()) return handle
      const what = next()
      if (what === 'error') setTimeout(() => onError(failure), 0)
      if (what === 'gone') setTimeout(() => onEvent(`\\\\?\\${path}`), 0)
      return handle
    },
  }
  return { fs, failure }
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
    const { watch, state, changes, errors } = await start(disk)
    expect(state).toBe('refused')
    expect(disk.open()).toEqual([])
    expect(disk.contacts).toEqual([])
    expect(through(disk, ROOT)).toEqual([])
    expect(disk.calls.every((call) => /^(lstat|readlink) /.test(call))).toBe(true)
    await watch.settled()
    expect(changes).toEqual([])
    // At the start the answer of start() says it: the caller writes its own line.
    expect(errors).toEqual([])
  })

  it('in place of the folder the caller works in, above the root: refused as well, after one look at that link', async () => {
    const disk = windowsDisk({ 'C:\\p\\elsewhere\\x': FILE, [REPO]: linkTo(`${EVIL}\\repo`) })
    const { state } = await start(disk)
    expect(state).toBe('refused')
    expect(disk.contacts).toEqual([])
    expect(disk.open()).toEqual([])
    expect(disk.calls).toEqual([`lstat ${REPO}`, `readlink ${REPO}`])
  })

  it('a root that is a link which cannot be read, or cannot be looked at, is refused like one that leads to a share', async () => {
    const unread = windowsDisk({ [`${REPO}\\README.md`]: FILE, [ROOT]: linkTo('C:\\other\\scratch'), 'C:\\other\\scratch\\demo\\issues\\01-a.md': FILE })
    unread.breakLink(ROOT)
    expect((await start(unread)).state).toBe('refused')
    expect(unread.open()).toEqual([])
    expect(through(unread, ROOT)).toEqual([])

    const denied = windowsDisk(TICKETS)
    denied.deny(ROOT)
    expect((await start(denied)).state).toBe('refused')
    expect(denied.open()).toEqual([])
    expect(denied.calls.filter((call) => !call.startsWith('lstat '))).toEqual([])
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
    // The root is reported once it is watched: the Ticket was written before its watch began.
    expect(changes).toEqual([root])
  })

  it('a root that is there at the start is not reported: the caller reads it after the start anyway', async () => {
    const { watch, changes } = await start(windowsDisk(TICKETS))
    await watch.settled()
    expect(changes).toEqual([])
  })

  it('a root that comes between the look for it and the start of the wait is found: the wait looks once more, and the root is reported once the start is over', async () => {
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
    // Not there at the first look: the Ticket was written before any watch saw it (worfy-windows
    // ticket 33). The caller may not have read the root yet, but nothing says it is there now.
    expect(changes).toEqual([ROOT])
  })

  it('a root that comes as a link to a share is refused when it comes', async () => {
    const disk = windowsDisk({ [`${REPO}\\README.md`]: FILE })
    const { watch, changes, errors } = await start(disk)
    expect(watch.state).toBe('waiting')
    expect(errors).toEqual([])
    // Two events for it, as Windows sends for a new entry: two looks are queued.
    disk.put(ROOT, linkTo(`${EVIL}\\scratch`))
    disk.put(ROOT, linkTo(`${EVIL}\\scratch`))
    await watch.settled()
    expect(watch.state).toBe('refused')
    expect(disk.open()).toEqual([])
    expect(disk.contacts).toEqual([])
    expect(through(disk, ROOT)).toEqual([])
    // Nobody asks for the state after the start: the refusal is said, once.
    expect(errors.map(String)).toEqual([`Error: ${ROOT} now leads off this machine: it is no longer watched`])
    expect(changes).toEqual([])
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
    // Reported once more when it is watched again: what was written before that had no watch.
    expect(changes).toEqual([ROOT, ROOT])
    disk.put(`${ROOT}\\demo\\issues\\02-b.md`, FILE)
    await watch.settled()
    expect(changes).toEqual([ROOT, ROOT, `${ROOT}\\demo\\issues\\02-b.md`])
  })

  it('an error of the watch of the root is passed on, and the root is looked at again', async () => {
    const disk = windowsDisk(TICKETS)
    const { watch, changes, errors } = await start(disk)
    const failure = new Error('EPERM: operation not permitted, watch')
    disk.fail(ROOT, failure)
    await watch.settled()
    expect(errors).toEqual([failure])
    // Once when the watch failed, once when the new one was in place.
    expect(changes).toEqual([ROOT, ROOT])
    expect(watch.state).toBe('watching')
    expect(disk.open()).toEqual([`${ROOT} (recursive)`])
  })
})

describe('a look at the root that fails is repeated', () => {
  const TARGET = 'C:\\other\\scratch'

  it('a root that is a link to a folder of this machine which is not there: said once, looked at again, and watched by its real path once the folder is made', async () => {
    const disk = windowsDisk({ [`${REPO}\\README.md`]: FILE, [ROOT]: linkTo(TARGET) })
    const { watch, state, changes, errors } = await start(disk, ROOT, [REPO, ROOT], { retryDelayMs: RETRY })
    expect(state).toBe('waiting')
    expect(watch.watched()).toEqual({ root: null, waitingAt: null, links: {} })
    expect(disk.open()).toEqual([])
    await until('two more looks', () => disk.calls.filter((call) => call === `realpath ${ROOT}`).length >= 3)

    // No event tells of it: nothing above the folder is watched.
    disk.putQuietly(`${TARGET}\\demo\\issues\\01-a.md`, FILE)
    await until('the watch of the root', () => watch.state === 'watching')
    await watch.settled()
    expect(watch.watched()).toEqual({ root: TARGET, waitingAt: null, links: {} })
    expect(disk.open()).toEqual([`${TARGET} (recursive)`])
    // The system is given the real path, not the link (worfy-windows ticket 33).
    expect(disk.calls.filter((call) => call.startsWith('watch '))).toEqual([`watch ${TARGET} (recursive)`])
    expect(changes).toEqual([ROOT])
    // A root that leads nowhere is not a root that is not there: the log says so, once (ticket 33).
    expect(errors.map(String)).toEqual([`Error: ${ROOT} is a link that leads nowhere: it is looked at again until it leads to a folder`])
    expect(disk.contacts).toEqual([])

    disk.put(`${TARGET}\\demo\\issues\\02-b.md`, FILE)
    await watch.settled()
    expect(changes).toEqual([ROOT, `${ROOT}\\demo\\issues\\02-b.md`])
  })

  it('what a root that is a link leads to is removed while watched and made again: watched again', async () => {
    const disk = windowsDisk({ [`${REPO}\\README.md`]: FILE, [ROOT]: linkTo(TARGET), [`${TARGET}\\demo\\issues\\01-a.md`]: FILE })
    const { watch, state, changes, errors } = await start(disk, ROOT, [REPO, ROOT], { retryDelayMs: RETRY })
    expect(state).toBe('watching')
    disk.remove(TARGET)
    await watch.settled()
    expect(watch.state).toBe('waiting')
    expect(changes).toEqual([ROOT])
    expect(disk.open()).toEqual([])

    disk.putQuietly(`${TARGET}\\demo\\issues\\01-a.md`, FILE)
    await until('the watch of the root', () => watch.state === 'watching')
    await watch.settled()
    expect(disk.open()).toEqual([`${TARGET} (recursive)`])
    expect(disk.calls.filter((call) => call.startsWith('watch '))).toEqual([`watch ${TARGET} (recursive)`, `watch ${TARGET} (recursive)`])
    expect(changes).toEqual([ROOT, ROOT])
    expect(errors.map(String)).toEqual([`Error: ${ROOT} is a link that leads nowhere: it is looked at again until it leads to a folder`])
  })

  it('the time between two looks is two seconds unless the caller says otherwise, and close leaves no timer behind', async () => {
    expect(RETRY_DELAY_MS).toBe(2000)
    vi.useFakeTimers()
    try {
      const disk = windowsDisk({ [`${REPO}\\README.md`]: FILE, [ROOT]: linkTo(TARGET) })
      const { watch } = await start(disk)
      const looks = (): number => disk.calls.filter((call) => call === `realpath ${ROOT}`).length
      expect(looks()).toBe(1)
      await vi.advanceTimersByTimeAsync(1999)
      expect(looks()).toBe(1)
      await vi.advanceTimersByTimeAsync(1)
      expect(looks()).toBe(2)
      expect(vi.getTimerCount()).toBe(1)
      watch.close()
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('a call that fails while the root is looked at again after its watch was lost: said once, however often it fails, and the root is watched in the end', async () => {
    const disk = windowsDisk(TICKETS)
    const refused = coded('EPERM', `realpath ${ROOT}`)
    const { fs, fail } = failing(disk.fs, 'realpath', ROOT, refused)
    const { watch, changes, errors } = await start(disk, ROOT, [REPO, ROOT], { fs, retryDelayMs: RETRY })
    const lost = new Error('the watch failed')
    fail(3)
    disk.fail(ROOT, lost)
    await watch.settled()
    // The first of the three: no watch is left, and none is waited at.
    expect(watch.state).toBe('waiting')
    expect(watch.watched()).toEqual({ root: null, waitingAt: null, links: {} })
    expect(disk.open()).toEqual([])

    await until('the watch of the root', () => watch.state === 'watching')
    await watch.settled()
    expect(disk.calls.filter((call) => call === `realpath ${ROOT}`)).toHaveLength(2)
    expect(errors).toEqual([lost, refused])
    expect(changes).toEqual([ROOT, ROOT])
    expect(disk.open()).toEqual([`${ROOT} (recursive)`])

    // A later run of failures is said again.
    fail(1)
    disk.fail(ROOT, lost)
    await watch.settled()
    await until('the watch of the root', () => watch.state === 'watching')
    expect(errors).toEqual([lost, refused, lost, refused])
  })

  it('a failure said once is said again after the root was properly waited for in between', async () => {
    const disk = windowsDisk(TICKETS)
    const refused = coded('EPERM', `realpath ${ROOT}`)
    const { fs, fail } = failing(disk.fs, 'realpath', ROOT, refused)
    const { watch, errors } = await start(disk, ROOT, [REPO, ROOT], { fs, retryDelayMs: RETRY })
    const lost = new Error('the watch failed')
    fail(1)
    disk.fail(ROOT, lost)
    await watch.settled()
    expect(errors).toEqual([lost, refused])
    // Gone by the next look: waited for at the folder above, which is no failure.
    disk.remove(ROOT)
    await until('the wait for the root', () => watch.watched().waitingAt === REPO)
    fail(1)
    disk.put(`${ROOT}\\demo\\issues\\01-a.md`, FILE)
    await until('the watch of the root', () => watch.state === 'watching')
    expect(errors).toEqual([lost, refused, refused])
  })

  it('a root that comes as a link to a share during the start is refused without a word, whatever was queued meanwhile', async () => {
    const disk = windowsDisk({ [`${REPO}\\README.md`]: FILE })
    // The root is looked at twice during the start: by the look, and by the wait once its watch is in place.
    const held = holding(disk.fs, 'kind', ROOT, 2)
    const { watch, errors } = made(disk, ROOT, [REPO, ROOT], { fs: held.fs, retryDelayMs: RETRY })
    const started = watch.start()
    await held.asked
    disk.put(ROOT, linkTo(`${EVIL}\\scratch`))
    disk.put(ROOT, linkTo(`${EVIL}\\scratch`))
    held.release()
    expect(await started).toBe('refused')
    await watch.settled()
    await pause(RETRY * 6)
    expect(watch.state).toBe('refused')
    expect(errors).toEqual([])
    expect(disk.open()).toEqual([])
    expect(disk.contacts).toEqual([])
  })

  it('a look that fails after the wait began, every time, is said once all the same', async () => {
    const disk = windowsDisk({ [`${REPO}\\README.md`]: FILE })
    const denied = coded('EACCES', `lstat ${ROOT}`)
    // Every second look at the root fails: the one the wait makes once its watch is in place.
    let asked = 0
    const fs: WatchFs = {
      ...disk.fs,
      kind: async (path) => {
        if (path.toLowerCase() === ROOT.toLowerCase() && ++asked % 2 === 0) throw denied
        return disk.fs.kind(path)
      },
    }
    const { watch, state, errors } = await start(disk, ROOT, [REPO, ROOT], { fs, retryDelayMs: RETRY })
    expect(state).toBe('waiting')
    expect(errors).toEqual([denied])
    await until('four more looks', () => asked >= 10)
    expect(errors).toEqual([denied])
    expect(watch.state).toBe('waiting')
  })

  it('a look for links that fails — the caller\'s own rule threw — leaves no watch and no wrong state, and is repeated', async () => {
    const disk = windowsDisk(TICKETS)
    const bug = new Error('the rule of the caller threw')
    let throws = 1
    const { watch, state, errors } = await start(disk, ROOT, [REPO, ROOT], {
      retryDelayMs: RETRY,
      enter: (path) => {
        if (throws-- > 0) throw bug
        return cares(path)
      },
    })
    expect(state).toBe('waiting')
    expect(disk.open()).toEqual([])
    expect(errors).toEqual([bug])
    await until('the watch of the root', () => watch.state === 'watching')
    expect(disk.open()).toEqual([`${ROOT} (recursive)`])
  })

  it.each(['ENOENT', 'ENOTDIR'])('a root that goes between the look at it and the next call (%s) is found gone at the next look, and waited for', async (code) => {
    const disk = windowsDisk(TICKETS)
    const { fs, fail } = failing(disk.fs, 'realpath', ROOT, coded(code, `realpath ${ROOT}`))
    const { watch, errors } = await start(disk, ROOT, [REPO, ROOT], { fs, retryDelayMs: RETRY })
    const lost = new Error('the watch failed')
    fail(1)
    disk.fail(ROOT, lost)
    await watch.settled()
    expect(watch.watched()).toEqual({ root: null, waitingAt: null, links: {} })
    // It is really gone by the next look.
    disk.remove(ROOT)
    await until('the wait for the root', () => watch.watched().waitingAt === REPO)
    expect(disk.open()).toEqual([REPO])
    expect(errors).toEqual([lost])

    disk.put(`${ROOT}\\demo\\issues\\01-a.md`, FILE)
    await watch.settled()
    expect(watch.state).toBe('watching')
  })

  it('the system refuses the watch of the root, or of the folder above a root that is gone: looked at again, and said', async () => {
    const disk = windowsDisk(TICKETS)
    const noRoot = coded('EPERM', `watch ${ROOT}`)
    const root = failing(disk.fs, 'watch', ROOT, noRoot)
    root.fail(1)
    const first = await start(disk, ROOT, [REPO, ROOT], { fs: root.fs, retryDelayMs: RETRY })
    expect(first.state).toBe('waiting')
    expect(first.errors).toEqual([noRoot])
    await until('the watch of the root', () => first.watch.state === 'watching')
    expect(disk.open()).toEqual([`${ROOT} (recursive)`])
    first.watch.close()

    const noWait = coded('EMFILE', `watch ${REPO}`)
    const above = failing(disk.fs, 'watch', REPO, noWait)
    const second = await start(disk, ROOT, [REPO, ROOT], { fs: above.fs, retryDelayMs: RETRY })
    above.fail(1)
    disk.remove(ROOT)
    await second.watch.settled()
    expect(second.errors).toEqual([noWait])
    expect(second.watch.watched()).toEqual({ root: null, waitingAt: null, links: {} })
    await until('the wait for the root', () => second.watch.watched().waitingAt === REPO)
    disk.put(`${ROOT}\\demo\\issues\\01-a.md`, FILE)
    await second.watch.settled()
    expect(second.watch.state).toBe('watching')
    expect(second.changes).toEqual([ROOT, ROOT])
  })

  it('a root that cannot be looked at for a moment after the start is not refused: said once, looked at again, watched', async () => {
    const disk = windowsDisk(TICKETS)
    let refuse = 0
    const links = {
      ...disk.links,
      isLink: async (path: string) => {
        if (path.toLowerCase() === ROOT.toLowerCase() && refuse-- > 0) throw coded('EPERM', `lstat ${path}`)
        return disk.links.isLink(path)
      },
    }
    const { watch, changes, errors } = await start(disk, ROOT, [REPO, ROOT], { links, retryDelayMs: RETRY })
    const lost = new Error('the watch failed')
    refuse = 2
    disk.fail(ROOT, lost)
    await watch.settled()
    expect(watch.state).toBe('waiting')
    expect(disk.open()).toEqual([])
    await until('the watch of the root', () => watch.state === 'watching')
    expect(errors.map(String)).toEqual([String(lost), `Error: ${ROOT} ${UNCHECKED}`])
    expect(changes).toEqual([ROOT, ROOT])
    expect(disk.open()).toEqual([`${ROOT} (recursive)`])
  })

  it('a root that becomes a link to a share while watched is refused for good, and said once', async () => {
    const disk = windowsDisk(TICKETS)
    const { watch, changes, errors } = await start(disk, ROOT, [REPO, ROOT], { retryDelayMs: RETRY })
    const before = disk.calls.length
    disk.remove(ROOT)
    disk.putQuietly(ROOT, linkTo(`${EVIL}\\scratch`))
    await watch.settled()
    expect(watch.state).toBe('refused')
    await pause(RETRY * 6)
    expect(watch.state).toBe('refused')
    expect(errors.map(String)).toEqual([`Error: ${ROOT} now leads off this machine: it is no longer watched`])
    expect(changes).toEqual([ROOT])
    expect(disk.open()).toEqual([])
    expect(disk.contacts).toEqual([])
    // Since it is a link, the link has been read and nothing else was asked.
    const since = disk.calls.slice(before)
    expect(since).toContain(`readlink ${ROOT}`)
    expect(since.filter((call) => !/^(lstat|readlink) /.test(call))).toEqual([])
  })

  it('close ends the looks: nothing is asked of the disk after it', async () => {
    const disk = windowsDisk({ [`${REPO}\\README.md`]: FILE, [ROOT]: linkTo(TARGET) })
    const { watch } = await start(disk, ROOT, [REPO, ROOT], { retryDelayMs: RETRY })
    expect(watch.state).toBe('waiting')
    watch.close()
    const before = disk.calls.length
    disk.putQuietly(`${TARGET}\\demo\\issues\\01-a.md`, FILE)
    await pause(RETRY * 6)
    expect(disk.calls.length).toBe(before)
    expect(disk.open()).toEqual([])
    expect(watch.state).toBe('closed')
  })

  it('a look that succeeds ends the wait for the next one: the root is not looked at once more', async () => {
    const disk = windowsDisk({ [`${REPO}\\README.md`]: FILE })
    const { fs, fail } = failing(disk.fs, 'realpath', ROOT, coded('EPERM', `realpath ${ROOT}`))
    const { watch, changes } = await start(disk, ROOT, [REPO, ROOT], { fs, retryDelayMs: 40 })
    expect(watch.watched().waitingAt).toBe(REPO)
    // Two events of the wait, so two looks in a row: the first fails, the second watches the root.
    fail(1)
    disk.put(ROOT, FOLDER)
    disk.put(ROOT, FOLDER)
    await watch.settled()
    expect(watch.state).toBe('watching')
    const before = disk.calls.length
    await pause(120)
    expect(disk.calls.length).toBe(before)
    expect(changes).toEqual([ROOT])
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

  it.each([
    ['the real path of what the link leads to is asked', 'realpath', `${ROOT}\\first\\issues`],
    ['what the link leads to is asked to be a folder', 'isFolder', 'C:\\other\\issues'],
  ] as const)('while %s leaves no watch of the link behind, and the look ends there', async (_what, call, path) => {
    // In the order the folders are listed: a link to a share, an Epic whose issues are a link to
    // a folder of this machine, and the Epic of every test with nothing special in it.
    const disk = windowsDisk({ [`${ROOT}\\away`]: linkTo(`${EVIL}\\x`), [`${ROOT}\\first\\issues`]: linkTo('C:\\other\\issues'), ...TICKETS, 'C:\\other\\issues\\01.md': FILE })
    const held = holding(disk.fs, call, path)
    const { watch, changes, errors } = made(disk, ROOT, [REPO, ROOT], { fs: held.fs })
    const started = watch.start()
    await held.asked
    watch.close()
    const atClose = disk.calls.length
    held.release()
    expect(await started).toBe('closed')
    await watch.settled()
    expect(disk.open()).toEqual([])
    expect(watch.watched().links).toEqual({})
    // No folder is listed after the close, and a look that was cut short says nothing of what it found.
    expect(disk.calls.slice(atClose).filter((asked) => asked.startsWith('readdir '))).toEqual([])
    expect(watch.skipped()).toEqual([])

    disk.put('C:\\other\\issues\\01.md', FILE)
    await watch.settled()
    expect(changes).toEqual([])
    expect(errors).toEqual([])
  })

  it('a root that is lost while the links are looked for ends that look too: the link gets its watch from the next one only', async () => {
    const disk = windowsDisk({ ...TICKETS, [`${ROOT}\\linked`]: linkTo('C:\\other\\epic'), 'C:\\other\\epic\\spec.md': FILE })
    const held = holding(disk.fs, 'isFolder', 'C:\\other\\epic')
    const { watch, changes } = made(disk, ROOT, [REPO, ROOT], { fs: held.fs })
    const started = watch.start()
    await held.asked
    disk.fail(ROOT, new Error('the watch failed'))
    held.release()
    await started
    await watch.settled()
    expect(watch.state).toBe('watching')
    expect(disk.calls.filter((call) => call === 'watch C:\\other\\epic (recursive)')).toHaveLength(1)
    expect(disk.open()).toEqual([`${ROOT} (recursive)`, 'C:\\other\\epic (recursive)'])
    expect(changes).toEqual([ROOT, ROOT])
  })

  it('while the links are looked for after the root was lost and is watched again: the root is not reported after the close', async () => {
    const disk = windowsDisk({ ...TICKETS, [`${ROOT}\\linked`]: linkTo('C:\\other\\epic'), 'C:\\other\\epic\\spec.md': FILE })
    // Asked at the start, and again when the root is looked at again.
    const held = holding(disk.fs, 'isFolder', 'C:\\other\\epic', 2)
    const { watch, changes } = await start(disk, ROOT, [REPO, ROOT], { fs: held.fs })
    disk.fail(ROOT, new Error('the watch failed'))
    await held.asked
    expect(changes).toEqual([ROOT])
    watch.close()
    held.release()
    await watch.settled()
    expect(changes).toEqual([ROOT])
    expect(disk.open()).toEqual([])
  })

  it('while the real path of the root is asked: no watch is made at all', async () => {
    const disk = windowsDisk(TICKETS)
    const held = holding(disk.fs, 'realpath', ROOT)
    const { watch, errors } = made(disk, ROOT, [REPO, ROOT], { fs: held.fs })
    const started = watch.start()
    await held.asked
    watch.close()
    held.release()
    expect(await started).toBe('closed')
    expect(disk.calls.filter((call) => call.startsWith('watch '))).toEqual([])
    expect(errors).toEqual([])
  })

  it('while the wait looks once more for a root that has come meanwhile: no watch of the root, and no error', async () => {
    const disk = windowsDisk({ [`${REPO}\\README.md`]: FILE })
    // The root is looked at twice: by the look, and by the wait once its watch is in place.
    const held = holding(disk.fs, 'kind', ROOT, 2)
    const { watch, errors } = made(disk, ROOT, [REPO, ROOT], { fs: held.fs })
    const started = watch.start()
    await held.asked
    expect(disk.open()).toEqual([REPO])
    disk.putQuietly(`${ROOT}\\demo\\issues\\01-a.md`, FILE)
    watch.close()
    held.release()
    expect(await started).toBe('closed')
    expect(disk.open()).toEqual([])
    expect(disk.calls.filter((call) => call.startsWith('watch '))).toEqual([`watch ${REPO}`])
    expect(errors).toEqual([])
  })

  it('while a call is awaited that then fails: nothing is said, and the root is not looked at again', async () => {
    const disk = windowsDisk(TICKETS)
    const bad = failing(disk.fs, 'realpath', ROOT, coded('EPERM', `realpath ${ROOT}`))
    bad.fail(1)
    const held = holding(bad.fs, 'realpath', ROOT)
    const { watch, errors } = made(disk, ROOT, [REPO, ROOT], { fs: held.fs, retryDelayMs: RETRY })
    const started = watch.start()
    await held.asked
    watch.close()
    held.release()
    expect(await started).toBe('closed')
    const before = disk.calls.length
    await pause(RETRY * 6)
    expect(disk.calls.length).toBe(before)
    expect(errors).toEqual([])
  })

  it('while the links on the way to a root that has turned into a link to a share are read: it stays closed, and nothing is said', async () => {
    const disk = windowsDisk(TICKETS)
    let hold = false
    let reached = (): void => undefined
    let release = (): void => undefined
    const asked = new Promise<void>((done) => (reached = done))
    const gate = new Promise<void>((done) => (release = done))
    const links = {
      ...disk.links,
      readlink: async (path: string) => {
        if (hold) {
          reached()
          await gate
        }
        return disk.links.readlink(path)
      },
    }
    const { watch, errors } = await start(disk, ROOT, [REPO, ROOT], { links })
    hold = true
    disk.remove(ROOT)
    disk.putQuietly(ROOT, linkTo(`${EVIL}\\scratch`))
    await asked
    watch.close()
    release()
    await watch.settled()
    expect(watch.state).toBe('closed')
    expect(errors).toEqual([])
  })
})

// The review of PR #274, rounds one and two (worfy-windows ticket 33): the mutants that passed,
// and the retries that did not end or grow.
describe('an event that names a folder by its absolute path', () => {
  it('the folder the wait is at is removed: the wait moves up to the folder above', async () => {
    const disk = windowsDisk({ [`${REPO}\\.scratch\\notes.txt`]: FILE })
    const root = `${REPO}\\.scratch\\tickets`
    const { watch, state } = await start(disk, root, [REPO, root])
    expect(state).toBe('waiting')
    expect(watch.watched().waitingAt).toBe(`${REPO}\\.scratch`)
    // Windows names the removed folder itself, by its `\\?\` path; the next name on the way never comes.
    disk.remove(`${REPO}\\.scratch`)
    await watch.settled()
    expect(watch.watched()).toEqual({ root: null, waitingAt: REPO, links: {} })
    expect(disk.open()).toEqual([REPO])
  })

  it('what a local link leads to is removed: its watch is closed at the first such event, before any new look for links', async () => {
    const link = `${ROOT}\\linked`
    const disk = windowsDisk({ ...TICKETS, [link]: linkTo('C:\\other\\epic'), 'C:\\other\\epic\\spec.md': FILE })
    // No look for links comes in the time of the test: only the event may close the watch.
    const { watch, changes } = await start(disk, ROOT, [REPO, ROOT], { scanDelayMs: 60_000 })
    expect(disk.open()).toEqual([`${ROOT} (recursive)`, 'C:\\other\\epic (recursive)'])
    disk.remove('C:\\other\\epic')
    expect(watch.watched().links).toEqual({})
    expect(disk.open()).toEqual([`${ROOT} (recursive)`])
    // Once for the five events: the link is reported, the rest are not the watch's any more.
    expect(changes).toEqual([link])
  })
})

describe('the review of PR #274: close during the wait, and a root that comes while the wait is made', () => {
  it('close while the wait looks for the folder above the root: no wait is made after the close', async () => {
    const disk = windowsDisk({ [`${REPO}\\README.md`]: FILE })
    const held = holding(disk.fs, 'kind', REPO)
    const { watch } = made(disk, ROOT, [REPO, ROOT], { fs: held.fs })
    const started = watch.start()
    await held.asked
    watch.close()
    held.release()
    expect(await started).toBe('closed')
    await watch.settled()
    expect(disk.open()).toEqual([])
    expect(disk.calls.filter((call) => call.startsWith('watch '))).toEqual([])
  })

  it('a root that comes while the wait is made, and whose watch then fails every time: said once', async () => {
    const disk = windowsDisk({ [`${REPO}\\README.md`]: FILE })
    const refused = coded('EPERM', `watch ${ROOT}`)
    let first = true
    let rootWatches = 0
    const fs: WatchFs = {
      ...disk.fs,
      watch: (path, ...rest) => {
        if (path.toLowerCase() === ROOT.toLowerCase()) {
          rootWatches++
          throw refused
        }
        const handle = disk.fs.watch(path, ...rest)
        // The root comes right after the wait began, with no event: the wait finds it by its second look.
        if (first) disk.putQuietly(`${ROOT}\\demo\\spec.md`, FILE)
        first = false
        return handle
      },
    }
    const { watch, errors } = await start(disk, ROOT, [REPO, ROOT], { fs, retryDelayMs: RETRY })
    await until('three more looks', () => rootWatches >= 4)
    expect(watch.state).toBe('waiting')
    expect(errors).toEqual([refused])
  })
})

describe('a look that fails again and again', () => {
  const TARGET = 'C:\\other\\scratch'

  it('after RETRY_SLOW_AFTER failures in a row the time between two looks grows to SLOW_RETRY_DELAY_MS', async () => {
    expect([RETRY_SLOW_AFTER, SLOW_RETRY_DELAY_MS]).toEqual([5, 30_000])
    vi.useFakeTimers()
    try {
      const disk = windowsDisk({ [`${REPO}\\README.md`]: FILE, [ROOT]: linkTo(TARGET) })
      const { watch, errors } = await start(disk)
      const looks = (): number => disk.calls.filter((call) => call === `realpath ${ROOT}`).length
      expect(looks()).toBe(1)
      await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS * (RETRY_SLOW_AFTER - 1))
      expect(looks()).toBe(RETRY_SLOW_AFTER)
      await vi.advanceTimersByTimeAsync(SLOW_RETRY_DELAY_MS - 1)
      expect(looks()).toBe(RETRY_SLOW_AFTER)
      await vi.advanceTimersByTimeAsync(1)
      expect(looks()).toBe(RETRY_SLOW_AFTER + 1)
      // One line for the whole run.
      expect(errors).toHaveLength(1)

      // The folder comes: watched at the next look, and a later failure starts from the short time again.
      disk.putQuietly(`${TARGET}\\demo\\spec.md`, FILE)
      await vi.advanceTimersByTimeAsync(SLOW_RETRY_DELAY_MS)
      expect(watch.state).toBe('watching')
      disk.remove(TARGET)
      await vi.advanceTimersByTimeAsync(0)
      const after = looks()
      await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS)
      expect(looks()).toBe(after + 1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('a look for links that throws every time, after the root watch is made, is said once', async () => {
    const disk = windowsDisk(TICKETS)
    const bug = new Error('the rule of the caller threw')
    const { watch, errors } = await start(disk, ROOT, [REPO, ROOT], {
      retryDelayMs: RETRY,
      enter: () => {
        throw bug
      },
    })
    expect(watch.state).toBe('waiting')
    await until('three more looks', () => disk.calls.filter((call) => call === `watch ${ROOT} (recursive)`).length >= 4)
    expect(errors).toEqual([bug])
  })

  it(`a root watch that fails right after it is made, every time: made again at once ${ROOT_ERRORS_BEFORE_PAUSE} times, then after the pauses of a failed look; a bounded log, and the root reported after a pause only when something changed`, async () => {
    expect(ROOT_ERRORS_BEFORE_PAUSE).toBe(3)
    vi.useFakeTimers()
    try {
      const disk = windowsDisk(TICKETS)
      const broken = erring(disk, () => 'error')
      const { watch, errors, changes } = await start(disk, ROOT, [REPO, ROOT], { fs: broken.fs })
      const watches = (): number => disk.calls.filter((call) => call === `watch ${ROOT} (recursive)`).length
      await vi.advanceTimersByTimeAsync(10)
      expect(watches()).toBe(1 + ROOT_ERRORS_BEFORE_PAUSE)
      expect(errors.map(String)).toEqual([...Array<string>(ROOT_ERRORS_BEFORE_PAUSE).fill(String(broken.failure)), `Error: the watch of ${ROOT} fails each time it is made: it is made again after a pause, and not said again until it works`])
      // Up to the pause: once when each watch failed, once when the next was in place.
      expect(changes).toHaveLength(2 * ROOT_ERRORS_BEFORE_PAUSE)
      // Four pauses of a failed look, then the long one: nothing changed, nothing is reported.
      await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS * (RETRY_SLOW_AFTER - 1))
      expect(watches()).toBe(ROOT_ERRORS_BEFORE_PAUSE + RETRY_SLOW_AFTER)
      // (The first 10 ms above are part of the long pause too.)
      await vi.advanceTimersByTimeAsync(SLOW_RETRY_DELAY_MS - 20)
      expect(watches()).toBe(ROOT_ERRORS_BEFORE_PAUSE + RETRY_SLOW_AFTER)
      expect(changes).toHaveLength(2 * ROOT_ERRORS_BEFORE_PAUSE)
      // A Ticket written while no watch is in place: the next watch reports the root, once.
      disk.putQuietly(`${ROOT}\\demo\\issues\\02-b.md`, FILE)
      await vi.advanceTimersByTimeAsync(20)
      expect(watches()).toBe(ROOT_ERRORS_BEFORE_PAUSE + RETRY_SLOW_AFTER + 1)
      expect(changes).toHaveLength(2 * ROOT_ERRORS_BEFORE_PAUSE + 1)
      await vi.advanceTimersByTimeAsync(SLOW_RETRY_DELAY_MS * 2)
      expect(changes).toHaveLength(2 * ROOT_ERRORS_BEFORE_PAUSE + 1)
      expect(errors).toHaveLength(ROOT_ERRORS_BEFORE_PAUSE + 1)
      expect(watch.state).toBe('waiting')
    } finally {
      vi.useRealTimers()
    }
  })

  it('errors of the root watch far apart, each after the watch lived the time between two looks: each is said, and the watch is made again at once', async () => {
    vi.useFakeTimers()
    try {
      const disk = windowsDisk(TICKETS)
      const { watch, errors } = await start(disk)
      const failure = new Error('EPERM: operation not permitted, watch')
      for (let times = 0; times < ROOT_ERRORS_BEFORE_PAUSE + 2; times++) {
        await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS)
        disk.fail(ROOT, failure)
        await vi.advanceTimersByTimeAsync(0)
        expect(watch.state).toBe('watching')
      }
      expect(errors).toEqual(Array<Error>(ROOT_ERRORS_BEFORE_PAUSE + 2).fill(failure))
    } finally {
      vi.useRealTimers()
    }
  })

  it('an event that says the root went is no sign that the watch works: watches that fail and watches that see the root go, in turns, reach the pause', async () => {
    vi.useFakeTimers()
    try {
      const disk = windowsDisk(TICKETS)
      let made = 0
      const broken = erring(disk, () => (++made % 2 === 1 ? 'error' : 'gone'))
      const { errors } = await start(disk, ROOT, [REPO, ROOT], { fs: broken.fs })
      await vi.advanceTimersByTimeAsync(10)
      expect(errors.map(String)).toEqual([...Array<string>(ROOT_ERRORS_BEFORE_PAUSE).fill(String(broken.failure)), `Error: the watch of ${ROOT} fails each time it is made: it is made again after a pause, and not said again until it works`])
      await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS * 3)
      expect(errors).toHaveLength(ROOT_ERRORS_BEFORE_PAUSE + 1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('a change the root watch reports ends the run of errors: the next error is said, and the watch made again at once', async () => {
    vi.useFakeTimers()
    try {
      const disk = windowsDisk(TICKETS)
      let left = ROOT_ERRORS_BEFORE_PAUSE
      const broken = erring(disk, () => (left-- > 0 ? 'error' : 'quiet'))
      const { watch, errors } = await start(disk, ROOT, [REPO, ROOT], { fs: broken.fs })
      await vi.advanceTimersByTimeAsync(10)
      expect(errors).toEqual(Array<Error>(ROOT_ERRORS_BEFORE_PAUSE).fill(broken.failure))
      expect(watch.state).toBe('watching')
      // The watch in place reports a Ticket, well within the time between two looks.
      disk.put(`${ROOT}\\demo\\issues\\02-b.md`, FILE)
      disk.fail(ROOT, broken.failure)
      await vi.advanceTimersByTimeAsync(10)
      expect(errors).toEqual(Array<Error>(ROOT_ERRORS_BEFORE_PAUSE + 1).fill(broken.failure))
      expect(watch.state).toBe('watching')
    } finally {
      vi.useRealTimers()
    }
  })

  it('a proper wait for a root that went ends the run of errors: an error of the watch of the root made again is said', async () => {
    vi.useFakeTimers()
    try {
      const disk = windowsDisk(TICKETS)
      let left = ROOT_ERRORS_BEFORE_PAUSE
      const broken = erring(disk, () => (left-- > 0 ? 'error' : 'quiet'))
      const { watch, errors } = await start(disk, ROOT, [REPO, ROOT], { fs: broken.fs })
      await vi.advanceTimersByTimeAsync(10)
      expect(errors).toHaveLength(ROOT_ERRORS_BEFORE_PAUSE)
      disk.remove(ROOT)
      await vi.advanceTimersByTimeAsync(10)
      expect(watch.watched().waitingAt).toBe(REPO)
      left = 1
      disk.put(`${ROOT}\\demo\\issues\\01-a.md`, FILE)
      await vi.advanceTimersByTimeAsync(10)
      expect(errors).toEqual(Array<Error>(ROOT_ERRORS_BEFORE_PAUSE + 1).fill(broken.failure))
      expect(watch.state).toBe('watching')
    } finally {
      vi.useRealTimers()
    }
  })

  it('in the pause no watch is left open: neither of the root nor of a link', async () => {
    vi.useFakeTimers()
    try {
      const disk = windowsDisk({ ...TICKETS, [`${ROOT}\\linked`]: linkTo('C:\\other\\epic'), 'C:\\other\\epic\\spec.md': FILE })
      const broken = erring(disk, () => 'error')
      const { watch } = await start(disk, ROOT, [REPO, ROOT], { fs: broken.fs })
      await vi.advanceTimersByTimeAsync(10)
      expect(watch.state).toBe('waiting')
      expect(watch.watched()).toEqual({ root: null, waitingAt: null, links: {} })
      expect(disk.open()).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })

  it('an edit behind a local link while no watch is in place — of a file it leads to, or of a file in a folder it leads to — is reported by the next watch', async () => {
    vi.useFakeTimers()
    try {
      const disk = windowsDisk({
        ...TICKETS,
        [`${ROOT}\\linked`]: linkTo('C:\\other\\epic'),
        'C:\\other\\epic\\spec.md': FILE,
        [`${ROOT}\\demo\\issues\\02-b.md`]: linkTo('C:\\other\\02-b.md'),
        'C:\\other\\02-b.md': FILE,
      })
      const broken = erring(disk, () => 'error')
      const { changes } = await start(disk, ROOT, [REPO, ROOT], { fs: broken.fs })
      // Past the four short pauses: the long one has begun, and nothing changed.
      await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS * RETRY_SLOW_AFTER)
      const quiet = changes.length
      await vi.advanceTimersByTimeAsync(SLOW_RETRY_DELAY_MS)
      expect(changes).toHaveLength(quiet)
      // The file a link leads to: its own stamp changes, the link's does not.
      disk.putQuietly('C:\\other\\02-b.md', FILE)
      await vi.advanceTimersByTimeAsync(SLOW_RETRY_DELAY_MS)
      expect(changes).toHaveLength(quiet + 1)
      // A file in the folder a link leads to.
      disk.putQuietly('C:\\other\\epic\\spec.md', FILE)
      await vi.advanceTimersByTimeAsync(SLOW_RETRY_DELAY_MS)
      expect(changes).toHaveLength(quiet + 2)
      await vi.advanceTimersByTimeAsync(SLOW_RETRY_DELAY_MS)
      expect(changes).toHaveLength(quiet + 2)
      expect(disk.contacts).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })

  it('a link to a share is not stamped through: only lstat and readlink name it', async () => {
    vi.useFakeTimers()
    try {
      const link = `${ROOT}\\away`
      const disk = windowsDisk({ ...TICKETS, [link]: linkTo(`${EVIL}\\epic`) })
      const broken = erring(disk, () => 'error')
      await start(disk, ROOT, [REPO, ROOT], { fs: broken.fs })
      await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS * RETRY_SLOW_AFTER + SLOW_RETRY_DELAY_MS)
      expect(disk.calls).toContain(`stamp ${link}`)
      expect(disk.contacts).toEqual([])
      // The stamp of the link itself is an lstat of the link: it does not follow it.
      expect(through(disk, link).filter((call) => !call.startsWith('stamp '))).toEqual([])
      // Nor is what it leads to stamped: the model would not count a call made right on the share.
      expect(disk.calls.filter((call) => call.toLowerCase().includes(EVIL.toLowerCase()))).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })

  it('close while the stamps are taken: the root is not reported after the close, and no watch is made', async () => {
    const disk = windowsDisk(TICKETS)
    let made = 0
    const broken = erring(disk, () => (++made === 1 ? 'error' : 'quiet'))
    let release = (): void => undefined
    let reached = (): void => undefined
    const gate = new Promise<void>((done) => (release = done))
    const asked = new Promise<void>((done) => (reached = done))
    let armed = true
    const fs: WatchFs = {
      ...broken.fs,
      stamp: async (path) => {
        if (armed) {
          armed = false
          reached()
          await gate
        }
        return disk.fs.stamp(path)
      },
    }
    const { watch, changes, errors } = await start(disk, ROOT, [REPO, ROOT], { fs })
    // The first watch fails; the next one, in place, takes the stamps.
    await asked
    expect(changes).toEqual([ROOT])
    const watches = disk.calls.filter((call) => call.startsWith('watch ')).length
    watch.close()
    release()
    await watch.settled()
    await pause(20)
    expect(changes).toEqual([ROOT])
    expect(errors).toEqual([broken.failure])
    expect(disk.calls.filter((call) => call.startsWith('watch '))).toHaveLength(watches)
    expect(disk.open()).toEqual([])
  })

  it('a proper wait ends a run of failed looks too: a failure after it waits the short time again', async () => {
    const TARGET = 'C:\\other\\scratch'
    vi.useFakeTimers()
    try {
      const disk = windowsDisk({ [`${REPO}\\README.md`]: FILE, [ROOT]: linkTo(TARGET) })
      await start(disk)
      const looks = (): number => disk.calls.filter((call) => call === `realpath ${ROOT}`).length
      await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS * (RETRY_SLOW_AFTER - 1))
      expect(looks()).toBe(RETRY_SLOW_AFTER)
      // The link goes: the next look, after the long time, waits properly at the folder above.
      disk.remove(ROOT)
      await vi.advanceTimersByTimeAsync(SLOW_RETRY_DELAY_MS)
      expect(disk.open()).toEqual([REPO])
      // It comes back, leading nowhere: the look fails, and the next one is the short time away.
      disk.put(ROOT, linkTo(TARGET))
      await vi.advanceTimersByTimeAsync(0)
      const after = looks()
      expect(after).toBe(RETRY_SLOW_AFTER + 1)
      await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS)
      expect(looks()).toBe(after + 1)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('the links of a root on a mapped network drive', () => {
  it('a link is read with the real path of the root among the allowed folders: a link that stays on the machine gets its watch', async () => {
    // Z: is a share of the user mapped to a letter; realpath answers it by its UNC path. The model
    // has no mapped drives: the same folder is put at both paths, and realpath is told the mapping.
    const root = 'Z:\\worfy\\demo\\cards'
    const real = '\\\\nas\\work\\worfy\\demo\\cards'
    const disk = windowsDisk({
      [`${root}\\c1\\index.html`]: FILE,
      [`${real}\\c1\\index.html`]: FILE,
      [`${real}\\linked`]: linkTo('C:\\elsewhere\\card'),
      'C:\\elsewhere\\card\\index.html': FILE,
    })
    const fs: WatchFs = {
      ...disk.fs,
      realpath: async (path) => {
        if (path.toLowerCase() !== root.toLowerCase()) return disk.fs.realpath(path)
        disk.calls.push(`realpath ${path}`)
        return real
      },
    }
    const { watch, state } = await start(disk, root, [root], { fs, enter: () => true, wanted: () => true })
    expect(state).toBe('watching')
    expect(watch.skipped()).toEqual([])
    expect(watch.watched()).toEqual({ root: real, waitingAt: null, links: { [`${root}\\linked`]: 'C:\\elsewhere\\card' } })
    expect(disk.contacts).toEqual([])
  })
})
