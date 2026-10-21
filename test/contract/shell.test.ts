// The `shell` channels in main: src/main/ipc/shell.ts registered through registerIpc (the same
// wrapper the app uses) over a mocked `electron`, against a real git repository with a linked
// worktree in a temporary folder. Nothing reaches macOS: shell.openPath, shell.showItemInFolder and
// shell.openExternal are recorders.
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
}))

vi.mock('electron', () => ({
  shell: { openPath: electron.openPath, openExternal: electron.openExternal, showItemInFolder: electron.showItemInFolder },
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
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-shell-')))
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
    expect(result).toStrictEqual({ ok: true, value: { path: file } })
    // Exactly one argument: an extra input key never reaches macOS.
    expect(electron.openPath.mock.calls).toStrictEqual([[file]])
  })

  it('resolves a relative path against the Project root and a symlink to its real target inside', async () => {
    expect(await call('shell.openInEditor', { projectId: PROJECT_ID, path: '.scratch/e/issues/01-a.md' })).toStrictEqual({
      ok: true,
      value: { path: join(repo, '.scratch', 'e', 'issues', '01-a.md') },
    })
    expect(await call('shell.openInEditor', { projectId: PROJECT_ID, path: join(repo, 'link-in.md') })).toStrictEqual({
      ok: true,
      value: { path: join(repo, 'README.md') },
    })
    expect(electron.openPath.mock.calls).toStrictEqual([[join(repo, '.scratch', 'e', 'issues', '01-a.md')], [join(repo, 'README.md')]])
  })

  it('opens a file in a folder whose name starts with two dots', async () => {
    mkdirSync(join(repo, '..drafts'))
    const file = join(repo, '..drafts', 'x.md')
    writeFileSync(file, 'x')
    expect(await call('shell.openInEditor', { projectId: PROJECT_ID, path: file })).toStrictEqual({ ok: true, value: { path: file } })
    expect(await call('shell.openInEditor', { projectId: PROJECT_ID, path: '..drafts/x.md' })).toStrictEqual({ ok: true, value: { path: file } })
  })

  it('opens a file of a linked worktree that lies outside the repository folder', async () => {
    const file = join(worktree, 'README.md')
    expect(await call('shell.openInEditor', { projectId: PROJECT_ID, path: file })).toStrictEqual({ ok: true, value: { path: file } })
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
// for a program is running it; such a file is shown in Finder or Explorer instead.
describe('shell.openInEditor never runs a program', () => {
  const REVEALED = /^(Finder|Explorer|the file manager)$/
  const opened = () => electron.openPath.mock.calls.map(([path]) => path)
  const shown = () => electron.showItemInFolder.mock.calls.map(([path]) => path)

  it('shows a .command file in Finder and does not open it', async () => {
    const file = projectFile('scripts/setup.command')
    const result = await asPlatform('darwin', () => call('shell.openInEditor', { projectId: PROJECT_ID, path: 'scripts/setup.command' }))
    expect(result).toStrictEqual({ ok: true, value: { path: file, revealedIn: 'Finder' } })
    expect(opened()).toStrictEqual([])
    expect(shown()).toStrictEqual([file])
  })

  it('shows every macOS launcher kind, in any letter case, and a folder bundle with a trailing slash', async () => {
    const bundle = join(repo, 'Tool.app')
    mkdirSync(join(bundle, 'Contents', 'MacOS'), { recursive: true })
    const files = ['a.terminal', 'b.tool', 'c.pkg', 'd.sh', 'e.scpt', 'f.webloc', 'RUN.COMMAND', 'Mixed.Command'].map((name) => projectFile(`bin/${name}`))
    const workflow = join(repo, 'Do.workflow')
    mkdirSync(workflow)
    // A bundle of a kind no list names (a plug-in, a framework) is still a folder: shown, never opened.
    const plugin = join(repo, 'Thing.plugin')
    mkdirSync(join(plugin, 'Contents'), { recursive: true })
    // A folder named like a document is a folder too: its name does not make it one to open.
    const named = join(repo, 'Guide.md')
    mkdirSync(named)
    await asPlatform('darwin', async () => {
      for (const path of ['Tool.app', 'Tool.app/', './Tool.app', 'Do.workflow/', 'Thing.plugin', 'Guide.md/', ...files]) {
        const result = await call('shell.openInEditor', { projectId: PROJECT_ID, path })
        expect(result.ok && (result.value as { revealedIn?: string }).revealedIn, path).toBe('Finder')
      }
    })
    expect(opened()).toStrictEqual([])
    expect(shown()).toStrictEqual([bundle, bundle, bundle, workflow, plugin, named, ...files])
  })

  it('shows the program a symlink with a document name points at, not the link', async () => {
    const program = projectFile('scripts/setup.command')
    symlinkSync(program, join(repo, 'readme-setup.md'))
    const result = await asPlatform('darwin', () => call('shell.openInEditor', { projectId: PROJECT_ID, path: 'readme-setup.md' }))
    expect(result).toStrictEqual({ ok: true, value: { path: program, revealedIn: 'Finder' } })
    expect(opened()).toStrictEqual([])
  })

  // chmod sets no execute bit on Windows, so these run where a POSIX file system is.
  it.skipIf(process.platform === 'win32')('shows a file with the execute bit and no text extension; a text file with it still opens', async () => {
    const plain = projectFile('bin/run', 0o755)
    const unknown = projectFile('bin/tool.xyz', 0o744)
    const notes = projectFile('notes.md', 0o755)
    const source = projectFile('scripts/check.mjs', 0o755)
    for (const platform of ['darwin', 'linux'] as const) {
      await asPlatform(platform, async () => {
        for (const path of [plain, unknown]) {
          const result = await call('shell.openInEditor', { projectId: PROJECT_ID, path })
          expect(result.ok && (result.value as { revealedIn?: string }).revealedIn, `${platform} ${path}`).toMatch(REVEALED)
        }
        expect(await call('shell.openInEditor', { projectId: PROJECT_ID, path: notes })).toStrictEqual({ ok: true, value: { path: notes } })
        expect(await call('shell.openInEditor', { projectId: PROJECT_ID, path: source })).toStrictEqual({ ok: true, value: { path: source } })
      })
    }
    expect(opened()).toStrictEqual([notes, source, notes, source])
    expect(shown()).toStrictEqual([plain, unknown, plain, unknown])
  })

  it('on Windows shows .cmd and the other launcher kinds in Explorer', async () => {
    const names = ['setup.cmd', 'a.exe', 'b.bat', 'c.ps1', 'd.lnk', 'e.url', 'f.scr', 'g.msi', 'h.js', 'i.vbs', 'j.hta', 'K.EXE', 'l.exe.', 'm.bat ']
    const files = names.map((name) => projectFile(`win/${name}`))
    // A folder opens in Explorer; any folder is shown selected instead, whatever its name.
    const folder = join(repo, 'Setup.txt')
    mkdirSync(folder)
    files.push(folder)
    await asPlatform('win32', async () => {
      for (const path of files) {
        const result = await call('shell.openInEditor', { projectId: PROJECT_ID, path })
        expect(result.ok && (result.value as { revealedIn?: string }).revealedIn, path).toBe('Explorer')
      }
    })
    expect(opened()).toStrictEqual([])
    expect(shown()).toStrictEqual(files)
  })

  it('opens .md, .ts and .png as before, on every platform', async () => {
    const files = ['docs/a.md', 'src/b.ts', 'img/c.png'].map((name) => projectFile(name, 0o644))
    for (const platform of ['darwin', 'win32', 'linux'] as const) {
      await asPlatform(platform, async () => {
        for (const path of files) expect(await call('shell.openInEditor', { projectId: PROJECT_ID, path })).toStrictEqual({ ok: true, value: { path } })
      })
    }
    expect(opened()).toStrictEqual([...files, ...files, ...files])
    expect(shown()).toStrictEqual([])
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
