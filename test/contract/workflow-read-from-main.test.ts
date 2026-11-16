// The workflow is read from the Project's main branch, not from the working tree of its folder (worfy-polish
// ticket 118, ADR-0107). Real git repositories in a temporary folder: a bare `origin`, a clone that pushes, and the
// Project folder, another clone. The Tickets are read by the real harness/bin/epic-status of this repository. Every
// fetch goes to the bare repository on the disk: no network, no GitHub.
import { execFile, execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DocsWatcher, docsTreeOf, readDoc, readDocs, versionOf } from '../../src/main/docs/watch'
import { committedDocs } from '../../src/main/ipc/docs'
import { readTicketFile } from '../../src/main/ipc/tickets'
import { gitFetch, isLocalRemote, setFetchGuard } from '../../src/main/workflow/fetch'
import { fullLayout, type ProjectLayout } from '../../src/main/workflow/folder'
import { readWorkflow, type EpicStatusRunner } from '../../src/main/workflow/reader'
import { WorkflowHub, WorkflowWatcher, type WatchOptions, type WorkflowSubscriber } from '../../src/main/workflow/watch'
import type { WorkflowModel } from '../../src/shared/workflow/types'
import { NODE } from '../harness-node'
import { removeTestTree } from '../remove'
import { ms } from '../time-scale'

vi.mock('electron', () => ({
  app: { on: () => undefined, isPackaged: false, getAppPath: () => '/nowhere' },
  BrowserWindow: { getAllWindows: () => [] },
  dialog: {},
  shell: {},
}))

const EPIC_STATUS = join(import.meta.dirname, '..', '..', 'harness', 'bin', 'epic-status')

let dir: string
let home: string
/** The environment of git and of epic-status: none of the run's GIT_* variables, the test's own homes. */
let env: NodeJS.ProcessEnv
const watchers: WorkflowWatcher[] = []

beforeEach(() => {
  dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-main-ref-')))
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

afterEach(async () => {
  await Promise.all(watchers.splice(0).map((watcher) => watcher.close()))
  removeTestTree(dir)
})

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

const HANDOFF_OLD = '# Handoff\n\nold\n'
const HANDOFF_NEW = '# Handoff\n\nnew\n'
const ALPHA_MAIN = ticket(1, 'open', 'Alpha from main')
const FIRST_DATE = '2026-01-01T00:00:00Z'

/** A bare `origin`, a clone `seed` that pushes to it, and the Project folder `project`, a clone at the first commit. */
function fixture(): { origin: string; seed: string; project: string; first: string } {
  const origin = join(dir, 'origin.git')
  git(dir, 'init', '-q', '--bare', '-b', 'main', origin)
  const seed = join(dir, 'seed')
  git(dir, 'init', '-q', '-b', 'main', seed)
  write(seed, '.scratch/old/spec.md', '# Old epic\n')
  write(seed, '.scratch/old/issues/01-first.md', ticket(1, 'open', 'First'))
  write(seed, '.scratch/old/issues/02-second.md', ticket(2, 'open', 'Second'))
  write(seed, 'HANDOFF.md', HANDOFF_OLD)
  write(seed, 'docs/adr/0001-first.md', '# 1. First\n\nStatus: accepted.\n')
  git(seed, 'add', '-A')
  // An older date than the commits after it, so a time read from the wrong commit shows.
  execFileSync('git', ['commit', '-qm', 'first'], { cwd: seed, env: { ...env, GIT_AUTHOR_DATE: FIRST_DATE, GIT_COMMITTER_DATE: FIRST_DATE } })
  git(seed, 'remote', 'add', 'origin', origin)
  git(seed, 'push', '-q', 'origin', 'main')
  const project = join(dir, 'project')
  git(dir, 'clone', '-q', origin, project)
  return { origin, seed, project, first: git(project, 'rev-parse', 'HEAD') }
}

/** Pushes a commit with Epic `new-epic`, a new state file and a second ADR; answers its sha. */
function advanceOrigin(seed: string): string {
  write(seed, '.scratch/new-epic/spec.md', '# New epic from main\n')
  write(seed, '.scratch/new-epic/issues/01-alpha.md', ALPHA_MAIN)
  write(seed, 'HANDOFF.md', HANDOFF_NEW)
  write(seed, 'docs/adr/0002-second.md', '# 2. Second\n\nStatus: accepted.\n')
  git(seed, 'add', '-A')
  git(seed, 'commit', '-qm', 'new epic')
  git(seed, 'push', '-q', 'origin', 'main')
  return git(seed, 'rev-parse', 'HEAD')
}

/** The real epic-status of this repository, reading the Tickets root `ticketsRoot(cwd)`. */
function runner(ticketsRoot: (cwd: string) => string = (cwd) => join(cwd, '.scratch')): EpicStatusRunner {
  return (cwd, ref) =>
    new Promise((resolvePromise, reject) => {
      execFile(NODE, [EPIC_STATUS, '--json', ...(ref === null ? [] : ['--ref', ref]), '--root', ticketsRoot(cwd)], { cwd, env, encoding: 'utf8' }, (error, stdout, stderr) =>
        error ? reject(new Error(`${error.message}\n${stderr}`)) : resolvePromise(stdout),
      )
    })
}

const layoutOf = (root: string, finish: ProjectLayout['finish']): ProjectLayout => ({ ...fullLayout(root), ...(finish ? { finish } : {}) })

/** What a read must leave as it was: the working tree, the index, HEAD and the local branches. */
const folderState = (project: string): string =>
  [git(project, 'status', '--porcelain', '--untracked-files=all'), git(project, 'rev-parse', 'HEAD'), git(project, 'for-each-ref', 'refs/heads')].join('\n--\n')

const epicNames = (model: WorkflowModel): string[] => model.epics.map((epic) => epic.epic).sort()
const ticketOf = (model: WorkflowModel, epic: string, num: number) => model.tickets.find((each) => each.epic === epic && each.num === num)

const read = async (root: string, layout: ProjectLayout, run: EpicStatusRunner = runner()) =>
  (await readWorkflow({ root, claudeHome: home, env: () => Promise.resolve(env), layout }, run)).model

describe('the workflow is read from the main branch', () => {
  it('a stale detached folder with an untracked file on the new Epic\'s path shows the Epic of origin/main, with its spec, Ticket text and documents', async () => {
    const { seed, project } = fixture()
    const sha = advanceOrigin(seed)
    git(project, 'fetch', '-q', 'origin')
    git(project, 'checkout', '-q', '--detach', 'HEAD')
    // Untracked files where the new Epic lies: they kept the folder from a fast-forward.
    write(project, '.scratch/new-epic/spec.md', '# The folder\'s own spec\n')
    write(project, '.scratch/new-epic/issues/01-alpha.md', ticket(1, 'done 2026-01-01', 'Alpha in the folder'))
    const before = folderState(project)
    const layout = layoutOf(project, 'pr-green-ci')

    const model = await read(project, layout)

    expect(model.error).toBeNull()
    expect(epicNames(model)).toEqual(['new-epic', 'old'])
    expect(model.epics.find((epic) => epic.epic === 'new-epic')?.title).toBe('New epic from main')
    // The spec's time is the commit that added it to main, not the mtime of the folder's untracked copy.
    const added = Number(git(seed, 'log', '-1', '--format=%ct', 'HEAD')) * 1000
    const firstAt = Date.parse(FIRST_DATE)
    expect(model.epics.find((epic) => epic.epic === 'new-epic')?.specAt).toBe(new Date(added).toISOString())
    expect(model.epics.find((epic) => epic.epic === 'old')?.specAt).toBe(new Date(firstAt).toISOString())
    expect(ticketOf(model, 'new-epic', 1)).toMatchObject({ state: 'open', files: ['src/x.ts'], version: versionOf(ALPHA_MAIN) })
    expect(model.source).toEqual({ ref: 'refs/remotes/origin/main', sha, updatedAt: null, notice: null })

    // The focused Ticket's text and the documents come from the same commit.
    expect((await readTicketFile(layout, { epic: 'new-epic', num: 1, slug: 'alpha' })).text).toBe(ALPHA_MAIN)
    const tree = await docsTreeOf(project, layout)
    expect(tree?.sha).toBe(sha)
    const docs = await readDocs(project, { tree: tree! })
    expect(docs.handoff?.version).toBe(versionOf(HANDOFF_NEW))
    expect(docs.adrs.map((adr) => adr.number)).toEqual(['0001', '0002'])
    expect((await readDoc(project, 'HANDOFF.md', { tree: tree! })).text).toBe(HANDOFF_NEW)
    await expect(readDoc(project, '../outside.md', { tree: tree! })).rejects.toThrow()

    expect(folderState(project)).toBe(before)
  })

  it('a folder on a branch with unmerged Ticket edits shows main; a Ticket worktree branch still lays its status over it', async () => {
    const { project } = fixture()
    git(project, 'checkout', '-qb', 'feature')
    write(project, '.scratch/old/issues/02-second.md', ticket(2, 'done 2026-01-02', 'Second'))
    git(project, 'commit', '-qam', 'unmerged done')
    const worktree = join(project, '.claude', 'worktrees', '01')
    git(project, 'worktree', 'add', '-q', '-b', 'old/01', worktree, 'origin/main')
    write(worktree, '.scratch/old/issues/01-first.md', ticket(1, 'claimed 2026-11-16', 'First'))
    git(worktree, 'commit', '-qam', 'claim')

    const model = await read(project, layoutOf(project, 'pr-green-ci'))

    expect(ticketOf(model, 'old', 2)?.state).toBe('open')
    expect(ticketOf(model, 'old', 1)).toMatchObject({ state: 'work', fromBranch: 'old/01' })
    expect(model.source?.ref).toBe('refs/remotes/origin/main')
  })

  it('a folder on a Ticket\'s branch under pr-green-ci shows main, with that branch\'s committed status over it', async () => {
    const { project } = fixture()
    git(project, 'checkout', '-qb', 'old/02')
    write(project, '.scratch/old/issues/02-second.md', ticket(2, 'claimed 2026-11-16', 'Second'))
    git(project, 'commit', '-qam', 'claim 02')
    // Not committed: a branch is read from its commit, so this edit shows nowhere.
    write(project, '.scratch/old/issues/01-first.md', ticket(1, 'done 2026-11-16', 'First'))

    const layout = layoutOf(project, 'pr-green-ci')
    const once = await read(project, layout)
    // The watcher of an open Project reads the same.
    const watcher = await WorkflowWatcher.start({
      root: project,
      claudeHome: home,
      env: () => Promise.resolve(env),
      run: runner(),
      layout: () => Promise.resolve(layout),
      onChange: () => undefined,
    })
    watchers.push(watcher)

    for (const model of [once, watcher.current]) {
      expect(model.source?.ref).toBe('refs/remotes/origin/main')
      expect(ticketOf(model, 'old', 2)).toMatchObject({ state: 'work', fromBranch: 'old/02' })
      expect(ticketOf(model, 'old', 1)?.state).toBe('open')
    }
  })

  it('local-green reads the local main branch, not the HEAD of the folder', async () => {
    const project = join(dir, 'local')
    git(dir, 'init', '-q', '-b', 'main', project)
    write(project, '.scratch/old/spec.md', '# Old epic\n')
    write(project, '.scratch/old/issues/01-first.md', ticket(1, 'open', 'First'))
    git(project, 'add', '-A')
    git(project, 'commit', '-qm', 'first')
    git(project, 'checkout', '-qb', 'other')
    write(project, '.scratch/old/issues/01-first.md', ticket(1, 'done 2026-01-03', 'First'))
    git(project, 'commit', '-qam', 'done on other')
    // main moves on while the folder stays on `other`, as a local merge of a Ticket does.
    git(project, 'worktree', 'add', '-q', join(dir, 'main-tree'), 'main')
    write(join(dir, 'main-tree'), '.scratch/merged/spec.md', '# Merged locally\n')
    write(join(dir, 'main-tree'), '.scratch/merged/issues/01-one.md', ticket(1, 'open', 'One'))
    git(join(dir, 'main-tree'), 'add', '-A')
    git(join(dir, 'main-tree'), 'commit', '-qm', 'merged')
    const main = git(project, 'rev-parse', 'main')

    const model = await read(project, layoutOf(project, 'local-green'))

    expect(epicNames(model)).toEqual(['merged', 'old'])
    expect(ticketOf(model, 'old', 1)?.state).toBe('open')
    expect(model.source).toEqual({ ref: 'refs/heads/main', sha: main, updatedAt: null, notice: null })
  })

  it('local-green with the folder on main or on a Ticket branch reads the folder: the Harness\'s claim there is not committed yet', async () => {
    const project = join(dir, 'single')
    git(dir, 'init', '-q', '-b', 'main', project)
    write(project, '.scratch/old/spec.md', '# Old epic\n')
    write(project, '.scratch/old/issues/01-first.md', ticket(1, 'open', 'First'))
    git(project, 'add', '-A')
    git(project, 'commit', '-qm', 'first')
    // `ticket claim` in the folder, as the demo of Getting started does: not committed.
    write(project, '.scratch/old/issues/01-first.md', ticket(1, 'claimed 2026-11-16', 'First'))
    const layout = layoutOf(project, 'local-green')
    const onMain = await read(project, layout)
    expect(ticketOf(onMain, 'old', 1)?.state).toBe('work')
    expect(onMain.source).toBeUndefined()

    // The claim goes on with the folder onto the Ticket's branch (`parallel: single`).
    git(project, 'checkout', '-qb', 'old/01')
    expect(ticketOf(await read(project, layout), 'old', 1)?.state).toBe('work')
  })

  it('with no origin the folder is read as before, and the model says as of which commit and why', async () => {
    const project = join(dir, 'lonely')
    git(dir, 'init', '-q', '-b', 'main', project)
    write(project, '.scratch/old/spec.md', '# Old epic\n')
    write(project, '.scratch/old/issues/01-first.md', ticket(1, 'open', 'First'))
    git(project, 'add', '-A')
    git(project, 'commit', '-qm', 'first')
    // Only in the working tree: it is read, as before this ticket.
    write(project, '.scratch/draft/spec.md', '# Draft\n')
    const head = git(project, 'rev-parse', 'HEAD')

    const model = await read(project, layoutOf(project, 'pr-green-ci'))

    expect(epicNames(model)).toEqual(['draft', 'old'])
    expect(model.source).toMatchObject({ ref: null, sha: head, updatedAt: null })
    expect(model.source?.notice).toMatch(/origin\/main/)
  })

  it('Silent mode and a Tickets root outside git read the working tree, with no source line', async () => {
    const { seed, project } = fixture()
    advanceOrigin(seed)
    git(project, 'fetch', '-q', 'origin')
    // Silent mode: the Workflow folder outside the repository holds the Tickets.
    const workflow = join(dir, 'workflow-folder')
    write(workflow, '.scratch/silent/spec.md', '# Silent epic\n')
    write(workflow, '.scratch/silent/issues/01-one.md', ticket(1, 'open', 'One'))
    const silent: ProjectLayout = { ...fullLayout(project), mode: 'silent', workflowFolder: workflow, ticketsRoot: join(workflow, '.scratch') }
    const model = await read(project, silent, runner(() => join(workflow, '.scratch')))
    expect(epicNames(model)).toEqual(['silent'])
    expect(model.source).toBeUndefined()

    // A Project folder outside git.
    const plain = join(dir, 'plain')
    write(plain, '.scratch/plain/spec.md', '# Plain\n')
    write(plain, '.scratch/plain/issues/01-one.md', ticket(1, 'open', 'One'))
    const outside = await read(plain, layoutOf(plain, 'pr-green-ci'))
    expect(epicNames(outside)).toEqual(['plain'])
    expect(outside.source).toBeUndefined()
  })
})

describe('fetch keeps the main branch current', () => {
  const start = async (project: string, options: Partial<WatchOptions> = {}): Promise<WorkflowWatcher> => {
    const layout = layoutOf(project, 'pr-green-ci')
    const watcher = await WorkflowWatcher.start({
      root: project,
      claudeHome: home,
      env: () => Promise.resolve(env),
      run: runner(),
      layout: () => Promise.resolve(layout),
      debounceMs: 50,
      maxWaitMs: 200,
      onChange: () => undefined,
      fetching: true,
      // The real fetch, to the bare repository on the disk (the test setup refuses any other remote).
      fetch: gitFetch(() => Promise.resolve(env)),
      ...options,
    })
    watchers.push(watcher)
    return watcher
  }

  /** Waits until `check` passes on the watcher's model. */
  const until = (watcher: WorkflowWatcher, check: (model: WorkflowModel) => void) => vi.waitFor(() => check(watcher.current), { timeout: ms(5_000), interval: 50 })

  it('the fetch at the start brings the new Epic from the bare origin, and writes nothing in the folder', async () => {
    const { seed, project } = fixture()
    const sha = advanceOrigin(seed)
    const before = folderState(project)

    const watcher = await start(project)
    await until(watcher, (model) => expect(epicNames(model)).toEqual(['new-epic', 'old']))

    expect(watcher.current.source).toEqual({ ref: 'refs/remotes/origin/main', sha, updatedAt: null, notice: null })
    expect(folderState(project)).toBe(before)
    expect(git(project, 'rev-parse', 'refs/remotes/origin/main')).toBe(sha)
  })

  it('a fetch that fails keeps the list as it was, with no error; a ref updated from outside reads the new commit', async () => {
    const { origin, seed, project } = fixture()
    const sha = advanceOrigin(seed)
    // No network: origin points at a folder that is not there; the real fetch fails on it.
    git(project, 'remote', 'set-url', 'origin', join(dir, 'missing.git'))
    let failed = 0
    const real = gitFetch(() => Promise.resolve(env))
    const fetch = vi.fn(async (root: string, branch: string, signal: AbortSignal) => {
      try {
        await real(root, branch, signal)
      } finally {
        failed += 1
      }
    })
    const watcher = await start(project, { fetch, fetchStaleAfterMs: 0 })
    await vi.waitFor(() => expect(failed).toBe(1), { timeout: ms(5_000), interval: 20 })
    await until(watcher, (model) => expect(model.source?.notice).toMatch(/^git fetch origin has failed for 0 min: /))
    // The read the failed fetch asked for has ended; the next fetch is 2 minutes away, so only the watch of
    // refs/remotes can see the ref move below.
    await watcher.idle()
    expect(watcher.current.source?.updatedAt).toBeNull()
    expect(watcher.current.error).toBeNull()
    expect(epicNames(watcher.current)).toEqual(['old'])

    // A fetch from a terminal moves refs/remotes/origin/main: the watcher reads the new commit.
    git(project, 'fetch', '-q', origin, '+refs/heads/main:refs/remotes/origin/main')
    await until(watcher, (model) => expect(epicNames(model)).toEqual(['new-epic', 'old']))
    expect(watcher.current.source?.sha).toBe(sha)
    expect(failed).toBe(1)
  })

  it('a fetch that times out changes nothing in the list; failing past the limit shows the notice', async () => {
    const { project } = fixture()
    const fetch = vi.fn(() => Promise.reject(new Error('git fetch timed out after 60 s')))
    const watcher = await start(project, { fetch, fetchStaleAfterMs: 0 })
    await until(watcher, (model) => expect(model.source?.notice).toMatch(/git fetch timed out/))
    expect(watcher.current.error).toBeNull()
    expect(epicNames(watcher.current)).toEqual(['old'])
    expect(fetch).toHaveBeenCalledWith(project, 'main', expect.anything())
  })

  it('a fetch that finds main where it was sends no change: the time of the fetch is not in the model', async () => {
    const { project } = fixture()
    const changes: unknown[] = []
    let calls = 0
    const fetch = vi.fn(() => {
      calls += 1
      return Promise.resolve()
    })
    const watcher = await start(project, { fetch, fetchEveryMs: 20, onChange: (delta) => changes.push(delta) })
    await vi.waitFor(() => expect(calls).toBeGreaterThan(5), { timeout: ms(5_000), interval: 20 })
    // Each fetch asked for a read (fetch.ts onDone); the close waits for the one that runs.
    await watcher.close()
    expect(changes).toEqual([])
    expect(watcher.current.source).toMatchObject({ updatedAt: null, notice: null })
  })

  it('fetches only while a window shows the Project; Autopilot and the notices alone fetch nothing', async () => {
    const { project } = fixture()
    let calls = 0
    const fetch = vi.fn(() => {
      calls += 1
      return Promise.resolve()
    })
    const hub = new WorkflowHub({
      claudeHome: home,
      env: () => Promise.resolve(env),
      run: runner(),
      layout: () => Promise.resolve(layoutOf(project, 'pr-green-ci')),
      debounceMs: 50,
      maxWaitMs: 200,
      fetch,
      fetchEveryMs: 20,
      fetchFocusMinMs: 0,
    })
    const autopilot: WorkflowSubscriber = { id: 'autopilot', fieldsOnly: true, send: () => undefined }
    const window: WorkflowSubscriber = { id: 7, window: true, send: () => undefined }
    const pause = () => new Promise((done) => setTimeout(done, 150))
    try {
      expect(epicNames(await hub.open(project, autopilot))).toEqual(['old'])
      hub.focus()
      await pause()
      expect(calls).toBe(0)

      await hub.open(project, window)
      await vi.waitFor(() => expect(calls).toBeGreaterThan(1), { timeout: ms(5_000), interval: 20 })

      // The window leaves, Autopilot stays: the fetch stops, and focus starts none.
      await hub.close(project, window.id)
      await pause()
      const after = calls
      hub.focus()
      await pause()
      expect(calls).toBe(after)
    } finally {
      await hub.drop(window.id)
      await hub.drop(autopilot.id)
    }
    expect(hub.roots).toEqual([])
  })

  it('stops fetching when closed: no fetch runs after close', async () => {
    const { project } = fixture()
    let running = 0
    let calls = 0
    const fetch = vi.fn(async (_root: string, _branch: string, signal: AbortSignal) => {
      calls += 1
      running += 1
      await new Promise<void>((done) => {
        const timer = setTimeout(done, 5_000)
        signal.addEventListener('abort', () => {
          clearTimeout(timer)
          done()
        })
      })
      running -= 1
    })
    const watcher = await start(project, { fetch, fetchEveryMs: 20 })
    await vi.waitFor(() => expect(calls).toBeGreaterThan(0))
    await watcher.close()
    const after = calls
    expect(running).toBe(0)
    await new Promise((done) => setTimeout(done, 100))
    expect(calls).toBe(after)
  })
})

describe('no test fetches from a remote that is not on the disk', () => {
  it('tells a repository on the disk from one on another machine', () => {
    for (const url of ['/tmp/origin.git', 'C:\\work\\origin.git', 'C:/work/origin.git', 'file:///tmp/origin.git', '../origin.git', 'origin.git']) expect(isLocalRemote(url), url).toBe(true)
    for (const url of ['https://example.invalid/o/r.git', 'git@example.invalid:o/r.git', 'ssh://host/r.git', 'https://example.invalid/demo.git']) expect(isLocalRemote(url), url).toBe(false)
  })

  it('the test setup guards every fetch, and a guard refuses the fetch before git talks to the remote', async () => {
    const { project } = fixture()
    git(project, 'remote', 'set-url', 'origin', 'https://example.invalid/demo.git')
    const seen: Array<string | null> = []
    const installed = setFetchGuard((_root, url) => {
      seen.push(url)
      throw new Error('refused by the guard')
    })
    try {
      expect(installed).not.toBeNull()
      await expect(gitFetch(() => Promise.resolve(env))(project, 'main', new AbortController().signal)).rejects.toThrow('refused by the guard')
    } finally {
      setFetchGuard(installed)
    }
    expect(seen).toEqual(['https://example.invalid/demo.git'])
  })
})

describe('the documents follow the main branch', () => {
  it('HANDOFF.md and the ADRs are read again when the workflow watcher sees main move, with nothing in the folder changed', async () => {
    const { seed, project } = fixture()
    const layout = layoutOf(project, 'pr-green-ci')
    const workflow = await WorkflowWatcher.start({
      root: project,
      claudeHome: home,
      env: () => Promise.resolve(env),
      run: runner(),
      layout: () => Promise.resolve(layout),
      debounceMs: 50,
      maxWaitMs: 200,
      onChange: () => undefined,
    })
    watchers.push(workflow)
    // The source the app gives the documents' watcher (src/main/ipc/docs.ts).
    const docs = await DocsWatcher.start({ root: project, debounceMs: 20, onChange: () => undefined, source: committedDocs(project, { get: () => Promise.resolve(layout) }) })
    try {
      expect(docs.current.adrs.map((adr) => adr.number)).toEqual(['0001'])
      expect(docs.current.handoff?.version).toBe(versionOf(HANDOFF_OLD))
      // The reads that follow the start of a watch (SETTLE_READS_MS, up to 1 s) are over: none of them reads the move.
      await new Promise((done) => setTimeout(done, 1_500))

      // A fetch from a terminal: only .git changes, which the documents' own watch ignores.
      advanceOrigin(seed)
      git(project, 'fetch', '-q', 'origin')
      await vi.waitFor(() => expect(docs.current.adrs.map((adr) => adr.number)).toEqual(['0001', '0002']), { timeout: ms(5_000), interval: 20 })
      expect(docs.current.handoff?.version).toBe(versionOf(HANDOFF_NEW))
    } finally {
      await docs.close()
    }
  })

  it('a main branch that cannot be read keeps the documents last read, never the folder\'s disk in their place', async () => {
    const { project } = fixture()
    const layout = layoutOf(project, 'pr-green-ci')
    let failing = false
    let moved: () => void = () => undefined
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const docs = await DocsWatcher.start({
      root: project,
      debounceMs: 20,
      onChange: () => undefined,
      source: {
        tree: () => (failing ? Promise.reject(new Error('git ls-tree failed')) : docsTreeOf(project, layout)),
        onMoved: (listener) => {
          moved = listener
          return () => undefined
        },
      },
    })
    try {
      // An edit in the folder, not in main: read from main, it does not show.
      write(project, 'HANDOFF.md', '# Handoff\n\nonly in the folder\n')
      await new Promise((done) => setTimeout(done, 1_500))
      expect(docs.current.handoff?.version).toBe(versionOf(HANDOFF_OLD))

      failing = true
      moved()
      await vi.waitFor(() => expect(errors).toHaveBeenCalledWith('[docs] read failed', expect.objectContaining({ message: 'git ls-tree failed' })), { timeout: ms(5_000), interval: 20 })
      expect(docs.current.handoff?.version).toBe(versionOf(HANDOFF_OLD))
    } finally {
      await docs.close()
      errors.mockRestore()
    }
  })
})
