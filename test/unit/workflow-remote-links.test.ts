// enrichSnapshot of src/main/workflow/reader.ts and a link that leads to a share (worfy-windows
// ticket 19). It reads `<epic>/spec.md` and the Tickets of `<epic>/issues/` under the Tickets root
// with readFile and readdir, which follow links; on Windows a link to `\\host\share\…` makes the
// system contact that host with the user's credentials. The path rules are path.win32 and the file
// system is replaced, so every case but the last runs on any machine.
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, posix, win32 } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { EpicStatusSnapshot } from '../../src/shared/workflow/types'
import { removeTestTree } from '../remove'

/** What Node itself was asked through node:fs/promises. */
const asked = vi.hoisted(() => ({ lstat: [] as string[], readdir: [] as string[], readFile: [] as string[] }))

vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof import('node:fs/promises')>()
  const watched =
    <Name extends keyof typeof asked>(name: Name) =>
    (...args: unknown[]): unknown => {
      asked[name].push(String(args[0]))
      return (actual[name] as (...all: unknown[]) => unknown)(...args)
    }
  return { ...actual, lstat: watched('lstat'), readdir: watched('readdir'), readFile: watched('readFile') }
})

const { enrichSnapshot } = await import('../../src/main/workflow/reader')

afterEach(() => {
  for (const list of Object.values(asked)) list.length = 0
})

const ROOT = 'C:\\p\\repo'
const SCRATCH = 'C:\\p\\repo\\.scratch'
const ticketText = (file: string): string => ['# Ticket', '', '## Где в коде', '', '- `' + file + '`', ''].join('\n')

const ticket = (epic: string, num: number, slug: string): EpicStatusSnapshot['tickets'][number] => ({
  epic,
  num,
  slug,
  title: slug,
  statusRaw: 'open',
  state: 'open',
  blockedRaw: null,
  blockedNums: [],
  blockedParsed: true,
})

const SNAPSHOT: EpicStatusSnapshot = {
  ref: 'HEAD',
  epics: [
    { epic: 'alpha', hasSpec: true, hasMap: false },
    { epic: 'beta', hasSpec: true, hasMap: false },
  ],
  tickets: [ticket('alpha', 1, 'first'), ticket('alpha', 2, 'second'), ticket('beta', 1, 'only')],
}

/** The Tickets of two Epics under `scratch`, by the rules of `sep`. */
const filesUnder = (scratch: string, sep: string): Record<string, string> => ({
  [[scratch, 'alpha', 'spec.md'].join(sep)]: '# Alpha epic\n',
  [[scratch, 'alpha', 'issues', '01-first.md'].join(sep)]: ticketText('src/a.ts'),
  [[scratch, 'alpha', 'issues', '02-second.md'].join(sep)]: ticketText('src/b.ts'),
  [[scratch, 'beta', 'spec.md'].join(sep)]: '# Beta epic\n',
  [[scratch, 'beta', 'issues', '01-only.md'].join(sep)]: ticketText('src/c.ts'),
})

/**
 * A file system under the given rules: `fs` is what the reader asks for the Tickets, `links` what
 * the walk reads. `calls` records every call in order.
 */
function fakeSystem(files: Record<string, string>, linked: Record<string, string> = {}, rules: typeof win32 = win32, denied: readonly string[] = []) {
  const calls: string[] = []
  const key = (path: string): string => (rules === win32 ? path.toLowerCase() : path)
  const texts = new Map(Object.entries(files).map(([path, text]) => [key(path), text]))
  const links = new Map(Object.entries(linked).map(([path, target]) => [key(path), target]))
  return {
    calls,
    options: {
      paths: rules,
      fs: {
        readText: async (path: string): Promise<string | null> => {
          calls.push('readFile ' + path)
          return texts.get(key(path)) ?? null
        },
        readdir: async (dir: string): Promise<string[]> => {
          calls.push('readdir ' + dir)
          const inside = Object.keys(files).filter((file) => key(file).startsWith(key(dir) + rules.sep))
          if (inside.length === 0) throw Object.assign(new Error('ENOENT: ' + dir), { code: 'ENOENT' })
          return [...new Set(inside.map((file) => file.slice(dir.length + 1).split(rules.sep)[0]!))]
        },
      },
      links: {
        isLink: async (path: string): Promise<boolean | null> => {
          calls.push('lstat ' + path)
          if (denied.some((each) => key(each) === key(path))) throw Object.assign(new Error('EACCES: ' + path), { code: 'EACCES' })
          return links.has(key(path))
        },
        readlink: async (path: string): Promise<string> => {
          calls.push('readlink ' + path)
          return links.get(key(path))!
        },
      },
    },
  }
}

// Review round 2 of PR #233, done in worfy-windows ticket 20: the real path of the Project root
// is one of the places the paths may go, as it is for HANDOFF and the ADRs.
describe('enrichSnapshot and a Project root that is itself a link to a share of the user', () => {
  const LINKED = 'C:\\p\\link'
  const REAL = '\\\\fileserver\\proj\\repo'
  const system = (extra: Record<string, string> = {}) => fakeSystem(filesUnder(LINKED + '\\.scratch', '\\'), { [LINKED]: REAL, ...extra })

  it('reads the titles and the files when the file system names the real path of the root', async () => {
    const fake = system()
    const asked: string[] = []
    const fs = { ...fake.options.fs, realpath: async (path: string): Promise<string> => (asked.push(path), REAL) }
    const model = await enrichSnapshot(LINKED, SNAPSHOT, LINKED + '\\.scratch', { ...fake.options, fs })
    expect(asked).toEqual([LINKED])
    expect(model.epics.map((epic) => epic.title)).toEqual(['Alpha epic', 'Beta epic'])
    expect(model.tickets.map((each) => each.files)).toEqual([['src/a.ts'], ['src/b.ts'], ['src/c.ts']])
  })

  it('still reads nothing behind a link from the Tickets to another share', async () => {
    const fake = system({ [REAL + '\\.scratch\\alpha']: '\\\\evil\\share\\alpha' })
    const fs = { ...fake.options.fs, realpath: async (): Promise<string> => REAL }
    const model = await enrichSnapshot(LINKED, SNAPSHOT, LINKED + '\\.scratch', { ...fake.options, fs })
    expect(model.epics.map((epic) => epic.title)).toEqual([null, 'Beta epic'])
    expect(model.tickets.map((each) => each.files)).toEqual([[], [], ['src/c.ts']])
    expect(fake.calls.filter((call) => /^(readFile|readdir) /.test(call) && call.includes('\\alpha'))).toEqual([])
  })

  it('reads nothing when the real path of the root cannot be told, or the stand-in has none: the root is then a link to a share like any other', async () => {
    for (const realpath of [undefined, async (): Promise<string> => Promise.reject(new Error('EACCES'))]) {
      const fake = system()
      const fs = realpath === undefined ? fake.options.fs : { ...fake.options.fs, realpath }
      const model = await enrichSnapshot(LINKED, SNAPSHOT, LINKED + '\\.scratch', { ...fake.options, fs })
      expect(model.epics.map((epic) => epic.title)).toEqual([null, null])
      expect(fake.calls.filter((call) => /^(readFile|readdir) /.test(call))).toEqual([])
    }
  })
})

const followed = (calls: readonly string[]): string[] => calls.filter((call) => call.startsWith('readFile') || call.startsWith('readdir'))
const titles = (model: Awaited<ReturnType<typeof enrichSnapshot>>): (string | null)[] => model.epics.map((epic) => epic.title)
const filesOf = (model: Awaited<ReturnType<typeof enrichSnapshot>>): string[][] => model.tickets.map((each) => each.files)

describe('enrichSnapshot and a link that leads to a share (Windows rules)', () => {
  it('reads the titles of the Epics and the files of the Tickets as before, after looking at each path for a link', async () => {
    const system = fakeSystem(filesUnder(SCRATCH, '\\'))
    const model = await enrichSnapshot(ROOT, SNAPSHOT, SCRATCH, system.options)
    expect(titles(model)).toEqual(['Alpha epic', 'Beta epic'])
    expect(filesOf(model)).toEqual([['src/a.ts'], ['src/b.ts'], ['src/c.ts']])
    expect(model.tickets.every((each) => each.filesListed)).toBe(true)
    // Every folder on the way and the file itself were looked at before the read.
    const read = system.calls.indexOf('readFile C:\\p\\repo\\.scratch\\alpha\\spec.md')
    expect(system.calls.slice(0, read)).toEqual(expect.arrayContaining(['lstat C:\\p\\repo\\.scratch', 'lstat C:\\p\\repo\\.scratch\\alpha', 'lstat C:\\p\\repo\\.scratch\\alpha\\spec.md']))
    const listed = system.calls.indexOf('readdir C:\\p\\repo\\.scratch\\alpha\\issues')
    expect(system.calls.slice(0, listed)).toContain('lstat C:\\p\\repo\\.scratch\\alpha\\issues')
  })

  it('reads a spec.md that is a link to a share as one that cannot be read: no title, and the file is not read', async () => {
    const system = fakeSystem(filesUnder(SCRATCH, '\\'), { 'C:\\p\\repo\\.scratch\\alpha\\spec.md': '\\\\evil\\share\\spec.md' })
    const model = await enrichSnapshot(ROOT, SNAPSHOT, SCRATCH, system.options)
    expect(titles(model)).toEqual([null, 'Beta epic'])
    expect(filesOf(model)).toEqual([['src/a.ts'], ['src/b.ts'], ['src/c.ts']])
    expect(system.calls).not.toContain('readFile C:\\p\\repo\\.scratch\\alpha\\spec.md')
    expect(system.calls.some((call) => call.includes('evil'))).toBe(false)
  })

  it('reads a Ticket that is a link to a share as one that cannot be read, and the other Tickets as before', async () => {
    const system = fakeSystem(filesUnder(SCRATCH, '\\'), { 'C:\\p\\repo\\.scratch\\alpha\\issues\\01-first.md': '//evil/share/01-first.md' })
    const model = await enrichSnapshot(ROOT, SNAPSHOT, SCRATCH, system.options)
    expect(model.tickets[0]).toMatchObject({ files: [], filesListed: false })
    expect(filesOf(model).slice(1)).toEqual([['src/b.ts'], ['src/c.ts']])
    expect(titles(model)).toEqual(['Alpha epic', 'Beta epic'])
    expect(system.calls).not.toContain('readFile C:\\p\\repo\\.scratch\\alpha\\issues\\01-first.md')
  })

  it.each([
    ['the issues folder', 'C:\\p\\repo\\.scratch\\alpha\\issues', ['Alpha epic', 'Beta epic']],
    ['the folder of the Epic', 'C:\\p\\repo\\.scratch\\alpha', [null, 'Beta epic']],
  ])('lists and reads nothing behind %s that is a link to a share, and the other Epic as before', async (_case, link, expected) => {
    const system = fakeSystem(filesUnder(SCRATCH, '\\'), { [link]: '\\??\\GLOBALROOT\\Device\\Mup\\evil\\share\\x' })
    const model = await enrichSnapshot(ROOT, SNAPSHOT, SCRATCH, system.options)
    expect(titles(model)).toEqual(expected)
    expect(filesOf(model)).toEqual([[], [], ['src/c.ts']])
    expect(followed(system.calls).filter((call) => call.includes('\\alpha\\issues'))).toEqual([])
    expect(followed(system.calls)).toContain('readdir C:\\p\\repo\\.scratch\\beta\\issues')
  })

  it('reads nothing at all when the Tickets root itself is a link to a share', async () => {
    const system = fakeSystem(filesUnder(SCRATCH, '\\'), { [SCRATCH]: '\\\\evil\\share\\scratch' })
    const model = await enrichSnapshot(ROOT, SNAPSHOT, SCRATCH, system.options)
    expect(titles(model)).toEqual([null, null])
    expect(filesOf(model)).toEqual([[], [], []])
    expect(followed(system.calls)).toEqual([])
  })

  it('reads a path that cannot be checked as one that cannot be read', async () => {
    const system = fakeSystem(filesUnder(SCRATCH, '\\'), {}, win32, ['C:\\p\\repo\\.scratch\\alpha'])
    const model = await enrichSnapshot(ROOT, SNAPSHOT, SCRATCH, system.options)
    expect(titles(model)).toEqual([null, 'Beta epic'])
    expect(filesOf(model)).toEqual([[], [], ['src/c.ts']])
    expect(followed(system.calls).filter((call) => call.includes('\\alpha'))).toEqual([])
  })

  it('reads the Tickets of a Tickets root that is itself on a share: a Workflow folder there', async () => {
    const root = '\\\\nas\\team\\workflow'
    const system = fakeSystem(filesUnder(root, '\\'), { '\\\\nas\\team\\workflow\\beta\\spec.md': '\\\\nas\\team\\other\\spec.md' })
    const model = await enrichSnapshot(ROOT, SNAPSHOT, root, system.options)
    // A link into another folder of the same share is not the Tickets root's own.
    expect(titles(model)).toEqual(['Alpha epic', null])
    expect(filesOf(model)).toEqual([['src/a.ts'], ['src/b.ts'], ['src/c.ts']])
  })

  // Review round 1 of PR #233: with the Tickets root alone as the caller's own, a Project written
  // as a UNC path lost the links that stay in its own repository.
  it('reads a Ticket folder that is a link to another folder of the same Project on a share', async () => {
    const root = '\\\\nas\\team\\repo'
    const scratch = '\\\\nas\\team\\repo\\.scratch'
    const moved = Object.fromEntries(Object.entries(filesUnder(scratch, '\\')).map(([path, text]) => [path.replace('\\.scratch\\alpha\\', '\\docs\\alpha\\'), text]))
    const system = fakeSystem(moved, { '\\\\nas\\team\\repo\\.scratch\\alpha': '..\\docs\\alpha' })
    // The reader asks by the path as written; the fake answers for the folder the link names.
    const real = (path: string): string => path.replace('\\.scratch\\alpha', '\\docs\\alpha')
    const fs = { readText: (path: string) => system.options.fs.readText(real(path)), readdir: (dir: string) => system.options.fs.readdir(real(dir)) }
    const model = await enrichSnapshot(root, SNAPSHOT, scratch, { ...system.options, fs })
    expect(titles(model)).toEqual(['Alpha epic', 'Beta epic'])
    expect(filesOf(model)).toEqual([['src/a.ts'], ['src/b.ts'], ['src/c.ts']])
    // A link out of the Project, to another folder of the same share, is still not the Project's own.
    const out = fakeSystem(filesUnder(scratch, '\\'), { '\\\\nas\\team\\repo\\.scratch\\alpha': '\\\\nas\\team\\other\\alpha' })
    expect(titles(await enrichSnapshot(root, SNAPSHOT, scratch, out.options))).toEqual([null, 'Beta epic'])
  })

  it('given no links to read with, reads them with lstat of Node', async () => {
    // A folder that is on no machine: each walk ends at the folder it starts at, which is not there.
    // It starts at the Project root, the outer one of the two folders the paths may go.
    const root = 'C:\\worfy-no-such-folder-19\\repo'
    const scratch = 'C:\\worfy-no-such-folder-19\\repo\\.scratch'
    const system = fakeSystem(filesUnder(scratch, '\\'))
    const model = await enrichSnapshot(root, SNAPSHOT, scratch, { paths: win32, fs: system.options.fs })
    expect(titles(model)).toEqual(['Alpha epic', 'Beta epic'])
    expect(asked.lstat.length).toBeGreaterThan(0)
    expect(new Set(asked.lstat)).toEqual(new Set([root]))
    expect(asked.readFile).toEqual([])
    expect(asked.readdir).toEqual([])
  })

  it('under POSIX rules reads no link: the files are read and the folders listed as before', async () => {
    const system = fakeSystem(filesUnder('/p/repo/.scratch', '/'), { '/p/repo/.scratch/alpha': '//evil/share/alpha' }, posix as typeof win32)
    const model = await enrichSnapshot('/p/repo', SNAPSHOT, '/p/repo/.scratch', system.options)
    expect(titles(model)).toEqual(['Alpha epic', 'Beta epic'])
    expect(filesOf(model)).toEqual([['src/a.ts'], ['src/b.ts'], ['src/c.ts']])
    expect(system.calls.filter((call) => call.startsWith('lstat') || call.startsWith('readlink'))).toEqual([])
  })
})

// Real links, as a checked-out repository would have them. Only Windows makes a share of `\\host\…`.
describe.runIf(process.platform === 'win32')('the Tickets of a Project with real links to a share (Windows)', () => {
  let scratch: string | undefined

  afterEach(() => {
    if (scratch !== undefined) removeTestTree(scratch)
    scratch = undefined
  })

  it('reads and lists none of them through the link: readFile and readdir of Node are asked about no such path', async (context) => {
    scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-tickets-links-')))
    const tickets = join(scratch, '.scratch')
    mkdirSync(join(tickets, 'alpha', 'issues'), { recursive: true })
    mkdirSync(join(tickets, 'beta'), { recursive: true })
    writeFileSync(join(tickets, 'alpha', 'issues', '02-second.md'), ticketText('src/b.ts'))
    writeFileSync(join(tickets, 'beta', 'spec.md'), '# Beta epic\n')
    try {
      symlinkSync('\\\\worfy-no-such-host\\share\\spec.md', join(tickets, 'alpha', 'spec.md'), 'file')
      symlinkSync('\\\\worfy-no-such-host\\share\\01-first.md', join(tickets, 'alpha', 'issues', '01-first.md'), 'file')
      symlinkSync('\\\\worfy-no-such-host\\share\\issues', join(tickets, 'beta', 'issues'), 'dir')
    } catch (error) {
      // A user without Developer Mode may not create symlinks.
      context.skip('this user cannot create a symlink: ' + (error instanceof Error ? error.message : String(error)))
    }
    for (const list of Object.values(asked)) list.length = 0

    const model = await enrichSnapshot(scratch, SNAPSHOT)
    expect(titles(model)).toEqual([null, 'Beta epic'])
    expect(model.tickets.map((each) => [each.files, each.filesListed])).toEqual([
      [[], false],
      [['src/b.ts'], true],
      [[], false],
    ])
    expect(asked.readdir).toEqual([join(tickets, 'alpha', 'issues')])
    expect(new Set(asked.readFile)).toEqual(new Set([join(tickets, 'beta', 'spec.md'), join(tickets, 'alpha', 'issues', '02-second.md')]))
  })
})
