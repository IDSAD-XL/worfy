// The watch of a Tickets root on Windows (worfy-windows ticket 20): ticketsWatch of
// src/main/workflow/watch.ts over the model of a Windows disk (test/unit/windows-disk.ts), with
// path.win32, on any system. A link to `\\evil\share\…` stands at each level in turn; the model
// marks every call Windows would answer by contacting the host.
import { posix, win32 } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { LinkSafeWatch } from '../../src/main/link-safe-watch'
import { ticketsIgnored, ticketsWatch } from '../../src/main/workflow/watch'
import { FILE, linkTo, windowsDisk, type DiskEntry, type WindowsDisk } from './windows-disk'

const REPO = 'C:\\p\\repo'
const ROOT = `${REPO}\\.scratch`
const EVIL = '\\\\evil\\share'

const TICKETS: Record<string, DiskEntry> = {
  [`${ROOT}\\demo\\spec.md`]: FILE,
  [`${ROOT}\\demo\\map.md`]: FILE,
  [`${ROOT}\\demo\\issues\\01-a.md`]: FILE,
  [`${ROOT}\\demo\\evidence\\shot.png`]: FILE,
  [`${ROOT}\\notes.txt`]: FILE,
}

const open: LinkSafeWatch[] = []
afterEach(() => {
  for (const watch of open.splice(0)) watch.close()
})

async function start(disk: WindowsDisk): Promise<{ watch: LinkSafeWatch; changes: { count: number }; errors: unknown[] }> {
  const changes = { count: 0 }
  const errors: unknown[] = []
  const watch = ticketsWatch({
    ticketsRoot: ROOT,
    allowed: [REPO],
    onChange: () => {
      changes.count += 1
    },
    onError: (error) => errors.push(error),
    paths: win32,
    links: disk.links,
    fs: disk.fs,
    scanDelayMs: 0,
  })
  open.push(watch)
  await watch.start()
  return { watch, changes, errors }
}

/** The calls that name a path through the link, other than lstat and readlink of the link itself. */
const through = (disk: WindowsDisk, link: string): string[] =>
  disk.calls.filter((call) => {
    const path = call.replace(/^\S+ /, '').replace(/ \(recursive\)$/, '').toLowerCase()
    if (path === link.toLowerCase()) return !/^(lstat|readlink) /.test(call)
    return path.startsWith(`${link.toLowerCase()}\\`)
  })

describe('the watch of a Tickets root, by the rules of Windows', () => {
  it('watches the root with one handle, lists only the root, the Epic folders and their issues, and reports what epic-status reads', async () => {
    const disk = windowsDisk(TICKETS)
    const { watch, changes } = await start(disk)
    expect(watch.state).toBe('watching')
    expect(disk.open()).toEqual([`${ROOT} (recursive)`])
    expect(disk.calls.filter((call) => call.startsWith('readdir ')).sort()).toEqual([`readdir ${ROOT}`, `readdir ${ROOT}\\demo`, `readdir ${ROOT}\\demo\\issues`])

    disk.put(`${ROOT}\\demo\\evidence\\more.png`, FILE)
    disk.put(`${ROOT}\\demo\\issues\\notes.txt`, FILE)
    disk.put(`${ROOT}\\demo\\issues\\deep\\03-c.md`, FILE)
    await watch.settled()
    expect(changes.count).toBe(0)

    disk.put(`${ROOT}\\demo\\issues\\02-b.md`, FILE)
    disk.put(`${ROOT}\\demo\\Spec.md`, FILE)
    disk.put(`${ROOT}\\next\\ISSUES\\01-a.md`, FILE)
    await watch.settled()
    // The new Ticket, the spec, and the new Epic: its folder, its issues folder, its Ticket.
    expect(changes.count).toBe(5)
  })

  it.each([
    ['the Tickets root itself', ROOT],
    ['an Epic folder', `${ROOT}\\away`],
    ['the issues folder of an Epic', `${ROOT}\\other\\issues`],
    ['a Ticket file', `${ROOT}\\demo\\issues\\09-away.md`],
    ['the spec of an Epic', `${ROOT}\\other\\spec.md`],
    ['the map of an Epic', `${ROOT}\\other\\map.md`],
  ])('a link to a share in place of %s: no realpath, stat, readdir or watch names a path through it', async (_what, link) => {
    const base: Record<string, DiskEntry> = link === ROOT ? { [`${REPO}\\README.md`]: FILE } : { ...TICKETS, [`${ROOT}\\other\\notes.txt`]: FILE }
    const disk = windowsDisk({ ...base, [link]: linkTo(`${EVIL}\\x`) })
    const { watch, changes, errors } = await start(disk)
    if (link !== ROOT) {
      disk.put(`${ROOT}\\demo\\issues\\02-b.md`, FILE)
      await watch.settled()
      // A new Ticket in the same Tickets root still reaches the canvas.
      expect(changes.count).toBe(1)
      expect(watch.skipped()).toEqual([link])
    }
    expect(watch.state).toBe(link === ROOT ? 'refused' : 'watching')
    expect(disk.contacts).toEqual([])
    expect(through(disk, link)).toEqual([])
    expect(disk.calls).toContain(`readlink ${link}`)
    expect(errors).toEqual([])
  })

  it.each([
    ['cannot be read', (disk: WindowsDisk, link: string) => disk.breakLink(link)],
    ['cannot be looked at', (disk: WindowsDisk, link: string) => disk.deny(link)],
  ])('a link that %s is left alone as well', async (_what, spoil) => {
    const link = `${ROOT}\\away`
    const disk = windowsDisk({ ...TICKETS, [link]: linkTo('C:\\other\\epic'), 'C:\\other\\epic\\issues\\01-a.md': FILE })
    spoil(disk, link)
    const { watch } = await start(disk)
    expect(watch.skipped()).toEqual([link])
    expect(through(disk, link)).toEqual([])
    expect(disk.open()).toEqual([`${ROOT} (recursive)`])
  })

  it('a link to a folder of this machine in place of an Epic folder, and to a file in place of a Ticket: a change behind each is reported', async () => {
    const epic = `${ROOT}\\linked`
    const ticket = `${ROOT}\\demo\\issues\\07-linked.md`
    const disk = windowsDisk({ ...TICKETS, [epic]: linkTo('C:\\other\\epic'), 'C:\\other\\epic\\issues\\01-a.md': FILE, [ticket]: linkTo('C:\\notes\\seven.md'), 'C:\\notes\\seven.md': FILE })
    const { watch, changes } = await start(disk)
    expect(watch.watched().links).toEqual({ [epic]: 'C:\\other\\epic', [ticket]: 'C:\\notes\\seven.md' })
    disk.put('C:\\other\\epic\\issues\\02-b.md', FILE)
    disk.put('C:\\notes\\seven.md', FILE)
    disk.put('C:\\other\\epic\\evidence\\shot.png', FILE)
    await watch.settled()
    expect(changes.count).toBe(2)
  })

  it('a Tickets root on a share of its own — the Workflow folder of a Project in Silent mode — is watched, though the Project root is elsewhere', async () => {
    const root = '\\\\nas\\workflows\\demo\\tickets'
    const disk = windowsDisk({ [`${root}\\demo\\issues\\01-a.md`]: FILE })
    let changes = 0
    const watch = ticketsWatch({ ticketsRoot: root, allowed: [REPO], onChange: () => void changes++, onError: () => undefined, paths: win32, links: disk.links, fs: disk.fs, scanDelayMs: 0 })
    open.push(watch)
    expect(await watch.start()).toBe('watching')
    disk.put(`${root}\\demo\\issues\\02-b.md`, FILE)
    await watch.settled()
    expect(changes).toBe(1)
    expect(disk.contacts).toEqual([])
  })

  it('a link where epic-status reads nothing — among the evidence, or right under the root next to a file — is never read', async () => {
    const disk = windowsDisk({ ...TICKETS, [`${ROOT}\\demo\\evidence\\modules`]: linkTo(`${EVIL}\\modules`) })
    const { watch } = await start(disk)
    expect(watch.skipped()).toEqual([])
    expect(disk.calls.some((call) => call.includes('evidence'))).toBe(false)
    expect(disk.contacts).toEqual([])
  })
})

describe('ticketsIgnored with the path rules given', () => {
  it('reads a Windows path by the rules of Windows on any system, and a POSIX one by its own', () => {
    const windows = ticketsIgnored(ROOT, win32)
    expect([ROOT, `${ROOT}\\demo`, `${ROOT}\\demo\\issues`, `${ROOT}\\demo\\issues\\01-a.md`, `${ROOT}\\demo\\spec.md`, REPO, 'D:\\elsewhere'].map((path) => windows(path))).toEqual([false, false, false, false, false, false, false])
    expect([`${ROOT}\\demo\\evidence`, `${ROOT}\\demo\\issues\\notes.txt`, `${ROOT}\\demo\\issues\\deep\\01-a.md`].map((path) => windows(path))).toEqual([true, true, true])
    // Right under the root a file is skipped once the caller says it is one; a folder, or a path of unknown kind, is kept.
    expect(windows(`${ROOT}\\notes.txt`, { isFile: () => true })).toBe(true)
    expect(windows(`${ROOT}\\demo`, { isFile: () => false })).toBe(false)
    expect(windows(`${ROOT}\\notes.txt`)).toBe(false)
    expect(windows(`${ROOT}\\demo\\spec.md`, { isFile: () => true })).toBe(false)
    expect(windows(REPO, { isFile: () => true })).toBe(false)
    const unix = ticketsIgnored('/p/repo/.scratch', posix)
    expect(['/p/repo/.scratch/demo/issues/01-a.md', '/p/repo/.scratch/demo/logs', '/p/repo'].map((path) => unix(path))).toEqual([false, true, false])
  })
})
