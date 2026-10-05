// The worfy-card:// protocol (src/main/cards/protocol.ts), the Card store behind it
// (src/main/cards/store.ts) and the `cards` IPC domain (src/main/ipc/cards.ts) on a temporary data
// folder: which files a Card gets, with which headers, that nothing outside the Card's own folder
// is ever served, and that a change of a Card's files is reported within a second.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
  CARD_CSP,
  CARD_SCHEME,
} from '../../src/main/cards/protocol'
import { CardStore, titleOf } from '../../src/main/cards/store'
import { projectId, projectIdHash } from '../../src/main/projects/store'

const INDEX_HTML = '/Applications/worfy.app/Contents/Resources/app/out/renderer/index.html'

const electron = vi.hoisted(() => {
  const sent: { channel: string; payload: unknown }[] = []
  const quitListeners: (() => void)[] = []
  const window = { isDestroyed: () => false, webContents: { send: (channel: string, payload: unknown) => sent.push({ channel, payload }) } }
  return { sent, quitListeners, window }
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
        writeFileSync(join(cardDir('c1'), 'index.html'), '<title>Clock v2</title>')
        // The file event arrives well inside the 300 ms quiet period; the Project leaves before it ends.
        await sleep(150)
        removeFromList(PROJECT)
        await sleep(500)
        expect(seen.filter((info) => info.projectId === PROJECT)).toEqual([])
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

  it('refuses a Card id of the wrong type or shape, and an unknown Project', async () => {
    for (const input of [{ projectId: PROJECT, cardId: 5 }, { projectId: PROJECT, cardId: '../c1' }, { projectId: PROJECT }, { projectId: 'nobody-ffffffff', cardId: 'c1' }]) {
      const result = await call(input)
      expect(result.ok, JSON.stringify(input)).toBe(false)
    }
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
