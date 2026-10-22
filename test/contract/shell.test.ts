// The `shell` channels in main: src/main/ipc/shell.ts registered through registerIpc (the same
// wrapper the app uses) over a mocked `electron`, against a real git repository with a linked
// worktree in a temporary folder. Nothing reaches macOS: shell.openPath, shell.showItemInFolder,
// shell.openExternal and dialog.showMessageBox are recorders; the box answers what a test sets.
import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IpcMainInvokeEvent } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
