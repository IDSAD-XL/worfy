// The workflow the Canvas MCP tools of a Session check against (src/main/mcp/canvas-server.ts, canvasWorkflow: the
// targets of link_card and of the Browser tools) is read like the window's list: from the Project's main branch, with
// the local-green exception (ADR-0107; follow-up of worfy-polish ticket 118). Before, it read the working tree of the
// folder. Real git repositories in a temporary folder — a bare `origin`, a clone that pushes, the Project folder — and
// the real harness/bin/epic-status of this repository. No fetch: the folder's `git fetch` goes to the bare repository.
import { execFile, execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { canvasWorkflow, type CanvasWorkflow } from '../../src/main/mcp/canvas-server'
import { fullLayout, type ProjectLayout } from '../../src/main/workflow/folder'
import type { EpicStatusRunner } from '../../src/main/workflow/reader'
import { NODE } from '../harness-node'
import { removeTestTree } from '../remove'

vi.mock('electron', () => ({
  app: { on: () => undefined, isPackaged: false, getAppPath: () => '/nowhere', getPath: () => '/nowhere' },
  BrowserWindow: { getAllWindows: () => [] },
  dialog: {},
  shell: {},
  ipcMain: { handle: () => undefined, on: () => undefined },
}))

const EPIC_STATUS = join(import.meta.dirname, '..', '..', 'harness', 'bin', 'epic-status')

let dir: string
let home: string
let env: NodeJS.ProcessEnv

beforeEach(() => {
  dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-canvas-workflow-')))
  home = join(dir, 'home')
  mkdirSync(home)
  const clean = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.toUpperCase().startsWith('GIT_') && name !== 'HARNESS_HOME'))
  env = {
    ...clean,
    HOME: home,
    USERPROFILE: home,
    HARNESS_HOME: join(dir, 'harness-home'),
    // epic-status --ref asks the Profile for Silent mode; there is none here.
    CLAUDE_PROFILE_BIN: join(dir, 'no-profile'),
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: join(dir, 'gitconfig'),
  }
  writeFileSync(join(dir, 'gitconfig'), '[user]\n\tname = t\n\temail = t@t\n[maintenance]\n\tauto = false\n[gc]\n\tauto = 0\n')
})

afterEach(() => removeTestTree(dir))

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env }).trim()
}

function write(root: string, rel: string, text: string): void {
  mkdirSync(dirname(join(root, rel)), { recursive: true })
  writeFileSync(join(root, rel), text)
}

function ticket(num: number, status: string, title: string): string {
  const nn = String(num).padStart(2, '0')
  return [`# ${nn} — ${title}`, '', 'Type: task', `Status: ${status}`, 'Blocked by: —', '', '## Что делаем', '', 'text', '', '## Где в коде', '', '- `src/x.ts`', ''].join('\n')
}

/** The real epic-status of this repository over `<cwd>/.scratch`. */
const runner: EpicStatusRunner = (cwd, ref) =>
  new Promise((resolvePromise, reject) => {
    execFile(NODE, [EPIC_STATUS, '--json', ...(ref === null ? [] : ['--ref', ref]), '--root', join(cwd, '.scratch')], { cwd, env, encoding: 'utf8' }, (error, stdout, stderr) =>
      error ? reject(new Error(`${error.message}\n${stderr}`)) : resolvePromise(stdout),
    )
  })

const layoutOf = (root: string, finish: ProjectLayout['finish']): ProjectLayout => ({ ...fullLayout(root), finish })

const read = (root: string, layout: ProjectLayout): Promise<CanvasWorkflow> => canvasWorkflow({ root, claudeHome: home, env: () => Promise.resolve(env), layout }, runner)

const stateOf = (model: CanvasWorkflow, epic: string, num: number) => model.tickets.find((each) => each.epic === epic && each.num === num)?.state

/** A repository `name` with Epic `old`, Tickets 01 and 02 open, committed on `main`. */
function seedRepo(name: string): string {
  const root = join(dir, name)
  git(dir, 'init', '-q', '-b', 'main', root)
  write(root, '.scratch/old/spec.md', '# Old epic\n')
  write(root, '.scratch/old/issues/01-first.md', ticket(1, 'open', 'First'))
  write(root, '.scratch/old/issues/02-second.md', ticket(2, 'open', 'Second'))
  git(root, 'add', '-A')
  git(root, 'commit', '-qm', 'first')
  return root
}

describe('the Canvas MCP workflow snapshot is read from the main branch', () => {
  it('pr-green-ci: a status changed only in the detached folder does not show; one merged into origin/main does', async () => {
    const seed = seedRepo('seed')
    const origin = join(dir, 'origin.git')
    git(dir, 'init', '-q', '--bare', '-b', 'main', origin)
    git(seed, 'remote', 'add', 'origin', origin)
    git(seed, 'push', '-q', 'origin', 'main')
    const project = join(dir, 'project')
    git(dir, 'clone', '-q', origin, project)
    // main moves on: Ticket 02 is done there, and the folder has fetched it but stays behind, detached.
    write(seed, '.scratch/old/issues/02-second.md', ticket(2, 'done 2026-11-16', 'Second'))
    git(seed, 'commit', '-qam', 'done 02')
    git(seed, 'push', '-q', 'origin', 'main')
    git(project, 'fetch', '-q', 'origin')
    git(project, 'checkout', '-q', '--detach', 'HEAD')
    // Not committed, only in the folder.
    write(project, '.scratch/old/issues/01-first.md', ticket(1, 'done 2026-11-16', 'First'))

    const model = await read(project, layoutOf(project, 'pr-green-ci'))

    expect(model.error).toBeNull()
    expect(stateOf(model, 'old', 1)).toBe('open')
    expect(stateOf(model, 'old', 2)).toBe('done')
  })

  it('pr-green-ci: a status committed on another branch of the folder does not show', async () => {
    const seed = seedRepo('seed')
    const origin = join(dir, 'origin.git')
    git(dir, 'init', '-q', '--bare', '-b', 'main', origin)
    git(seed, 'remote', 'add', 'origin', origin)
    git(seed, 'push', '-q', 'origin', 'main')
    const project = join(dir, 'project')
    git(dir, 'clone', '-q', origin, project)
    git(project, 'checkout', '-qb', 'feature')
    write(project, '.scratch/old/issues/01-first.md', ticket(1, 'done 2026-11-16', 'First'))
    git(project, 'commit', '-qam', 'unmerged done')

    expect(stateOf(await read(project, layoutOf(project, 'pr-green-ci')), 'old', 1)).toBe('open')
  })

  it('local-green: the folder on main is read as it is, a detached folder reads the local main', async () => {
    const project = seedRepo('single')
    // `ticket claim` in the folder: not committed.
    write(project, '.scratch/old/issues/01-first.md', ticket(1, 'claimed 2026-11-16', 'First'))
    const layout = layoutOf(project, 'local-green')
    expect(stateOf(await read(project, layout), 'old', 1)).toBe('work')

    git(project, 'checkout', '-q', '--detach', 'HEAD')
    expect(stateOf(await read(project, layout), 'old', 1)).toBe('open')
  })
})
