// A Card and a link that leads to a share (worfy-windows tickets 18 and 19): what resolveCardFile
// (src/main/cards/protocol.ts) and CardStore.info (src/main/cards/store.ts) ask of the file system
// when a link is on the way. Moved out of card-protocol.test.ts, which had grown past 1000 lines
// (worfy-windows ticket 20): the cases are the same, the head keeps what they use of it.
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, posix, win32 } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveCardFile } from '../../src/main/cards/protocol'
import { CardStore } from '../../src/main/cards/store'
import { removeTestTree } from '../remove'

/** What Node was asked through node:fs/promises: lstat reads a link, it does not follow it; stat and open do. */
const fsAsked = vi.hoisted(() => ({ lstat: [] as string[], stat: [] as string[], open: [] as string[] }))

vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof import('node:fs/promises')>()
  const watched =
    <Name extends 'lstat' | 'stat' | 'open'>(name: Name) =>
    (...args: unknown[]): unknown => {
      fsAsked[name].push(String(args[0]))
      return (actual[name] as (...all: unknown[]) => unknown)(...args)
    }
  return { ...actual, lstat: watched('lstat'), stat: watched('stat'), open: watched('open') }
})

// protocol.ts registers the scheme with Electron; resolveCardFile is called directly.
vi.mock('electron', () => ({
  app: { on: () => undefined },
  BrowserWindow: { getAllWindows: () => [] },
  protocol: {},
  session: {},
}))

const PROJECT = 'demo-0a1b2c3d'

let scratch: string
let dataDir: string
let store: CardStore

const cardDir = (id: string, project: string = PROJECT) => join(dataDir, project, 'cards', id)

/** A store over the temporary data folder; `projects` are the ids in the Project list. */
function makeStore(projects: readonly string[], watch: boolean): CardStore {
  return new CardStore({
    dataDirOf: (id) => {
      if (!projects.includes(id)) throw new Error(`No Project ${id}`)
      return join(dataDir, id)
    },
    projectIds: () => projects,
    watch,
    delayMs: 50,
  })
}

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-card-links-')))
  dataDir = join(scratch, 'data')
  mkdirSync(join(cardDir('c1'), 'js'), { recursive: true })
  writeFileSync(join(cardDir('c1'), 'index.html'), '<!doctype html><title>Clock</title><script src="js/app.js"></script>')
  writeFileSync(join(cardDir('c1'), 'js', 'app.js'), 'document.title = "tick"')
  writeFileSync(join(dataDir, PROJECT, 'layout.json'), '{"nodes":[]}')
  store = makeStore([PROJECT], false)
})

afterEach(async () => {
  await store.close()
  removeTestTree(scratch)
})

describe('resolveCardFile and a link that leads to a share', () => {
  const CARDS = 'C:\\data\\demo\\cards'

  /** `links` maps a link to its target as written; realpath answers with the path it was asked. */
  function fakeSystem(links: Record<string, string>, rules: typeof win32 = win32) {
    const asked: string[] = []
    const read: string[] = []
    const table = new Map(Object.entries(links).map(([path, target]) => [path.toLowerCase(), target]))
    return {
      asked,
      read,
      options: {
        paths: rules,
        links: {
          isLink: async (path: string): Promise<boolean | null> => {
            read.push(path)
            return table.has(path.toLowerCase())
          },
          readlink: async (path: string): Promise<string> => table.get(path.toLowerCase())!,
        },
        real: async (path: string): Promise<string> => {
          asked.push(path)
          return path
        },
        isFile: async (): Promise<boolean> => true,
      },
    }
  }

  it('serves a plain file of a Card: realpath is asked about the Cards folder, the Card and the file', async () => {
    const system = fakeSystem({})
    expect(await resolveCardFile(CARDS, 'c1', '/img/x.png', system.options)).toBe('C:\\data\\demo\\cards\\c1\\img\\x.png')
    expect(system.asked).toEqual([CARDS, 'C:\\data\\demo\\cards\\c1', 'C:\\data\\demo\\cards\\c1\\img\\x.png'])
    // Every folder on the way and the file were looked at for a link.
    expect(system.read).toEqual([CARDS, 'C:\\data\\demo\\cards\\c1', 'C:\\data\\demo\\cards\\c1\\img', 'C:\\data\\demo\\cards\\c1\\img\\x.png'])
  })

  it.each([
    ['a file of the Card', '/x.png', { 'C:\\data\\demo\\cards\\c1\\x.png': '\\\\evil\\share\\x.png' }],
    ['a folder inside the Card', '/img/x.png', { 'C:\\data\\demo\\cards\\c1\\img': '//evil/share/img' }],
    ['the folder of the Card', '/index.html', { 'C:\\data\\demo\\cards\\c1': '\\\\evil\\share\\card' }],
    ['the folder of all Cards', '/index.html', { 'C:\\data\\demo\\cards': '\\\\evil\\share\\cards' }],
    ['a local link whose target is a link to a share', '/x.png', { 'C:\\data\\demo\\cards\\c1\\x.png': 'C:\\data\\demo\\cards\\c1\\hop.png', 'C:\\data\\demo\\cards\\c1\\hop.png': '\\\\evil\\share\\x.png' }],
  ])('answers null when %s is a link to a share, and realpath is asked nothing', async (_case, pathname, links) => {
    const system = fakeSystem(links)
    expect(await resolveCardFile(CARDS, 'c1', pathname, system.options)).toBeNull()
    expect(system.asked).toEqual([])
    expect(system.read.some((path) => path.includes('evil'))).toBe(false)
  })

  it('serves a link that stays on the machine by the rules it had: realpath decides', async () => {
    const system = fakeSystem({ 'C:\\data\\demo\\cards\\c1\\alias.js': 'C:\\data\\demo\\cards\\c1\\js\\app.js' })
    expect(await resolveCardFile(CARDS, 'c1', '/alias.js', system.options)).toBe('C:\\data\\demo\\cards\\c1\\alias.js')
    expect(system.asked).toContain('C:\\data\\demo\\cards\\c1\\alias.js')
  })

  it('serves the Cards of a data folder that lies on a share itself, and nothing behind a link to another share', async () => {
    const shared = '\\\\nas\\profiles\\u\\worfy\\demo\\cards'
    const system = fakeSystem({ '\\\\nas\\profiles\\u\\worfy\\demo\\cards\\c1\\out.png': '\\\\nas\\other\\out.png' })
    expect(await resolveCardFile(shared, 'c1', '/x.png', system.options)).toBe('\\\\nas\\profiles\\u\\worfy\\demo\\cards\\c1\\x.png')
    system.asked.length = 0
    expect(await resolveCardFile(shared, 'c1', '/out.png', system.options)).toBeNull()
    expect(system.asked).toEqual([])
  })

  it('given no links to read with, reads them with lstat of Node', async () => {
    const system = fakeSystem({})
    fsAsked.lstat.length = 0
    // A folder that is on no machine: the walk ends at its first segment, which is not there.
    const cards = 'C:\\worfy-no-such-folder-18\\cards'
    expect(await resolveCardFile(cards, 'c1', '/x.png', { paths: win32, real: system.options.real, isFile: system.options.isFile })).toBe(`${cards}\\c1\\x.png`)
    expect(fsAsked.lstat).toEqual([cards])
    expect(system.read).toEqual([])
  })

  it('serves nothing of a sibling folder whose name starts with the id of the Card', async () => {
    const system = fakeSystem({})
    expect(await resolveCardFile(CARDS, 'c1', '/..%2Fc1x%2Findex.html', system.options)).toBeNull()
    expect(await resolveCardFile(CARDS, 'c1', '/..%2Fc1%2Findex.html', system.options)).toBe('C:\\data\\demo\\cards\\c1\\index.html')
  })

  it('under POSIX rules reads no link and asks realpath as before', async () => {
    const system = fakeSystem({ '/data/demo/cards/c1/x.png': '//evil/share/x.png' }, posix as unknown as typeof win32)
    expect(await resolveCardFile('/data/demo/cards', 'c1', '/x.png', system.options)).toBe('/data/demo/cards/c1/x.png')
    expect(system.read).toEqual([])
    expect(system.asked).toEqual(['/data/demo/cards', '/data/demo/cards/c1', '/data/demo/cards/c1/x.png'])
  })
})

// CardStore.info reads the <title> of index.html with stat of the Card's folder and open of the
// file; both follow a link (worfy-windows ticket 19).
describe('the title of a Card and a link that leads to a share', () => {
  const CARDS = 'C:\\data\\demo\\cards'
  const CARD = CARDS + '\\c1'
  const INDEX = CARD + '\\index.html'

  /** A store under the given rules, over a file system of links alone: every path is a folder, and every index.html has a title. */
  /** What cannot be read: `denied` — lstat is refused (EACCES); `unreadable` — a link whose target cannot be read. */
  interface Broken {
    denied?: readonly string[]
    unreadable?: readonly string[]
  }

  function fakeStore(links: Record<string, string>, rules: typeof win32 = win32, data = 'C:\\data\\demo', broken: Broken = {}) {
    const calls: string[] = []
    const table = new Map(Object.entries(links).map(([path, target]) => [path.toLowerCase(), target]))
    const among = (list: readonly string[] | undefined, path: string): boolean => (list ?? []).some((each) => each.toLowerCase() === path.toLowerCase())
    const store = new CardStore({
      dataDirOf: () => data,
      projectIds: () => [PROJECT],
      watch: false,
      paths: rules,
      links: {
        isLink: async (path: string): Promise<boolean | null> => {
          calls.push('lstat ' + path)
          if (among(broken.denied, path)) throw Object.assign(new Error('EACCES: ' + path), { code: 'EACCES' })
          return table.has(path.toLowerCase()) || among(broken.unreadable, path)
        },
        readlink: async (path: string): Promise<string> => {
          calls.push('readlink ' + path)
          const target = table.get(path.toLowerCase())
          if (target === undefined) throw Object.assign(new Error('EINVAL: ' + path), { code: 'EINVAL' })
          return target
        },
      },
      fs: {
        isDirectory: async (path: string): Promise<boolean> => {
          calls.push('stat ' + path)
          return true
        },
        readTitle: async (file: string): Promise<string | null> => {
          calls.push('open ' + file)
          return 'A Card'
        },
      },
    })
    return { store, calls }
  }

  it('reads the title of a plain Card after looking at its folder and its index.html for a link', async () => {
    const { store, calls } = fakeStore({})
    expect(await store.info(PROJECT, 'c1')).toMatchObject({ cardId: 'c1', exists: true, title: 'A Card' })
    expect(calls).toEqual(['lstat ' + CARDS, 'lstat ' + CARD, 'stat ' + CARD, 'lstat ' + CARDS, 'lstat ' + CARD, 'lstat ' + INDEX, 'open ' + INDEX])
  })

  it.each([
    ['the folder of the Card', { [CARD]: '\\\\evil\\share\\card' }],
    ['the Cards folder', { [CARDS]: '//evil/share/cards' }],
    ['a local link whose target is a link to a share', { [CARD]: 'C:\\data\\demo\\hop', 'C:\\data\\demo\\hop': '\\??\\GLOBALROOT\\Device\\Mup\\evil\\share\\card' }],
  ])('a Card is not there when %s is a link to a share: neither its folder nor its index.html is asked about', async (_case, links) => {
    const { store, calls } = fakeStore(links)
    expect(await store.info(PROJECT, 'c1')).toMatchObject({ cardId: 'c1', exists: false, title: null })
    expect(calls.filter((call) => call.startsWith('stat') || call.startsWith('open'))).toEqual([])
    expect(calls.at(-1)).toMatch(/^readlink /)
    expect(calls.some((call) => call.includes('evil'))).toBe(false)
  })

  it('a Card whose index.html is a link to a share has no title, and the file is not opened', async () => {
    const { store, calls } = fakeStore({ [INDEX]: '\\\\evil\\share\\index.html' })
    expect(await store.info(PROJECT, 'c1')).toMatchObject({ exists: true, title: null })
    expect(calls.filter((call) => call.startsWith('open'))).toEqual([])
    expect(calls.at(-1)).toBe('readlink ' + INDEX)
  })

  /** `count` links in a row, from `start` on; the last one leads to a share. */
  const chainToShare = (start: string, count: number): Record<string, string> => {
    const hop = (index: number): string => (index === 0 ? start : 'C:\\data\\demo\\cards\\hop' + index)
    return Object.fromEntries(Array.from({ length: count }, (_, index) => [hop(index), index === count - 1 ? '\\\\evil\\share\\x' : hop(index + 1)]))
  }
  /** The ways a walk ends without an answer, at the path `at`. */
  const unchecked = (at: string): [string, Record<string, string>, Broken][] => [
    ['cannot be looked at', {}, { denied: [at] }],
    ['is a link that cannot be read', {}, { unreadable: [at] }],
    ['is a link in a circle of links', { [at]: 'C:\\data\\demo\\cards\\round', 'C:\\data\\demo\\cards\\round': at }, {}],
    ['is the first of 41 links, the last of them to a share', chainToShare(at, 41), {}],
  ]

  it.each(unchecked(CARD))('a Card is not there when its folder %s: neither the folder nor index.html is asked about', async (_case, links, broken) => {
    const { store, calls } = fakeStore(links, win32, 'C:\\data\\demo', broken)
    expect(await store.info(PROJECT, 'c1')).toMatchObject({ cardId: 'c1', exists: false, title: null })
    expect(calls.filter((call) => call.startsWith('stat') || call.startsWith('open'))).toEqual([])
    expect(calls.some((call) => call.includes('evil'))).toBe(false)
  })

  it.each(unchecked(INDEX))('a Card has no title when its index.html %s: the file is not opened', async (_case, links, broken) => {
    const { store, calls } = fakeStore(links, win32, 'C:\\data\\demo', broken)
    expect(await store.info(PROJECT, 'c1')).toMatchObject({ cardId: 'c1', exists: true, title: null })
    expect(calls.filter((call) => call.startsWith('open'))).toEqual([])
    expect(calls.some((call) => call.includes('evil'))).toBe(false)
  })

  // Review round 1 of PR #233: the Cards folder was asked of the Project list a second time, after
  // the wait for stat, so a Project removed meanwhile made info reject where it had answered.
  it.each([
    ['POSIX', posix as typeof win32, '/data/demo'],
    ['Windows', win32, 'C:\\data\\demo'],
  ])('under %s rules a Project that leaves the list while its Card is asked about still gets the answer', async (_name, rules, data) => {
    let listed = true
    const store = new CardStore({
      dataDirOf: () => {
        if (!listed) throw new Error('Project ' + PROJECT + ' is not in the list')
        return data
      },
      projectIds: () => [PROJECT],
      watch: false,
      paths: rules,
      links: { isLink: async (): Promise<boolean | null> => false, readlink: async (): Promise<string> => '' },
      fs: {
        isDirectory: async (): Promise<boolean> => {
          listed = false
          return true
        },
        readTitle: async (): Promise<string | null> => 'A Card',
      },
    })
    expect(await store.info(PROJECT, 'c1')).toMatchObject({ cardId: 'c1', exists: true, title: 'A Card' })
  })

  it('reads the title behind a link that stays on the machine, and of a Card in a data folder on a share', async () => {
    const local = fakeStore({ [INDEX]: 'C:\\data\\demo\\cards\\c1\\real.html' })
    expect(await local.store.info(PROJECT, 'c1')).toMatchObject({ exists: true, title: 'A Card' })
    expect(local.calls.at(-1)).toBe('open ' + INDEX)
    const shared = fakeStore({}, win32, '\\\\nas\\data\\demo')
    expect(await shared.store.info(PROJECT, 'c1')).toMatchObject({ exists: true, title: 'A Card' })
    expect(shared.calls.at(-1)).toBe('open \\\\nas\\data\\demo\\cards\\c1\\index.html')
  })

  it('given no links to read with, reads them with lstat of Node', async () => {
    const calls: string[] = []
    const files = {
      isDirectory: async (path: string): Promise<boolean> => (calls.push('stat ' + path), true),
      readTitle: async (file: string): Promise<string | null> => (calls.push('open ' + file), 'A Card'),
    }
    // A folder that is on no machine: each walk ends at its first segment, which is not there.
    const cards = 'C:\\worfy-no-such-folder-19\\demo\\cards'
    const store = new CardStore({ dataDirOf: () => 'C:\\worfy-no-such-folder-19\\demo', projectIds: () => [PROJECT], watch: false, paths: win32, fs: files })
    fsAsked.lstat.length = 0
    expect(await store.info(PROJECT, 'c1')).toMatchObject({ exists: true, title: 'A Card' })
    expect(fsAsked.lstat).toEqual([cards, cards])
    expect(calls).toEqual(['stat ' + cards + '\\c1', 'open ' + cards + '\\c1\\index.html'])
  })

  it('under POSIX rules reads no link: the folder and the file are asked about as before', async () => {
    const { store, calls } = fakeStore({ '/data/demo/cards/c1': '//evil/share/card' }, posix as typeof win32, '/data/demo')
    expect(await store.info(PROJECT, 'c1')).toMatchObject({ exists: true, title: 'A Card' })
    expect(calls).toEqual(['stat /data/demo/cards/c1', 'open /data/demo/cards/c1/index.html'])
  })

  // Only Windows makes a share of \\host\…; a user without Developer Mode may not create symlinks.
  it.runIf(process.platform === 'win32')('with real links to a share, Node is asked to stat no such folder and to open no such file', async (context) => {
    mkdirSync(cardDir('plain'), { recursive: true })
    mkdirSync(cardDir('byfile'), { recursive: true })
    writeFileSync(join(cardDir('plain'), 'index.html'), '<title>Plain</title>')
    try {
      symlinkSync('\\\\worfy-no-such-host\\share\\card', cardDir('byfolder'), 'dir')
      symlinkSync('\\\\worfy-no-such-host\\share\\index.html', join(cardDir('byfile'), 'index.html'), 'file')
    } catch (error) {
      context.skip('this user cannot create a symlink: ' + (error instanceof Error ? error.message : String(error)))
    }
    const real = makeStore([PROJECT], false)
    fsAsked.stat.length = 0
    fsAsked.open.length = 0
    expect(await real.info(PROJECT, 'plain')).toMatchObject({ exists: true, title: 'Plain' })
    expect(await real.info(PROJECT, 'byfolder')).toMatchObject({ exists: false, title: null })
    expect(await real.info(PROJECT, 'byfile')).toMatchObject({ exists: true, title: null })
    expect(fsAsked.stat).toEqual([cardDir('plain'), cardDir('byfile')])
    expect(fsAsked.open).toEqual([join(cardDir('plain'), 'index.html')])
  })
})
