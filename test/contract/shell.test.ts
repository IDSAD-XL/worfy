// The `shell` channels in main: src/main/ipc/shell.ts registered through registerIpc (the same
// wrapper the app uses) over a mocked `electron`, against a real git repository with a linked
// worktree in a temporary folder. Nothing reaches macOS: shell.openPath, shell.showItemInFolder,
// shell.openExternal and dialog.showMessageBox are recorders; the box answers what a test sets.
import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, posix, win32 } from 'node:path'
import type { IpcMainInvokeEvent } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectLayout } from '../../src/main/workflow/folder'
import { IPC_CHANNEL_PREFIX, type IpcResult } from '../../src/shared/ipc/channels'
import { APP_URL, INDEX_HTML } from '../app-url'
import { removeTestTree } from '../remove'

const PROJECT_ID = 'repo-00000001'

const electron = vi.hoisted(() => ({
  openPath: vi.fn<(path: string) => Promise<string>>(),
  openExternal: vi.fn<(url: string) => Promise<void>>(),
  showItemInFolder: vi.fn<(path: string) => void>(),
  showMessageBox: vi.fn<(owner: unknown, options: Electron.MessageBoxOptions) => Promise<{ response: number }>>(),
  /** The window BrowserWindow.fromWebContents finds for the sender of a call. */
  owner: { id: 'the window that asked' },
}))

vi.mock('electron', () => ({
  shell: { openPath: electron.openPath, openExternal: electron.openExternal, showItemInFolder: electron.showItemInFolder },
  dialog: { showMessageBox: electron.showMessageBox },
  BrowserWindow: { fromWebContents: () => electron.owner },
}))

// The Project's layout (src/main/workflow/folder.ts) stands in for the `profile` call: Full mode
// unless a test puts a Silent layout, with the Workflow folder outside the repository, in its place.
const layouts = vi.hoisted(() => ({ byRoot: new Map<string, ProjectLayout | Error>() }))
vi.mock('../../src/main/workflow/folder', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/main/workflow/folder')>()
  return {
    ...actual,
    projectLayouts: () => ({
      get: (root: string) => {
        const layout = layouts.byRoot.get(root)
        return layout instanceof Error ? Promise.reject(layout) : Promise.resolve(layout ?? actual.fullLayout(root))
      },
    }),
  }
})

type Listener = (event: IpcMainInvokeEvent, input: unknown) => unknown

let scratch: string
let repo: string
let outside: string
let worktree: string
let handlers: Map<string, Listener>

function git(cwd: string, ...args: string[]): string {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd, env, encoding: 'utf8' }).trim()
}

async function call(channel: string, input?: unknown): Promise<IpcResult<unknown>> {
  const listener = handlers.get(IPC_CHANNEL_PREFIX + channel)
  if (!listener) throw new Error(`no handler for ${channel}`)
  const event = { senderFrame: { url: APP_URL }, sender: {} } as unknown as IpcMainInvokeEvent
  return (await listener(event, input)) as IpcResult<unknown>
}

async function refused(channel: string, input: unknown, reason: RegExp): Promise<void> {
  const result = await call(channel, input)
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.error).toMatch(reason)
}

beforeEach(async () => {
  // .native: the answer is the path realpath(3) gives, and a temporary folder under an 8.3 short
  // name (C:\Users\RUNNER~1 on the GitHub Windows runner) keeps that name in the JavaScript realpath.
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-shell-')))
  repo = join(scratch, 'repo')
  mkdirSync(join(repo, '.scratch', 'e', 'issues'), { recursive: true })
  git(repo, 'init', '-q')
  writeFileSync(join(repo, '.scratch', 'e', 'issues', '01-a.md'), '# 01 — a\n')
  writeFileSync(join(repo, 'README.md'), 'repo')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'init')
  // A linked worktree outside the repository folder, as `git worktree add ../wt` makes it.
  worktree = join(scratch, 'wt-07')
  git(repo, 'worktree', 'add', '-q', '-b', 'e/07', worktree)
  outside = join(scratch, 'outside')
  mkdirSync(outside)
  writeFileSync(join(outside, 'secret.txt'), 'not the Project')
  symlinkSync(join(outside, 'secret.txt'), join(repo, 'link-out.md'))
  symlinkSync(join(repo, 'README.md'), join(repo, 'link-in.md'))

  const dataDir = join(scratch, 'data')
  mkdirSync(join(dataDir, PROJECT_ID), { recursive: true })
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT_ID, name: 'repo', path: repo }], activeId: PROJECT_ID }))

  layouts.byRoot.clear()
  electron.openPath.mockReset().mockResolvedValue('')
  electron.openExternal.mockReset().mockResolvedValue(undefined)
  electron.showItemInFolder.mockReset()
  // Cancel unless a test answers otherwise: a box nobody expected opens nothing.
  electron.showMessageBox.mockReset().mockResolvedValue({ response: 0 })
  vi.spyOn(console, 'error').mockImplementation(() => undefined)

  vi.resetModules()
  process.env.WORFY_DATA_DIR = dataDir
  const { registerIpc, appUrlMatcher } = await import('../../src/main/ipc/index')
  handlers = new Map()
  await registerIpc(
    { handle: (channel, listener) => handlers.set(channel, listener as Listener) },
    {
      modules: { './shell.ts': () => import('../../src/main/ipc/shell').then((module) => module.default) },
      isTrustedSender: appUrlMatcher({ indexHtml: INDEX_HTML }),
    },
  )
})

afterEach(() => {
  vi.restoreAllMocks()
  delete process.env.WORFY_DATA_DIR
  removeTestTree(scratch)
})

describe('shell.openInEditor', () => {
  it('opens a file inside the Project and answers with its real path only', async () => {
    const file = join(repo, '.scratch', 'e', 'issues', '01-a.md')
    const result = await call('shell.openInEditor', { projectId: PROJECT_ID, path: file, app: '/Applications/Evil.app' })
    expect(result).toStrictEqual({ ok: true, value: { path: file, outcome: 'opened' } })
    // Exactly one argument: an extra input key never reaches macOS.
    expect(electron.openPath.mock.calls).toStrictEqual([[file]])
  })

  it('resolves a relative path against the Project root and a symlink to its real target inside', async () => {
    expect(await call('shell.openInEditor', { projectId: PROJECT_ID, path: '.scratch/e/issues/01-a.md' })).toStrictEqual({
      ok: true,
      value: { path: join(repo, '.scratch', 'e', 'issues', '01-a.md'), outcome: 'opened' },
    })
    expect(await call('shell.openInEditor', { projectId: PROJECT_ID, path: join(repo, 'link-in.md') })).toStrictEqual({
      ok: true,
      value: { path: join(repo, 'README.md'), outcome: 'opened' },
    })
    expect(electron.openPath.mock.calls).toStrictEqual([[join(repo, '.scratch', 'e', 'issues', '01-a.md')], [join(repo, 'README.md')]])
  })

  it('opens a file in a folder whose name starts with two dots', async () => {
    mkdirSync(join(repo, '..drafts'))
    const file = join(repo, '..drafts', 'x.md')
    writeFileSync(file, 'x')
    expect(await call('shell.openInEditor', { projectId: PROJECT_ID, path: file })).toStrictEqual({ ok: true, value: { path: file, outcome: 'opened' } })
    expect(await call('shell.openInEditor', { projectId: PROJECT_ID, path: '..drafts/x.md' })).toStrictEqual({ ok: true, value: { path: file, outcome: 'opened' } })
  })

  it('opens a file of a linked worktree that lies outside the repository folder', async () => {
    const file = join(worktree, 'README.md')
    expect(await call('shell.openInEditor', { projectId: PROJECT_ID, path: file })).toStrictEqual({ ok: true, value: { path: file, outcome: 'opened' } })
  })

  it('refuses ../ out of the Project, a symlink that points out, and a missing file', async () => {
    await refused('shell.openInEditor', { projectId: PROJECT_ID, path: join(repo, '..', 'outside', 'secret.txt') }, /outside the Project/)
    await refused('shell.openInEditor', { projectId: PROJECT_ID, path: '../outside/secret.txt' }, /outside the Project/)
    // The parent folder itself is outside too.
    await refused('shell.openInEditor', { projectId: PROJECT_ID, path: '..' }, /outside the Project/)
    await refused('shell.openInEditor', { projectId: PROJECT_ID, path: join(repo, 'link-out.md') }, /outside the Project/)
    // The folder next to the root whose name starts the same is not inside it.
    mkdirSync(join(scratch, 'repo-evil'))
    writeFileSync(join(scratch, 'repo-evil', 'x.md'), 'x')
    await refused('shell.openInEditor', { projectId: PROJECT_ID, path: join(scratch, 'repo-evil', 'x.md') }, /outside the Project/)
    await refused('shell.openInEditor', { projectId: PROJECT_ID, path: join(repo, 'no-such.md') }, /does not exist/)
    expect(electron.openPath).not.toHaveBeenCalled()
  })

  it('refuses an unknown Project and input of the wrong type', async () => {
    await refused('shell.openInEditor', { projectId: 'nope-00000000', path: join(repo, 'README.md') }, /No Project with id/)
    await refused('shell.openInEditor', { projectId: PROJECT_ID, path: 42 }, /invalid input/)
    await refused('shell.openInEditor', { path: join(repo, 'README.md') }, /invalid input/)
    await refused('shell.openInEditor', { projectId: PROJECT_ID, path: '' }, /invalid input/)
    expect(electron.openPath).not.toHaveBeenCalled()
  })

  it('reports the reason macOS gives when it cannot open the file', async () => {
    electron.openPath.mockResolvedValue('No application knows how to open this file')
    await refused('shell.openInEditor', { projectId: PROJECT_ID, path: join(repo, 'README.md') }, /No application knows/)
  })
})

// worfy-polish ticket 36: in Silent mode the Ticket files lie in the Workflow folder, outside the
// Project. tickets.read reads them there, so "Open in editor" and the links of the Ticket body must
// open them there too, and nothing else outside the Project.
describe('shell.openInEditor in a Silent Project', () => {
  let workflow: string
  let ticketsRoot: string

  beforeEach(() => {
    workflow = join(scratch, 'workflow')
    // A Tickets root apart from the Workflow folder, as `ticket root` may answer.
    ticketsRoot = join(scratch, 'tickets-root')
    mkdirSync(join(workflow, '.scratch', 'e', 'issues'), { recursive: true })
    mkdirSync(join(ticketsRoot, 'e', 'issues'), { recursive: true })
    writeFileSync(join(workflow, '.scratch', 'e', 'spec.md'), '# e\n')
    writeFileSync(join(ticketsRoot, 'e', 'issues', '02-b.md'), '# 02 — b\n')
    layouts.byRoot.set(repo, { root: repo, mode: 'silent', workflowFolder: workflow, ticketsRoot, repos: [], workspace: null, reason: null, failed: false })
  })

  it('opens a file of the Workflow folder and of the Tickets root, and the Project\'s own files as before', async () => {
    for (const file of [join(workflow, '.scratch', 'e', 'spec.md'), join(ticketsRoot, 'e', 'issues', '02-b.md'), join(repo, 'README.md'), join(worktree, 'README.md')]) {
      expect(await call('shell.openInEditor', { projectId: PROJECT_ID, path: file })).toStrictEqual({ ok: true, value: { path: file, outcome: 'opened' } })
    }
    // A link of the Ticket body, relative to the Project root, that leads into the Workflow folder.
    expect(await call('shell.openInEditor', { projectId: PROJECT_ID, path: '../workflow/.scratch/e/spec.md' })).toStrictEqual({
      ok: true,
      value: { path: join(workflow, '.scratch', 'e', 'spec.md'), outcome: 'opened' },
    })
  })

  it('still refuses a file outside the Project, its worktrees, the Workflow folder and the Tickets root', async () => {
    await refused('shell.openInEditor', { projectId: PROJECT_ID, path: join(outside, 'secret.txt') }, /outside the Project/)
    symlinkSync(join(outside, 'secret.txt'), join(workflow, '.scratch', 'e', 'link-out.md'))
    await refused('shell.openInEditor', { projectId: PROJECT_ID, path: join(workflow, '.scratch', 'e', 'link-out.md') }, /outside the Project/)
    expect(electron.openPath).not.toHaveBeenCalled()
  })

  it('never takes the root of a disk or a share, or a folder that holds the home folder, as a place of the workflow', async () => {
    const { workflowPlaces } = await import('../../src/main/ipc/shell')
    const layout = (workflowFolder: string, ticketsRoot: string): ProjectLayout => ({ root: '/p', mode: 'silent', workflowFolder, ticketsRoot, repos: [], workspace: null, reason: null, failed: false })
    // realpath of the places: the folders as written unless a test names their real path.
    const real =
      (links: Record<string, string | null> = {}) =>
      async (path: string): Promise<string | null> =>
        path in links ? links[path]! : path
    // stat of the folders: each path its own folder unless a test gives it the identity of another,
    // or an error.
    const looks =
      (ids: Record<string, { dev: number; ino: number } | NodeJS.ErrnoException> = {}) =>
      async (path: string): Promise<{ dev: number; ino: number }> => {
        const id = ids[path]
        if (id instanceof Error) throw id
        return id ?? { dev: 1, ino: inode(path) }
      }
    const inodes = new Map<string, number>()
    const inode = (path: string): number => inodes.get(path) ?? inodes.set(path, 1000 + inodes.size).get(path)!
    const failure = (code: string): NodeJS.ErrnoException => Object.assign(new Error(code), { code })
    const places = (workflowFolder: string, ticketsRoot: string, home: string, links?: Record<string, string | null>, ids?: Parameters<typeof looks>[0]) =>
      workflowPlaces(layout(workflowFolder, ticketsRoot), { paths: posix, home, real: real(links), stat: looks(ids) })
    expect(await places('/wf', '/wf/.scratch', '/Users/a')).toEqual(['/wf/.scratch', '/wf'])
    expect(await places('/', '/.scratch', '/Users/a')).toEqual(['/.scratch'])
    expect(await places('/Users/a', '/Users/a/', '/Users/a')).toEqual([])
    expect(await places('/Users/a/wf', '/Users/a/wf/.scratch', '/Users/a/')).toEqual(['/Users/a/wf/.scratch', '/Users/a/wf'])
    // A folder above the home folder holds it, and so does a path that only reads as another folder.
    expect(await places('/Users', '/wf/../Users/a/../a/wf', '/Users/a')).toEqual(['/wf/../Users/a/../a/wf'])
    // review of PR #826: a symlink to the home folder, and the home folder in another letter case,
    // which realpath gives as the disk keeps it, pass a check of the text alone.
    expect(await places('/tmp/x/link', '/tmp/x/link/.scratch', '/Users/a', { '/tmp/x/link': '/Users/a', '/tmp/x/link/.scratch': '/Users/a/.scratch' })).toEqual(['/tmp/x/link/.scratch'])
    expect(await places('/users/a', '/users/a/wf', '/Users/a', { '/users/a': '/Users/a', '/users/a/wf': '/Users/a/wf' })).toEqual(['/users/a/wf'])
    expect(await places('/tmp/up', '/wf', '/Users/a', { '/tmp/up': '/' })).toEqual(['/wf'])
    // The written path and the real path of a place are both judged, and so are those of the home folder.
    expect(await places('/Users', '/wf', '/Users/a', { '/Users': '/elsewhere' })).toEqual(['/wf'])
    expect(await places('/srv/up', '/wf', '/home/a', { '/home/a': '/srv/up/a' })).toEqual(['/wf'])
    expect(await places('/home', '/wf', '/home/a', { '/home/a': '/srv/up/a' })).toEqual(['/wf'])
    // review of PR #826: realpath keeps a macOS firmlink (`/System/Volumes/Data/Users` is `/Users`)
    // and `/.nofollow/Users` as they are; the device and inode say what they are.
    const firmlinks = { '/System/Volumes/Data/Users': { dev: 1, ino: 7 }, '/Users': { dev: 1, ino: 7 }, '/System/Volumes/Data/Users/a': { dev: 1, ino: 8 }, '/Users/a': { dev: 1, ino: 8 }, '/.nofollow/Users/a': { dev: 1, ino: 8 } }
    expect(await places('/System/Volumes/Data/Users', '/System/Volumes/Data/Users/a', '/Users/a', {}, firmlinks)).toEqual([])
    expect(await places('/System/Volumes/Data', '/.nofollow', '/Users/a', {}, firmlinks)).toEqual([])
    // A place inside the home folder stays, under any name.
    expect(await places('/System/Volumes/Data/Users/a/wf', '/Users/a/wf', '/Users/a', {}, firmlinks)).toEqual(['/Users/a/wf', '/System/Volumes/Data/Users/a/wf'])
    // A place whose stat fails, or whose folder on the way down to the home folder cannot be read, is left out.
    expect(await places('/wf', '/denied', '/Users/a', {}, { '/denied': failure('EACCES') })).toEqual(['/wf'])
    expect(await places('/wf', '/gone-now', '/Users/a', {}, { '/gone-now': failure('ENOENT') })).toEqual(['/wf'])
    expect(await places('/wf', '/odd', '/Users/a', {}, { '/odd/Users/a': failure('EACCES') })).toEqual(['/wf'])
    // A folder above the home folder that cannot be read: nothing is known to be safe.
    expect(await places('/wf', '/wf/.scratch', '/Users/a', {}, { '/Users': failure('EACCES') })).toEqual([])
    // A home folder that is not there holds no file: the places stay.
    expect(await places('/wf', '/wf/.scratch', '/nobody/a', {}, { '/nobody/a': failure('ENOENT'), '/nobody': failure('ENOENT') })).toEqual(['/wf/.scratch', '/wf'])
    // The home folder that is a symlink itself: the place is compared with where it leads.
    expect(await places('/data/a', '/data/a/wf', '/home/a', { '/home/a': '/data/a' })).toEqual(['/data/a/wf'])
    // A place that does not exist holds no file.
    expect(await places('/gone', '/wf', '/Users/a', { '/gone': null })).toEqual(['/wf'])
    // On Windows the root of a drive and of a share, and the home folder in any letter case.
    const windows = (workflowFolder: string, ticketsRoot: string) => workflowPlaces(layout(workflowFolder, ticketsRoot), { paths: win32, home: 'C:\\Users\\a', real: real(), stat: looks() })
    expect(await windows('D:\\', '\\\\host\\share\\')).toEqual([])
    expect(await windows('c:\\users\\A', 'D:\\wf\\.scratch')).toEqual(['D:\\wf\\.scratch'])
    expect(await windows('C:\\Users', '\\\\host\\share\\wf')).toEqual(['\\\\host\\share\\wf'])
    // The path as written is judged too: `D:\wf\..` is the root of the drive.
    expect(await windows('D:\\wf\\..', 'D:\\wf')).toEqual(['D:\\wf'])
  })

  // review of PR #826: on macOS `/System/Volumes/Data/Users` and `/.nofollow/Users` are the folder
  // above the home folder under other names, which realpath keeps.
  const home = realpathSync.native(homedir())
  it.runIf(process.platform === 'darwin' && existsSync(join('/System/Volumes/Data', dirname(home))))('takes on macOS no firmlink or /.nofollow name of the folder above the home folder', async () => {
    const { workflowPlaces } = await import('../../src/main/ipc/shell')
    const data = join('/System/Volumes/Data', dirname(home))
    const nofollow = join('/.nofollow', dirname(home))
    const layout: ProjectLayout = { root: repo, mode: 'silent', workflowFolder: data, ticketsRoot: existsSync(nofollow) ? nofollow : data, repos: [], workspace: null, reason: null, failed: false }
    expect(await workflowPlaces(layout)).toEqual([])
    expect(await workflowPlaces({ ...layout, workflowFolder: '/System/Volumes/Data', ticketsRoot: join('/System/Volumes/Data', home) })).toEqual([])
  })

  // review of PR #826: a Workflow folder that is a symlink to the home folder, a folder above it, or
  // the home folder in another letter case opened `~/.ssh/id`.
  it('opens no file of the home folder through a Workflow folder that leads to it', async () => {
    const home = join(scratch, 'people', 'a')
    mkdirSync(join(home, '.ssh'), { recursive: true })
    writeFileSync(join(home, '.ssh', 'id'), 'key\n')
    vi.stubEnv('HOME', home)
    vi.stubEnv('USERPROFILE', home)
    try {
      const link = join(scratch, 'link-home')
      symlinkSync(home, link, 'junction')
      const upper = join(scratch, 'people', 'A')
      const ways: Array<[string, string]> = [
        [link, join(link, '.ssh', 'id')],
        [join(scratch, 'people'), join(home, '.ssh', 'id')],
        [home, join(home, '.ssh', 'id')],
        // Only on a disk that ignores the letter case, as macOS and Windows have by default.
        ...(existsSync(upper) ? [[upper, join(upper, '.ssh', 'id')] as [string, string]] : []),
      ]
      for (const [workflowFolder, path] of ways) {
        layouts.byRoot.set(repo, { root: repo, mode: 'silent', workflowFolder, ticketsRoot, repos: [], workspace: null, reason: null, failed: false })
        await refused('shell.openInEditor', { projectId: PROJECT_ID, path }, /outside the Project/)
      }
      expect(electron.openPath).not.toHaveBeenCalled()
      // The Tickets root of the same layout still opens.
      const ticket = join(ticketsRoot, 'e', 'issues', '02-b.md')
      expect(await call('shell.openInEditor', { projectId: PROJECT_ID, path: ticket })).toStrictEqual({ ok: true, value: { path: ticket, outcome: 'opened' } })
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('opens nothing from the Workflow folder when where the workflow lives is unknown: a failed layout, or one that could not be asked', async () => {
    const spec = join(workflow, '.scratch', 'e', 'spec.md')
    layouts.byRoot.set(repo, { root: repo, mode: 'full', workflowFolder: workflow, ticketsRoot, repos: [], workspace: null, reason: 'the profile script failed', failed: true })
    await refused('shell.openInEditor', { projectId: PROJECT_ID, path: spec }, /outside the Project/)
    layouts.byRoot.set(repo, new Error('the scripts environment could not be read'))
    await refused('shell.openInEditor', { projectId: PROJECT_ID, path: spec }, /outside the Project/)
    // The Project's own files still open.
    expect(await call('shell.openInEditor', { projectId: PROJECT_ID, path: join(repo, 'README.md') })).toStrictEqual({ ok: true, value: { path: join(repo, 'README.md'), outcome: 'opened' } })
  })
})

/** Runs `step` with process.platform as asked; the real value is back when it ends, failed or not. */
async function asPlatform<T>(platform: NodeJS.Platform, step: () => Promise<T>): Promise<T> {
  const real = Object.getOwnPropertyDescriptor(process, 'platform')!
  Object.defineProperty(process, 'platform', { ...real, value: platform })
  try {
    return await step()
  } finally {
    Object.defineProperty(process, 'platform', real)
  }
}

/** A file of the Project at `relative`, with `mode` when given; its real path. */
function projectFile(relative: string, mode?: number): string {
  const file = join(repo, relative)
  mkdirSync(join(file, '..'), { recursive: true })
  writeFileSync(file, '#!/bin/sh\necho launched\n')
  if (mode !== undefined) chmodSync(file, mode)
  // Windows drops a trailing dot or space of a name: the file is what the file system made.
  return realpathSync(file)
}

// worfy-polish ticket 35: a link in a Ticket or a document of the Project is written by agents,
// other people's PRs and cloned repositories. shell.openPath does what a double click does, which
// for a program is running it. A regular file with a document extension opens at once; for anything
// else main asks in a box on the window that called (owner's decision on PR #692, the third option):
// "Open" opens it, "Show in Finder" shows it, "Cancel" — the default — does nothing.
describe('shell.openInEditor opens documents and asks about anything else', () => {
  const CANCEL = 0
  const SHOW = 1
  const OPEN = 2
  const opened = () => electron.openPath.mock.calls.map(([path]) => path)
  const shown = () => electron.showItemInFolder.mock.calls.map(([path]) => path)
  const boxes = () => electron.showMessageBox.mock.calls
  const answer = (response: number) => electron.showMessageBox.mockResolvedValue({ response })
  const outcome = (result: IpcResult<unknown>) => (result.ok ? (result.value as { outcome?: string }).outcome : `refused: ${result.error}`)
  const open = (path: string) => call('shell.openInEditor', { projectId: PROJECT_ID, path })

  // Kinds the system runs, follows or installs on a double click. Not the rule (main lists
  // documents, not this), but what must never open unasked: each one is a file named x<kind>.
  const LAUNCHERS: Record<'darwin' | 'win32' | 'linux', readonly string[]> = {
    darwin: [
      // `.term`: a Terminal session file whose ExecutionString runs on open (round 1 of PR #692).
      ...['.term', '.command', '.terminal', '.tool', '.workflow', '.action', '.scpt', '.scptd', '.applescript', '.pkg', '.mpkg'],
      ...['.sh', '.bash', '.zsh', '.csh', '.tcsh', '.ksh', '.fish', '.py', '.pyw', '.jar', '.class', '.jnlp'],
      ...['.webloc', '.inetloc', '.fileloc', '.afploc', '.ftploc', '.vncloc', '.url'],
      ...['.dmg', '.iso', '.img', '.cdr', '.sparseimage', '.mobileconfig', '.configprofile', '.prefpane', '.saver', '.kext', '.osax', '.shortcut'],
      ...['.html', '.htm', '.svg', '.xml', '.csv'],
    ],
    win32: [
      ...['.com', '.exe', '.bat', '.cmd', '.vbs', '.vbe', '.js', '.jse', '.wsf', '.wsh', '.msc', '.mjs', '.cjs'],
      ...['.lnk', '.url', '.pif', '.scf', '.ps1', '.psm1', '.msi', '.msp', '.mst', '.scr', '.cpl', '.hta', '.reg', '.inf', '.jar'],
      ...['.application', '.appref-ms', '.appx', '.appxbundle', '.msix', '.msixbundle', '.appinstaller', '.settingcontent-ms'],
      ...['.library-ms', '.search-ms', '.searchconnector-ms', '.diagcab', '.chm', '.gadget', '.iso', '.img', '.vhd', '.vhdx'],
      ...['.sh', '.py', '.pyw', '.rdp', '.wsb', '.theme', '.themepack', '.deskthemepack', '.website', '.sct', '.wsc'],
      ...['.html', '.htm', '.svg', '.xml', '.csv'],
    ],
    linux: ['.sh', '.bash', '.zsh', '.csh', '.ksh', '.fish', '.py', '.jar', '.desktop', '.appimage', '.run', '.deb', '.rpm', '.flatpakref', '.snap', '.html', '.svg'],
  }
  const SHOW_LABEL = { darwin: 'Show in Finder', win32: 'Show in Explorer', linux: 'Show in folder' } as const
  const REVEALED_IN = { darwin: 'darwin', win32: 'win32', linux: 'other' } as const

  it('asks about a .term file on the window that called, with Cancel the default and the answer to Escape', async () => {
    const file = projectFile('scripts/session.term')
    const result = await asPlatform('darwin', () => open('scripts/session.term'))
    expect(result).toStrictEqual({ ok: true, value: { path: file, outcome: 'cancelled' } })
    expect(boxes()).toHaveLength(1)
    const [owner, options] = boxes()[0]!
    expect(owner).toBe(electron.owner)
    expect(options).toMatchObject({
      type: 'warning',
      title: 'Open session.term?',
      message: 'Open session.term?',
      detail: 'This file may run a program. worfy opens documents directly; this one is not a document.',
      buttons: ['Cancel', 'Show in Finder', 'Open'],
      noLink: true,
    })
    // Return and Escape both press Cancel: "Open" is never the default.
    expect(options.buttons![options.defaultId!]).toBe('Cancel')
    expect(options.buttons![options.cancelId!]).toBe('Cancel')
    expect(opened()).toStrictEqual([])
    expect(shown()).toStrictEqual([])
  })

  it('"Show in Finder" shows the file, "Open" opens it, "Cancel" leaves it', async () => {
    const file = projectFile('scripts/setup.command')
    await asPlatform('darwin', async () => {
      answer(SHOW)
      expect(await open(file)).toStrictEqual({ ok: true, value: { path: file, outcome: 'revealed', revealedIn: 'darwin' } })
      expect(shown()).toStrictEqual([file])
      expect(opened()).toStrictEqual([])
      answer(OPEN)
      expect(await open(file)).toStrictEqual({ ok: true, value: { path: file, outcome: 'opened' } })
      expect(opened()).toStrictEqual([file])
      answer(CANCEL)
      expect(await open(file)).toStrictEqual({ ok: true, value: { path: file, outcome: 'cancelled' } })
    })
    expect(shown()).toStrictEqual([file])
    expect(opened()).toStrictEqual([file])
    expect(boxes()).toHaveLength(3)
  })

  it('without a window to put it on, asks in a box of its own', async () => {
    const owner = electron.owner
    electron.owner = null as unknown as typeof owner
    try {
      projectFile('scripts/session.term')
      await asPlatform('darwin', () => open('scripts/session.term'))
      expect(boxes()).toHaveLength(1)
      // showMessageBox(options): the options come first.
      expect((boxes()[0]![0] as Electron.MessageBoxOptions).message).toBe('Open session.term?')
    } finally {
      electron.owner = owner
    }
  })

  it('reports a box that fails as a refusal and opens nothing', async () => {
    projectFile('scripts/session.term')
    electron.showMessageBox.mockRejectedValue(new Error('no screen'))
    await asPlatform('darwin', () => refused('shell.openInEditor', { projectId: PROJECT_ID, path: 'scripts/session.term' }, /no screen/))
    expect(opened()).toStrictEqual([])
    expect(shown()).toStrictEqual([])
  })

  it.each(['darwin', 'win32', 'linux'] as const)('on %s asks about every known launcher kind, in either letter case', async (platform) => {
    const files = LAUNCHERS[platform].flatMap((kind) => [projectFile(`kinds/x${kind}`), projectFile(`kinds/Y${kind.toUpperCase()}`)])
    await asPlatform(platform, async () => {
      for (const path of files) expect(outcome(await open(path)), path).toBe('cancelled')
      answer(SHOW)
      expect(await open(files[0]!)).toStrictEqual({ ok: true, value: { path: files[0], outcome: 'revealed', revealedIn: REVEALED_IN[platform] } })
    })
    expect(boxes()).toHaveLength(files.length + 1)
    expect(boxes().every(([, options]) => options.buttons![1] === SHOW_LABEL[platform])).toBe(true)
    expect(opened()).toStrictEqual([])
    expect(shown()).toStrictEqual([files[0]])
  })

  it('asks about a file of an unknown kind and one without an extension, whatever its bits', async () => {
    // Windows drops a trailing dot or space of `trail.md.` and `space.md ` when it makes the file, so
    // those two are POSIX only; main sees what the file system made.
    const names = ['bin/run', 'bin/tool.xyz', 'bin/notes.md.bak', ...(process.platform === 'win32' ? [] : ['bin/trail.md.', 'bin/space.md '])]
    const files = names.map((name) => projectFile(name, 0o644))
    for (const platform of ['darwin', 'win32', 'linux'] as const) {
      await asPlatform(platform, async () => {
        for (const path of files) expect(outcome(await open(path)), `${platform} ${path}`).toBe('cancelled')
      })
    }
    expect(boxes()).toHaveLength(files.length * 3)
    expect(opened()).toStrictEqual([])
  })

  it('asks about folders: bundles, a trailing slash, and a folder named like a document', async () => {
    mkdirSync(join(repo, 'Tool.app', 'Contents', 'MacOS'), { recursive: true })
    mkdirSync(join(repo, 'Thing.plugin'))
    mkdirSync(join(repo, 'Guide.md'))
    const paths = ['Tool.app', 'Tool.app/', './Tool.app', 'Thing.plugin', 'Guide.md/']
    for (const platform of ['darwin', 'win32', 'linux'] as const) {
      await asPlatform(platform, async () => {
        for (const path of paths) expect(outcome(await open(path)), `${platform} ${path}`).toBe('cancelled')
      })
    }
    expect(boxes()).toHaveLength(paths.length * 3)
    expect(boxes().map(([, options]) => options.message)).toContain('Open Guide.md?')
    expect(opened()).toStrictEqual([])
  })

  it('asks about what a symlink with a document name points at, by its real name', async () => {
    const program = projectFile('scripts/session.term')
    symlinkSync(program, join(repo, 'readme-setup.md'))
    const result = await asPlatform('darwin', () => open('readme-setup.md'))
    expect(result).toStrictEqual({ ok: true, value: { path: program, outcome: 'cancelled' } })
    expect(boxes()[0]![1].message).toBe('Open session.term?')
  })

  // A colon is a stream of a file on Windows (`evil.exe:x.md`); a POSIX file system takes it in a name.
  it.skipIf(process.platform === 'win32')('on Windows asks about a name with a colon even when it ends in a document kind', async () => {
    const file = projectFile('win/evil.exe:x.md')
    const stream = projectFile('win/a.txt:b.exe')
    await asPlatform('win32', async () => {
      expect(outcome(await open(file))).toBe('cancelled')
      expect(outcome(await open(stream))).toBe('cancelled')
    })
    expect(await asPlatform('darwin', () => open(file))).toStrictEqual({ ok: true, value: { path: file, outcome: 'opened' } })
    expect(boxes()).toHaveLength(2)
    expect(opened()).toStrictEqual([file])
  })

  it('opens documents at once, without a box, on every platform, in either letter case and with the execute bit', async () => {
    const files = ['docs/a.md', 'src/b.ts', 'img/c.png', 'docs/D.PDF', 'cfg/e.yaml', 'Notes.MD'].map((name) => projectFile(name, 0o755))
    for (const platform of ['darwin', 'win32', 'linux'] as const) {
      await asPlatform(platform, async () => {
        for (const path of files) expect(await open(path)).toStrictEqual({ ok: true, value: { path, outcome: 'opened' } })
      })
    }
    expect(boxes()).toStrictEqual([])
    expect(opened()).toStrictEqual([...files, ...files, ...files])
    expect(shown()).toStrictEqual([])
  })

  it('opens JavaScript sources at once on macOS and Linux, and asks on Windows, where Script Host runs .js', async () => {
    const files = ['scripts/a.js', 'scripts/b.mjs', 'scripts/c.cjs'].map((name) => projectFile(name))
    for (const platform of ['darwin', 'linux'] as const) {
      await asPlatform(platform, async () => {
        for (const path of files) expect(await open(path)).toStrictEqual({ ok: true, value: { path, outcome: 'opened' } })
      })
    }
    expect(boxes()).toStrictEqual([])
    await asPlatform('win32', async () => {
      for (const path of files) expect(outcome(await open(path))).toBe('cancelled')
    })
    expect(boxes()).toHaveLength(3)
    expect(opened()).toStrictEqual([...files, ...files])
  })

  // On a Mac with Adobe software `.jsx` is ExtendScript, which its application runs on open.
  it('asks about a .jsx file on every platform', async () => {
    const file = projectFile('scripts/panel.jsx')
    for (const platform of ['darwin', 'linux', 'win32'] as const) expect(outcome(await asPlatform(platform, () => open(file))), platform).toBe('cancelled')
    expect(boxes()).toHaveLength(3)
    expect(opened()).toStrictEqual([])
  })

  // worfy-polish ticket 36: U+202E (right-to-left override) makes `setup<U+202E>dm.command` read as a
  // name ending in `.md`. The question shows the name without the bidirectional controls.
  it('shows the name of the file it asks about with a mark for each bidirectional control, so it cannot pass for a document', async () => {
    const names = ['setup\u202Edm.command', 'a\u2066b\u2069\u202A\u202B\u202C\u202D.term', 'x\u200E\u200F\u061C.sh', 'plain\u2067\u2068.sh']
    const files = names.map((name) => projectFile(`bidi/${name}`))
    await asPlatform('darwin', async () => {
      for (const file of files) expect(outcome(await open(file))).toBe('cancelled')
    })
    expect(boxes().map(([, options]) => [options.title, options.message])).toStrictEqual(
      ['setup\uFFFDdm.command', 'a\uFFFDb\uFFFD\uFFFD\uFFFD\uFFFD\uFFFD.term', 'x\uFFFD\uFFFD\uFFFD.sh', 'plain\uFFFD\uFFFD.sh'].map((name) => [`Open ${name}?`, `Open ${name}?`]),
    )
    expect(opened()).toStrictEqual([])
  })

  // Line breaks would push the real extension out of the box: `invoice.md` and, three lines down, `.command`.
  it.skipIf(process.platform === 'win32')('shows a mark in place of each line break of the name', async () => {
    const file = projectFile('lines/invoice.md\n\n\n.command')
    await asPlatform('darwin', async () => expect(outcome(await open(file))).toBe('cancelled'))
    expect(boxes().map(([, options]) => options.message)).toStrictEqual(['Open invoice.md\uFFFD\uFFFD\uFFFD.command?'])
  })

  it('shows U+FFFD in a name for every control character, the line and paragraph separators, the bidirectional controls and the direction marks', async () => {
    const { shownName } = await import('../../src/main/ipc/shell')
    const hiding = [...Array.from({ length: 0x20 }, (_, code) => code), 0x7f, ...Array.from({ length: 0x20 }, (_, code) => 0x80 + code), 0x2028, 0x2029, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069, 0x200e, 0x200f, 0x061c]
    for (const code of hiding) expect(shownName(`a${String.fromCharCode(code)}.command`), code.toString(16)).toBe('a\uFFFD.command')
    // review of PR #826: a bell at the end must not leave `notes.md`, nor a name of controls alone an empty one.
    expect(shownName('notes.md\u0007')).toBe('notes.md\uFFFD')
    expect(shownName('\u0007\u202E')).toBe('\uFFFD\uFFFD')
    // Letters of any script and plain spaces stay.
    expect(shownName('Отчёт 2026 · résumé.md')).toBe('Отчёт 2026 · résumé.md')
  })

  // worfy-polish ticket 36: macOS opens what a Finder alias points at — the alias `x.md` of a
  // `.command` opens in Terminal — so on macOS an alias is asked about, whatever its name.
  it('asks on macOS about a Finder alias named like a document, and opens such a file at once elsewhere', async () => {
    const alias = join(repo, 'docs', 'alias.md')
    mkdirSync(join(repo, 'docs'), { recursive: true })
    // Bookmark data as Finder writes it: the magic, then the record.
    writeFileSync(alias, Buffer.concat([Buffer.from('book\0\0\0\0mark\0\0\0\0', 'latin1'), Buffer.alloc(64, 7)]))
    // A document that only mentions the word is one.
    const notes = projectFile('docs/book.md')
    writeFileSync(notes, 'book mark\n')
    const empty = projectFile('docs/empty.md')
    writeFileSync(empty, '')
    const real = realpathSync(alias)
    await asPlatform('darwin', async () => {
      expect(outcome(await open(real))).toBe('cancelled')
      expect(outcome(await open(notes))).toBe('opened')
      expect(outcome(await open(empty))).toBe('opened')
    })
    for (const platform of ['win32', 'linux'] as const) expect(outcome(await asPlatform(platform, () => open(real)))).toBe('opened')
    expect(boxes().map(([, options]) => options.message)).toStrictEqual(['Open alias.md?'])
    expect(opened()).toStrictEqual([notes, empty, real, real])
  })
})

describe('shell.openExternal', () => {
  it('opens an https:// address and nothing else from the input', async () => {
    const result = await call('shell.openExternal', { url: 'https://github.com/IDSAD-XL/worfy/pull/12', target: 'evil' })
    expect(result).toStrictEqual({ ok: true, value: { url: 'https://github.com/IDSAD-XL/worfy/pull/12' } })
    expect(electron.openExternal.mock.calls).toStrictEqual([['https://github.com/IDSAD-XL/worfy/pull/12']])
  })

  it('refuses every other scheme, a non-address and a wrong type', async () => {
    for (const url of ['http://github.com', 'file:///etc/passwd', 'javascript:alert(1)', 'ssh://host', 'HTTPS//no-colon']) {
      await refused('shell.openExternal', { url }, /only https|not an address/)
    }
    await refused('shell.openExternal', { url: 1 }, /invalid input/)
    await refused('shell.openExternal', {}, /invalid input/)
    expect(electron.openExternal).not.toHaveBeenCalled()
  })
})

// The access marks (worfy-link ticket 12; ADR-0053, Q14): a link opens on the Machine where it was
// clicked, so `shell.openExternal` is `local` — a window on Linked machine M calls its own main,
// and M never opens an address for a Linked machine. A file of a Project opens only on the
// Project's Machine and never for a Linked machine (`desktop`): a window on M shows the hint
// "File is on <M>" instead (owner's decision pending, option (c) of the ticket).
describe('the access marks of the shell channels', () => {
  it('shell.openExternal is local, shell.openInEditor is desktop', async () => {
    const { shellOpenExternal, shellOpenInEditor } = await import('../../src/shared/ipc/shell')
    expect(shellOpenExternal.access).toBe('local')
    expect(shellOpenInEditor.access).toBe('desktop')
  })
})
