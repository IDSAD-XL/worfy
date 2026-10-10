// The worfy-card:// protocol (src/main/cards/protocol.ts), the Card store behind it
// (src/main/cards/store.ts) and the `cards` IPC domain (src/main/ipc/cards.ts) on a temporary data
// folder: which files a Card gets, with which headers, that nothing outside the Card's own folder
// is ever served, and that a change of a Card's files is reported within a second.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, posix, win32 } from 'node:path'
import type { IpcMainInvokeEvent } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNEL_PREFIX, type IpcResult } from '../../src/shared/ipc/channels'
import { cardInfoSchema, type CardInfo } from '../../src/shared/ipc/cards'
import {
  allowFrameNavigation,
  cardUrl,
  createCardHandler,
  parseCardUrl,
  projectLabel,
  readCardFileChunk,
  resolveCardFile,
  CARD_CSP,
  CARD_HEADERS,
  CARD_SCHEME,
  type LinkedCardSource,
} from '../../src/main/cards/protocol'
import { createLinkedCardSource } from '../../src/main/cards/remote'
import { CardStore, titleOf } from '../../src/main/cards/store'
import { machineLabel } from '../../src/shared/cards/bridge'
import { CARD_FILE_CHUNK_BYTES, CARD_FILE_LIMIT_BYTES, cardsFile } from '../../src/shared/ipc/cards'
import { projectId, projectIdHash } from '../../src/main/projects/store'

const INDEX_HTML = '/Applications/worfy.app/Contents/Resources/app/out/renderer/index.html'

const electron = vi.hoisted(() => {
  const sent: { channel: string; payload: unknown }[] = []
  const quitListeners: (() => void)[] = []
  const window = { isDestroyed: () => false, webContents: { send: (channel: string, payload: unknown) => sent.push({ channel, payload }) } }
  return { sent, quitListeners, window }
})

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

// protocol.ts registers the scheme with Electron; the handler and the IPC module are called directly.
vi.mock('electron', () => ({
  app: {
    on: (event: string, listener: () => void) => {
      if (event === 'will-quit') electron.quitListeners.push(listener)
    },
  },
  BrowserWindow: { getAllWindows: () => [electron.window] },
  protocol: {},
  session: {},
}))

const PROJECT = 'demo-0a1b2c3d'
const LABEL = '0a1b2c3d'
const BASE = `${CARD_SCHEME}://c1.${LABEL}`

let scratch: string
let dataDir: string
let store: CardStore
let handle: (request: { url: string; method: string }) => Promise<Response>

const cardDir = (id: string, project: string = PROJECT) => join(dataDir, project, 'cards', id)
const get = (url: string) => handle({ url, method: 'GET' })

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
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-card-protocol-')))
  dataDir = join(scratch, 'data')
  mkdirSync(join(cardDir('c1'), 'js'), { recursive: true })
  writeFileSync(join(cardDir('c1'), 'index.html'), '<!doctype html><title>Clock</title><script src="js/app.js"></script>')
  writeFileSync(join(cardDir('c1'), 'js', 'app.js'), 'document.title = "tick"')
  writeFileSync(join(dataDir, PROJECT, 'layout.json'), '{"nodes":[]}')
  writeFileSync(join(scratch, 'outside.html'), '<title>outside</title>')
  store = makeStore([PROJECT], false)
  handle = createCardHandler((host) => store.locate(host))
})

afterEach(async () => {
  await store.close()
  rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

describe('worfy-card:// leaves the Card folder for nothing', () => {
  it('answers 404 to a path that climbs out of the Card folder with ..', async () => {
    const encoded = await get(`${BASE}/..%2F..%2Flayout.json`)
    expect(encoded.status).toBe(404)
    const dotted = await get(`${BASE}/js/%2e%2e%2F..%2F..%2Flayout.json`)
    expect(dotted.status).toBe(404)
  })

  it('answers 404 to a .. that the URL parser folds away, since the folded path is not a file of the Card', async () => {
    const response = await get(`${BASE}/../../layout.json`)
    expect(response.status).toBe(404)
  })

  it('answers 404 to a symlink inside the Card that points outside it', async () => {
    symlinkSync(join(dataDir, PROJECT, 'layout.json'), join(cardDir('c1'), 'layout.json'))
    symlinkSync(join(scratch, 'outside.html'), join(cardDir('c1'), 'outside.html'))
    expect((await get(`${BASE}/layout.json`)).status).toBe(404)
    expect((await get(`${BASE}/outside.html`)).status).toBe(404)
  })

  it('serves a symlink that stays inside the Card', async () => {
    symlinkSync(join(cardDir('c1'), 'js', 'app.js'), join(cardDir('c1'), 'alias.js'))
    const response = await get(`${BASE}/alias.js`)
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('document.title = "tick"')
  })

  it('answers 404 when the Card folder itself is a symlink out of the Cards folder', async () => {
    mkdirSync(join(scratch, 'elsewhere'))
    writeFileSync(join(scratch, 'elsewhere', 'index.html'), '<title>elsewhere</title>')
    symlinkSync(join(scratch, 'elsewhere'), cardDir('c2'))
    expect((await get(`${CARD_SCHEME}://c2.${LABEL}/index.html`)).status).toBe(404)
  })

  // worfy-windows ticket 18, with real links: lstat and readlink are Node's own, and realpath is
  // wrapped to see what it was asked. The host does not exist; nothing here follows the link.
  it.runIf(process.platform === 'win32')('serves nothing behind a real symlink to a share, and realpath is not asked about it', async (context) => {
    try {
      symlinkSync('\\\\worfy-no-such-host\\share\\x.png', join(cardDir('c1'), 'remote.png'), 'file')
      symlinkSync('\\\\worfy-no-such-host\\share\\card', cardDir('c3'), 'dir')
    } catch (error) {
      // Without Developer Mode a user may not create symlinks (SeCreateSymbolicLinkPrivilege).
      context.skip(`this user cannot create a symlink: ${error instanceof Error ? error.message : String(error)}`)
    }
    const cards = join(dataDir, PROJECT, 'cards')
    const asked: string[] = []
    const real = async (path: string): Promise<string> => {
      asked.push(path)
      return realpathSync.native(path)
    }
    expect(await resolveCardFile(cards, 'c1', '/remote.png', { real })).toBeNull()
    expect(await resolveCardFile(cards, 'c3', '/index.html', { real })).toBeNull()
    expect(asked).toEqual([])
    // A plain file of the same Card is served, through the same wrapped realpath.
    expect(await resolveCardFile(cards, 'c1', '/index.html', { real })).toBe(join(realpathSync.native(cardDir('c1')), 'index.html'))
    // And through the protocol the answer is a 404.
    expect((await get(`${BASE}/remote.png`)).status).toBe(404)
  })

  it('answers 404 to another Project’s Card through this Card’s address', async () => {
    mkdirSync(cardDir('c1', 'other-ffffffff'), { recursive: true })
    writeFileSync(join(cardDir('c1', 'other-ffffffff'), 'secret.json'), '{}')
    expect((await get(`${BASE}/..%2F..%2F..%2Fother-ffffffff%2Fcards%2Fc1%2Fsecret.json`)).status).toBe(404)
  })

  it('answers 404 to files with an extension outside the list, directories, missing files and a NUL byte', async () => {
    writeFileSync(join(cardDir('c1'), 'notes.md'), '# notes')
    writeFileSync(join(cardDir('c1'), 'secret'), 'no extension')
    for (const path of ['notes.md', 'secret', 'js', 'js/', 'missing.html', 'index.html%00.js']) {
      const response = await get(`${BASE}/${path}`)
      expect(response.status, path).toBe(404)
      expect(response.headers.get('content-security-policy'), path).toBe(CARD_CSP)
    }
  })

  it('answers 404 to hosts that name no single Card of a listed Project', async () => {
    const urls = [
      `${CARD_SCHEME}://c9.${LABEL}/index.html`, // no such Card
      `${CARD_SCHEME}://c1.ffffffff/index.html`, // no such Project
      `${CARD_SCHEME}://c1/index.html`, // no Project label
      `${CARD_SCHEME}://x.c1.${LABEL}/index.html`, // three labels
      `${CARD_SCHEME}://c1.${LABEL}:8080/index.html`, // a port
      `https://c1.${LABEL}/index.html`, // another scheme
    ]
    for (const url of urls) expect((await get(url)).status, url).toBe(404)
  })

  it('answers 404 when two listed Projects share a label', async () => {
    const twin = 'twin-0a1b2c3d'
    const ambiguous = makeStore([PROJECT, twin], false)
    const twinHandle = createCardHandler((host) => ambiguous.locate(host))
    expect((await twinHandle({ url: `${BASE}/index.html`, method: 'GET' })).status).toBe(404)
    await ambiguous.close()
  })

  it('refuses methods other than GET and HEAD', async () => {
    const response = await handle({ url: `${BASE}/index.html`, method: 'POST' })
    expect(response.status).toBe(405)
    expect(response.headers.get('content-security-policy')).toBe(CARD_CSP)
  })
})

// worfy-windows ticket 18: on Windows realpath of a link to \\host\share makes the system contact
// that host, so the links on the way to a Card file are read first (src/main/remote-links.ts). The
// file system is replaced here and the path rules are path.win32: the cases run on any machine.
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
  function fakeStore(links: Record<string, string>, rules: typeof win32 = win32, data = 'C:\\data\\demo') {
    const calls: string[] = []
    const table = new Map(Object.entries(links).map(([path, target]) => [path.toLowerCase(), target]))
    const store = new CardStore({
      dataDirOf: () => data,
      projectIds: () => [PROJECT],
      watch: false,
      paths: rules,
      links: {
        isLink: async (path: string): Promise<boolean | null> => {
          calls.push('lstat ' + path)
          return table.has(path.toLowerCase())
        },
        readlink: async (path: string): Promise<string> => {
          calls.push('readlink ' + path)
          return table.get(path.toLowerCase())!
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

describe('worfy-card:// serves the Card', () => {
  it('serves index.html with the CSP, nosniff and no-store headers', async () => {
    const response = await get(`${BASE}/index.html`)
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('<title>Clock</title>')
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(response.headers.get('content-security-policy')).toBe(CARD_CSP)
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('has exactly the CSP the ticket fixes', () => {
    expect(CARD_CSP).toBe(
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; " +
        "font-src 'self' data: https:; connect-src https:; frame-src 'none'; form-action 'none'; object-src 'none'; base-uri 'none'",
    )
  })

  it('serves index.html for the root path, and nested files with their content type', async () => {
    const root = await get(`${BASE}/`)
    expect(root.status).toBe(200)
    expect(await root.text()).toContain('<title>Clock</title>')
    const script = await get(`${BASE}/js/app.js`)
    expect(script.status).toBe(200)
    expect(script.headers.get('content-type')).toBe('text/javascript; charset=utf-8')
    expect(await script.text()).toBe('document.title = "tick"')
  })

  it('answers HEAD with the headers and no body', async () => {
    const response = await handle({ url: `${BASE}/index.html`, method: 'HEAD' })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(await response.text()).toBe('')
  })
})

describe('Card addresses', () => {
  it('builds <card id>.<project label> and reads it back', () => {
    expect(projectLabel(PROJECT)).toBe(LABEL)
    expect(projectLabel('My Projects-0A1B2C3D')).toBeNull()
    expect(cardUrl(PROJECT, 'c1')).toBe(`${BASE}/index.html`)
    expect(cardUrl('Мой проект с пробелами-1234abcd', 'c1', 'js/app.js')).toBe(`${CARD_SCHEME}://c1.1234abcd/js/app.js`)
    expect(parseCardUrl(`${BASE}/js/app.js`)).toEqual({ cardId: 'c1', projectLabel: LABEL, pathname: '/js/app.js' })
    expect(() => cardUrl(PROJECT, 'Bad_Id')).toThrow()
    expect(() => cardUrl('no-label', 'c1')).toThrow()
  })

  it('reads the machine label of a Card of a Linked machine: <card id>.<project label>.<machine label>', () => {
    expect(parseCardUrl(`${CARD_SCHEME}://c1.0123abcd.0123456789abcdef0123456789abcdef/index.html`)).toEqual({
      cardId: 'c1',
      projectLabel: '0123abcd',
      machineLabel: '0123456789abcdef0123456789abcdef',
      pathname: '/index.html',
    })
    // The own form has no machine label at all.
    expect(parseCardUrl(`${BASE}/index.html`)?.machineLabel).toBeUndefined()
    // The machine label is 32 hex characters (a Machine id without dashes); four parts are no address.
    for (const host of [`c1.${LABEL}.machine`, `c1.${LABEL}.89abcdef`, `c1.${LABEL}.${'0123456789abcdef0123456789abcdef'.slice(0, 31)}g`, `c1.${LABEL}.0123456789abcdef0123456789abcdef.00000000`, `c1.${LABEL}-0123456789abcdef0123456789abcdef`, `c1.${LABEL}.`]) {
      expect(parseCardUrl(`${CARD_SCHEME}://${host}/index.html`), host).toBeNull()
    }
  })

  it('takes the label from the Project id format of the Project store, for any folder name', () => {
    for (const root of ['/Users/me/My Projects', '/Users/me/Мой проект', '/']) {
      const id = projectId(root)
      const hash = projectIdHash(id)
      expect(hash).toMatch(/^[0-9a-f]+$/)
      expect(projectLabel(id)).toBe(hash)
      expect(parseCardUrl(cardUrl(id, 'c1'))).toEqual({ cardId: 'c1', projectLabel: hash, pathname: '/index.html' })
    }
  })
})

// ── a Card of a Linked machine (worfy-link ticket 10) ────────────────────────

/** Linked machine M: its own data folder, with Card c1 of a Project that has this Project's label. */
const MACHINE_M = '3f2504e0-4f89-41d3-9a0c-0305e82c3301'
const M_LABEL = machineLabel(MACHINE_M) ?? ''
const M_BASE = `${BASE}.${M_LABEL}`

describe('worfy-card:// serves a Card of a Linked machine from its second source', () => {
  let storeOfM: CardStore
  let dataOfM: string
  let calls: { machine: string; channel: string; input: { offset: number; length: number; path: string } }[]
  let reachable: boolean
  let linkedHandle: (request: { url: string; method: string }) => Promise<Response>

  const cardOfM = (id: string) => join(dataOfM, PROJECT, 'cards', id)

  beforeEach(() => {
    dataOfM = join(scratch, 'data-of-m')
    mkdirSync(join(cardOfM('c1'), 'js'), { recursive: true })
    writeFileSync(join(cardOfM('c1'), 'index.html'), '<!doctype html><html><head><title>Clock of M</title></head><body>M</body></html>')
    writeFileSync(join(cardOfM('c1'), 'js', 'app.js'), 'document.title = "tick of M"')
    storeOfM = new CardStore({
      dataDirOf: (id) => {
        if (id !== PROJECT) throw new Error(`No Project ${id}`)
        return join(dataOfM, id)
      },
      projectIds: () => [PROJECT],
      watch: false,
    })
    calls = []
    reachable = true
    // M answers cards.file as its main does (src/main/ipc/cards.ts), through the channel's schemas.
    const source = createLinkedCardSource({
      machines: () => Promise.resolve([{ id: MACHINE_M }, { id: 'another-machine' }]),
      call: async (machine, channel, input) => {
        const parsed = cardsFile.input.parse(input)
        calls.push({ machine, channel, input: parsed })
        if (!reachable) return { ok: false, error: `${channel}: Mini is unreachable` }
        if (machine !== MACHINE_M || channel !== 'cards.file') return { ok: false, error: 'wrong call' }
        const answer = await readCardFileChunk(storeOfM.locate({ cardId: parsed.cardId, projectLabel: parsed.projectLabel }), parsed.cardId, parsed.path, parsed.offset, parsed.length)
        return { ok: true, value: cardsFile.output.parse(answer) }
      },
    })
    linkedHandle = createCardHandler((host) => store.locate(host), source)
  })

  afterEach(async () => {
    await storeOfM.close()
  })

  const expectCardHeaders = (response: Response, what: string) => {
    for (const [name, value] of Object.entries(CARD_HEADERS)) expect(response.headers.get(name), `${what}: ${name}`).toBe(value)
  }

  it('serves the file of M with the Card headers and its content type, the runtime of this Machine in the HTML', async () => {
    const page = await linkedHandle({ url: `${M_BASE}/index.html`, method: 'GET' })
    expect(page.status).toBe(200)
    expectCardHeaders(page, 'index.html')
    expect(page.headers.get('content-type')).toBe('text/html; charset=utf-8')
    const html = await page.text()
    expect(html).toContain('<title>Clock of M</title>')
    // The runtime once, put in by this side: M sent the file as it is on disk.
    expect(html.match(/data-worfy-runtime/g)).toHaveLength(1)
    expect(html.startsWith('<!doctype html><html><head><script data-worfy-runtime>')).toBe(true)
    expect(calls.map((each) => each.machine)).toEqual([MACHINE_M])
    expect(calls[0]?.input).toMatchObject({ path: '/index.html', offset: 0 })

    const script = await linkedHandle({ url: `${M_BASE}/js/app.js`, method: 'GET' })
    expect(script.status).toBe(200)
    expect(script.headers.get('content-type')).toBe('text/javascript; charset=utf-8')
    expect(await script.text()).toBe('document.title = "tick of M"')

    // The root path is index.html, as for the own Card; HEAD gets the headers and asks for no bytes.
    expect(await (await linkedHandle({ url: `${M_BASE}/`, method: 'GET' })).text()).toContain('Clock of M')
    const head = await linkedHandle({ url: `${M_BASE}/index.html`, method: 'HEAD' })
    expect(head.status).toBe(200)
    expect(head.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(await head.text()).toBe('')
    expect(calls.at(-1)?.input.length).toBe(0)
  })

  it('the own Card with the same card id and project label stays the own one', async () => {
    const own = await linkedHandle({ url: `${BASE}/index.html`, method: 'GET' })
    expect(await own.text()).toContain('<title>Clock</title>')
    expect(calls).toEqual([])
    expect(parseCardUrl(`${M_BASE}/index.html`)).not.toEqual(parseCardUrl(`${BASE}/index.html`))
  })

  it('an unknown machine label, no file on M and a method other than GET or HEAD: 404 and 405 with the same headers', async () => {
    const unknown = await linkedHandle({ url: `${BASE}.${'0'.repeat(32)}/index.html`, method: 'GET' })
    expect(unknown.status).toBe(404)
    expectCardHeaders(unknown, 'unknown machine')
    expect(calls).toEqual([])

    for (const path of ['missing.html', '..%2F..%2Flayout.json', 'notes.md']) {
      const missing = await linkedHandle({ url: `${M_BASE}/${path}`, method: 'GET' })
      expect(missing.status, path).toBe(404)
      expectCardHeaders(missing, path)
    }
    const other = await linkedHandle({ url: `${CARD_SCHEME}://c1.ffffffff.${M_LABEL}/index.html`, method: 'GET' })
    expect(other.status).toBe(404)

    const post = await linkedHandle({ url: `${M_BASE}/index.html`, method: 'POST' })
    expect(post.status).toBe(405)
    expectCardHeaders(post, 'POST')
  })

  it('without a second source an address with a machine label is a 404', async () => {
    const response = await get(`${M_BASE}/index.html`)
    expect(response.status).toBe(404)
    expectCardHeaders(response, 'no second source')
  })

  it('a file over 20 MB is a 413 with the same headers, and M reads none of it', async () => {
    expect(CARD_FILE_LIMIT_BYTES).toBe(20 * 1024 * 1024)
    writeFileSync(join(cardOfM('c1'), 'big.mp4'), Buffer.alloc(CARD_FILE_LIMIT_BYTES + 1))
    const response = await linkedHandle({ url: `${M_BASE}/big.mp4`, method: 'GET' })
    expect(response.status).toBe(413)
    expectCardHeaders(response, '413')
    expect(calls).toHaveLength(1)

    // A Linked machine that sends more than the limit anyway is not believed either.
    const lying: LinkedCardSource = () => Promise.resolve({ status: 'file', extension: '.mp4', bytes: new Uint8Array(CARD_FILE_LIMIT_BYTES + 1) })
    const refused = await createCardHandler(() => null, lying)({ url: `${M_BASE}/big.mp4`, method: 'GET' })
    expect(refused.status).toBe(413)
    expectCardHeaders(refused, 'lying 413')
  })

  it('a file larger than one piece comes in several calls, glued in order', async () => {
    const size = CARD_FILE_CHUNK_BYTES * 2 + 5
    const bytes = Buffer.alloc(size)
    for (let index = 0; index < size; index += 4096) bytes[index] = (index / 4096) % 251
    writeFileSync(join(cardOfM('c1'), 'clip.webm'), bytes)
    const response = await linkedHandle({ url: `${M_BASE}/clip.webm`, method: 'GET' })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('video/webm')
    expect(Buffer.from(await response.arrayBuffer()).equals(bytes)).toBe(true)
    expect(calls.map((each) => each.input.offset)).toEqual([0, CARD_FILE_CHUNK_BYTES, CARD_FILE_CHUNK_BYTES * 2])
  })

  it('a file rewritten with the same size between two pieces is read again from the start, not spliced', async () => {
    // M as a script: the first read sees the old file in its first piece, the new one in the second.
    const old = Buffer.from('aaaaabbbbb')
    const fresh = Buffer.from('cccccddddd')
    const answers = [
      { file: old, mtimeMs: 1000.5, offset: 0 },
      { file: fresh, mtimeMs: 2000.25, offset: 5 },
      { file: fresh, mtimeMs: 2000.25, offset: 0 },
      { file: fresh, mtimeMs: 2000.25, offset: 5 },
    ]
    const offsets: number[] = []
    const source = createLinkedCardSource({
      machines: () => Promise.resolve([{ id: MACHINE_M }]),
      call: (_machine, _channel, input) => {
        const { offset } = cardsFile.input.parse(input)
        offsets.push(offset)
        const next = answers.shift()
        if (next === undefined || next.offset !== offset) return Promise.resolve({ ok: false, error: `unexpected offset ${offset}` })
        const value = { status: 'file', extension: '.txt', size: 10, mtimeMs: next.mtimeMs, base64: next.file.subarray(offset, offset + 5).toString('base64') }
        return Promise.resolve({ ok: true, value })
      },
    })
    const file = await source({ machineLabel: M_LABEL, projectLabel: LABEL, cardId: 'c1', pathname: '/notes.txt', head: false })
    expect(file.status === 'file' && Buffer.from(file.bytes).toString()).toBe('cccccddddd')
    expect(offsets).toEqual([0, 5, 0, 5])
  })

  it('M unreachable: 502 with the same headers; an extension M has no business sending: 404', async () => {
    reachable = false
    const response = await linkedHandle({ url: `${M_BASE}/index.html`, method: 'GET' })
    expect(response.status).toBe(502)
    expectCardHeaders(response, '502')
    expect(await response.text()).toBe('cards.file: Mini is unreachable')

    const odd: LinkedCardSource = () => Promise.resolve({ status: 'file', extension: '.exe', bytes: new Uint8Array(1) })
    expect((await createCardHandler(() => null, odd)({ url: `${M_BASE}/index.html`, method: 'GET' })).status).toBe(404)
  })
})

describe('cards.file on the Machine of the Project: nothing outside the Card folder, the file as it is', () => {
  const read = (path: string, label = LABEL, cardId = 'c1') => readCardFileChunk(store.locate({ cardId, projectLabel: label }), cardId, path, 0, CARD_FILE_CHUNK_BYTES)

  it('sends the HTML without the runtime, with its extension and size', async () => {
    const answer = await read('/index.html')
    expect(answer).toEqual({
      status: 'file',
      extension: '.html',
      size: Buffer.byteLength('<!doctype html><title>Clock</title><script src="js/app.js"></script>'),
      mtimeMs: expect.any(Number) as number,
      base64: Buffer.from('<!doctype html><title>Clock</title><script src="js/app.js"></script>').toString('base64'),
    })
    expect(cardsFile.output.safeParse(answer).success).toBe(true)
  })

  it('answers "missing" for .., a symlink out, an extension outside the list and a Card of an unknown label', async () => {
    symlinkSync(join(dataDir, PROJECT, 'layout.json'), join(cardDir('c1'), 'layout.json'))
    symlinkSync(join(scratch, 'outside.html'), join(cardDir('c1'), 'outside.html'))
    writeFileSync(join(cardDir('c1'), 'notes.md'), '# notes')
    for (const path of ['/..%2F..%2Flayout.json', '/js/%2e%2e%2F..%2F..%2Flayout.json', '/layout.json', '/outside.html', '/notes.md', '/missing.html', '/js']) {
      expect(await read(path), path).toEqual({ status: 'missing' })
    }
    expect(await read('/index.html', 'ffffffff')).toEqual({ status: 'missing' })
    expect(await read('/index.html', LABEL, 'c9')).toEqual({ status: 'missing' })
  })

  it('reads the piece asked for, and never more than one piece', async () => {
    const piece = await readCardFileChunk(store.locate({ cardId: 'c1', projectLabel: LABEL }), 'c1', '/js/app.js', 9, 5)
    expect(piece).toMatchObject({ status: 'file', extension: '.js', size: 23, base64: Buffer.from('title').toString('base64') })
    expect(cardsFile.input.safeParse({ projectLabel: LABEL, cardId: 'c1', path: '/index.html', length: CARD_FILE_CHUNK_BYTES + 1 }).success).toBe(false)
    expect(cardsFile.input.safeParse({ projectLabel: 'Demo', cardId: 'c1', path: '/index.html' }).success).toBe(false)
  })
})

describe('main lets a Card frame navigate only within its own origin', () => {
  const card = `${BASE}/index.html`
  const cases: [string, Parameters<typeof allowFrameNavigation>[0], boolean][] = [
    ['the Node loads its Card into a new iframe', { isMainFrame: false, frameUrl: '', targetUrl: card }, true],
    ['the Node loads its Card into an about:blank iframe', { isMainFrame: false, frameUrl: 'about:blank', targetUrl: card }, true],
    ['the Card goes to another of its own files', { isMainFrame: false, frameUrl: card, targetUrl: `${BASE}/page.html` }, true],
    ['the Card goes to another Card', { isMainFrame: false, frameUrl: card, targetUrl: `${CARD_SCHEME}://c2.${LABEL}/index.html` }, false],
    ['the Card goes to the same Card id of another Project', { isMainFrame: false, frameUrl: card, targetUrl: `${CARD_SCHEME}://c1.ffffffff/index.html` }, false],
    ['the Card goes to the web', { isMainFrame: false, frameUrl: card, targetUrl: 'https://example.com/' }, false],
    ['the Card goes to a file', { isMainFrame: false, frameUrl: card, targetUrl: 'file:///etc/hosts' }, false],
    ['the Card goes to about:blank', { isMainFrame: false, frameUrl: card, targetUrl: 'about:blank' }, false],
    ['the Card goes to a data: URL', { isMainFrame: false, frameUrl: card, targetUrl: 'data:text/html,hi' }, false],
    ['the window goes to a Card', { isMainFrame: true, frameUrl: 'file:///app/index.html', targetUrl: card }, false],
    ['the window loads its renderer', { isMainFrame: true, frameUrl: '', targetUrl: 'file:///app/index.html' }, true],
    ['an iframe that is not a Card navigates', { isMainFrame: false, frameUrl: 'https://a.example/', targetUrl: 'https://b.example/' }, true],
    // A Card of Linked machine M (worfy-link ticket 10): the whole host, machine label included.
    ['the Node loads a Card of a Linked machine', { isMainFrame: false, frameUrl: '', targetUrl: `${BASE}.3f2504e04f8941d39a0c0305e82c3301/index.html` }, true],
    ['a Card of a Linked machine goes to another of its own files', { isMainFrame: false, frameUrl: `${BASE}.3f2504e04f8941d39a0c0305e82c3301/index.html`, targetUrl: `${BASE}.3f2504e04f8941d39a0c0305e82c3301/page.html` }, true],
    ['a Card of a Linked machine goes to the own Card with the same ids', { isMainFrame: false, frameUrl: `${BASE}.3f2504e04f8941d39a0c0305e82c3301/index.html`, targetUrl: card }, false],
    ['the own Card goes to the Card of a Linked machine with the same ids', { isMainFrame: false, frameUrl: card, targetUrl: `${BASE}.3f2504e04f8941d39a0c0305e82c3301/index.html` }, false],
    ['a Card of a Linked machine goes to the same Card of another Linked machine', { isMainFrame: false, frameUrl: `${BASE}.3f2504e04f8941d39a0c0305e82c3301/index.html`, targetUrl: `${BASE}.0123456789abcdef0123456789abcdef/index.html` }, false],
    ['the window goes to a Card of a Linked machine', { isMainFrame: true, frameUrl: 'file:///app/index.html', targetUrl: `${BASE}.3f2504e04f8941d39a0c0305e82c3301/index.html` }, false],
  ]
  for (const [name, navigation, allowed] of cases) {
    it(`${allowed ? 'allows' : 'stops'}: ${name}`, () => {
      expect(allowFrameNavigation(navigation)).toBe(allowed)
    })
  }
})

describe('Card store', () => {
  it('reads the title from <title>, entities decoded and spaces collapsed', () => {
    expect(titleOf('<html><head><TITLE lang="en">\n  Tom &amp; Jerry&#39;s  &#x263A; clock </TITLE>')).toBe("Tom & Jerry's ☺ clock")
    expect(titleOf('<title>   </title>')).toBeNull()
    expect(titleOf('<h1>no title</h1>')).toBeNull()
  })

  it('describes a Card: its address, title and whether its folder is there', async () => {
    expect(await store.info(PROJECT, 'c1')).toEqual({ projectId: PROJECT, cardId: 'c1', url: `${BASE}/index.html`, exists: true, title: 'Clock', revision: 0 })
    expect(await store.info(PROJECT, 'gone')).toMatchObject({ cardId: 'gone', exists: false, title: null })
    await expect(store.info('nobody-ffffffff', 'c1')).rejects.toThrow()
    await expect(store.info(PROJECT, '../c1')).rejects.toThrow()
  })

  it('lists the Cards of a Project that have a folder', async () => {
    mkdirSync(cardDir('b2'))
    mkdirSync(cardDir('Not_A_Card'))
    writeFileSync(join(dataDir, PROJECT, 'cards', 'stray.html'), '')
    expect((await store.list(PROJECT)).map((info) => [info.cardId, info.title])).toEqual([
      ['b2', null],
      ['c1', 'Clock'],
    ])
  })

  it('reports a file change of a Card within a second, with a higher revision and the new title', async () => {
    const watching = makeStore([PROJECT], true)
    try {
      await watching.info(PROJECT, 'c1')
      // chokidar needs a moment to set its watches up after the first info().
      await new Promise((done) => setTimeout(done, 300))
      const seen: CardInfo[] = []
      watching.onChange((info) => seen.push(info))
      const started = Date.now()
      writeFileSync(join(cardDir('c1'), 'index.html'), '<title>Clock v2</title>')
      await vi.waitFor(() => expect(seen.at(-1)?.title).toBe('Clock v2'), { timeout: 1000, interval: 20 })
      expect(Date.now() - started).toBeLessThan(1000)
      // At least one: FSEvents may also deliver the fixture's own writes from just before the watch began.
      expect(seen.at(-1)).toMatchObject({ cardId: 'c1', exists: true })
      expect(seen.at(-1)?.revision).toBeGreaterThanOrEqual(1)

      rmSync(cardDir('c1'), { recursive: true, force: true })
      await vi.waitFor(() => expect(seen.at(-1)?.exists).toBe(false), { timeout: 1000, interval: 20 })
    } finally {
      await watching.close()
    }
  })

  describe('when a Project leaves the list', () => {
    const OTHER = 'other-0f0f0f0f'
    let projects: string[]
    let projectListeners: Set<() => void>
    let watching: CardStore

    const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms))
    /**
     * Waits until the store has reported no change for `quietMs`. FSEvents on macOS may deliver the
     * events of writes made before the watch started a few hundred ms late (a slow CI runner shows
     * it); such a late report, read after the test's own write, looked like the test's change.
     */
    const settle = async (store: CardStore, quietMs = 700, maxMs = 5000) => {
      const started = Date.now()
      let last = started
      const stop = store.onChange(() => {
        last = Date.now()
      })
      try {
        while (Date.now() - last < quietMs && Date.now() - started < maxMs) await sleep(50)
      } finally {
        stop()
      }
    }
    const removeFromList = (id: string) => {
      projects = projects.filter((other) => other !== id)
      for (const listener of projectListeners) listener()
    }

    beforeEach(async () => {
      mkdirSync(cardDir('o1', OTHER), { recursive: true })
      writeFileSync(join(cardDir('o1', OTHER), 'index.html'), '<title>Other</title>')
      projects = [PROJECT, OTHER]
      projectListeners = new Set()
      watching = new CardStore({
        dataDirOf: (id) => {
          if (!projects.includes(id)) throw new Error(`No Project ${id}`)
          return join(dataDir, id)
        },
        projectIds: () => projects,
        subscribeProjects: (listener) => {
          projectListeners.add(listener)
          return () => projectListeners.delete(listener)
        },
        delayMs: 300,
      })
      await watching.info(PROJECT, 'c1')
      await watching.info(OTHER, 'o1')
      await settle(watching)
    })

    afterEach(async () => {
      await watching.close()
    })

    it('stops watching its Cards and keeps watching the other Projects', async () => {
      expect(watching.watchedProjects()).toEqual([PROJECT, OTHER].sort())
      removeFromList(PROJECT)
      expect(watching.watchedProjects()).toEqual([OTHER])

      const seen: CardInfo[] = []
      watching.onChange((info) => seen.push(info))
      writeFileSync(join(cardDir('o1', OTHER), 'index.html'), '<title>Other v2</title>')
      await vi.waitFor(() => expect(seen.some((info) => info.cardId === 'o1' && info.title === 'Other v2')).toBe(true), { timeout: 1500, interval: 20 })
    })

    it('drops a change of its Cards that was waiting out the quiet period', async () => {
      const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      try {
        const seen: CardInfo[] = []
        watching.onChange((info) => seen.push(info))
        // A new Card, which no setup step wrote. A late event of a setup write to c1 (settle() sees
        // reports only, not a change still in its quiet period) may still be reported while the
        // Project is listed; it says nothing about this change, so the check is on c2 alone.
        mkdirSync(cardDir('c2'))
        writeFileSync(join(cardDir('c2'), 'index.html'), '<title>Timer</title>')
        // The file event arrives well inside the 300 ms quiet period; the Project leaves before it ends.
        // The quiet period starts after this sleep does and is longer, so it cannot end first however
        // late the timers fire; an event later than the sleep only finds the watch already stopped.
        await sleep(150)
        removeFromList(PROJECT)
        await sleep(500)
        expect(seen.filter((info) => info.projectId === PROJECT && info.cardId === 'c2')).toEqual([])
        // Reading a Card of a Project that is not listed fails and is logged; nothing may try.
        expect(errors).not.toHaveBeenCalled()
      } finally {
        errors.mockRestore()
      }
    })

    it('unsubscribes from the Project list on close', async () => {
      expect(projectListeners.size).toBe(1)
      await watching.close()
      expect(projectListeners.size).toBe(0)
    })
  })
})

describe('cards IPC domain', () => {
  type Listener = (event: IpcMainInvokeEvent, input: unknown) => unknown
  let handlers: Map<string, Listener>

  beforeEach(async () => {
    vi.resetModules()
    electron.sent.length = 0
    electron.quitListeners.length = 0
    process.env.WORFY_DATA_DIR = dataDir
    writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT, name: 'demo', path: join(scratch, 'repo') }], activeId: PROJECT }))
    const { registerIpc, appUrlMatcher } = await import('../../src/main/ipc/index')
    handlers = new Map()
    await registerIpc(
      { handle: (channel, listener) => handlers.set(channel, listener as Listener) },
      {
        modules: { './cards.ts': () => import('../../src/main/ipc/cards').then((module) => module.default) },
        isTrustedSender: appUrlMatcher({ indexHtml: INDEX_HTML }),
      },
    )
  })

  afterEach(() => {
    for (const listener of electron.quitListeners) listener()
    delete process.env.WORFY_DATA_DIR
  })

  async function call(input: unknown): Promise<IpcResult<unknown>> {
    const listener = handlers.get(`${IPC_CHANNEL_PREFIX}cards.get`)
    if (!listener) throw new Error('cards.get is not registered')
    const event = { senderFrame: { url: `file://${INDEX_HTML}` }, sender: {} } as unknown as IpcMainInvokeEvent
    return (await listener(event, input)) as IpcResult<unknown>
  }

  it('answers cards.get with exactly the declared keys, extra input keys dropped', async () => {
    const result = await call({ projectId: PROJECT, cardId: 'c1', extra: 'dropped' })
    expect(result).toEqual({ ok: true, value: { projectId: PROJECT, cardId: 'c1', url: `${BASE}/index.html`, exists: true, title: 'Clock', revision: 0 } })
    if (!result.ok) return
    expect(Object.keys(result.value as object).sort()).toEqual(Object.keys(cardInfoSchema.shape).sort())
  })

  it('answers cards.file through the IPC handler: the file as it is, and "missing" outside the Card', async () => {
    const listener = handlers.get(`${IPC_CHANNEL_PREFIX}cards.file`)
    if (!listener) throw new Error('cards.file is not registered')
    const event = { senderFrame: { url: `file://${INDEX_HTML}` }, sender: {} } as unknown as IpcMainInvokeEvent
    const page = (await listener(event, { projectLabel: LABEL, cardId: 'c1', path: '/index.html' })) as IpcResult<{ status: string; base64?: string }>
    expect(page.ok && page.value.status).toBe('file')
    if (page.ok) expect(Buffer.from(page.value.base64 ?? '', 'base64').toString('utf8')).not.toContain('data-worfy-runtime')
    expect(await listener(event, { projectLabel: LABEL, cardId: 'c1', path: '/..%2F..%2Flayout.json' })).toEqual({ ok: true, value: { status: 'missing' } })
    expect(await listener(event, { projectLabel: 'ffffffff', cardId: 'c1', path: '/index.html' })).toEqual({ ok: true, value: { status: 'missing' } })
  })

  it('refuses a Card id of the wrong type or shape, and an unknown Project', async () => {
    for (const input of [{ projectId: PROJECT, cardId: 5 }, { projectId: PROJECT, cardId: '../c1' }, { projectId: PROJECT }, { projectId: 'nobody-ffffffff', cardId: 'c1' }]) {
      const result = await call(input)
      expect(result.ok, JSON.stringify(input)).toBe(false)
    }
  })

  it("the app's Card store stops watching the Cards of a Project removed from the Project list", async () => {
    const OTHER = 'other-0f0f0f0f'
    mkdirSync(cardDir('o1', OTHER), { recursive: true })
    writeFileSync(
      join(dataDir, 'projects.json'),
      JSON.stringify({ projects: [{ id: PROJECT, name: 'demo', path: join(scratch, 'repo') }, { id: OTHER, name: 'other', path: join(scratch, 'other') }], activeId: PROJECT }),
    )
    expect((await call({ projectId: PROJECT, cardId: 'c1' })).ok).toBe(true)
    expect((await call({ projectId: OTHER, cardId: 'o1' })).ok).toBe(true)
    const { cardStore } = await import('../../src/main/cards/store')
    const { projectStore } = await import('../../src/main/projects/store')
    expect(cardStore().watchedProjects()).toEqual([PROJECT, OTHER].sort())
    projectStore().remove(PROJECT)
    expect(cardStore().watchedProjects()).toEqual([OTHER])
  })

  it('broadcasts cards.changed to the windows after a Card file changes', async () => {
    await call({ projectId: PROJECT, cardId: 'c1' })
    await new Promise((done) => setTimeout(done, 300))
    writeFileSync(join(cardDir('c1'), 'js', 'app.js'), 'document.title = "tock"')
    await vi.waitFor(() => expect(electron.sent.some((message) => message.channel === `${IPC_CHANNEL_PREFIX}cards.changed`)).toBe(true), {
      timeout: 1000,
      interval: 20,
    })
    const payload = electron.sent.find((message) => message.channel === `${IPC_CHANNEL_PREFIX}cards.changed`)?.payload
    const info = cardInfoSchema.parse(payload)
    expect(info).toMatchObject({ projectId: PROJECT, cardId: 'c1', exists: true })
    expect(info.revision).toBeGreaterThanOrEqual(1)
  })
})
