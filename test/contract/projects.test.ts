// The `projects` channels end to end in main: src/main/ipc/projects.ts registered through
// registerIpc (the same wrapper the app uses) over a mocked `electron`, against real git
// repositories in a temporary folder and a temporary WORFY_DATA_DIR.
import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import type { IpcMainInvokeEvent } from 'electron'
import type { SessionRegistry } from '../../src/main/agent/session'
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import type { ModuleLoader } from '../../src/main/ipc/index'
import { IPC_CHANNEL_PREFIX, type IpcResult } from '../../src/shared/ipc/channels'
import { APP_URL, INDEX_HTML } from '../app-url'
import { nodeScript } from '../harness-node'
import { removeTestTree } from '../remove'

const electron = vi.hoisted(() => {
  const sent: { channel: string; payload: unknown }[] = []
  const window = { isDestroyed: () => false, webContents: { send: (channel: string, payload: unknown) => sent.push({ channel, payload }) } }
  return {
    sent,
    showOpenDialog: vi.fn<() => Promise<{ canceled: boolean; filePaths: string[] }>>(),
    showItemInFolder: vi.fn<(path: string) => void>(),
    window,
  }
})

vi.mock('electron', () => ({
  // src/main/ipc/layout.ts, loaded for the link adapter, listens for the app's quit.
  app: { on: () => undefined },
  BrowserWindow: { getAllWindows: () => [electron.window], fromWebContents: () => null },
  dialog: { showOpenDialog: electron.showOpenDialog },
  shell: { showItemInFolder: electron.showItemInFolder },
}))
// The app runs the Harness scripts with the login shell environment; a test does not start the
// login shell of the machine it runs on, so the scripts get this process's environment here.
vi.mock('../../src/main/harness/script-env', () => ({ harnessScriptEnv: () => Promise.resolve(process.env) }))

type Listener = (event: IpcMainInvokeEvent, input: unknown) => unknown

let scratch: string
let dataDir: string
let handlers: Map<string, Listener>

/**
 * git for the fixtures, without GIT_* variables of a surrounding hook, and without auto maintenance: git 2.56
 * may start it detached after a commit, and its .git/objects/maintenance.lock comes and goes while a test
 * compares the repository's files (#1510).
 */
function git(cwd: string, ...args: string[]): string {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', '-c', 'maintenance.auto=false', ...args], { cwd, env, encoding: 'utf8' }).trim()
}

function makeRepo(name: string, branch = 'main'): string {
  const dir = join(scratch, name)
  mkdirSync(dir, { recursive: true })
  git(dir, 'init', '-q', '-b', branch)
  writeFileSync(join(dir, 'README.md'), name)
  git(dir, 'add', 'README.md')
  git(dir, 'commit', '-q', '-m', 'init')
  return realpathSync.native(dir)
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
  // A Node script: worfy runs the Harness scripts as `node <script>` (src/main/workflow/profile.ts).
  writeFileSync(
    script,
    nodeScript(
      [
        `fs.appendFileSync(${JSON.stringify(calls)}, process.argv.slice(2).join(' ') + '\\n')`,
        `process.stdout.write(fs.readFileSync(${JSON.stringify(json)}, 'utf8'))`,
        `process.exitCode = ${answer.code}`,
      ].join('\n'),
    ),
  )
  return calls
}

const LEGACY_TEMPLATES = { shipTicket: '/ship-ticket {epic} {NN}', runWave: '/epic-wave Ticket-ы {tickets} эпика {epic}', gateQueue: '' }
const PLUGIN_TEMPLATES = { shipTicket: '/worfy:ship-ticket {epic} {NN}', runWave: '/worfy:epic-wave tickets {tickets} of epic {epic}', gateQueue: '/worfy:gate-queue' }

beforeEach(async () => {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-projects-')))
  dataDir = join(scratch, 'data')
  claudeHome = join(scratch, 'claude-home')
  mkdirSync(join(claudeHome, 'bin'), { recursive: true })
  writeFileSync(join(claudeHome, 'bin', 'epic-status'), '#!/bin/sh\n')
  vi.stubEnv('WORFY_CLAUDE_HOME', claudeHome)
  vi.stubEnv('WORFY_HARNESS_HOME', '')
  electron.sent.length = 0
  electron.showOpenDialog.mockReset()
  electron.showItemInFolder.mockReset()
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
    const repo = makeRepo('auberge', 'trunk')
    const result = await addOk(repo)
    expect(result.notice).toBeNull()
    expect(result.project).toStrictEqual({ id: expect.stringMatching(/^auberge-[0-9a-f]{8}$/), name: 'auberge', path: repo, branch: 'trunk' })
    expect(result.state.activeId).toBe(result.project.id)
    expect(await value('projects.list')).toStrictEqual(result.state)
  })

  it('creates the Project data folder <name>-<sha256(path)[0:8]> under WORFY_DATA_DIR with default settings', async () => {
    const repo = makeRepo('auberge')
    const { createHash } = await import('node:crypto')
    const { project } = await addOk(repo)
    // The hash is of the root as git prints it: on Windows that is C:/…, not the stored C:\….
    const gitRoot = git(repo, 'rev-parse', '--show-toplevel')
    expect(project.id).toBe(`auberge-${createHash('sha256').update(gitRoot).digest('hex').slice(0, 8)}`)
    const settings = JSON.parse(readFileSync(join(dataDir, project.id, 'settings.json'), 'utf8')) as unknown
    expect(settings).toStrictEqual({ actionTemplates: { shipTicket: '/ship-ticket {epic} {NN}', runWave: '/epic-wave Ticket-ы {tickets} эпика {epic}', gateQueue: '' } })
    expect(existsSync(join(dataDir, 'projects.json'))).toBe(true)
  })

  it("keeps the id of a Project saved with git's spelling of the path, shows the resolved path and adds no second entry", async () => {
    const repo = makeRepo('auberge')
    const { createHash } = await import('node:crypto')
    // projects.json written before the stored path was resolved: on Windows it holds git's C:/… spelling.
    // The trailing `/.` is removed by resolve() on every system, so the check holds on macOS and Linux too.
    const gitRoot = git(repo, 'rev-parse', '--show-toplevel')
    const id = `auberge-${createHash('sha256').update(gitRoot).digest('hex').slice(0, 8)}`
    mkdirSync(dataDir, { recursive: true })
    writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id, name: 'auberge', path: `${gitRoot}/.` }], activeId: id }))
    await start()

    expect((await value<State>('projects.list')).projects).toStrictEqual([{ id, name: 'auberge', path: repo, branch: 'main' }])
    const result = await addOk(repo)
    expect(result.project).toStrictEqual({ id, name: 'auberge', path: repo, branch: 'main' })
    expect(result.notice).toBe('auberge is already in the list.')
    expect(result.state.projects.map((project) => project.id)).toStrictEqual([id])
  })

  it('resolves a subfolder to the repository root and says so', async () => {
    const repo = makeRepo('auberge')
    mkdirSync(join(repo, 'src', 'deep'), { recursive: true })
    const result = await addOk(join(repo, 'src', 'deep'))
    expect(result.project.path).toBe(repo)
    // Exact text: on Windows the root must read C:\…, the way the list shows it, not git's C:/….
    expect(result.notice).toBe(`${join(repo, 'src', 'deep')} is inside the repository ${repo}; the repository root was added instead.`)
  })

  // The folder in the notice reads in the spelling of the root, not as it was typed.
  it.each(['typed with forward slashes', 'reached through a link'] as const)('a subfolder %s is named in the notice in the spelling of the root', async (how) => {
    const repo = makeRepo('auberge')
    const deep = join(repo, 'src', 'deep')
    mkdirSync(deep, { recursive: true })
    let typed = deep.replaceAll('\\', '/')
    if (how === 'reached through a link') {
      const link = join(scratch, 'auberge-src')
      symlinkSync(join(repo, 'src'), link, process.platform === 'win32' ? 'junction' : 'dir')
      typed = join(link, 'deep')
    }
    const result = await addOk(typed)
    expect(result.notice).toBe(`${deep} is inside the repository ${repo}; the repository root was added instead.`)
  })

  it('resolves a linked worktree to the main repository root and says so', async () => {
    const repo = makeRepo('auberge')
    const worktree = join(scratch, 'auberge-wt')
    git(repo, 'worktree', 'add', '-q', '-b', 'feature', worktree)
    const result = await addOk(worktree)
    expect(result.project.path).toBe(repo)
    expect(result.project.branch).toBe('main')
    expect(result.notice).toBe(`${worktree} is a worktree of ${repo}; the repository root was added instead.`)
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
    const workspace = join(scratch, 'atalaya')
    mkdirSync(join(workspace, 'docs'), { recursive: true })
    const api = makeRepo('atalaya/api')
    const web = makeRepo('atalaya/web')
    const calls = stubProfile({ code: 0, workspace })
    const status = { api: repoStatus(api), web: repoStatus(web) }
    const before = readdirSync(workspace).sort()

    const result = await addOk(workspace)
    expect(result.project).toStrictEqual({ id: expect.stringMatching(/^atalaya-[0-9a-f]{8}$/), name: 'atalaya', path: workspace, branch: null })
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
    const repo = makeRepo('auberge')
    expect((await addOk(repo)).project.path).toBe(repo)
    expect(readFileSync(calls, 'utf8')).toBe('')
  })

  it('does not list a repository twice', async () => {
    const repo = makeRepo('auberge')
    await addOk(repo)
    const again = await addOk(repo)
    expect(again.notice).toBe('auberge is already in the list.')
    expect(again.state.projects).toHaveLength(1)
  })

  it('takes another spelling of the repository root for the root itself: no notice, and one entry', async () => {
    const repo = makeRepo('auberge')
    // Windows: other letter case and `/` (as a short 8.3 name or a `subst` drive, it is the same folder
    // to git and to the native realpath, not to fs.realpathSync). A case-insensitive disk elsewhere
    // (APFS by default): other letter case. A case-sensitive disk: a symbolic link to the root, which
    // fs.realpathSync resolves too, so there the test does not tell the two realpaths apart.
    let other: string
    const upper = join(scratch, 'AUBERGE')
    if (process.platform === 'win32') {
      other = repo.toLowerCase().replaceAll('\\', '/')
      expect(realpathSync(other)).not.toBe(repo)
    } else if (existsSync(upper)) {
      other = upper
      expect(realpathSync(other)).not.toBe(repo)
    } else {
      other = join(scratch, 'auberge-link')
      symlinkSync(repo, other)
    }
    const first = await addOk(other)
    expect(first.notice).toBeNull()
    expect(first.project.path).toBe(repo)
    const again = await addOk(repo)
    expect(again.notice).toBe('auberge is already in the list.')
    expect(again.state.projects.map((project) => project.id)).toStrictEqual([first.project.id])
  })

  it('keeps the settings of a repository that is added again', async () => {
    const repo = makeRepo('auberge')
    const { project } = await addOk(repo)
    const changed = { actionTemplates: { shipTicket: '/ship {epic}/{NN}', runWave: '', gateQueue: '' } }
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
    const first = (await addOk(makeRepo('auberge'))).project
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
      ['auberge', 'main'],
      ['worfy', 'dev'],
    ])
    expect(second.branch).toBe('dev')
  })

  it('removes a Project from the list and keeps its data folder', async () => {
    const first = (await addOk(makeRepo('auberge'))).project
    const second = (await addOk(makeRepo('worfy'))).project
    const state = await value<State>('projects.remove', { id: second.id })
    expect(state.projects.map((project) => project.id)).toEqual([first.id])
    // The active one was removed: the first remaining Project becomes active.
    expect(state.activeId).toBe(first.id)
    expect(existsSync(join(dataDir, second.id, 'settings.json'))).toBe(true)
    expect((await value<State>('projects.remove', { id: first.id })).activeId).toBeNull()
  })

  it('answers an unknown id with an error and changes nothing', async () => {
    await addOk(makeRepo('auberge'))
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
    const first = (await addOk(makeRepo('auberge'))).project
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
    const repo = makeRepo('auberge')
    const { project } = await addOk(repo)
    const file = join(dataDir, 'projects.json')
    const saved = JSON.parse(readFileSync(file, 'utf8')) as { projects: Record<string, unknown>[] }
    saved.projects[0] = { ...saved.projects[0], token: 'secret-from-disk' }
    writeFileSync(file, JSON.stringify({ ...saved, extra: true }))

    await start()
    const state = await value<State>('projects.list')
    expect(state.projects).toStrictEqual([{ id: project.id, name: 'auberge', path: repo, branch: 'main' }])
    expect(JSON.stringify(state)).not.toContain('secret-from-disk')
  })
})

describe('projects.settings', () => {
  it('gives a new Project the default templates and keeps a change across a restart', async () => {
    const { project } = await addOk(makeRepo('auberge'))
    expect(await value('projects.settings.get', { id: project.id })).toStrictEqual({
      actionTemplates: { shipTicket: '/ship-ticket {epic} {NN}', runWave: '/epic-wave Ticket-ы {tickets} эпика {epic}', gateQueue: '' },
    })
    const changed = { actionTemplates: { shipTicket: '/ship {epic}/{NN} on {branch}', runWave: '', gateQueue: '' } }
    expect(await value('projects.settings.set', { id: project.id, settings: changed })).toStrictEqual(changed)

    await start()
    expect(await value('projects.settings.get', { id: project.id })).toStrictEqual(changed)
  })

  it('reads a saved old default of Run wave as the new default without writing the file; an own template stays (ticket 30)', async () => {
    const { project } = await addOk(makeRepo('auberge'))
    const file = join(dataDir, project.id, 'settings.json')
    // What the stable copy has saved: the defaults of before ticket 30.
    const old = `${JSON.stringify({ actionTemplates: { shipTicket: '/ship-ticket {epic} {NN}', runWave: '/epic-wave волна {wave} эпика {epic}' } }, null, 2)}\n`
    writeFileSync(file, old)
    await start()
    expect(await value('projects.settings.get', { id: project.id })).toStrictEqual({
      actionTemplates: { shipTicket: '/ship-ticket {epic} {NN}', runWave: '/epic-wave Ticket-ы {tickets} эпика {epic}', gateQueue: '' },
    })
    // Reading does not write: the file stays as the stable copy left it.
    expect(readFileSync(file, 'utf8')).toBe(old)

    const own = { actionTemplates: { shipTicket: '/ship-ticket {epic} {NN}', runWave: '/epic-wave wave {wave} of {epic}', gateQueue: '' } }
    writeFileSync(file, JSON.stringify(own))
    expect(await value('projects.settings.get', { id: project.id })).toStrictEqual(own)
  })

  it('a save without gateQueue (a Linked machine on an older build) keeps the saved template (worfy-windows ticket 17)', async () => {
    const { project } = await addOk(makeRepo('auberge'))
    const file = join(dataDir, project.id, 'settings.json')
    const own = { actionTemplates: { shipTicket: '/x {NN}', runWave: '', gateQueue: '/my-gate-queue' } }
    expect(await value('projects.settings.set', { id: project.id, settings: own })).toStrictEqual(own)
    const older = { actionTemplates: { shipTicket: '/y {NN}', runWave: '' } }
    const kept = { actionTemplates: { shipTicket: '/y {NN}', runWave: '', gateQueue: '/my-gate-queue' } }
    expect(await value('projects.settings.set', { id: project.id, settings: older })).toStrictEqual(kept)
    expect(JSON.parse(readFileSync(file, 'utf8'))).toStrictEqual(kept)
    // No saved gateQueue either (a file of a build from before it): the default of the Harness found now.
    writeFileSync(file, JSON.stringify(older))
    expect(await value('projects.settings.set', { id: project.id, settings: older })).toStrictEqual({ actionTemplates: { ...older.actionTemplates, gateQueue: '' } })
  })

  it('does not save a template with an unknown placeholder', async () => {
    const { project } = await addOk(makeRepo('auberge'))
    const file = join(dataDir, project.id, 'settings.json')
    const before = readFileSync(file, 'utf8')
    const result = await call('projects.settings.set', { id: project.id, settings: { actionTemplates: { shipTicket: '/ship-ticket {foo}', runWave: '', gateQueue: '' } } })
    expect(result.ok).toBe(false)
    expect(!result.ok && result.error).toMatch(/Unknown placeholder \{foo\}/)
    expect(readFileSync(file, 'utf8')).toBe(before)
  })

  it('gives a new Project the plugin\'s templates when the Harness plugin is on the machine (worfy-harness ticket 12)', async () => {
    switchToPlugin()
    const { project } = await addOk(makeRepo('auberge'))
    expect(await value('projects.settings.get', { id: project.id })).toStrictEqual({ actionTemplates: PLUGIN_TEMPLATES })
    expect(JSON.parse(readFileSync(join(dataDir, project.id, 'settings.json'), 'utf8'))).toStrictEqual({ actionTemplates: PLUGIN_TEMPLATES })
  })

  it('reads saved defaults as those of the Harness found now, without writing the file; the owner\'s own template stays', async () => {
    const { project } = await addOk(makeRepo('auberge'))
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

    const own = { actionTemplates: { shipTicket: 'my ship {NN}', runWave: '', gateQueue: '' } }
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
    const { project } = await addOk(makeRepo('auberge'))
    await value('projects.settings.get', { id: project.id })
    await value('projects.settings.defaults')
    await value('projects.settings.set', { id: project.id, settings: { actionTemplates: { shipTicket: '/x {NN}', runWave: '', gateQueue: '' } } })
    expect(listing(claudeHome)).toEqual(before)
  })

  it('adds no shell of the Terminals to settings without one, keeps one that is set, and refuses an unknown one (worfy-windows ticket 10)', async () => {
    const { project } = await addOk(makeRepo('auberge'))
    const file = join(dataDir, project.id, 'settings.json')
    // A settings file from before the field: read as it is.
    expect(await value('projects.settings.get', { id: project.id })).not.toHaveProperty('terminalShell')
    expect(JSON.parse(readFileSync(file, 'utf8'))).not.toHaveProperty('terminalShell')

    const chosen = { actionTemplates: { shipTicket: '/x {NN}', runWave: '', gateQueue: '' }, terminalShell: 'git-bash' }
    expect(await value('projects.settings.set', { id: project.id, settings: chosen })).toStrictEqual(chosen)
    expect(JSON.parse(readFileSync(file, 'utf8'))).toStrictEqual(chosen)
    expect(await value('projects.settings.get', { id: project.id })).toStrictEqual(chosen)

    const before = readFileSync(file, 'utf8')
    const refused = await call('projects.settings.set', { id: project.id, settings: { ...chosen, terminalShell: 'cmd' } })
    expect(refused.ok).toBe(false)
    expect(readFileSync(file, 'utf8')).toBe(before)
  })

  it('stores only the declared keys, whatever else the caller sends', async () => {
    const { project } = await addOk(makeRepo('auberge'))
    const result = await value('projects.settings.set', {
      id: project.id,
      junk: 1,
      settings: { actionTemplates: { shipTicket: '', runWave: '', smuggled: 'x', gateQueue: '' }, other: 'y' },
    })
    expect(result).toStrictEqual({ actionTemplates: { shipTicket: '', runWave: '', gateQueue: '' } })
    const stored = readFileSync(join(dataDir, project.id, 'settings.json'), 'utf8')
    expect(stored).not.toContain('smuggled')
    expect(stored).not.toContain('other')
  })
})

describe('the repository of a Project', () => {
  it('stays untouched: adding, switching, removing and editing settings write nothing into it', async () => {
    const repo = makeRepo('auberge')
    const other = makeRepo('worfy')
    const listing = (dir: string) => readdirSync(dir, { recursive: true }).map(String).sort()
    const before = listing(repo)

    const { project } = await addOk(join(repo))
    await addOk(other)
    await value('projects.select', { id: project.id })
    await value('projects.settings.set', { id: project.id, settings: { actionTemplates: { shipTicket: '/x {NN}', runWave: '', gateQueue: '' } } })
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
    electron.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ['/Users/someone/code/auberge'] })
    expect(await value('projects.pickFolder')).toStrictEqual({ path: '/Users/someone/code/auberge' })
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
  peer.setAccess(access ? 'all' : 'off')
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
    expect(parentOf('C:\\Users\\someone', win32)).toBe('C:\\Users')
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

  // Skipped on Windows: chmod 0o000 does not take read access away on NTFS, so the folder stays
  // readable. Lifted by none: the premise does not hold on Windows.
  it.skipIf(process.platform === 'win32')('a folder that cannot be read is answered with ok:false, the reason and its parent', async () => {
    const locked = join(scratch, 'locked')
    mkdirSync(join(locked, 'inside'), { recursive: true })
    chmodSync(locked, 0o000)
    try {
      expect(await value<Browsed>('projects.browse', { path: locked })).toStrictEqual({ ok: false, path: locked, parent: scratch, reason: `No permission to read ${locked}` })
    } finally {
      chmodSync(locked, 0o755)
    }
  })

  it('a missing folder is answered with ok:false, the reason and its parent', async () => {
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
    // os.homedir() reads USERPROFILE on Windows and ignores HOME.
    vi.stubEnv('USERPROFILE', home)
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
    const mine = (await addOk(makeRepo('auberge'))).project
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
    // No capture of an environment: the scripts get this process's, which has node on PATH for the
    // Node stub of profile. A capture starts real processes — a login shell, or on Windows PowerShell
    // twice with 10 s each — and on the loaded Windows runner it and the 15 s of bin/profile ran out
    // in 4 of 9 runs, each answering 'rejected' after 17-27 s (CI runs 40594271018, 40605523606,
    // 40609470172, 40611634948).
    vi.doMock('../../src/main/agent/env', async (importOriginal) => ({
      ...(await importOriginal<typeof import('../../src/main/agent/env')>()),
      agentEnv: () => Promise.resolve({ env: { ...process.env }, from: 'login-shell', error: null }),
    }))
    onTestFinished(() => {
      vi.doUnmock('../../src/main/agent/env')
    })
    await start()
    stubProfile({ code: 0, workspace: null })
    const mine = (await addOk(makeRepo('auberge'))).project
    const remote = makeRepo('shop')
    const linked = await linkedCaller(true)
    const result = await linked('projects.connect.inspect', { path: remote })
    // The whole answer: a refusal names its reason.
    expect(result).toMatchObject({ ok: true, value: { status: 'added' } })
    expect(projectsFile().activeId).toBe(mine.id)
    expect(projectsFile().projects.map((project) => project.path)).toContain(remote)
    // From this Machine's window the known folder becomes active, as before.
    const other = makeRepo('cart')
    const local = await value<{ status: string; project: View }>('projects.connect.inspect', { path: other })
    expect(local.status).toBe('added')
    expect(projectsFile().activeId).toBe(local.project.id)
  })
})

// A Project local to this Machine (`localOnly`; the Demo project) is never shared over the link:
// ProjectStore.add puts it in the list, the windows see it, a Linked machine does not.
describe('a Project local to this Machine (localOnly)', () => {
  /** Adds `path` as the app's code does for the Demo project: through the store, with localOnly. */
  async function addLocal(path: string): Promise<{ id: string; name: string }> {
    const { projectStore } = await import('../../src/main/projects/store')
    const added = await projectStore().add(path, { localOnly: true })
    if (added.status !== 'added') throw new Error(`rejected: ${added.reason}`)
    return added.project
  }

  /** A link connection with access on whose `project` client joins main's clients, and the events it pushed. */
  async function linkedPeer(more: Record<string, ModuleLoader> = {}): Promise<{ call: (channel: string, input?: unknown) => Promise<IpcResult<unknown>>; pushed: { channel: string; payload: unknown }[] }> {
    const { createLinkIpc, LinkPeer } = await import('../../src/main/link/ipc-adapter')
    const { addClient } = await import('../../src/main/broadcast')
    const adapter = await createLinkIpc({
      modules: {
        './projects.ts': () => import('../../src/main/ipc/projects').then((module) => module.default),
        './layout.ts': () => import('../../src/main/ipc/layout').then((module) => module.default),
        ...more,
      },
      isLinked: (id) => id === LINKED,
    })
    const pushed: { channel: string; payload: unknown }[] = []
    const peer = new LinkPeer({
      machineId: LINKED,
      describe: () => LINKED,
      push: (channel, payload) => pushed.push({ channel, payload }),
      local: () => ({ id: 'beta', name: 'Beta', protocol: 1, build: 'x' }),
      addClient,
      warn: () => undefined,
    })
    peer.setAccess('all')
    return { call: (channel, input) => adapter.call(peer, channel, input, 'Beta'), pushed }
  }

  /** Waits until the change broadcast of the store has reached the clients. */
  async function settled(check: () => boolean): Promise<void> {
    await vi.waitFor(() => {
      if (!check()) throw new Error('not yet')
    })
  }

  it('projects.list over the link leaves it out and keeps the ordinary one; a window sees both', async () => {
    const shop = (await addOk(makeRepo('shop'))).project
    const demo = await addLocal(makeRepo('demo'))
    const { call } = await linkedPeer()
    const linked = await call('projects.list')
    expect(linked.ok && (linked.value as State).projects.map((project) => project.id)).toEqual([shop.id])
    expect((await value<State>('projects.list')).projects.map((project) => project.id)).toEqual([shop.id, demo.id])
  })

  it('when it is the active Project, a Linked machine gets the first of the others as active, or null', async () => {
    const shop = (await addOk(makeRepo('shop'))).project
    const demo = await addLocal(makeRepo('demo'))
    expect((await value<State>('projects.list')).activeId).toBe(demo.id)
    const { call } = await linkedPeer()
    const linked = await call('projects.list')
    expect(linked.ok && (linked.value as State).activeId).toBe(shop.id)
    await value('projects.remove', { id: shop.id })
    const alone = await call('projects.list')
    expect(alone.ok && (alone.value as State)).toMatchObject({ projects: [], activeId: null })
  })

  it('projects.changed after an add with localOnly: the link client gets the list without it, the window with it', async () => {
    const shop = (await addOk(makeRepo('shop'))).project
    const { pushed } = await linkedPeer()
    electron.sent.length = 0
    const demo = await addLocal(makeRepo('demo'))
    const changed = (): State[] => pushed.filter((item) => item.channel === 'projects.changed').map((item) => item.payload as State)
    const toWindow = (): State[] => electron.sent.filter((item) => item.channel === IPC_CHANNEL_PREFIX + 'projects.changed').map((item) => item.payload as State)
    // Broadcasts are asynchronous and may finish out of order: compare the ones of the add's revision.
    const revision = (await value<State>('projects.list')).revision
    await settled(() => changed().some((state) => state.revision === revision) && toWindow().some((state) => state.revision === revision))
    const linkedState = changed().find((state) => state.revision === revision)
    expect(linkedState?.projects.map((project) => project.id)).toEqual([shop.id])
    expect(linkedState?.activeId).toBe(shop.id)
    expect(toWindow().find((state) => state.revision === revision)?.projects.map((project) => project.id)).toEqual([shop.id, demo.id])
    expect(JSON.stringify(pushed)).not.toContain(demo.id)
  })

  it('layout.get with its projectId from a Linked machine is refused before the handler; an ordinary Project answers', async () => {
    const shop = (await addOk(makeRepo('shop'))).project
    const demo = await addLocal(makeRepo('demo'))
    const { call } = await linkedPeer()
    const { layoutStore } = await import('../../src/main/layout/store')
    const get = vi.spyOn(layoutStore(), 'get')
    expect(await call('layout.get', { projectId: demo.id })).toStrictEqual({ ok: false, error: 'demo is local to this Machine' })
    expect(get).not.toHaveBeenCalled()
    expect((await call('layout.get', { projectId: shop.id })).ok).toBe(true)
    expect(get).toHaveBeenCalledWith(shop.id)
  })

  // A Card file and a Canvas image are asked for by project label, not by projectId (cards.file,
  // images.file): the label names the Project as well, and the refusal is layout.get's.
  it('cards.file and images.file of it from a Linked machine are refused before the handler; an ordinary Project answers', async () => {
    const shop = (await addOk(makeRepo('shop'))).project
    const demo = await addLocal(makeRepo('demo'))
    const { projectStore } = await import('../../src/main/projects/store')
    const image = `${'a'.repeat(32)}.png`
    for (const project of [shop, demo]) {
      const data = projectStore().dataDir(project.id)
      mkdirSync(join(data, 'images'), { recursive: true })
      writeFileSync(join(data, 'images', image), 'png bytes')
      mkdirSync(join(data, 'cards', 'c1'), { recursive: true })
      writeFileSync(join(data, 'cards', 'c1', 'index.html'), '<title>card</title>')
    }
    const { call } = await linkedPeer({
      './cards.ts': () => import('../../src/main/ipc/cards').then((module) => module.default),
      './images.ts': () => import('../../src/main/ipc/images').then((module) => module.default),
    })
    const label = (id: string) => id.slice(-8)
    const protocol = await import('../../src/main/images/protocol')
    const cards = await import('../../src/main/cards/protocol')
    const readImage = vi.spyOn(protocol, 'readImageFileChunk')
    const readCard = vi.spyOn(cards, 'readCardFileChunk')
    const refused = { ok: false, error: 'demo is local to this Machine' }
    expect(await call('images.file', { store: `canvas.${label(demo.id)}`, name: image })).toStrictEqual(refused)
    expect(await call('cards.file', { projectLabel: label(demo.id), cardId: 'c1', path: '/index.html' })).toStrictEqual(refused)
    expect(readImage).not.toHaveBeenCalled()
    expect(readCard).not.toHaveBeenCalled()
    // The same refusal as layout.get gives it.
    expect(await call('layout.get', { projectId: demo.id })).toStrictEqual(refused)

    const shopImage = await call('images.file', { store: `canvas.${label(shop.id)}`, name: image })
    expect(shopImage.ok && shopImage.value).toMatchObject({ status: 'file', extension: '.png', base64: Buffer.from('png bytes').toString('base64') })
    const shopCard = await call('cards.file', { projectLabel: label(shop.id), cardId: 'c1', path: '/index.html' })
    expect(shopCard.ok && shopCard.value).toMatchObject({ status: 'file', extension: '.html' })
    // The copies of sent images belong to no Project: their store is not refused for the local one.
    const attachments = await call('images.file', { store: 'attachments', name: `${'ab'.repeat(32)}.png` })
    expect(attachments).toStrictEqual({ ok: true, value: { status: 'missing' } })
  })

  it('a Linked machine can neither remove it by id nor add its folder; the list stays', async () => {
    await addOk(makeRepo('shop'))
    const demoPath = makeRepo('demo')
    const demo = await addLocal(demoPath)
    const { call } = await linkedPeer()
    const before = projectsFile()
    expect(await call('projects.remove', { id: demo.id })).toStrictEqual({ ok: false, error: 'demo is local to this Machine' })
    expect(await call('projects.add', { path: join(demoPath, 'README.md', '..') })).toStrictEqual({ ok: false, error: 'demo is local to this Machine' })
    expect(await call('projects.settings.get', { id: demo.id })).toStrictEqual({ ok: false, error: 'demo is local to this Machine' })
    expect(projectsFile()).toStrictEqual(before)
  })

  it('an old projects.json without the field reads as before; add without the option writes no field, with it writes localOnly: true', async () => {
    const old = makeRepo('old')
    mkdirSync(dataDir, { recursive: true })
    writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: 'old-12345678', name: 'old', path: old }], activeId: 'old-12345678' }))
    await start()
    expect(await value<State>('projects.list')).toMatchObject({ projects: [{ id: 'old-12345678', name: 'old', path: old }], activeId: 'old-12345678' })
    const shop = (await addOk(makeRepo('shop'))).project
    const demo = await addLocal(makeRepo('demo'))
    const saved = JSON.parse(readFileSync(join(dataDir, 'projects.json'), 'utf8')) as { projects: Record<string, unknown>[] }
    expect(saved.projects.map((project) => [project.id, 'localOnly' in project ? project.localOnly : 'none'])).toEqual([
      ['old-12345678', 'none'],
      [shop.id, 'none'],
      [demo.id, true],
    ])
  })

  it('a relative path to it from a Linked machine is refused too: projects.add, connect.inspect, connect.write', async () => {
    await addOk(makeRepo('shop'))
    const demoPath = makeRepo('demo')
    await addLocal(demoPath)
    const { call } = await linkedPeer()
    const before = projectsFile()
    const relativeTo = relative(process.cwd(), demoPath)
    expect(await call('projects.add', { path: relativeTo })).toStrictEqual({ ok: false, error: 'demo is local to this Machine' })
    expect(await call('projects.connect.inspect', { path: relativeTo })).toStrictEqual({ ok: false, error: 'demo is local to this Machine' })
    expect(await call('projects.connect.write', { root: relativeTo, draft: {} })).toStrictEqual({ ok: false, error: 'demo is local to this Machine' })
    expect(projectsFile()).toStrictEqual(before)
  })

  it('a `..` after a symbolic link inside an ordinary Project: refused on connect.draft, inspect, write and accounts wherever it leads into it', async () => {
    const shopPath = makeRepo('shop')
    await addOk(shopPath)
    const demoPath = makeRepo('demo')
    await addLocal(demoPath)
    // shop/lnk -> <scratch>/deep/a/b. POSIX follows the link before each `..` (the kernel, realpath,
    // `git -C`); Win32 drops `..` as text first (GetFullPathName), before any link is followed.
    mkdirSync(join(scratch, 'deep', 'a', 'b'), { recursive: true })
    symlinkSync(join(scratch, 'deep', 'a', 'b'), join(shopPath, 'lnk'))
    const { call } = await linkedPeer()
    const refused = { ok: false, error: 'demo is local to this Machine' }
    const fourCalls = async (through: string) => [
      await call('projects.connect.draft', { draftId: 'd1', root: through, mode: 'full', workflowFolder: null }),
      await call('projects.connect.inspect', { path: through }),
      await call('projects.connect.write', { root: through, draft: { profile: {}, rules: '', gate: [] } }),
      await call('projects.connect.accounts', { root: through }),
    ]
    // Two `..`: as text this is <scratch>/demo, the Demo project (Win32 reads it so); POSIX reads
    // <scratch>/deep/demo. Refused on both: either form leading into it is enough.
    expect(await fourCalls(join(shopPath, 'lnk') + '/../../demo')).toStrictEqual([refused, refused, refused, refused])
    // Three `..`: POSIX follows the link and lands in <scratch>/demo, the Demo project: refused.
    const three = join(shopPath, 'lnk') + '/../../../demo'
    if (process.platform !== 'win32') {
      expect(await fourCalls(three)).toStrictEqual([refused, refused, refused, refused])
    } else {
      // Win32 reads it as text: <temp>/demo, one folder above the scratch folder, not the Demo
      // project and not there at all. The handlers look there and find nothing.
      expect(resolve(three)).toBe(join(dirname(scratch), 'demo'))
      expect(existsSync(resolve(three))).toBe(false)
      const missing = { ok: true, value: expect.objectContaining({ reason: `${three} does not exist.` }) }
      expect(await fourCalls(three)).toStrictEqual([missing, missing, missing, missing])
    }
  })

  it('connect.write that names it as the Workflow folder of a shared Project is refused; docs.read of that Project then reads its own documents', async () => {
    const shopPath = makeRepo('shop')
    const shop = (await addOk(shopPath)).project
    const demoPath = makeRepo('demo')
    await addLocal(demoPath)
    writeFileSync(join(shopPath, 'HANDOFF.md'), 'shop handoff\n')
    writeFileSync(join(demoPath, 'HANDOFF.md'), 'demo handoff\n')
    const { call } = await linkedPeer({ './docs.ts': () => import('../../src/main/ipc/docs').then((module) => module.default) })
    const before = projectsFile()
    const draft = { profile: { name: 'shop', mode: 'silent', workflow: { folder: demoPath } }, rules: '', gate: [] }
    expect(await call('projects.connect.write', { root: shopPath, draft })).toStrictEqual({ ok: false, error: 'demo is local to this Machine' })
    expect(projectsFile()).toStrictEqual(before)
    const read = await call('docs.read', { projectId: shop.id, path: 'HANDOFF.md' })
    expect(read).toStrictEqual({ ok: true, value: { path: 'HANDOFF.md', text: 'shop handoff\n' } })
  })

  it('an add that reaches the handler with its folder answers a Linked machine with a refusal, not its view; a window gets the view', async () => {
    const demoPath = makeRepo('demo')
    await addLocal(demoPath)
    // As if the link adapter had missed the folder: the handler itself, called by a link client.
    const listener = handlers.get(IPC_CHANNEL_PREFIX + 'projects.add')
    const remoteEvent = { senderFrame: { url: APP_URL }, sender: { id: `link:${LINKED}/1` } } as unknown as IpcMainInvokeEvent
    expect(await listener?.(remoteEvent, { path: demoPath })).toStrictEqual({ ok: false, error: 'projects.add failed: demo is local to this Machine' })
    expect((await add(demoPath)).status).toBe('added')
  })

  it('agent: a Linked machine does not see its Sessions, cannot call them, and does not hear their events', async () => {
    await addOk(makeRepo('shop'))
    const demoPath = makeRepo('demo')
    await addLocal(demoPath)
    const shopPath = projectsFile().projects[0]?.path ?? ''
    const sessions = new Map([
      ['s-demo', { cwd: demoPath }],
      ['s-shop', { cwd: shopPath }],
    ])
    const noteInput = vi.fn()
    const registry = {
      get: (sessionId: string) => {
        const session = sessions.get(sessionId)
        if (session === undefined) throw new Error(`No live Session ${sessionId}`)
        return { ...session, state: 'idle', close: () => undefined }
      },
      list: () => [...sessions].map(([sessionId, { cwd }]) => ({ sessionId, sdkSessionId: null, cwd, state: 'idle' })),
      noteInput,
    }
    const { call, pushed } = await linkedPeer({
      './agent.ts': () => import('../../src/main/ipc/agent').then((module) => module.agentHandlers(() => registry as unknown as SessionRegistry)),
    })
    const listed = await call('agent.list')
    expect(listed.ok && (listed.value as { sessionId: string }[]).map((session) => session.sessionId)).toEqual(['s-shop'])
    for (const [channel, input] of [
      ['agent.send', { sessionId: 's-demo', text: 'hi', attachments: [] }],
      ['agent.close', { sessionId: 's-demo' }],
      ['agent.permission', { sessionId: 's-demo', requestId: 'r', decision: 'allow' }],
      ['agent.configure', { sessionId: 's-demo', change: { model: 'opus' } }],
    ] as const) {
      expect(await call(channel, input)).toStrictEqual({ ok: false, error: 'demo is local to this Machine' })
    }
    expect(noteInput).not.toHaveBeenCalled()
    await call('agent.close', { sessionId: 's-shop' })
    expect(noteInput).toHaveBeenCalledWith('s-shop', 'closed the Session')
    const { toEveryWindow } = await import('../../src/main/broadcast')
    const { emit } = await import('../../src/main/ipc/index')
    const { agentEvent } = await import('../../src/shared/ipc/agent')
    for (const sessionId of ['s-demo', 's-shop']) toEveryWindow((client) => emit(client, agentEvent, { sessionId, event: { type: 'prompt', text: 'hi', at: 1 } }))
    expect(pushed.filter((item) => item.channel === 'agent.event').map((item) => (item.payload as { sessionId: string }).sessionId)).toEqual(['s-shop'])
  })
})

describe('the draft Session of Connect (worfy-multi-vendor ticket 15)', () => {
  it('outside e2e runs it is the oneShot part of the Claude driver, through vendorDriver (worfy-multi-vendor ticket 23); WORFY_AGENT=fake plays the fake agent', async () => {
    await start()
    const { draftOneShotFromEnv, DRAFT_VENDOR } = await import('../../src/main/ipc/projects')
    const { vendorDriver } = await import('../../src/main/vendors/registry')
    expect(DRAFT_VENDOR).toBe('claude')
    const answer = { text: '', structured: { profile: {} } }
    // The Claude driver is one object for the app's life: its oneShot is what the draft calls.
    const oneShot = vi.spyOn(vendorDriver('claude'), 'oneShot').mockResolvedValue(answer)
    onTestFinished(() => oneShot.mockRestore())
    const opts = { cwd: scratch, readOnlyTools: ['Read'], outputSchema: {} }
    await expect(draftOneShotFromEnv({})('draft it', opts)).resolves.toBe(answer)
    expect(oneShot).toHaveBeenCalledWith('draft it', opts)

    // The fake agent plays the draft's script through the Claude driver's oneShot, not the SDK.
    oneShot.mockClear()
    const scripts = join(import.meta.dirname, '..', 'fixtures', 'agent-scripts')
    const fake = await draftOneShotFromEnv({ WORFY_AGENT: 'fake', WORFY_AGENT_SCRIPTS: scripts })('draft it', { cwd: scratch, readOnlyTools: ['Read'], outputSchema: {} })
    expect(fake.structured).toEqual(expect.objectContaining({ profile: expect.any(Object) }))
    expect(oneShot).not.toHaveBeenCalled()
  })
})

// worfy-human-review ticket 09: the team reviewer offer after a Project is added, the answer
// `humanReview.offer`, and "Team reviewer" of Project settings over the private folder of the
// Profile in a temporary Harness home. The Harness is the old one in the test's Claude home: its
// `bin/profile` and `bin/review-history` are Node stand-ins written here; the probe records its
// arguments and answers as each test says. Nothing here reaches GitHub.
describe('the team reviewer (worfy-human-review ticket 09)', () => {
  /** The Profiles of the temporary Harness home: `bin/profile -C <root> --dir` names <profiles>/<folder name of root>. */
  let profiles: string
  /** The Profile folder of the repository `shop`. */
  let profileDir: string
  /** One line per probe run: its arguments. */
  let probeCalls: string
  /** GH_TOKEN and REVIEW_HISTORY_GH of the last probe run. */
  let probeEnv: string

  /**
   * `bin/profile`: `--dir` prints the Profile folder of the `-C` folder (or fails with `dirCode`),
   * `--json` a known folder, `--field github.account` prints `account` (absent, exit 4, without one),
   * any other field is absent (exit 4).
   */
  function harnessStubs(options: { dirCode?: number; account?: string } = {}): void {
    const json = JSON.stringify({ _resolved: { mode: 'full', workflow_folder: scratch, workspace: null, repos: [] } })
    const account = options.account ?? ''
    writeFileSync(
      join(claudeHome, 'bin', 'profile'),
      nodeScript(
        [
          'const args = process.argv.slice(2)',
          "const name = (args[args.indexOf('-C') + 1] || '').split(/[\\\\/]/).filter(Boolean).pop()",
          `if (args.includes('--dir')) { if (${options.dirCode ?? 0} === 0) process.stdout.write(${JSON.stringify(join(profiles, '-').slice(0, -1))} + name + '\\n'); else { process.stderr.write('profile: no project\\n'); process.exitCode = ${options.dirCode ?? 0} } }`,
          `else if (args.includes('--json')) process.stdout.write(${JSON.stringify(`${json}\n`)})`,
          `else if (args.includes('github.account') && ${JSON.stringify(account)} !== '') process.stdout.write(${JSON.stringify(`${account}\n`)})`,
          'else process.exitCode = 4',
        ].join('\n'),
      ),
    )
  }

  /** `bin/review-history`: records its arguments, prints `stdout` and exits with `code`. */
  function stubProbe(answer: { code: number; stdout: string }): void {
    writeFileSync(
      join(claudeHome, 'bin', 'review-history'),
      nodeScript(
        [
          `fs.appendFileSync(${JSON.stringify(probeCalls)}, process.argv.slice(2).join(' ') + '\\n')`,
          `fs.writeFileSync(${JSON.stringify(probeEnv)}, JSON.stringify({ GH_TOKEN: process.env.GH_TOKEN ?? null, REVIEW_HISTORY_GH: process.env.REVIEW_HISTORY_GH ?? null }))`,
          `process.stdout.write(${JSON.stringify(answer.stdout)})`,
          `process.exitCode = ${answer.code}`,
        ].join('\n'),
      ),
    )
  }

  const VOICE_YES = { code: 0, stdout: JSON.stringify({ voice: 'yes', substantive: 30, threshold: 30, pull_requests: 12, requests: 1, line: 'voice: yes' }) }
  const VOICE_NO = { code: 0, stdout: JSON.stringify({ voice: 'no', substantive: 4, threshold: 30, pull_requests: 80, requests: 1, line: 'voice: no (4 of 30)' }) }

  const offers = (): unknown[] => electron.sent.filter((item) => item.channel === IPC_CHANNEL_PREFIX + 'projects.reviewer.offer').map((item) => item.payload)
  const probes = (): string[] => (existsSync(probeCalls) ? readFileSync(probeCalls, 'utf8').split('\n').filter(Boolean) : [])

  /** "Add project" on a folder the Harness knows (projects.connect.inspect), then the background offer settles. */
  async function addKnown(path: string): Promise<View> {
    const added = await value<{ status: string; project: View }>('projects.connect.inspect', { path })
    expect(added.status).toBe('added')
    const { settleReviewOffers } = await import('../../src/main/ipc/projects')
    await settleReviewOffers()
    return added.project
  }

  beforeEach(async () => {
    // The scripts get this process's environment, as in the connect.inspect test above: no login shell capture.
    vi.doMock('../../src/main/agent/env', async (importOriginal) => ({
      ...(await importOriginal<typeof import('../../src/main/agent/env')>()),
      agentEnv: () => Promise.resolve({ env: { ...process.env }, from: 'login-shell', error: null }),
    }))
    profiles = join(scratch, 'harness-home', 'projects')
    profileDir = join(profiles, 'shop')
    probeCalls = join(scratch, 'probe-calls.txt')
    probeEnv = join(scratch, 'probe-env.json')
    harnessStubs()
    await start()
  })

  afterEach(() => {
    vi.doUnmock('../../src/main/agent/env')
  })

  it('a probe that answers voice: yes sends the offer for the added Project; the probe ran on its root with --json', async () => {
    stubProbe(VOICE_YES)
    const shop = makeRepo('shop')
    const project = await addKnown(shop)
    expect(offers()).toEqual([{ projectId: project.id }])
    expect(probes()).toEqual([`probe -C ${shop} --json`])
  })

  it('voice: no, exit code 3, another exit code, an answer that is not JSON and a missing script send no offer, with one log line each', async () => {
    const warn = vi.mocked(console.warn)
    const answers = [VOICE_NO, { code: 3, stdout: '' }, { code: 1, stdout: '' }, { code: 0, stdout: 'voice: yes\n' }, null]
    for (const [index, answer] of answers.entries()) {
      if (answer === null) removeTestTree(join(claudeHome, 'bin', 'review-history'))
      else stubProbe(answer)
      warn.mockClear()
      await addKnown(makeRepo(`shop-${index}`))
      expect(offers(), JSON.stringify(answer)).toEqual([])
      const lines = warn.mock.calls.map((args) => String(args[0])).filter((line) => line.startsWith('[review-offer]'))
      expect(lines, JSON.stringify(answer)).toHaveLength(1)
    }
    expect(probes()).toHaveLength(4)
  })

  it('a folder already in the list, or one whose reviewer is built, is not offered again; the probe does not run', async () => {
    stubProbe(VOICE_YES)
    const shop = makeRepo('shop')
    await addKnown(shop)
    electron.sent.length = 0
    await addKnown(shop)
    expect(offers()).toEqual([])
    expect(probes()).toHaveLength(1)

    // The Profile of `cart` has its reviewer already.
    const cartSkill = join(profiles, 'cart', 'state', 'human-review', '.claude', 'skills', 'human-review', 'SKILL.md')
    mkdirSync(dirname(cartSkill), { recursive: true })
    writeFileSync(cartSkill, '---\nname: human-review\n---\n')
    await addKnown(makeRepo('cart'))
    expect(offers()).toEqual([])
    expect(probes()).toHaveLength(1)
  })

  it('"Later" saves humanReview.offer: "later"; it survives a restart and a Save of the dialog, and a new add makes no offer', async () => {
    stubProbe(VOICE_YES)
    const shop = makeRepo('shop')
    const project = await addKnown(shop)
    electron.sent.length = 0
    const saved = await value<{ humanReview?: unknown }>('projects.reviewer.later', { id: project.id })
    expect(saved.humanReview).toEqual({ offer: 'later' })
    expect(electron.sent.filter((item) => item.channel === IPC_CHANNEL_PREFIX + 'projects.settings.changed').map((item) => item.payload)).toEqual([{ id: project.id, settings: saved }])
    const file = join(dataDir, project.id, 'settings.json')
    expect((JSON.parse(readFileSync(file, 'utf8')) as { humanReview?: unknown }).humanReview).toEqual({ offer: 'later' })

    await start()
    const settings = await value<{ actionTemplates: unknown; humanReview?: unknown }>('projects.settings.get', { id: project.id })
    expect(settings.humanReview).toEqual({ offer: 'later' })
    // "Save" of Project settings sends no humanReview: the answer stays.
    await value('projects.settings.set', { id: project.id, settings: { actionTemplates: settings.actionTemplates } })
    expect((JSON.parse(readFileSync(file, 'utf8')) as { humanReview?: unknown }).humanReview).toEqual({ offer: 'later' })

    // Out of the list and in again: the data folder keeps the answer, and the probe does not run.
    await value('projects.remove', { id: project.id })
    electron.sent.length = 0
    await addKnown(shop)
    expect(offers()).toEqual([])
    expect(probes()).toHaveLength(1)
  })

  it('a settings.json from before the field reads, without humanReview; an unknown offer reads as unanswered', async () => {
    const project = (await addOk(makeRepo('shop'))).project
    const file = join(dataDir, project.id, 'settings.json')
    writeFileSync(file, JSON.stringify({ actionTemplates: LEGACY_TEMPLATES }))
    const old = await value<Record<string, unknown>>('projects.settings.get', { id: project.id })
    expect(old).toEqual({ actionTemplates: LEGACY_TEMPLATES })
    writeFileSync(file, JSON.stringify({ actionTemplates: LEGACY_TEMPLATES, humanReview: { offer: 'someday' } }))
    expect(await value<Record<string, unknown>>('projects.settings.get', { id: project.id })).toEqual({ actionTemplates: LEGACY_TEMPLATES, humanReview: {} })
  })

  it('projects.reviewer.get: not built, built with its date and pull requests, too little history, and not available without a Profile folder', async () => {
    const project = (await addOk(makeRepo('shop'))).project
    const folder = join(profileDir, 'state', 'human-review')
    expect(await value('projects.reviewer.get', { id: project.id })).toEqual({ status: 'none' })

    mkdirSync(folder, { recursive: true })
    writeFileSync(join(folder, 'meta.json'), JSON.stringify({ voice: 'voice: no (12 of 30)', counts: { pull_requests: 40, substantive: 12 } }))
    expect(await value('projects.reviewer.get', { id: project.id })).toEqual({ status: 'short', substantive: 12, threshold: 30 })

    writeFileSync(join(folder, 'meta.json'), JSON.stringify({ voice: 'voice: yes', counts: { pull_requests: 214, substantive: 380 } }))
    expect(await value('projects.reviewer.get', { id: project.id })).toEqual({ status: 'none' })
    const skill = join(folder, '.claude', 'skills', 'human-review', 'SKILL.md')
    mkdirSync(dirname(skill), { recursive: true })
    writeFileSync(skill, '---\nname: human-review\n---\n')
    const built = await value<{ status: string; builtAt: string; pullRequests: number }>('projects.reviewer.get', { id: project.id })
    expect(built).toMatchObject({ status: 'built', pullRequests: 214 })
    expect(Math.abs(Date.parse(built.builtAt) - Date.now())).toBeLessThan(60_000)

    harnessStubs({ dirCode: 3 })
    const unavailable = await value<{ status: string; reason: string }>('projects.reviewer.get', { id: project.id })
    expect(unavailable.status).toBe('unavailable')
    expect(unavailable.reason).toContain('exit code 3')
  })

  it('"Delete" erases the private folder and nothing else of the Profile folder', async () => {
    const project = (await addOk(makeRepo('shop'))).project
    const folder = join(profileDir, 'state', 'human-review')
    mkdirSync(join(folder, '.claude', 'skills', 'human-review'), { recursive: true })
    mkdirSync(join(folder, 'raw'), { recursive: true })
    writeFileSync(join(folder, '.claude', 'skills', 'human-review', 'SKILL.md'), 'skill')
    writeFileSync(join(folder, 'meta.json'), '{}')
    writeFileSync(join(folder, 'raw', 'prs.jsonl'), '{}\n')
    writeFileSync(join(profileDir, 'profile.json'), '{}')
    writeFileSync(join(profileDir, 'rules.md'), '# rules\n')
    mkdirSync(join(profileDir, 'state', 'other'), { recursive: true })
    writeFileSync(join(profileDir, 'state', 'other', 'keep.json'), '{}')
    writeFileSync(join(profileDir, 'state', 'human-review.json'), '{}')

    expect(await value('projects.reviewer.delete', { id: project.id })).toEqual({ status: 'none' })
    expect(existsSync(folder)).toBe(false)
    const left = (dir: string): string[] => readdirSync(dir, { recursive: true, encoding: 'utf8' }).map((path) => path.split('\\').join('/')).sort()
    expect(left(profileDir)).toEqual(['profile.json', 'rules.md', 'state', 'state/human-review.json', 'state/other', 'state/other/keep.json'])
    // A second Delete finds nothing to erase and answers the same.
    expect(await value('projects.reviewer.delete', { id: project.id })).toEqual({ status: 'none' })
  })

  /** A private folder of Profile `name` with a skill and meta.json; its path. */
  function builtReviewer(name: string, meta: Record<string, unknown>): string {
    const folder = join(profiles, name, 'state', 'human-review')
    mkdirSync(join(folder, '.claude', 'skills', 'human-review'), { recursive: true })
    writeFileSync(join(folder, '.claude', 'skills', 'human-review', 'SKILL.md'), 'skill')
    writeFileSync(join(folder, 'meta.json'), JSON.stringify(meta))
    return folder
  }

  it("the date of a built reviewer is kept_at of meta.json, else fetched_at, and the skill file's time only without either", async () => {
    const project = (await addOk(makeRepo('shop'))).project
    const folder = builtReviewer('shop', { kept_at: '2026-10-02T09:00:00Z', fetched_at: '2026-10-01T08:00:00Z', counts: { pull_requests: 7 } })
    expect(await value('projects.reviewer.get', { id: project.id })).toEqual({ status: 'built', builtAt: '2026-10-02T09:00:00.000Z', pullRequests: 7 })
    writeFileSync(join(folder, 'meta.json'), JSON.stringify({ fetched_at: '2026-10-01T08:00:00Z', kept_at: 'not a date' }))
    expect(await value('projects.reviewer.get', { id: project.id })).toEqual({ status: 'built', builtAt: '2026-10-01T08:00:00.000Z', pullRequests: null })
    writeFileSync(join(folder, 'meta.json'), '{}')
    const byFile = await value<{ builtAt: string }>('projects.reviewer.get', { id: project.id })
    expect(Math.abs(Date.parse(byFile.builtAt) - Date.now())).toBeLessThan(60_000)
  })

  it('get, Delete and Build go to the Project named by id, not to another one in the list', async () => {
    const shop = (await addOk(makeRepo('shop'))).project
    const cart = (await addOk(makeRepo('cart'))).project
    const shopFolder = builtReviewer('shop', { kept_at: '2026-10-02T09:00:00Z', counts: { pull_requests: 7 } })
    const cartFolder = builtReviewer('cart', { kept_at: '2026-09-01T09:00:00Z', counts: { pull_requests: 3 } })
    expect(await value('projects.reviewer.get', { id: cart.id })).toEqual({ status: 'built', builtAt: '2026-09-01T09:00:00.000Z', pullRequests: 3 })
    expect(await value('projects.reviewer.get', { id: shop.id })).toEqual({ status: 'built', builtAt: '2026-10-02T09:00:00.000Z', pullRequests: 7 })

    expect(await value('projects.reviewer.delete', { id: cart.id })).toEqual({ status: 'none' })
    expect(existsSync(cartFolder)).toBe(false)
    expect(existsSync(join(shopFolder, '.claude', 'skills', 'human-review', 'SKILL.md'))).toBe(true)
    expect(await value('projects.reviewer.get', { id: shop.id })).toMatchObject({ status: 'built' })

    // Build: the launcher of src/main/ipc/actions.ts is replaced; it records the Project it starts the Session for.
    const built: string[] = []
    vi.doMock('../../src/main/ipc/actions', () => ({
      sharedLauncher: () => ({
        buildTeamReviewer: (projectId: string) => {
          built.push(projectId)
          return { nodeId: `node-${projectId}`, sessionId: `session-${projectId}`, text: '/worfy:human-review-setup' }
        },
      }),
    }))
    try {
      expect(await value('projects.reviewer.build', { id: cart.id })).toEqual({ nodeId: `node-${cart.id}`, sessionId: `session-${cart.id}` })
      expect(await value('projects.reviewer.build', { id: shop.id })).toEqual({ nodeId: `node-${shop.id}`, sessionId: `session-${shop.id}` })
      expect(built).toEqual([cart.id, shop.id])
    } finally {
      vi.doUnmock('../../src/main/ipc/actions')
    }
  })

  it('Connect writing a Profile (projects.connect.write) offers too when the probe answers voice: yes', async () => {
    stubProbe(VOICE_YES)
    const written = join(scratch, 'connect-stdin.json')
    // bin/project-connect of the old Harness: takes the draft on stdin, keeps it aside and answers success.
    writeFileSync(
      join(claudeHome, 'bin', 'project-connect'),
      nodeScript([`fs.writeFileSync(${JSON.stringify(written)}, fs.readFileSync(0, 'utf8'))`, "process.stdout.write('{}\\n')"].join('\n')),
    )
    const shop = makeRepo('shop')
    const draft = { profile: { name: 'shop', mode: 'full' }, rules: '', gate: [] }
    const added = await value<{ status: string; project: View }>('projects.connect.write', { root: shop, draft })
    expect(added.status).toBe('added')
    expect(JSON.parse(readFileSync(written, 'utf8'))).toEqual(draft)
    const { settleReviewOffers } = await import('../../src/main/ipc/projects')
    await settleReviewOffers()
    expect(offers()).toEqual([{ projectId: added.project.id }])
    expect(probes()).toEqual([`probe -C ${shop} --json`])
  })

  it("the probe runs with GH_TOKEN of the Profile's GitHub account, and with the gh stand-in of the tests as its gh", async () => {
    const { ghWorld } = await import('./gh-world')
    const gh = ghWorld(join(scratch, 'gh'), { accounts: [{ login: 'alice', token: 'gho_alice_TEST' }, { login: 'bob', token: 'gho_bob_TEST', active: true }] })
    vi.stubEnv('WORFY_GH', gh.command)
    for (const [key, val] of Object.entries(gh.env)) vi.stubEnv(key, val)
    harnessStubs({ account: 'alice' })
    stubProbe(VOICE_YES)
    await addKnown(makeRepo('shop'))
    expect(JSON.parse(readFileSync(probeEnv, 'utf8'))).toEqual({ GH_TOKEN: 'gho_alice_TEST', REVIEW_HISTORY_GH: gh.command })
    expect(gh.calls()).toContainEqual(['auth', 'token', '-u', 'alice'])
  })

  it('deleteTeamReviewer refuses a Profile folder that is not an absolute path and removes nothing', async () => {
    const { deleteTeamReviewer } = await import('../../src/main/projects/review-offer')
    const folder = builtReviewer('shop', {})
    expect(() => deleteTeamReviewer(join('projects', 'shop'))).toThrow('the Profile folder is not an absolute path')
    expect(() => deleteTeamReviewer('')).toThrow('the Profile folder is not an absolute path')
    expect(existsSync(folder)).toBe(true)
  })

  // worfy-human-review ticket 10: the monthly reminder to update the reviewer (spec Q8 (a)). The clock is
  // vitest's fake Date, which the handler reads; the Harness stubs are real processes with their own clock.
  describe('the reminder to update it (worfy-human-review ticket 10)', () => {
    const DAY = 86_400_000
    const KEPT = Date.parse('2026-10-01T09:00:00Z')
    /** Asks main, at the time `at`, whether the reminder is due now. */
    async function remindAt(id: string, at: number): Promise<{ due: boolean }> {
      vi.setSystemTime(at)
      return value<{ due: boolean }>('projects.reviewer.remind', { id })
    }
    const savedReview = (id: string): unknown => (JSON.parse(readFileSync(join(dataDir, id, 'settings.json'), 'utf8')) as { humanReview?: unknown }).humanReview

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] })
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    it('comes on the 31st day after the reviewer was kept, is recorded in the settings, and not again for 30 days; "Later" waits for the next one', async () => {
      const project = (await addOk(makeRepo('shop'))).project
      const folder = builtReviewer('shop', { kept_at: new Date(KEPT).toISOString(), fetched_at: new Date(KEPT - DAY).toISOString(), counts: { pull_requests: 7 } })
      expect(await remindAt(project.id, KEPT + 30 * DAY - 60_000)).toEqual({ due: false })
      expect(savedReview(project.id)).toBeUndefined()

      const first = KEPT + 30 * DAY + 60_000
      expect(await remindAt(project.id, first)).toEqual({ due: true })
      expect(savedReview(project.id)).toEqual({ remindedAt: new Date(first).toISOString() })
      // Shown once: the next activation, another window, 29 days later — nothing ("Later" only closes the toast).
      expect(await remindAt(project.id, first)).toEqual({ due: false })
      expect(await remindAt(project.id, first + 29 * DAY)).toEqual({ due: false })
      const second = first + 30 * DAY + 60_000
      expect(await remindAt(project.id, second)).toEqual({ due: true })
      expect(savedReview(project.id)).toEqual({ remindedAt: new Date(second).toISOString() })

      // An update kept since (kept_at of the refresh): the reviewer is new again.
      writeFileSync(join(folder, 'meta.json'), JSON.stringify({ kept_at: new Date(second + 31 * DAY).toISOString() }))
      expect(await remindAt(project.id, second + 40 * DAY)).toEqual({ due: false })
      // Without kept_at, fetched_at dates the reviewer, as projects.reviewer.get reads it.
      writeFileSync(join(folder, 'meta.json'), JSON.stringify({ fetched_at: new Date(second).toISOString() }))
      expect(await remindAt(project.id, second + 31 * DAY)).toEqual({ due: true })
    })

    it('keeps the other answers of the settings, and the Save of the dialog keeps the reminder', async () => {
      stubProbe(VOICE_YES)
      const project = await addKnown(makeRepo('shop'))
      await value('projects.reviewer.later', { id: project.id })
      builtReviewer('shop', { kept_at: new Date(KEPT).toISOString() })
      const at = KEPT + 31 * DAY
      expect(await remindAt(project.id, at)).toEqual({ due: true })
      expect(savedReview(project.id)).toEqual({ offer: 'later', remindedAt: new Date(at).toISOString() })
      const settings = await value<{ actionTemplates: unknown }>('projects.settings.get', { id: project.id })
      await value('projects.settings.set', { id: project.id, settings: { actionTemplates: settings.actionTemplates } })
      expect(savedReview(project.id)).toEqual({ offer: 'later', remindedAt: new Date(at).toISOString() })
      // A remindedAt this version cannot read is no reminder: the next one is due.
      const file = join(dataDir, project.id, 'settings.json')
      writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), humanReview: { offer: 'later', remindedAt: 'soon' } }))
      expect(await remindAt(project.id, at + DAY)).toEqual({ due: true })
    })

    it('never comes without a built reviewer: no skill, a short history, no Profile folder; nothing is written', async () => {
      const project = (await addOk(makeRepo('shop'))).project
      const folder = join(profileDir, 'state', 'human-review')
      const late = KEPT + 90 * DAY
      expect(await remindAt(project.id, late)).toEqual({ due: false })
      mkdirSync(folder, { recursive: true })
      writeFileSync(join(folder, 'meta.json'), JSON.stringify({ kept_at: new Date(KEPT).toISOString(), voice: 'voice: yes' }))
      expect(await remindAt(project.id, late)).toEqual({ due: false })
      writeFileSync(join(folder, 'meta.json'), JSON.stringify({ fetched_at: new Date(KEPT).toISOString(), voice: 'voice: no (12 of 30)' }))
      expect(await remindAt(project.id, late)).toEqual({ due: false })
      builtReviewer('shop', { kept_at: new Date(KEPT).toISOString() })
      harnessStubs({ dirCode: 3 })
      expect(await remindAt(project.id, late)).toEqual({ due: false })
      expect(savedReview(project.id)).toBeUndefined()
    })

    it('reads only the private folder: the Harness asks no review-history, and the Profile folder is unchanged', async () => {
      stubProbe(VOICE_YES)
      const project = (await addOk(makeRepo('shop'))).project
      const folder = builtReviewer('shop', { kept_at: new Date(KEPT).toISOString() })
      const before = readdirSync(profileDir, { recursive: true, encoding: 'utf8' }).sort()
      const meta = readFileSync(join(folder, 'meta.json'), 'utf8')
      expect(await remindAt(project.id, KEPT + 31 * DAY)).toEqual({ due: true })
      expect(probes()).toEqual([])
      expect(readdirSync(profileDir, { recursive: true, encoding: 'utf8' }).sort()).toEqual(before)
      expect(readFileSync(join(folder, 'meta.json'), 'utf8')).toBe(meta)
    })

    it('a reviewer or a reminder dated in the future, as a clock set back, is not due, even more than 30 days ahead', async () => {
      const project = (await addOk(makeRepo('shop'))).project
      const folder = builtReviewer('shop', { kept_at: new Date(KEPT + 10 * DAY).toISOString() })
      expect(await remindAt(project.id, KEPT)).toEqual({ due: false })
      writeFileSync(join(folder, 'meta.json'), JSON.stringify({ kept_at: new Date(KEPT + 40 * DAY).toISOString() }))
      expect(await remindAt(project.id, KEPT)).toEqual({ due: false })
      // A reminder recorded 40 days ahead of the clock waits for that date and 30 days more.
      writeFileSync(join(folder, 'meta.json'), JSON.stringify({ kept_at: new Date(KEPT - 60 * DAY).toISOString() }))
      const file = join(dataDir, project.id, 'settings.json')
      writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), humanReview: { remindedAt: new Date(KEPT + 40 * DAY).toISOString() } }))
      expect(await remindAt(project.id, KEPT)).toEqual({ due: false })
      expect(await remindAt(project.id, KEPT + 71 * DAY)).toEqual({ due: true })
    })

    it('after an accepted update the reviewer counts the pull requests of the history and of the update, until a whole build reads it again', async () => {
      const project = (await addOk(makeRepo('shop'))).project
      const meta = { kept_at: '2026-11-02T09:00:00Z', fetched_at: '2026-10-01T08:00:00Z', analysed_through: '2026-11-02T08:00:00Z', analysed_pull_requests: 260, counts: { pull_requests: 214 } }
      const folder = builtReviewer('shop', meta)
      expect(await value('projects.reviewer.get', { id: project.id })).toEqual({ status: 'built', builtAt: '2026-11-02T09:00:00.000Z', pullRequests: 260 })
      // A whole build since: fetched_at is later, its counts replace the update's.
      writeFileSync(join(folder, 'meta.json'), JSON.stringify({ ...meta, fetched_at: '2026-12-01T08:00:00Z', kept_at: '2026-12-01T09:00:00Z', counts: { pull_requests: 230 } }))
      expect(await value('projects.reviewer.get', { id: project.id })).toEqual({ status: 'built', builtAt: '2026-12-01T09:00:00.000Z', pullRequests: 230 })
      // A count that does not read falls back to the history's.
      writeFileSync(join(folder, 'meta.json'), JSON.stringify({ ...meta, analysed_pull_requests: 'many' }))
      expect(await value('projects.reviewer.get', { id: project.id })).toMatchObject({ pullRequests: 214 })
    })

    it('refreshDue: the rule itself, with the clock passed in', async () => {
      const { refreshDue, REFRESH_AFTER_DAYS } = await import('../../src/main/projects/review-offer')
      expect(REFRESH_AFTER_DAYS).toBe(30)
      const built = { status: 'built' as const, builtAt: new Date(KEPT).toISOString(), pullRequests: 3 }
      expect(refreshDue(built, undefined, new Date(KEPT + 30 * DAY))).toBe(false)
      expect(refreshDue(built, undefined, new Date(KEPT + 30 * DAY + 1))).toBe(true)
      expect(refreshDue(built, new Date(KEPT + 40 * DAY).toISOString(), new Date(KEPT + 69 * DAY))).toBe(false)
      expect(refreshDue(built, new Date(KEPT + 40 * DAY).toISOString(), new Date(KEPT + 71 * DAY))).toBe(true)
      // Dates ahead of the clock are not old, however far ahead.
      expect(refreshDue({ ...built, builtAt: new Date(KEPT + 40 * DAY).toISOString() }, undefined, new Date(KEPT))).toBe(false)
      expect(refreshDue({ ...built, builtAt: new Date(KEPT - 60 * DAY).toISOString() }, new Date(KEPT + 40 * DAY).toISOString(), new Date(KEPT))).toBe(false)
      expect(refreshDue({ status: 'none' }, undefined, new Date(KEPT + 90 * DAY))).toBe(false)
      expect(refreshDue({ status: 'short', substantive: 4, threshold: 30 }, undefined, new Date(KEPT + 90 * DAY))).toBe(false)
    })

    it('"Update" starts the generator with --refresh; "Build" stays the first run', async () => {
      const project = (await addOk(makeRepo('shop'))).project
      const built: unknown[] = []
      vi.doMock('../../src/main/ipc/actions', () => ({
        sharedLauncher: () => ({
          buildTeamReviewer: (projectId: string, options?: unknown) => {
            built.push([projectId, options])
            return { nodeId: 'node-1', sessionId: 'session-1', text: '' }
          },
        }),
      }))
      try {
        expect(await value('projects.reviewer.build', { id: project.id, refresh: true })).toEqual({ nodeId: 'node-1', sessionId: 'session-1' })
        await value('projects.reviewer.build', { id: project.id })
        expect(built).toEqual([
          [project.id, { refresh: true }],
          [project.id, { refresh: false }],
        ])
      } finally {
        vi.doUnmock('../../src/main/ipc/actions')
      }
    })

    it('a Linked machine reaches the reminder only while access is on: it writes the Project settings', async () => {
      const project = (await addOk(makeRepo('shop'))).project
      builtReviewer('shop', { kept_at: new Date(KEPT).toISOString() })
      vi.setSystemTime(KEPT + 31 * DAY)
      const off = await linkedCaller(false)
      expect(await off('projects.reviewer.remind', { id: project.id })).toMatchObject({ ok: false })
      expect(savedReview(project.id)).toBeUndefined()
      const on = await linkedCaller(true)
      expect(await on('projects.reviewer.remind', { id: project.id })).toStrictEqual({ ok: true, value: { due: true } })
    })
  })
})

describe('Remove project (worfy-polish ticket 79): projects.removal.preview, projects.removeProject, projects.removal.reveal', () => {
  /** The Harness home of the app (<claudeHome>/worfy-harness): <harness>/projects/<name>/profile.json; the old Harness's registry is <claudeHome>/gate. */
  let harness: string
  /** One line per bin/project-connect run: its arguments. */
  let connectCalls: string
  /** What the Orchestrators were asked. */
  let asked: string[]

  /** `bin/profile -C <folder> --dir` prints <harness>/projects/<folder name>; any other call is absent (exit 4). */
  function stubProfile(): void {
    writeFileSync(
      join(claudeHome, 'bin', 'profile'),
      nodeScript(
        [
          'const args = process.argv.slice(2)',
          "const name = (args[args.indexOf('-C') + 1] || '').split(/[\\\\/]/).filter(Boolean).pop()",
          `if (args.includes('--dir')) process.stdout.write(${JSON.stringify(join(harness, 'projects') + sep)} + name + '\\n')`,
          'else process.exitCode = 4',
        ].join('\n'),
      ),
    )
  }

  /** `bin/project-connect`: notes its arguments, prints `stdout` and exits with `code`. */
  function stubConnect(code: number, stdout: string): void {
    writeFileSync(
      join(claudeHome, 'bin', 'project-connect'),
      nodeScript(
        [`fs.appendFileSync(${JSON.stringify(connectCalls)}, process.argv.slice(2).join(' ') + '\\n')`, `process.stdout.write(${JSON.stringify(stdout)})`, `process.exitCode = ${code}`].join('\n'),
      ),
    )
  }

  /** A Profile `name` of the stub Harness home, with gate registry entries for `matches`. */
  function profileOf(name: string, profile: Record<string, unknown>, matches: readonly string[]): string {
    const dir = join(harness, 'projects', name)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'profile.json'), JSON.stringify({ schema: 2, name, ...profile }))
    mkdirSync(join(claudeHome, 'gate'), { recursive: true })
    writeFileSync(join(claudeHome, 'gate', 'config.json'), JSON.stringify({ repos: matches.map((match) => ({ key: name, match, profile: name })) }))
    return dir
  }

  const connects = (): string[] => (existsSync(connectCalls) ? readFileSync(connectCalls, 'utf8').split('\n').filter(Boolean) : [])

  beforeEach(async () => {
    harness = join(claudeHome, 'worfy-harness')
    connectCalls = join(scratch, 'connect-calls.txt')
    asked = []
    // The scripts get this process's environment, as in the team reviewer tests above: no login shell capture.
    vi.doMock('../../src/main/agent/env', async (importOriginal) => ({
      ...(await importOriginal<typeof import('../../src/main/agent/env')>()),
      agentEnv: () => Promise.resolve({ env: { ...process.env }, from: 'login-shell', error: null }),
    }))
    // The app's Orchestrators and Sessions, imported by a removal only: stand-ins that note what they are asked.
    vi.doMock('../../src/main/agent/app-orchestrators', () => ({
      sharedOrchestrators: () => ({ retain: (ids: ReadonlySet<string>) => asked.push(`retain ${[...ids].join(' ')}`) }),
      keepClosed: (id: string) => {
        asked.push(`keep closed ${id}`)
        return () => asked.push(`release ${id}`)
      },
    }))
    vi.doMock('../../src/main/agent/app-registry', () => ({ sharedRegistry: () => ({ list: () => [], get: () => undefined, noteInput: () => undefined }) }))
    // The app's Tickets and documents hubs: a removal holds both watches closed while project-connect runs
    // (Windows refuses to rename the Profile folder while a watch holds the Workflow folder inside it).
    const hub = (what: string) => ({
      hold: (key: string) => {
        asked.push(`hold ${what} ${key} after ${connects().length} runs`)
        return Promise.resolve(() => {
          asked.push(`watch ${what} ${key} again after ${connects().length} runs`)
          return Promise.resolve()
        })
      },
    })
    vi.doMock('../../src/main/ipc/workflow', () => ({ workflowHub: hub('tickets') }))
    vi.doMock('../../src/main/ipc/docs', () => ({ docsHub: hub('documents') }))
    stubProfile()
    await start()
  })

  afterEach(() => {
    vi.doUnmock('../../src/main/agent/env')
    vi.doUnmock('../../src/main/agent/app-orchestrators')
    vi.doUnmock('../../src/main/agent/app-registry')
    vi.doUnmock('../../src/main/ipc/workflow')
    vi.doUnmock('../../src/main/ipc/docs')
  })

  it('previews the Profile and its paths, then removes it through project-connect --remove and takes the Project out of the list', async () => {
    const shop = makeRepo('shop')
    const kept = (await addOk(makeRepo('kept'))).project
    const project = (await addOk(shop)).project
    const profileDir = profileOf('shop', { mode: 'full' }, [shop])
    stubConnect(0, JSON.stringify({ name: 'shop', removed: { profileDir, gateKeys: ['shop'], runs: null, qmd: { status: 'skipped', reason: 'skipped: --no-qmd', removed: [], kept: [] }, leftover: [] } }))

    expect(await value('projects.removal.preview', { id: project.id })).toStrictEqual({
      status: 'ready',
      profile: 'shop',
      profileDir,
      paths: [shop],
      runs: join(harness, 'runs', 'shop'),
      qmd: [],
      mode: 'full',
      workflowFolder: null,
      alsoListed: [],
    })
    const removed = await value<{ status: string; state: State; notes: string[] }>('projects.removeProject', { id: project.id })
    expect(removed.status).toBe('removed')
    expect(removed.notes).toStrictEqual([])
    expect(removed.state.projects.map((each) => each.id)).toStrictEqual([kept.id])
    expect((await value<State>('projects.list')).projects.map((each) => each.id)).toStrictEqual([kept.id])
    expect(connects()).toStrictEqual(['--remove shop'])
    expect(asked).toStrictEqual([
      `retain ${kept.id}`,
      `keep closed ${project.id}`,
      `hold tickets ${shop} after 0 runs`,
      `hold documents ${project.id} after 0 runs`,
      `release ${project.id}`,
      `watch tickets ${shop} again after 1 runs`,
      `watch documents ${project.id} again after 1 runs`,
    ])
    // worfy deletes nothing itself: the stub removed nothing, so the Profile and the repository are as they were.
    expect(existsSync(join(profileDir, 'profile.json'))).toBe(true)
    expect(repoStatus(shop)).toBe('')
  })

  it("a refusal of project-connect leaves the Project in the list, with the script's words", async () => {
    const shop = makeRepo('shop')
    const project = (await addOk(shop)).project
    profileOf('shop', { mode: 'full' }, [shop])
    stubConnect(1, JSON.stringify({ ok: false, errors: [{ path: '', kind: 'write', message: 'the registry cannot be written' }] }))
    expect(await value('projects.removeProject', { id: project.id })).toStrictEqual({
      status: 'refused',
      reason: 'The Harness did not remove the Profile shop, so the Project stays in the list: the registry cannot be written',
      workflowFolder: null,
    })
    expect((await value<State>('projects.list')).projects.map((each) => each.id)).toStrictEqual([project.id])
  })

  it('Silent mode with tickets in the default Workflow folder: refused with the folder and no script run; reveal shows that folder', async () => {
    const shop = makeRepo('shop')
    const project = (await addOk(shop)).project
    const profileDir = profileOf('shop', { mode: 'silent', workflow: { folder: null } }, [shop])
    mkdirSync(join(profileDir, 'workflow'), { recursive: true })
    writeFileSync(join(profileDir, 'workflow', '01-ticket.md'), '# 01')
    stubConnect(0, '{}')
    expect(await value('projects.removeProject', { id: project.id })).toMatchObject({ status: 'refused', workflowFolder: join(profileDir, 'workflow') })
    expect(connects()).toStrictEqual([])
    expect(asked).toStrictEqual([])
    expect(await value('projects.removal.reveal', { id: project.id })).toStrictEqual({ path: join(profileDir, 'workflow') })
    expect(electron.showItemInFolder.mock.calls).toStrictEqual([[join(profileDir, 'workflow')]])
    expect(readFileSync(join(profileDir, 'workflow', '01-ticket.md'), 'utf8')).toBe('# 01')
  })

  it('reveal of a Full mode Project is refused: its Profile has no Workflow folder', async () => {
    const shop = makeRepo('shop')
    const project = (await addOk(shop)).project
    profileOf('shop', { mode: 'full' }, [shop])
    expect(await call('projects.removal.reveal', { id: project.id })).toStrictEqual({ ok: false, error: 'projects.removal.reveal failed: the Profile shop has no Workflow folder inside its folder' })
    expect(electron.showItemInFolder).not.toHaveBeenCalled()
  })
})
