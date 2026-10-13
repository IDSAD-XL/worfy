// The `projects` channels end to end in main: src/main/ipc/projects.ts registered through
// registerIpc (the same wrapper the app uses) over a mocked `electron`, against real git
// repositories in a temporary folder and a temporary WORFY_DATA_DIR.
import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IpcMainInvokeEvent } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNEL_PREFIX, type IpcResult } from '../../src/shared/ipc/channels'
import { APP_URL, INDEX_HTML } from '../app-url'
import { removeTestTree } from '../remove'

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
  const event = { senderFrame: { url: APP_URL }, sender: {} } as unknown as IpcMainInvokeEvent
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
  if (!keepOld) removeTestTree(join(claudeHome, 'bin'))
}

/**
 * A stub `bin/profile` in the test's Claude home: `--json` prints `_resolved` with `workspace` and
 * exits with `code`; `old` leaves `_resolved.mode` out, like a Harness before Silent mode. Its
 * arguments go to the file it returns.
 */
function stubProfile(answer: { code: number; workspace: string | null; old?: boolean }): string {
  const calls = join(scratch, 'profile-calls.txt')
  writeFileSync(calls, '')
  const resolved = answer.old ? { name: 'x', workspace: answer.workspace } : { mode: 'silent', workflow_folder: answer.workspace ?? scratch, workspace: answer.workspace, repos: [] }
  const json = join(scratch, 'profile-answer.json')
  writeFileSync(json, answer.code === 0 ? JSON.stringify({ _resolved: resolved }) : '')
  const script = join(claudeHome, 'bin', 'profile')
  writeFileSync(script, `#!/bin/sh\necho "$*" >> '${calls}'\ncat '${json}'\nexit ${answer.code}\n`)
  chmodSync(script, 0o755)
  return calls
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
  removeTestTree(scratch)
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
    expect(await add(plain)).toStrictEqual({
      status: 'rejected',
      reason: `${plain} is not a git repository. Choose the folder of a git repository; a Project over several repositories is connected in the Harness first.`,
    })
    expect(await add(join(scratch, 'missing'))).toStrictEqual({ status: 'rejected', reason: `${join(scratch, 'missing')} does not exist.` })
    expect((await value<State>('projects.list')).projects).toEqual([])
  })

  it('adds a folder outside git that the Harness knows as a Project over several repositories (profile: code 0, a workspace)', async () => {
    const workspace = join(scratch, 'atakama')
    mkdirSync(join(workspace, 'docs'), { recursive: true })
    const api = makeRepo('atakama/api')
    const web = makeRepo('atakama/web')
    const calls = stubProfile({ code: 0, workspace })
    const status = { api: repoStatus(api), web: repoStatus(web) }
    const before = readdirSync(workspace).sort()

    const result = await addOk(workspace)
    expect(result.project).toStrictEqual({ id: expect.stringMatching(/^atakama-[0-9a-f]{8}$/), name: 'atakama', path: workspace, branch: null })
    expect(result.notice).toBeNull()
    expect(result.state.activeId).toBe(result.project.id)
    expect(readFileSync(calls, 'utf8').trim()).toBe(`-C ${workspace} --json`)

    // A folder inside it that is not a repository either: the Project's folder is added instead, once.
    const inside = await addOk(join(workspace, 'docs'))
    expect(inside.project.id).toBe(result.project.id)
    expect(inside.notice).toBe(`${join(workspace, 'docs')} is inside the Project ${workspace} over several repositories; its folder was added instead.`)
    expect((await value<State>('projects.list')).projects).toHaveLength(1)

    // Nothing was written into the folder or its repositories.
    expect(readdirSync(workspace).sort()).toStrictEqual(before)
    expect({ api: repoStatus(api), web: repoStatus(web) }).toStrictEqual(status)
  })

  it.each([
    ['exit code 3 (no registered project)', { code: 3, workspace: null }],
    ['exit code 0 without a workspace', { code: 0, workspace: null }],
    ['a Harness without Silent mode (no _resolved.mode)', { code: 0, workspace: 'old' as const }],
  ])('refuses a folder outside git the Harness does not know as such a Project: %s', async (_case, answer) => {
    const plain = join(scratch, 'plain')
    mkdirSync(plain)
    stubProfile({ code: answer.code, workspace: answer.workspace === 'old' ? plain : answer.workspace, old: answer.workspace === 'old' })
    const result = await add(plain)
    expect(result).toStrictEqual({ status: 'rejected', reason: expect.stringMatching(/is not a git repository\. .*a Project over several repositories is connected in the Harness first\.$/) })
    expect((await value<State>('projects.list')).projects).toEqual([])
  })

  it('asks the Harness only about a folder outside git: a repository is added by git alone', async () => {
    const calls = stubProfile({ code: 0, workspace: scratch })
    const repo = makeRepo('auction')
    expect((await addOk(repo)).project.path).toBe(repo)
    expect(readFileSync(calls, 'utf8')).toBe('')
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
    removeTestTree(join(claudeHome, 'bin'))
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
    removeTestTree(join(claudeHome, 'worfy-harness'))
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

  it('adds no shell of the Terminals to settings without one, keeps one that is set, and refuses an unknown one (worfy-windows ticket 10)', async () => {
    const { project } = await addOk(makeRepo('auction'))
    const file = join(dataDir, project.id, 'settings.json')
    // A settings file from before the field: read as it is.
    expect(await value('projects.settings.get', { id: project.id })).not.toHaveProperty('terminalShell')
    expect(JSON.parse(readFileSync(file, 'utf8'))).not.toHaveProperty('terminalShell')

    const chosen = { actionTemplates: { shipTicket: '/x {NN}', runWave: '' }, terminalShell: 'git-bash' }
    expect(await value('projects.settings.set', { id: project.id, settings: chosen })).toStrictEqual(chosen)
    expect(JSON.parse(readFileSync(file, 'utf8'))).toStrictEqual(chosen)
    expect(await value('projects.settings.get', { id: project.id })).toStrictEqual(chosen)

    const before = readFileSync(file, 'utf8')
    const refused = await call('projects.settings.set', { id: project.id, settings: { ...chosen, terminalShell: 'cmd' } })
    expect(refused.ok).toBe(false)
    expect(readFileSync(file, 'utf8')).toBe(before)
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

// ── worfy-link ticket 11: "Add project" on a Linked machine ───────────────────────────────────

/** The id of the Linked machine whose calls come through the link adapter below. */
const LINKED = '44444444-4444-4444-8444-444444444444'

/**
 * Calls from Linked machine LINKED as the link adapter of worfy-link ticket 01 makes them: the same
 * handler module registered on a LinkIpcAdapter, a LinkPeer with access on or off.
 */
async function linkedCaller(access: boolean): Promise<(channel: string, input?: unknown) => Promise<IpcResult<unknown>>> {
  const { createLinkIpc, LinkPeer } = await import('../../src/main/link/ipc-adapter')
  const adapter = await createLinkIpc({
    modules: { './projects.ts': () => import('../../src/main/ipc/projects').then((module) => module.default) },
    isLinked: (id) => id === LINKED,
  })
  const peer = new LinkPeer({ machineId: LINKED, describe: () => LINKED, push: () => undefined, local: () => ({ id: 'beta', name: 'Beta', protocol: 1, build: 'x' }), warn: () => undefined })
  peer.setAccess(access)
  return (channel, input) => adapter.call(peer, channel, input, 'Beta')
}

/** projects.json as main keeps it. */
const projectsFile = (): { projects: { id: string; path: string }[]; activeId: string | null } =>
  JSON.parse(readFileSync(join(dataDir, 'projects.json'), 'utf8')) as { projects: { id: string; path: string }[]; activeId: string | null }

interface Browsed {
  ok: boolean
  path: string
  parent: string | null
  folders?: { name: string; path: string; hidden: boolean; gitRepo: boolean }[]
  truncated?: boolean
  reason?: string
}

describe('projects.browse', () => {
  it('lists only the folders of a folder, by name: a link to a folder too, files and links to files not; parent, hidden and gitRepo', async () => {
    const root = join(scratch, 'browse')
    mkdirSync(join(root, 'beta', '.git'), { recursive: true })
    mkdirSync(join(root, 'alpha'), { recursive: true })
    mkdirSync(join(root, '.config'), { recursive: true })
    // A linked worktree: `.git` is a file.
    mkdirSync(join(root, 'delta'), { recursive: true })
    writeFileSync(join(root, 'delta', '.git'), 'gitdir: /elsewhere/.git/worktrees/delta\n')
    mkdirSync(join(scratch, 'target'), { recursive: true })
    symlinkSync(join(scratch, 'target'), join(root, 'gamma'))
    writeFileSync(join(root, 'notes.txt'), 'a file')
    symlinkSync(join(root, 'notes.txt'), join(root, 'file-link'))
    symlinkSync(join(scratch, 'nowhere'), join(root, 'broken-link'))

    const answer = await value<Browsed>('projects.browse', { path: root })
    expect(answer).toStrictEqual({
      ok: true,
      path: root,
      parent: scratch,
      truncated: false,
      folders: [
        { name: '.config', path: join(root, '.config'), hidden: true, gitRepo: false },
        { name: 'alpha', path: join(root, 'alpha'), hidden: false, gitRepo: false },
        { name: 'beta', path: join(root, 'beta'), hidden: false, gitRepo: true },
        { name: 'delta', path: join(root, 'delta'), hidden: false, gitRepo: true },
        { name: 'gamma', path: join(root, 'gamma'), hidden: false, gitRepo: false },
      ],
    })
    // A path with `..` is answered in its plain form.
    expect((await value<Browsed>('projects.browse', { path: join(root, 'alpha', '..') })).path).toBe(root)
  })

  it('the parent of a root is null, on this OS and on Windows', async () => {
    const { parentOf } = await import('../../src/main/projects/browse')
    const { posix, win32 } = await import('node:path')
    expect(parentOf('/', posix)).toBeNull()
    expect(parentOf('/Users', posix)).toBe('/')
    expect(parentOf('C:\\', win32)).toBeNull()
    expect(parentOf('C:\\Users\\me', win32)).toBe('C:\\Users')
  })

  it('more than 2000 folders: the first 2000 by name and truncated', async () => {
    const root = join(scratch, 'many')
    for (let index = 0; index < 2001; index += 1) mkdirSync(join(root, `f${String(index).padStart(4, '0')}`), { recursive: true })
    const answer = await value<Browsed>('projects.browse', { path: root })
    expect(answer.folders).toHaveLength(2000)
    expect(answer.truncated).toBe(true)
    expect(answer.folders?.[0]?.name).toBe('f0000')
    expect(answer.folders?.at(-1)?.name).toBe('f1999')
  })

  it('a folder that cannot be read is answered with ok:false, the reason and its parent; a missing one too', async () => {
    const locked = join(scratch, 'locked')
    mkdirSync(join(locked, 'inside'), { recursive: true })
    chmodSync(locked, 0o000)
    try {
      expect(await value<Browsed>('projects.browse', { path: locked })).toStrictEqual({ ok: false, path: locked, parent: scratch, reason: `No permission to read ${locked}` })
    } finally {
      chmodSync(locked, 0o755)
    }
    expect(await value<Browsed>('projects.browse', { path: join(scratch, 'missing') })).toStrictEqual({
      ok: false,
      path: join(scratch, 'missing'),
      parent: scratch,
      reason: `${join(scratch, 'missing')} does not exist`,
    })
  })

  it('null starts in the home folder (the whole disk is open, the start is home: decided without the owner)', async () => {
    const home = join(scratch, 'home')
    mkdirSync(join(home, 'code'), { recursive: true })
    vi.stubEnv('HOME', home)
    const answer = await value<Browsed>('projects.browse', { path: null })
    expect(answer).toMatchObject({ ok: true, path: home, parent: scratch })
    expect(answer.folders?.map((folder) => folder.name)).toEqual(['code'])
  })

  it('refuses a relative path; writes nothing', async () => {
    const result = await call('projects.browse', { path: 'code/shop' })
    expect(result.ok).toBe(false)
    expect(!result.ok && result.error).toMatch(/not an absolute path/)
    expect(existsSync(join(dataDir, 'projects.json'))).toBe(false)
  })
})

describe('from a Linked machine (the link adapter)', () => {
  it('projects.browse answers while access is on and is refused while it is off', async () => {
    const root = join(scratch, 'browse')
    mkdirSync(join(root, 'shop'), { recursive: true })
    const on = await linkedCaller(true)
    const answered = await on('projects.browse', { path: root })
    expect(answered.ok && (answered.value as Browsed).folders?.map((folder) => folder.name)).toEqual(['shop'])
    const off = await linkedCaller(false)
    expect(await off('projects.browse', { path: root })).toStrictEqual({ ok: false, error: 'Linked machines cannot work with the Projects of Beta: access is off' })
  })

  it('projects.pickFolder is refused with access on and off; the dialog never opens', async () => {
    for (const access of [true, false]) {
      const result = await (await linkedCaller(access))('projects.pickFolder', { purpose: 'project' })
      expect(result.ok).toBe(false)
    }
    expect(electron.showOpenDialog).not.toHaveBeenCalled()
  })

  it('projects.add from a Linked machine keeps activeId in projects.json; from this Machine\'s window it becomes active as before', async () => {
    const mine = (await addOk(makeRepo('auction'))).project
    const linked = await linkedCaller(true)
    const remote = makeRepo('shop')
    const result = await linked('projects.add', { path: remote })
    expect(result.ok && (result.value as Added).status).toBe('added')
    expect(projectsFile().activeId).toBe(mine.id)
    expect(projectsFile().projects.map((project) => project.path)).toEqual([mine.path, remote])
    // The same folder added from this Machine's window becomes active.
    const local = await addOk(remote)
    expect(projectsFile().activeId).toBe(local.project.id)
  })

  it('projects.connect.inspect of a folder the Harness knows adds it without switching the active Project for a Linked machine', async () => {
    // No login shell of the person running the test: the scripts' environment comes from /bin/sh with an empty HOME.
    const home = join(scratch, 'home')
    mkdirSync(home)
    vi.stubEnv('HOME', home)
    vi.stubEnv('SHELL', '/bin/sh')
    await start()
    stubProfile({ code: 0, workspace: null })
    const mine = (await addOk(makeRepo('auction'))).project
    const remote = makeRepo('shop')
    const linked = await linkedCaller(true)
    const result = await linked('projects.connect.inspect', { path: remote })
    expect(result.ok && (result.value as { status: string }).status).toBe('added')
    expect(projectsFile().activeId).toBe(mine.id)
    expect(projectsFile().projects.map((project) => project.path)).toContain(remote)
    // From this Machine's window the known folder becomes active, as before.
    const other = makeRepo('cart')
    const local = await value<{ status: string; project: View }>('projects.connect.inspect', { path: other })
    expect(local.status).toBe('added')
    expect(projectsFile().activeId).toBe(local.project.id)
  })
})
