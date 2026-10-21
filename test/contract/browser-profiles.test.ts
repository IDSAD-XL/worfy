// Browser profiles (worfy-browser ticket 03, ADR-0078 item 5) over a mocked `electron` and a
// temporary WORFY_DATA_DIR: the store (src/main/browser/profiles.ts) and the `browser.profiles.*`
// channels (src/main/ipc/browser.ts) create, change and delete profiles in the Project's data
// folder, never in its repository; deleting one erases its partition's storage; a read-only Linked
// machine reads the list and is refused a change; and installWebPolicy (src/main/window.ts), fed
// with the partitions of the profiles as src/main/index.ts feeds it, lets a <webview> attach only on
// a live profile's partition and guards each partition's own session.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { IpcMainInvokeEvent } from 'electron'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { appUrlMatcher, registerIpc } from '../../src/main/ipc/index'
import { BROWSER_PROFILES_FILE, BrowserProfileStore, browserProfilePartitions, browserProfileStore } from '../../src/main/browser/profiles'
import { createLinkIpc, LinkPeer, readOnlyRefusal } from '../../src/main/link/ipc-adapter'
import { installWebPolicy } from '../../src/main/window'
import { browserPartition } from '../../src/shared/browser/partition'
import { browserProfilesFileSchema, type BrowserProfile } from '../../src/shared/browser/profiles'
import { IPC_CHANNEL_PREFIX, type IpcResult } from '../../src/shared/ipc/channels'
import { APP_URL, INDEX_HTML } from '../app-url'
import { removeTestTree } from '../remove'

const env = await vi.hoisted(async () => {
  // Before any module of main is imported: the stores of the running app sit over dataRoot().
  const fs = await import('node:fs')
  const os = await import('node:os')
  const path = await import('node:path')
  const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'worfy-browser-profiles-')))
  process.env.WORFY_DATA_DIR = path.join(scratch, 'data')
  return { scratch }
})

type Listener = (...args: unknown[]) => void

/** The session of a partition as the code under test sees it: its permission handlers and what erased it. */
interface FakeSession {
  partition: string
  request?: Listener
  check?: Listener
  cleared: string[]
  /** The object `session.fromPartition` answers, made once, as Electron answers one per partition. */
  api?: object
}

/** A <webview> page open on a partition: closing it is logged with what erased the partitions. */
interface FakeGuest {
  partition: string
  destroyed: boolean
  onDestroyed: Listener[]
  /**
   * When the page is gone after close(): at once (the default), PAGE_GOES_MS later, or never — a
   * page that hangs in its unload.
   */
  goes?: 'now' | 'later' | 'never'
}

/** How long a page with `goes: 'later'` takes to go after close(). */
const PAGE_GOES_MS = 500

const electron = vi.hoisted(() => {
  const partitions = new Map<string, FakeSession>()
  return {
    appListeners: new Map<string, Listener[]>(),
    partitions,
    /** A partition whose clearStorageData fails, to see the refusal. */
    failing: new Set<string>(),
    /** The <webview> pages open now. */
    guests: [] as FakeGuest[],
    /** What happened to the pages and the storage, in order: `close <partition>`, `storage <partition>`. */
    log: [] as string[],
    /** The events sent to the windows, as [channel, payload]. */
    sent: [] as [string, unknown][],
    sessionOf(partition: string): FakeSession {
      let fake = partitions.get(partition)
      if (fake === undefined) {
        fake = { partition, cleared: [] }
        partitions.set(partition, fake)
      }
      return fake
    },
  }
})

vi.mock('electron', () => {
  const asSession = (fake: FakeSession): object => (fake.api ??= makeSession(fake))
  const makeSession = (fake: FakeSession) => ({
    setPermissionRequestHandler: (handler: Listener) => {
      fake.request = handler
    },
    setPermissionCheckHandler: (handler: Listener) => {
      fake.check = handler
    },
    clearStorageData: () => {
      if (electron.failing.has(fake.partition)) return Promise.reject(new Error('the disk said no'))
      fake.cleared.push('storage')
      electron.log.push(`storage ${fake.partition}`)
      return Promise.resolve()
    },
    clearCache: () => {
      fake.cleared.push('cache')
      return Promise.resolve()
    },
    clearAuthCache: () => {
      fake.cleared.push('auth')
      return Promise.resolve()
    },
  })
  const defaultSession = { setPermissionRequestHandler: () => undefined }
  return {
    app: {
      on: (event: string, listener: Listener) => {
        electron.appListeners.set(event, [...(electron.appListeners.get(event) ?? []), listener])
      },
    },
    BrowserWindow: {
      getAllWindows: () => [{ isDestroyed: () => false, webContents: { send: (channel: string, payload: unknown) => electron.sent.push([channel, payload]) } }],
    },
    webContents: {
      getAllWebContents: () =>
        electron.guests.map((guest) => ({
          isDestroyed: () => guest.destroyed,
          getType: () => 'webview',
          session: asSession(electron.sessionOf(guest.partition)),
          once: (event: string, listener: Listener) => {
            if (event === 'destroyed') guest.onDestroyed.push(listener)
          },
          close: () => {
            electron.log.push(`close ${guest.partition}`)
            const go = () => {
              guest.destroyed = true
              electron.log.push(`destroyed ${guest.partition}`)
              for (const listener of guest.onDestroyed) listener()
            }
            if (guest.goes === 'later') setTimeout(go, PAGE_GOES_MS)
            else if (guest.goes !== 'never') go()
          },
        })),
    },
    nativeTheme: {},
    screen: {},
    session: { defaultSession, fromPartition: (partition: string) => asSession(electron.sessionOf(partition)) },
  }
})

const ALPHA = 'alpha-0a1b2c3d'
const BETA = 'beta-99999999'
const dataDir = join(env.scratch, 'data')
const repoOf = (name: string) => join(env.scratch, 'repos', name)

/** Writes the Projects of this Machine: alpha and beta, each with a repository folder holding one file. */
function projects(): void {
  for (const name of ['alpha', 'beta']) {
    mkdirSync(repoOf(name), { recursive: true })
    writeFileSync(join(repoOf(name), 'README.md'), 'a repository\n')
  }
  mkdirSync(dataDir, { recursive: true })
  writeFileSync(
    join(dataDir, 'projects.json'),
    JSON.stringify({
      projects: [
        { id: ALPHA, name: 'alpha', path: repoOf('alpha') },
        { id: BETA, name: 'beta', path: repoOf('beta') },
      ],
      activeId: ALPHA,
    }),
  )
}
projects()

afterAll(() => removeTestTree(env.scratch))

const fileOf = (projectId: string) => join(dataDir, projectId, BROWSER_PROFILES_FILE)
const onDisk = (projectId: string): BrowserProfile[] => browserProfilesFileSchema.parse(JSON.parse(readFileSync(fileOf(projectId), 'utf8'))).profiles

/** Every path under `dir`, relative to it. */
function tree(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' }).sort()
}

let handlers: Map<string, (event: IpcMainInvokeEvent, input: unknown) => unknown>

beforeEach(async () => {
  for (const id of [ALPHA, BETA]) removeTestTree(join(dataDir, id))
  electron.partitions.clear()
  electron.failing.clear()
  electron.guests.length = 0
  electron.log.length = 0
  electron.sent.length = 0
  handlers = new Map()
  await registerIpc(
    { handle: (channel, listener) => handlers.set(channel, listener as never) },
    { modules: { './browser.ts': () => import('../../src/main/ipc/browser').then((module) => module.default) }, isTrustedSender: appUrlMatcher({ indexHtml: INDEX_HTML }) },
  )
})

/** Calls a handler as a window of this Machine does. */
async function call(channel: string, input: unknown): Promise<IpcResult<unknown>> {
  const listener = handlers.get(IPC_CHANNEL_PREFIX + channel)
  if (!listener) throw new Error(`no handler for ${channel}`)
  return (await listener({ senderFrame: { url: APP_URL }, sender: {} } as unknown as IpcMainInvokeEvent, input)) as IpcResult<unknown>
}

async function value<T = BrowserProfile>(channel: string, input: unknown): Promise<T> {
  const answer = await call(channel, input)
  if (!answer.ok) throw new Error(answer.error)
  return answer.value as T
}

describe('the Browser profiles of a Project, over the channels', () => {
  it('a Project without a file has «Default»; reading writes nothing, the first change writes the file in its data folder, and nothing in its repository', async () => {
    const repoBefore = tree(repoOf('alpha'))
    expect(existsSync(fileOf(ALPHA))).toBe(false)
    const { profiles } = await value<{ profiles: BrowserProfile[] }>('browser.profiles.list', { projectId: ALPHA })
    expect(profiles).toEqual([{ id: 'default', name: 'Default', origins: [], autopilot: false }])
    expect(existsSync(fileOf(ALPHA)), 'a read channel changes no file (ADR-0066)').toBe(false)
    const admin = await value('browser.profiles.create', { projectId: ALPHA, name: 'admin' })
    expect(onDisk(ALPHA)).toEqual([...profiles, admin])
    expect(fileOf(ALPHA).startsWith(join(dataDir, ALPHA))).toBe(true)
    expect(tree(repoOf('alpha')), 'the repository is as it was').toEqual(repoBefore)
    expect(tree(repoOf('alpha'))).not.toContain(BROWSER_PROFILES_FILE)
  })

  it('creates, renames and changes a profile; its id, and so its partition, stay', async () => {
    const admin = await value('browser.profiles.create', { projectId: ALPHA, name: ' admin ', origins: ['http://localhost:3000', 'HTTPS://Staging.Example.com:443/', 'http://localhost:3000'] })
    expect(admin).toMatchObject({ name: 'admin', origins: ['http://localhost:3000', 'https://staging.example.com'], autopilot: false })
    expect(admin.id).toMatch(/^admin-[0-9a-f]{6}$/)
    expect(onDisk(ALPHA).map((profile) => profile.name)).toEqual(['Default', 'admin'])

    const renamed = await value('browser.profiles.update', { projectId: ALPHA, id: admin.id, name: 'moderator', origins: [], autopilot: true })
    expect(renamed).toEqual({ id: admin.id, name: 'moderator', origins: [], autopilot: true })
    expect(onDisk(ALPHA).find((profile) => profile.id === admin.id)).toEqual(renamed)
    // Only the name changed in the partition's eyes: it is named by the id.
    expect(browserPartition(ALPHA, renamed.id)).toBe(`persist:worfy-browser-0a1b2c3d-${admin.id}`)
    // A change that names only the flag keeps the rest.
    expect(await value('browser.profiles.update', { projectId: ALPHA, id: admin.id, autopilot: false })).toEqual({ ...renamed, autopilot: false })
    // A change that names only the name keeps the origins and the flag.
    const withOrigins = await value('browser.profiles.update', { projectId: ALPHA, id: admin.id, origins: ['http://localhost:3000'], autopilot: true })
    expect(await value('browser.profiles.update', { projectId: ALPHA, id: admin.id, name: 'admin' })).toEqual({ ...withOrigins, name: 'admin' })
    expect(onDisk(ALPHA).find((profile) => profile.id === admin.id)).toEqual({ ...withOrigins, name: 'admin' })
  })

  it('refuses a rename to a name another profile of the Project has, in any case, and keeps the file', async () => {
    const admin = await value('browser.profiles.create', { projectId: ALPHA, name: 'admin' })
    await value('browser.profiles.create', { projectId: ALPHA, name: 'user' })
    const before = readFileSync(fileOf(ALPHA), 'utf8')
    for (const name of ['user', 'USER', ' Default ']) {
      expect(await call('browser.profiles.update', { projectId: ALPHA, id: admin.id, name }), name).toMatchObject({ ok: false, error: expect.stringMatching(/already exists/) })
    }
    expect(readFileSync(fileOf(ALPHA), 'utf8')).toBe(before)
    // Its own name, in another case, is not taken.
    expect(await value('browser.profiles.update', { projectId: ALPHA, id: admin.id, name: 'Admin' })).toMatchObject({ id: admin.id, name: 'Admin' })
  })

  it('tells every window after a create, a change and a delete, also when the storage could not be erased; a read tells none', async () => {
    const changed = () => electron.sent.filter(([channel]) => channel === `${IPC_CHANNEL_PREFIX}browser.profiles.changed`).map(([, payload]) => payload)
    await value('browser.profiles.list', { projectId: ALPHA })
    expect(changed()).toEqual([])
    const admin = await value('browser.profiles.create', { projectId: ALPHA, name: 'admin' })
    expect(changed()).toEqual([{ projectId: ALPHA }])
    await value('browser.profiles.update', { projectId: ALPHA, id: admin.id, autopilot: true })
    expect(changed()).toHaveLength(2)
    await value('browser.profiles.delete', { projectId: ALPHA, id: admin.id })
    expect(changed()).toEqual([{ projectId: ALPHA }, { projectId: ALPHA }, { projectId: ALPHA }])
    electron.failing.add(browserPartition(ALPHA, 'default')!)
    expect(await call('browser.profiles.delete', { projectId: ALPHA, id: 'default' })).toMatchObject({ ok: false })
    expect(changed()).toHaveLength(4)
    // A refused change tells nobody.
    expect(await call('browser.profiles.create', { projectId: ALPHA, name: 'x', origins: ['https://*.example.com'] })).toMatchObject({ ok: false })
    expect(changed()).toHaveLength(4)
  })

  it('refuses an origin that is not exact, a name the Project has, and an unknown profile, and writes nothing then', async () => {
    await value('browser.profiles.create', { projectId: ALPHA, name: 'user' })
    const before = readFileSync(fileOf(ALPHA), 'utf8')
    for (const origins of [['https://*.example.com'], ['https://example.com/path'], ['ftp://example.com']]) {
      const answer = await call('browser.profiles.create', { projectId: ALPHA, name: 'admin', origins })
      expect(answer, origins[0]).toMatchObject({ ok: false })
    }
    expect(await call('browser.profiles.create', { projectId: ALPHA, name: 'default' })).toMatchObject({ ok: false, error: expect.stringMatching(/already exists/) })
    expect(await call('browser.profiles.update', { projectId: ALPHA, id: 'default', origins: ['http://*'] })).toMatchObject({ ok: false })
    expect(await call('browser.profiles.update', { projectId: ALPHA, id: 'nobody-000000', name: 'x' })).toMatchObject({ ok: false, error: expect.stringMatching(/no Browser profile/) })
    expect(await call('browser.profiles.create', { projectId: ALPHA, name: '   ' })).toMatchObject({ ok: false })
    // An id main did not make is refused before the handler runs.
    expect(await call('browser.profiles.update', { projectId: ALPHA, id: '../x', name: 'x' })).toMatchObject({ ok: false })
    expect(readFileSync(fileOf(ALPHA), 'utf8')).toBe(before)
    // A Project this Machine does not have.
    expect(await call('browser.profiles.list', { projectId: 'gamma-12345678' })).toMatchObject({ ok: false })
  })

  it('deleting a profile drops it from the file and erases its partition\'s storage, and only its', async () => {
    const admin = await value('browser.profiles.create', { projectId: ALPHA, name: 'admin' })
    const user = await value('browser.profiles.create', { projectId: ALPHA, name: 'user' })
    expect(await value('browser.profiles.delete', { projectId: ALPHA, id: admin.id })).toEqual({ id: admin.id })
    expect(onDisk(ALPHA).map((profile) => profile.id)).toEqual(['default', user.id])
    expect(electron.partitions.get(browserPartition(ALPHA, admin.id)!)?.cleared).toEqual(['storage', 'cache', 'auth'])
    expect(electron.partitions.get(browserPartition(ALPHA, user.id)!)?.cleared ?? []).toEqual([])
    expect(electron.partitions.get(browserPartition(ALPHA, 'default')!)?.cleared ?? []).toEqual([])
    // Gone: a second delete is refused.
    expect(await call('browser.profiles.delete', { projectId: ALPHA, id: admin.id })).toMatchObject({ ok: false })
  })

  it('closes the pages still open on the profile before it erases the storage, and only those pages', async () => {
    const admin = await value('browser.profiles.create', { projectId: ALPHA, name: 'admin' })
    const [gone, kept] = [browserPartition(ALPHA, admin.id)!, browserPartition(ALPHA, 'default')!]
    electron.guests.push({ partition: gone, destroyed: false, onDestroyed: [] }, { partition: kept, destroyed: false, onDestroyed: [] }, { partition: gone, destroyed: false, onDestroyed: [] })
    await value('browser.profiles.delete', { projectId: ALPHA, id: admin.id })
    expect(electron.log).toEqual([`close ${gone}`, `destroyed ${gone}`, `close ${gone}`, `destroyed ${gone}`, `storage ${gone}`])
    expect(electron.guests.map((guest) => guest.destroyed)).toEqual([true, false, true])
  })

  describe('a page that takes its time to go (fake timers)', () => {
    beforeEach(() => {
      // Only the timers: the files and the IPC run as they do.
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    /** Lets the promises of the delete run, without moving the fake clock. */
    const settle = async (): Promise<void> => {
      for (let turn = 0; turn < 20; turn += 1) await new Promise((resolve) => setImmediate(resolve))
    }

    it('erases the storage only once the page is gone, not when it is asked to close', async () => {
      const admin = await value('browser.profiles.create', { projectId: ALPHA, name: 'admin' })
      const gone = browserPartition(ALPHA, admin.id)!
      electron.guests.push({ partition: gone, destroyed: false, onDestroyed: [], goes: 'later' })
      const deleting = call('browser.profiles.delete', { projectId: ALPHA, id: admin.id })
      await settle()
      expect(electron.log).toEqual([`close ${gone}`])
      await vi.advanceTimersByTimeAsync(PAGE_GOES_MS - 1)
      await settle()
      expect(electron.log, 'the page is still there: nothing erased yet').toEqual([`close ${gone}`])
      await vi.advanceTimersByTimeAsync(1)
      expect(await deleting).toEqual({ ok: true, value: { id: admin.id } })
      expect(electron.log).toEqual([`close ${gone}`, `destroyed ${gone}`, `storage ${gone}`])
      expect(electron.partitions.get(gone)?.cleared).toEqual(['storage', 'cache', 'auth'])
    })

    it('erases the storage anyway when a page has not gone 2 s after it was asked to close (CLOSE_PAGE_MS)', async () => {
      const admin = await value('browser.profiles.create', { projectId: ALPHA, name: 'admin' })
      const gone = browserPartition(ALPHA, admin.id)!
      electron.guests.push({ partition: gone, destroyed: false, onDestroyed: [], goes: 'never' }, { partition: gone, destroyed: false, onDestroyed: [], goes: 'later' })
      const deleting = call('browser.profiles.delete', { projectId: ALPHA, id: admin.id })
      await settle()
      await vi.advanceTimersByTimeAsync(1999)
      await settle()
      expect(electron.log, 'one page went, the other hangs: nothing erased yet').toEqual([`close ${gone}`, `close ${gone}`, `destroyed ${gone}`])
      await vi.advanceTimersByTimeAsync(1)
      expect(await deleting).toEqual({ ok: true, value: { id: admin.id } })
      expect(electron.log).toEqual([`close ${gone}`, `close ${gone}`, `destroyed ${gone}`, `storage ${gone}`])
      expect(electron.partitions.get(gone)?.cleared).toEqual(['storage', 'cache', 'auth'])
    })
  })

  it('Default can be renamed and deleted like any other; a Project whose list was emptied keeps it empty', async () => {
    expect(await value('browser.profiles.update', { projectId: ALPHA, id: 'default', name: 'user' })).toMatchObject({ id: 'default', name: 'user' })
    await value('browser.profiles.delete', { projectId: ALPHA, id: 'default' })
    expect(electron.partitions.get(browserPartition(ALPHA, 'default')!)?.cleared).toEqual(['storage', 'cache', 'auth'])
    expect(await value<{ profiles: BrowserProfile[] }>('browser.profiles.list', { projectId: ALPHA })).toEqual({ profiles: [] })
    expect(onDisk(ALPHA)).toEqual([])
  })

  it('names a storage that could not be erased; the profile is deleted by then', async () => {
    const admin = await value('browser.profiles.create', { projectId: ALPHA, name: 'admin' })
    electron.failing.add(browserPartition(ALPHA, admin.id)!)
    expect(await call('browser.profiles.delete', { projectId: ALPHA, id: admin.id })).toMatchObject({ ok: false, error: expect.stringMatching(/could not be erased/) })
    expect(onDisk(ALPHA).map((profile) => profile.id)).toEqual(['default'])
  })
})

describe('the store', () => {
  const fresh = (randomHex: () => string, clearPartition: (partition: string) => Promise<void> = () => Promise.resolve()) =>
    new BrowserProfileStore({ dataDirOf: (projectId) => join(env.scratch, 'store', projectId), clearPartition, randomHex })

  it('reads the ids for the attach check without writing a file', () => {
    const store = fresh(() => 'aaaaaa')
    expect(store.ids('delta-00000001')).toEqual(['default'])
    expect(existsSync(store.file('delta-00000001'))).toBe(false)
  })

  it('never gives a new profile an id taken now or `default`, and never one from a name alone', () => {
    const hexes = ['aaaaaa', 'aaaaaa', 'bbbbbb']
    const store = fresh(() => hexes.shift() ?? 'cccccc')
    const first = store.create('delta-00000002', { name: 'Admin user!' })
    expect(first.id).toBe('admin-user-aaaaaa')
    // The same random part again: tried once more.
    expect(store.create('delta-00000002', { name: 'admin-user' }).id).toBe('admin-user-bbbbbb')
    // A name with no ASCII letter or digit.
    expect(store.create('delta-00000002', { name: '\u65e5\u672c' }).id).toBe('profile-cccccc')
  })
})

describe('the read-only screen of a Linked machine (ADR-0066)', () => {
  it('reads the list, and is refused a create, a change and a delete before the handler runs', async () => {
    const adapter = await createLinkIpc({ modules: { './browser.ts': () => import('../../src/main/ipc/browser').then((module) => module.default) }, isLinked: () => true })
    const peer = new LinkPeer({ machineId: 'mac', describe: () => 'mac', push: () => undefined, local: () => ({ id: 'here', name: 'Here', protocol: 1, build: 'test' }), warn: () => undefined })
    peer.setAccess('read')
    const listed = await adapter.call(peer, 'browser.profiles.list', { projectId: ALPHA }, 'Here')
    expect(listed).toEqual({ ok: true, value: { profiles: [{ id: 'default', name: 'Default', origins: [], autopilot: false }] } })
    // Reading made no file on this Machine (ADR-0066: a read changes nothing).
    expect(existsSync(fileOf(ALPHA))).toBe(false)
    // With a file, the reads and the refused changes leave it as it was.
    await value('browser.profiles.create', { projectId: ALPHA, name: 'user' })
    electron.partitions.clear()
    const before = readFileSync(fileOf(ALPHA), 'utf8')
    expect(await adapter.call(peer, 'browser.profiles.list', { projectId: ALPHA }, 'Here')).toMatchObject({ ok: true })
    expect(await adapter.call(peer, 'browser.profiles.create', { projectId: ALPHA, name: 'admin' }, 'Here')).toEqual({ ok: false, error: readOnlyRefusal('Here') })
    expect(await adapter.call(peer, 'browser.profiles.update', { projectId: ALPHA, id: 'default', name: 'x' }, 'Here')).toEqual({ ok: false, error: readOnlyRefusal('Here') })
    expect(await adapter.call(peer, 'browser.profiles.delete', { projectId: ALPHA, id: 'default' }, 'Here')).toEqual({ ok: false, error: readOnlyRefusal('Here') })
    expect(readFileSync(fileOf(ALPHA), 'utf8')).toBe(before)
    expect(electron.partitions.size).toBe(0)
    peer.close()
  })
})

describe('installWebPolicy over the partitions of the Browser profiles', () => {
  /** installWebPolicy as src/main/index.ts calls it, and a window that asks to attach <webview>s. */
  function windowWithPolicy() {
    electron.appListeners.clear()
    installWebPolicy(appUrlMatcher({ indexHtml: INDEX_HTML }), () => browserProfilePartitions([ALPHA, BETA], browserProfileStore()))
    const listeners = new Map<string, Listener>()
    const contents = {
      getType: () => 'window',
      on: (event: string, listener: Listener) => listeners.set(event, listener),
      setWindowOpenHandler: () => undefined,
    }
    for (const listener of electron.appListeners.get('web-contents-created') ?? []) listener({}, contents)
    return {
      /** Whether a <webview> on `partition` may attach. */
      attach: (partition: string | null): boolean => {
        const preventDefault = vi.fn()
        listeners.get('will-attach-webview')?.({ preventDefault }, { nodeIntegration: false, contextIsolation: true, sandbox: true, partition: partition ?? '' }, {})
        return preventDefault.mock.calls.length === 0
      },
    }
  }

  const requested = (fake: FakeSession | undefined, permission: string): unknown => {
    const callback = vi.fn()
    fake?.request?.({}, permission, callback, { requestingUrl: 'http://127.0.0.1:3000/' })
    return callback.mock.calls[0]?.[0]
  }

  it('lets a <webview> attach only on a live profile of a Project of this Machine', async () => {
    const window = windowWithPolicy()
    const admin = await value('browser.profiles.create', { projectId: ALPHA, name: 'admin' })
    expect(window.attach(browserPartition(ALPHA, 'default')), 'Default of alpha').toBe(true)
    expect(window.attach(browserPartition(ALPHA, admin.id)), 'admin of alpha').toBe(true)
    // beta has no file yet: it has Default.
    expect(window.attach(browserPartition(BETA, 'default')), 'Default of beta').toBe(true)
    expect(window.attach(browserPartition(BETA, admin.id)), 'alpha\'s profile id under beta').toBe(false)
    expect(window.attach(browserPartition('gamma-12345678', 'default')), 'a Project this Machine does not have').toBe(false)
    expect(window.attach(browserPartition(ALPHA, 'never-000000')), 'a profile alpha never had').toBe(false)

    await value('browser.profiles.delete', { projectId: ALPHA, id: admin.id })
    expect(window.attach(browserPartition(ALPHA, admin.id)), 'a deleted profile').toBe(false)
  })

  it('reads an unreadable file of a Project as no file: it is set aside, the Project is back to Default, the other Project keeps its profiles', async () => {
    const window = windowWithPolicy()
    const admin = await value('browser.profiles.create', { projectId: ALPHA, name: 'admin' })
    const user = await value('browser.profiles.create', { projectId: BETA, name: 'user' })
    await value('browser.profiles.delete', { projectId: ALPHA, id: 'default' })
    writeFileSync(fileOf(ALPHA), '{ not json')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      expect(window.attach(browserPartition(ALPHA, admin.id)), 'a profile of the unreadable file').toBe(false)
      expect(window.attach(browserPartition(ALPHA, 'default')), 'Default, as for a missing file').toBe(true)
      expect(window.attach(browserPartition(BETA, user.id)), 'a profile of the other Project').toBe(true)
    } finally {
      warn.mockRestore()
    }
    expect(existsSync(fileOf(ALPHA))).toBe(false)
    expect(readdirSync(join(dataDir, ALPHA)).some((name) => name.startsWith(`${BROWSER_PROFILES_FILE}.unreadable-`))).toBe(true)
  })

  it('gives no partition to a Project whose data folder cannot be read; the others keep theirs', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const store = new BrowserProfileStore({
        dataDirOf: (projectId) => {
          if (projectId === ALPHA) throw new Error('no such Project')
          return join(env.scratch, 'store', projectId)
        },
        clearPartition: () => Promise.resolve(),
      })
      expect(browserProfilePartitions([ALPHA, BETA], store)).toEqual([browserPartition(BETA, 'default')])
      expect(errors).toHaveBeenCalledTimes(1)
    } finally {
      errors.mockRestore()
    }
  })

  it('guards the session of each profile\'s partition with its own handlers: every request refused, every check false', async () => {
    const window = windowWithPolicy()
    const admin = await value('browser.profiles.create', { projectId: ALPHA, name: 'admin' })
    const user = await value('browser.profiles.create', { projectId: ALPHA, name: 'user' })
    const adminPartition = browserPartition(ALPHA, admin.id)!
    const userPartition = browserPartition(ALPHA, user.id)!
    expect(electron.partitions.has(adminPartition), 'no session before a Browser attaches').toBe(false)

    expect(window.attach(adminPartition)).toBe(true)
    expect(window.attach(userPartition)).toBe(true)
    const adminSession = electron.partitions.get(adminPartition)
    const userSession = electron.partitions.get(userPartition)
    expect(adminSession).toBeDefined()
    expect(userSession).toBeDefined()
    expect(adminSession).not.toBe(userSession)
    for (const fake of [adminSession, userSession]) {
      expect(fake?.request).toBeTypeOf('function')
      expect(fake?.check).toBeTypeOf('function')
      for (const permission of ['media', 'notifications', 'geolocation', 'clipboard-read']) {
        expect(requested(fake, permission), permission).toBe(false)
        expect(fake?.check?.({}, permission, 'http://127.0.0.1:3000', {}), permission).toBe(false)
      }
    }
    // Each session has its own handlers, not the other's.
    expect(adminSession?.request).not.toBe(userSession?.request)
  })
})
