// The `projects` channels end to end in main: src/main/ipc/projects.ts registered through
// registerIpc (the same wrapper the app uses) over a mocked `electron`, against real git
// repositories in a temporary folder and a temporary WORFY_DATA_DIR.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IpcMainInvokeEvent } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNEL_PREFIX, type IpcResult } from '../../src/shared/ipc/channels'

const INDEX_HTML = '/Applications/worfy.app/Contents/Resources/app/out/renderer/index.html'

const electron = vi.hoisted(() => {
  const sent: { channel: string; payload: unknown }[] = []
  const window = { isDestroyed: () => false, webContents: { send: (channel: string, payload: unknown) => sent.push({ channel, payload }) } }
  return {
    sent,
    showOpenDialog: vi.fn<() => Promise<{ canceled: boolean; filePaths: string[] }>>(),
    window,
  }
})

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [electron.window], fromWebContents: () => null },
  dialog: { showOpenDialog: electron.showOpenDialog },
}))

type Listener = (event: IpcMainInvokeEvent, input: unknown) => unknown

let scratch: string
let dataDir: string
let handlers: Map<string, Listener>

/** git for the fixtures, without GIT_* variables of a surrounding hook. */
function git(cwd: string, ...args: string[]): string {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd, env, encoding: 'utf8' }).trim()
}

function makeRepo(name: string, branch = 'main'): string {
  const dir = join(scratch, name)
  mkdirSync(dir, { recursive: true })
  git(dir, 'init', '-q', '-b', branch)
  writeFileSync(join(dir, 'README.md'), name)
  git(dir, 'add', 'README.md')
  git(dir, 'commit', '-q', '-m', 'init')
  return realpathSync(dir)
}

/** Loads src/main/ipc/projects.ts afresh, as an app start does, over the current data dir. */
async function start(): Promise<void> {
  vi.resetModules()
  process.env.WORFY_DATA_DIR = dataDir
  const { registerIpc, appUrlMatcher } = await import('../../src/main/ipc/index')
  handlers = new Map()
  await registerIpc(
    { handle: (channel, listener) => handlers.set(channel, listener as Listener) },
    {
      modules: { './projects.ts': () => import('../../src/main/ipc/projects').then((module) => module.default) },
      isTrustedSender: appUrlMatcher({ indexHtml: INDEX_HTML }),
    },
  )
}

async function call(channel: string, input?: unknown): Promise<IpcResult<unknown>> {
  const listener = handlers.get(IPC_CHANNEL_PREFIX + channel)
  if (!listener) throw new Error(`no handler for ${channel}`)
  const event = { senderFrame: { url: `file://${INDEX_HTML}` }, sender: {} } as unknown as IpcMainInvokeEvent
  return (await listener(event, input)) as IpcResult<unknown>
}

/** The value of a call that must succeed. */
async function value<T = Record<string, unknown>>(channel: string, input?: unknown): Promise<T> {
  const result = await call(channel, input)
  if (!result.ok) throw new Error(`${channel} failed: ${result.error}`)
  return result.value as T
}

interface View {
  id: string
  name: string
  path: string
  branch: string | null
}
interface State {
  projects: View[]
  activeId: string | null
  revision: number
}
type Added = { status: 'added'; project: View; notice: string | null; state: State } | { status: 'rejected'; reason: string }

async function add(path: string): Promise<Added> {
  return value<Added>('projects.add', { path })
}

async function addOk(path: string): Promise<Extract<Added, { status: 'added' }>> {
  const result = await add(path)
  if (result.status !== 'added') throw new Error(`rejected: ${result.reason}`)
  return result
}

/** Everything git would report in the repository, ignored files included. */
function repoStatus(repo: string): string {
  return git(repo, 'status', '--porcelain', '--ignored', '--untracked-files=all')
}

/**
 * The Claude home of the test (WORFY_CLAUDE_HOME): the default templates follow the Harness found
 * there (worfy-harness ticket 12), so the test brings its own instead of reading the machine's
 * ~/.claude. It starts with the old Harness, <home>/bin/epic-status.
 */
let claudeHome: string

/** Puts the Harness plugin into <claudeHome>/worfy-harness and, unless `keepOld`, takes the old Harness away. */
function switchToPlugin(keepOld = false): void {
  const plugin = join(claudeHome, 'worfy-harness', 'plugin')
  mkdirSync(join(plugin, '.claude-plugin'), { recursive: true })
  mkdirSync(join(plugin, 'bin'), { recursive: true })
  writeFileSync(join(plugin, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'worfy' }))
  writeFileSync(join(plugin, 'bin', 'epic-status'), '#!/bin/sh\n')
  if (!keepOld) rmSync(join(claudeHome, 'bin'), { recursive: true, force: true })
}

const LEGACY_TEMPLATES = { shipTicket: '/ship-ticket {epic} {NN}', runWave: '/epic-wave Ticket-ы {tickets} эпика {epic}' }
const PLUGIN_TEMPLATES = { shipTicket: '/worfy:ship-ticket {epic} {NN}', runWave: '/worfy:epic-wave tickets {tickets} of epic {epic}' }

beforeEach(async () => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-projects-')))
  dataDir = join(scratch, 'data')
  claudeHome = join(scratch, 'claude-home')
  mkdirSync(join(claudeHome, 'bin'), { recursive: true })
  writeFileSync(join(claudeHome, 'bin', 'epic-status'), '#!/bin/sh\n')
  vi.stubEnv('WORFY_CLAUDE_HOME', claudeHome)
  vi.stubEnv('WORFY_HARNESS_HOME', '')
  electron.sent.length = 0
  electron.showOpenDialog.mockReset()
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  await start()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  delete process.env.WORFY_DATA_DIR
  rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

describe('projects.add', () => {
  it('adds a repository root, makes it active and reports its branch', async () => {
    const repo = makeRepo('auction', 'trunk')
    const result = await addOk(repo)
    expect(result.notice).toBeNull()
    expect(result.project).toStrictEqual({ id: expect.stringMatching(/^auction-[0-9a-f]{8}$/), name: 'auction', path: repo, branch: 'trunk' })
    expect(result.state.activeId).toBe(result.project.id)
    expect(await value('projects.list')).toStrictEqual(result.state)
  })

  it('creates the Project data folder <name>-<sha256(path)[0:8]> under WORFY_DATA_DIR with default settings', async () => {
    const repo = makeRepo('auction')
    const { createHash } = await import('node:crypto')
    const { project } = await addOk(repo)
    expect(project.id).toBe(`auction-${createHash('sha256').update(repo).digest('hex').slice(0, 8)}`)
    const settings = JSON.parse(readFileSync(join(dataDir, project.id, 'settings.json'), 'utf8')) as unknown
    expect(settings).toStrictEqual({ actionTemplates: { shipTicket: '/ship-ticket {epic} {NN}', runWave: '/epic-wave Ticket-ы {tickets} эпика {epic}' } })
    expect(existsSync(join(dataDir, 'projects.json'))).toBe(true)
  })

  it('resolves a subfolder to the repository root and says so', async () => {
    const repo = makeRepo('auction')
    mkdirSync(join(repo, 'src', 'deep'), { recursive: true })
    const result = await addOk(join(repo, 'src', 'deep'))
    expect(result.project.path).toBe(repo)
    expect(result.notice).toMatch(/inside the repository .*repository root was added/)
  })

  it('resolves a linked worktree to the main repository root and says so', async () => {
    const repo = makeRepo('auction')
    const worktree = join(scratch, 'auction-wt')
    git(repo, 'worktree', 'add', '-q', '-b', 'feature', worktree)
    const result = await addOk(worktree)
    expect(result.project.path).toBe(repo)
    expect(result.project.branch).toBe('main')
    expect(result.notice).toMatch(/is a worktree of .*repository root was added/)
  })

  it('rejects a folder that is not in a git repository, with a reason for the user', async () => {
    const plain = join(scratch, 'plain')
    mkdirSync(plain)
    expect(await add(plain)).toStrictEqual({ status: 'rejected', reason: `${plain} is not a git repository. Choose the folder of a git repository.` })
    expect(await add(join(scratch, 'missing'))).toStrictEqual({ status: 'rejected', reason: `${join(scratch, 'missing')} does not exist.` })
    expect((await value<State>('projects.list')).projects).toEqual([])
  })

  it('does not list a repository twice', async () => {
    const repo = makeRepo('auction')
    await addOk(repo)
    const again = await addOk(repo)
    expect(again.notice).toBe('auction is already in the list.')
    expect(again.state.projects).toHaveLength(1)
  })

  it('keeps the settings of a repository that is added again', async () => {
    const repo = makeRepo('auction')
    const { project } = await addOk(repo)
    const changed = { actionTemplates: { shipTicket: '/ship {epic}/{NN}', runWave: '' } }
    await value('projects.settings.set', { id: project.id, settings: changed })
    await addOk(repo)
    expect(await value('projects.settings.get', { id: project.id })).toStrictEqual(changed)
  })

  it('shows the branch of a repository that has no commits yet', async () => {
    const empty = join(scratch, 'fresh')
    mkdirSync(empty)
    git(empty, 'init', '-q', '-b', 'start')
    const result = await addOk(realpathSync(empty))
    expect(result.project.branch).toBe('start')
  })

  it('refuses an input of the wrong type before the handler runs', async () => {
    const result = await call('projects.add', { path: 42 })
    expect(result.ok).toBe(false)
    expect(!result.ok && result.error).toMatch(/projects\.add: invalid input/)
    expect(existsSync(join(dataDir, 'projects.json'))).toBe(false)
  })
})

describe('projects.select and projects.remove', () => {
  it('switches the active Project and tells every window', async () => {
    const first = (await addOk(makeRepo('auction'))).project
    const second = (await addOk(makeRepo('worfy', 'dev'))).project
    const state = await value<State>('projects.select', { id: first.id })
    expect(state.activeId).toBe(first.id)
    // Broadcasts are asynchronous (they ask git for branches); the one for this select carries
    // the revision the select answered with. The id check skips a late broadcast of an earlier
    // test: ids hash the repository path, which is new in every test.
    const forSelect = () =>
      electron.sent.filter(({ payload }) => (payload as State).revision === state.revision && (payload as State).activeId === first.id)
    await vi.waitFor(() => expect(forSelect()).toHaveLength(1))
    expect(forSelect()[0]).toStrictEqual({ channel: 'worfy:projects.changed', payload: state })
    expect(state.projects.map((project) => [project.name, project.branch])).toEqual([
      ['auction', 'main'],
      ['worfy', 'dev'],
    ])
    expect(second.branch).toBe('dev')
  })

  it('removes a Project from the list and keeps its data folder', async () => {
    const first = (await addOk(makeRepo('auction'))).project
    const second = (await addOk(makeRepo('worfy'))).project
    const state = await value<State>('projects.remove', { id: second.id })
    expect(state.projects.map((project) => project.id)).toEqual([first.id])
    // The active one was removed: the first remaining Project becomes active.
    expect(state.activeId).toBe(first.id)
    expect(existsSync(join(dataDir, second.id, 'settings.json'))).toBe(true)
    expect((await value<State>('projects.remove', { id: first.id })).activeId).toBeNull()
  })

  it('answers an unknown id with an error and changes nothing', async () => {
    await addOk(makeRepo('auction'))
    const before = await value<State>('projects.list')
    for (const channel of ['projects.select', 'projects.remove', 'projects.settings.get']) {
      const result = await call(channel, { id: 'nope-00000000' })
      expect(result.ok).toBe(false)
      expect(!result.ok && result.error).toMatch(/No Project with id nope-00000000/)
    }
    expect(await value('projects.list')).toStrictEqual(before)
  })

  it('refuses an id of the wrong type', async () => {
    const result = await call('projects.select', { id: 42 })
    expect(result.ok).toBe(false)
    expect(!result.ok && result.error).toMatch(/invalid input/)
  })
})

describe('persistence', () => {
  it('keeps the list and the active Project across a restart', async () => {
    const first = (await addOk(makeRepo('auction'))).project
    await addOk(makeRepo('worfy'))
    await value('projects.select', { id: first.id })
    const before = await value<State>('projects.list')

    await start()
    const after = await value<State>('projects.list')
    expect({ ...after, revision: 0 }).toStrictEqual({ ...before, revision: 0 })
    expect(after.activeId).toBe(first.id)
  })

  it('sets a broken projects.json aside and starts with an empty list', async () => {
    mkdirSync(dataDir, { recursive: true })
    writeFileSync(join(dataDir, 'projects.json'), '{"projects": [')
    await start()
    expect(await value('projects.list')).toStrictEqual({ projects: [], activeId: null, revision: 0 })
    expect(readdirSync(dataDir).filter((name) => name.startsWith('projects.json.unreadable-'))).toHaveLength(1)
  })

  it('answers with the parsed list: keys written into projects.json by hand do not cross the boundary', async () => {
    const repo = makeRepo('auction')
    const { project } = await addOk(repo)
    const file = join(dataDir, 'projects.json')
    const saved = JSON.parse(readFileSync(file, 'utf8')) as { projects: Record<string, unknown>[] }
    saved.projects[0] = { ...saved.projects[0], token: 'secret-from-disk' }
    writeFileSync(file, JSON.stringify({ ...saved, extra: true }))

    await start()
    const state = await value<State>('projects.list')
    expect(state.projects).toStrictEqual([{ id: project.id, name: 'auction', path: repo, branch: 'main' }])
    expect(JSON.stringify(state)).not.toContain('secret-from-disk')
  })
})

describe('projects.settings', () => {
  it('gives a new Project the default templates and keeps a change across a restart', async () => {
    const { project } = await addOk(makeRepo('auction'))
    expect(await value('projects.settings.get', { id: project.id })).toStrictEqual({
      actionTemplates: { shipTicket: '/ship-ticket {epic} {NN}', runWave: '/epic-wave Ticket-ы {tickets} эпика {epic}' },
    })
    const changed = { actionTemplates: { shipTicket: '/ship {epic}/{NN} on {branch}', runWave: '' } }
    expect(await value('projects.settings.set', { id: project.id, settings: changed })).toStrictEqual(changed)

    await start()
    expect(await value('projects.settings.get', { id: project.id })).toStrictEqual(changed)
  })

  it('reads a saved old default of Run wave as the new default without writing the file; an own template stays (ticket 30)', async () => {
    const { project } = await addOk(makeRepo('auction'))
    const file = join(dataDir, project.id, 'settings.json')
    // What the stable copy has saved: the defaults of before ticket 30.
    const old = `${JSON.stringify({ actionTemplates: { shipTicket: '/ship-ticket {epic} {NN}', runWave: '/epic-wave волна {wave} эпика {epic}' } }, null, 2)}\n`
    writeFileSync(file, old)
    await start()
    expect(await value('projects.settings.get', { id: project.id })).toStrictEqual({
      actionTemplates: { shipTicket: '/ship-ticket {epic} {NN}', runWave: '/epic-wave Ticket-ы {tickets} эпика {epic}' },
    })
    // Reading does not write: the file stays as the stable copy left it.
    expect(readFileSync(file, 'utf8')).toBe(old)

    const own = { actionTemplates: { shipTicket: '/ship-ticket {epic} {NN}', runWave: '/epic-wave wave {wave} of {epic}' } }
    writeFileSync(file, JSON.stringify(own))
    expect(await value('projects.settings.get', { id: project.id })).toStrictEqual(own)
  })

  it('does not save a template with an unknown placeholder', async () => {
    const { project } = await addOk(makeRepo('auction'))
    const file = join(dataDir, project.id, 'settings.json')
    const before = readFileSync(file, 'utf8')
    const result = await call('projects.settings.set', { id: project.id, settings: { actionTemplates: { shipTicket: '/ship-ticket {foo}', runWave: '' } } })
    expect(result.ok).toBe(false)
    expect(!result.ok && result.error).toMatch(/Unknown placeholder \{foo\}/)
    expect(readFileSync(file, 'utf8')).toBe(before)
  })

  it('gives a new Project the plugin\'s templates when the Harness plugin is on the machine (worfy-harness ticket 12)', async () => {
    switchToPlugin()
    const { project } = await addOk(makeRepo('auction'))
    expect(await value('projects.settings.get', { id: project.id })).toStrictEqual({ actionTemplates: PLUGIN_TEMPLATES })
    expect(JSON.parse(readFileSync(join(dataDir, project.id, 'settings.json'), 'utf8'))).toStrictEqual({ actionTemplates: PLUGIN_TEMPLATES })
  })

  it('reads saved defaults as those of the Harness found now, without writing the file; the owner\'s own template stays', async () => {
    const { project } = await addOk(makeRepo('auction'))
    const file = join(dataDir, project.id, 'settings.json')
    const saved = `${JSON.stringify({ actionTemplates: { shipTicket: '/ship-ticket {epic} {NN}', runWave: '/epic-wave волна {wave} эпика {epic}' } }, null, 2)}\n`
    writeFileSync(file, saved)
    // The old Harness next to the plugin: still the old Harness, still its templates.
    switchToPlugin(true)
    expect(await value('projects.settings.get', { id: project.id })).toStrictEqual({ actionTemplates: LEGACY_TEMPLATES })
    // The move takes the old Harness away: the same file reads as the plugin's, with no restart.
    rmSync(join(claudeHome, 'bin'), { recursive: true })
    expect(await value('projects.settings.get', { id: project.id })).toStrictEqual({ actionTemplates: PLUGIN_TEMPLATES })
    expect(readFileSync(file, 'utf8')).toBe(saved)

    const own = { actionTemplates: { shipTicket: 'my ship {NN}', runWave: '' } }
    writeFileSync(file, JSON.stringify(own))
    expect(await value('projects.settings.get', { id: project.id })).toStrictEqual(own)
  })

  it('gives "Reset to default" the defaults of the Harness on the machine at the time of the call', async () => {
    expect(await value('projects.settings.defaults')).toStrictEqual({ actionTemplates: LEGACY_TEMPLATES })
    switchToPlugin()
    expect(await value('projects.settings.defaults')).toStrictEqual({ actionTemplates: PLUGIN_TEMPLATES })
    // No Harness at all: worfy's Sessions carry its own plugin, so the plugin's names.
    rmSync(join(claudeHome, 'worfy-harness'), { recursive: true })
    expect(await value('projects.settings.defaults')).toStrictEqual({ actionTemplates: PLUGIN_TEMPLATES })
  })

  it('writes nothing under the Claude home or the Harness home', async () => {
    switchToPlugin(true)
    const listing = (dir: string) => readdirSync(dir, { recursive: true }).map(String).sort()
    const before = listing(claudeHome)
    const { project } = await addOk(makeRepo('auction'))
    await value('projects.settings.get', { id: project.id })
    await value('projects.settings.defaults')
    await value('projects.settings.set', { id: project.id, settings: { actionTemplates: { shipTicket: '/x {NN}', runWave: '' } } })
    expect(listing(claudeHome)).toEqual(before)
  })

  it('stores only the declared keys, whatever else the caller sends', async () => {
    const { project } = await addOk(makeRepo('auction'))
    const result = await value('projects.settings.set', {
      id: project.id,
      junk: 1,
      settings: { actionTemplates: { shipTicket: '', runWave: '', smuggled: 'x' }, other: 'y' },
    })
    expect(result).toStrictEqual({ actionTemplates: { shipTicket: '', runWave: '' } })
    const stored = readFileSync(join(dataDir, project.id, 'settings.json'), 'utf8')
    expect(stored).not.toContain('smuggled')
    expect(stored).not.toContain('other')
  })
})

describe('the repository of a Project', () => {
  it('stays untouched: adding, switching, removing and editing settings write nothing into it', async () => {
    const repo = makeRepo('auction')
    const other = makeRepo('worfy')
    const listing = (dir: string) => readdirSync(dir, { recursive: true }).map(String).sort()
    const before = listing(repo)

    const { project } = await addOk(join(repo))
    await addOk(other)
    await value('projects.select', { id: project.id })
    await value('projects.settings.set', { id: project.id, settings: { actionTemplates: { shipTicket: '/x {NN}', runWave: '' } } })
    await value('projects.list')
    await value('projects.remove', { id: project.id })

    expect(repoStatus(repo)).toBe('')
    expect(repoStatus(other)).toBe('')
    expect(listing(repo)).toEqual(before)
    expect(dataDir.startsWith(repo)).toBe(false)
  })
})

describe('projects.pickFolder', () => {
  it('returns the folder the user chose, or null when the dialog was cancelled', async () => {
    electron.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ['/Users/me/code/auction'] })
    expect(await value('projects.pickFolder')).toStrictEqual({ path: '/Users/me/code/auction' })
    electron.showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] })
    expect(await value('projects.pickFolder')).toStrictEqual({ path: null })
  })
})
