// "Remove project…" (worfy-polish ticket 79, src/main/projects/remove.ts): the Project leaves the Harness of
// this Machine through `project-connect --remove`, then worfy's list, and its folders connect again. Real
// git repositories, the real harness/bin/profile and harness/bin/project-connect in a temporary Harness home
// (HOME, HARNESS_HOME and CLAUDE_CONFIG_DIR all in the temporary folder), the real Project list; the
// Orchestrator and the Sessions are stand-ins that note what they were asked. Pinned both ways: what goes
// (the Profile, its gate registry entries, its runs folder) and what never goes (the repositories, their
// files, a Workflow folder the user chose, tickets in the default Workflow folder, other Profiles).
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DocsHub } from '../../src/main/docs/watch'
import { gateRegistryRepos } from '../../src/main/getting-started/demo'
import type { ConnectScript, ScriptRun } from '../../src/main/projects/connect'
import { ProjectRemover, removalPreview, removeProject, type ProjectRemovalDeps } from '../../src/main/projects/remove'
import { readProfileDir } from '../../src/main/projects/review-offer'
import { ProjectStore, runGit } from '../../src/main/projects/store'
import { WorkflowHub } from '../../src/main/workflow/watch'
import { removeTestTree } from '../remove'

/**
 * Every fs.watch handle worfy's watches open (the documents' watch and the Windows watch of the
 * Tickets both go through watch-gone.ts), by the folder it holds, until it is closed.
 */
const { openWatches } = vi.hoisted(() => ({ openWatches: new Map<object, string>() }))
vi.mock('../../src/main/watch-gone', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/main/watch-gone')>()
  const watchWithNode: typeof real.watchWithNode = (path, recursive, onEvent, onError) => {
    const handle = real.watchWithNode(path, recursive, onEvent, onError)
    const close = handle.close.bind(handle)
    openWatches.set(handle, path)
    handle.close = () => {
      openWatches.delete(handle)
      close()
    }
    return handle
  }
  return { ...real, watchWithNode }
})

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const BIN = join(REPO, 'harness', 'bin')

let scratch: string
let home: string
let harnessHome: string

/** Variables that would point the Harness scripts elsewhere: the gate exports CLAUDE_GATE_CONFIG to the tests it runs. */
const OUTSIDE = /^(GIT_|CLAUDE_GATE_|CLAUDE_PROFILES_DIR$|PROJECT_CONNECT_|ELECTRON_RUN_AS_NODE$)/

/** The environment of the Harness scripts: everything in the temporary folder, never the machine's ~/.claude. */
function sandboxEnv(): NodeJS.ProcessEnv {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !OUTSIDE.test(key)))
  return {
    ...env,
    HOME: home,
    USERPROFILE: home,
    HARNESS_HOME: harnessHome,
    CLAUDE_CONFIG_DIR: join(home, '.claude'),
    PROJECT_CONNECT_QMD: join(scratch, 'no-qmd'),
    GIT_AUTHOR_NAME: 't',
    GIT_AUTHOR_EMAIL: 't@t',
    GIT_COMMITTER_NAME: 't',
    GIT_COMMITTER_EMAIL: 't@t',
  }
}

function runScript(script: string, args: readonly string[], stdin: string, cwd = scratch): Promise<ScriptRun> {
  return new Promise((done, reject) => {
    const child = spawn('node', [join(BIN, script), ...args], { cwd, env: sandboxEnv() })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf8')))
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')))
    child.on('error', reject)
    child.on('close', (code) => done({ code, stdout, stderr }))
    child.stdin.end(stdin)
  })
}

const realConnect: ConnectScript = (args, stdin) => runScript('project-connect', args, stdin)

function git(cwd: string, ...args: string[]): string {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', '-c', 'maintenance.auto=false', ...args], { cwd, env, encoding: 'utf8' }).trim()
}

function makeRepo(path: string): string {
  mkdirSync(path, { recursive: true })
  git(path, 'init', '-q', '-b', 'main')
  writeFileSync(join(path, 'package.json'), '{"scripts":{"lint":"eslint .","test":"vitest run"}}\n')
  git(path, 'add', 'package.json')
  git(path, 'commit', '-q', '-m', 'init')
  return realpathSync.native(path)
}

/** Everything git would report in a repository, and its HEAD: equal before and after means it was not touched. */
const repoState = (repo: string): string => `${git(repo, 'status', '--porcelain', '--ignored', '--untracked-files=all')}\n${git(repo, 'rev-parse', 'HEAD')}`

/** A draft as skill connect-project proposes it (harness/bin/tests/project-connect.test.sh, draft()). */
function draft(name: string, mode: 'full' | 'silent', folder: string | null, matches: readonly string[]): string {
  const profile = {
    schema: 2,
    name,
    title: name,
    mode,
    language: { reports: 'en', team: 'en', docs: 'en' },
    attribution: mode === 'silent' ? 'off' : 'on',
    layout: { summary: 'one package', packages: ['.'], repos: null },
    stack: ['node'],
    commands: { install: 'npm ci', lint: 'npm run lint', typecheck: null, test: 'npm test', test_one: null, contract: null, e2e: null, build: null, verify: 'npm test', prepare_tree: 'npm ci', requires: [] },
    parallel: 'worktrees',
    worktree: { root: `${matches[0]}/.claude/worktrees/`, base: 'origin/main', implementer: null, reviewer: null },
    tickets: { root: '.scratch/', path: '.scratch/<epic>/issues/NN-*.md', trail_section: '## Where in the code', spec: '.scratch/<epic>/spec.md', branch: null },
    workflow: { folder, ticket_skill: 'ship-ticket', implementer_steps: 'steps 1-8', finish: 'local-green', merge: 'orchestrator' },
    numbering: null,
    deploy: null,
    github: { account: null },
    docs: null,
    lessons: 'repo:docs/lessons',
    mcp: { allowed: ['plugin_worfy_qmd'] },
    review: { lenses: ['correctness'], ticket_lenses: ['correctness'] },
  }
  const gate = matches.map((match) => ({ key: basename(match), match, profile: name, pm: 'npm', root: { fast: ['lint', 'test'], full: ['lint', 'test'] }, workspace: {} }))
  return JSON.stringify({ profile, rules: `# ${name}\n\n## Sources\n\n- package.json\n`, gate })
}

/** Connects a project through the real script; the test fails here when the Harness refuses. */
async function connect(name: string, mode: 'full' | 'silent', folder: string | null, matches: readonly string[]): Promise<void> {
  const run = await realConnect(['--no-qmd'], draft(name, mode, folder, matches))
  expect(run.code, run.stdout + run.stderr).toBe(0)
}

const registry = (): { key: string; profile: string; match: string }[] =>
  (JSON.parse(readFileSync(join(harnessHome, 'gate', 'config.json'), 'utf8')) as { repos: { key: string; profile: string; match: string }[] }).repos

/** What the removal was asked to do, in order. */
let log: string[]
let store: ProjectStore

function storeOver(): ProjectStore {
  return new ProjectStore(join(scratch, 'data'), runGit, async (folder) => {
    const run = await runScript('profile', ['-C', folder, '--field', '_resolved.workspace'], '', folder)
    const value = run.stdout.trim()
    return run.code === 0 && value !== '' && value !== 'null' ? value : null
  })
}

/** The removal's parts over the sandbox; `connect` replaces the real script, noted either way. */
function deps(sessions: { sessionId: string; cwd: string }[] = [], connectScript: ConnectScript = realConnect): ProjectRemovalDeps {
  return {
    projects: {
      get: (id) => store.get(id),
      list: () => store.list(),
      remove: (id) => {
        log.push(`list remove ${store.get(id).name}`)
        store.remove(id)
      },
    },
    harnessHome: () => harnessHome,
    profileDir: (root) => readProfileDir((cwd, args) => runScript('profile', args, '', cwd), root),
    registeredRepos: gateRegistryRepos(() => join(harnessHome, 'gate')),
    connect: async (args, stdin) => {
      log.push(`project-connect ${args.join(' ')}`)
      return connectScript(args, stdin)
    },
    stopOrchestrators: (projectIds) => {
      log.push(`stop ${projectIds.map((id) => store.get(id).name).join(' ')}`)
      return () => log.push('release')
    },
    holdWatches: (projects) => {
      log.push(`hold watches ${projects.map((project) => project.name).join(' ')}`)
      return Promise.resolve(() => {
        log.push('watch again')
        return Promise.resolve()
      })
    },
    sessions: {
      list: () => sessions,
      close: (sessionId) => {
        log.push(`close ${sessionId}`)
        return Promise.resolve()
      },
    },
  }
}

async function listed(path: string): Promise<{ id: string; name: string; path: string }> {
  const added = await store.add(path)
  if (added.status !== 'added') throw new Error(`not added: ${added.reason}`)
  return added.project
}

beforeEach(() => {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-project-remove-')))
  home = join(scratch, 'home')
  harnessHome = join(home, '.claude', 'worfy-harness')
  mkdirSync(harnessHome, { recursive: true })
  log = []
  store = storeOver()
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
  removeTestTree(scratch)
})

describe('Remove project of a Full mode repository', () => {
  it('previews what goes and what stays, removes through project-connect --remove, then the list, and the folder connects again', async () => {
    const shop = makeRepo(join(scratch, 'shop'))
    const other = makeRepo(join(scratch, 'other'))
    await connect('shop', 'full', null, [shop])
    await connect('other', 'full', null, [other])
    mkdirSync(join(harnessHome, 'runs', 'shop', 'marks'), { recursive: true })
    writeFileSync(join(harnessHome, 'runs', 'shop', 'marks', 'todo-01.json'), '{}')
    const project = await listed(shop)
    const kept = await listed(other)
    const shopBefore = repoState(shop)

    const preview = await removalPreview(deps(), project.id)
    expect(preview).toStrictEqual({
      status: 'ready',
      profile: 'shop',
      profileDir: expect.stringMatching(/[\\/]projects[\\/]shop$/) as unknown as string,
      paths: [shop],
      runs: expect.stringMatching(/[\\/]runs[\\/]shop$/) as unknown as string,
      qmd: [],
      mode: 'full',
      workflowFolder: null,
      alsoListed: [],
    })
    expect(preview.status === 'ready' && preview.runs).toBe(join(harnessHome, 'runs', 'shop'))

    const sessions = [
      { sessionId: 'inside', cwd: join(shop, '.claude', 'worktrees', '05') },
      { sessionId: 'outside', cwd: other },
    ]
    expect(await removeProject(deps(sessions), project.id)).toStrictEqual({ status: 'removed', notes: [] })
    // The order of the ticket: the Orchestrator and the Sessions of the Project, the script, then the list.
    expect(log).toStrictEqual(['stop shop', 'close inside', 'hold watches shop', 'project-connect --remove shop', 'list remove shop', 'release', 'watch again'])

    // What goes.
    expect(registry().map((entry) => entry.profile)).toStrictEqual(['other'])
    expect(existsSync(join(harnessHome, 'projects', 'shop'))).toBe(false)
    expect(existsSync(join(harnessHome, 'runs', 'shop'))).toBe(false)
    expect(store.list().map((each) => each.id)).toStrictEqual([kept.id])
    // What stays: the repository and every file in it, the other Profile, worfy's data folder of the Project.
    expect(repoState(shop)).toBe(shopBefore)
    expect(existsSync(join(harnessHome, 'projects', 'other', 'profile.json'))).toBe(true)
    expect(existsSync(store.dataDir(project.id))).toBe(true)
    expect((await runScript('profile', ['-C', shop, '--name'], '', shop)).code).toBe(3)

    // The same folder connects again, without "already in the gate registry", and joins the list again.
    const again = await realConnect(['--no-qmd'], draft('shop', 'full', null, [shop]))
    expect(again.stdout + again.stderr).not.toContain('already in the gate registry')
    expect(again.code).toBe(0)
    expect((await listed(shop)).path).toBe(shop)
  })

  it('a refusal of the script leaves the Project in the list and the Profile in place, with the script\'s words', async () => {
    const shop = makeRepo(join(scratch, 'shop'))
    await connect('shop', 'full', null, [shop])
    const project = await listed(shop)
    const refusing: ConnectScript = () =>
      Promise.resolve({ code: 1, stdout: JSON.stringify({ ok: false, errors: [{ path: '', kind: 'write', message: 'the commit failed; the removal was rolled back' }] }), stderr: '' })
    const result = await removeProject(deps([], refusing), project.id)
    expect(result).toStrictEqual({
      status: 'refused',
      reason: 'The Harness did not remove the Profile shop, so the Project stays in the list: the commit failed; the removal was rolled back',
      workflowFolder: null,
    })
    expect(log).toStrictEqual(['stop shop', 'hold watches shop', 'project-connect --remove shop', 'release', 'watch again'])
    expect(store.list().map((each) => each.id)).toStrictEqual([project.id])
    expect(registry().map((entry) => entry.profile)).toStrictEqual(['shop'])
  })

  it('a Harness older than --remove (exit 2), or one that cannot start, is a refusal that removes nothing', async () => {
    const shop = makeRepo(join(scratch, 'shop'))
    await connect('shop', 'full', null, [shop])
    const project = await listed(shop)
    const old: ConnectScript = () => Promise.resolve({ code: 2, stdout: '', stderr: 'unknown option --remove' })
    const older = await removeProject(deps([], old), project.id)
    expect(older.status === 'refused' && older.reason).toMatch(/does not know --remove\. Update the Harness plugin/)
    const missing: ConnectScript = () => Promise.reject(new Error('spawn node ENOENT'))
    const gone = await removeProject(deps([], missing), project.id)
    expect(gone.status === 'refused' && gone.reason).toBe('The Harness could not be run: spawn node ENOENT. The Project stays in the list.')
    expect(store.list().map((each) => each.id)).toStrictEqual([project.id])
    expect(existsSync(join(harnessHome, 'projects', 'shop', 'profile.json'))).toBe(true)
  })

  it('"no profile" from the script counts as done only when no registry entry of the Profile is left', async () => {
    const shop = makeRepo(join(scratch, 'shop'))
    await connect('shop', 'full', null, [shop])
    const project = await listed(shop)
    const noProfile = { code: 1, stdout: JSON.stringify({ ok: false, errors: [{ path: '', kind: 'value', message: 'no profile shop: it does not exist' }] }), stderr: '' }
    // The registry still names the Profile: nothing was freed.
    const stillListed = await removeProject(deps([], () => Promise.resolve(noProfile)), project.id)
    expect(stillListed).toStrictEqual({
      status: 'refused',
      reason: `The Harness has no Profile shop to remove, but its gate registry still names it for ${shop}: nothing was freed, and the Project stays in the list.`,
      workflowFolder: null,
    })
    expect(store.list().map((each) => each.id)).toStrictEqual([project.id])
    // Removed meanwhile by another run of the Harness: the registry is clear, so the list is all that is left.
    const removedMeanwhile: ConnectScript = async () => {
      expect((await realConnect(['--remove', 'shop', '--no-qmd'], '')).code).toBe(0)
      return noProfile
    }
    expect(await removeProject(deps([], removedMeanwhile), project.id)).toStrictEqual({ status: 'removed', notes: [] })
    expect(store.list()).toStrictEqual([])
  })

  it('a Profile in the old Harness folder (~/.claude/profiles) is refused before anything closes: --remove would not find it', async () => {
    const shop = makeRepo(join(scratch, 'shop'))
    const old = join(home, '.claude', 'profiles', 'shop')
    mkdirSync(old, { recursive: true })
    writeFileSync(join(old, 'profile.json'), JSON.stringify({ schema: 1, name: 'shop' }))
    mkdirSync(join(harnessHome, 'gate'), { recursive: true })
    writeFileSync(join(harnessHome, 'gate', 'config.json'), JSON.stringify({ repos: [{ key: 'shop', match: shop, profile: 'shop' }] }))
    expect((await runScript('profile', ['-C', shop, '--dir'], '', shop)).stdout.trim()).toBe(old)
    const project = await listed(shop)
    const result = await removeProject(deps([{ sessionId: 'inside', cwd: shop }]), project.id)
    expect(result).toStrictEqual({
      status: 'refused',
      reason: `The Profile shop is in the old Harness folder ${join(home, '.claude', 'profiles')}, and the Harness removes only Profiles in ${join(harnessHome, 'projects')}. Move the old Harness to the plugin first (Command palette: First-run checks), then remove the project. "Remove from list" takes it out of worfy's list only.`,
      workflowFolder: null,
    })
    expect(log).toStrictEqual([])
    expect(registry().map((entry) => entry.profile)).toStrictEqual(['shop'])
    expect(existsSync(join(old, 'profile.json'))).toBe(true)
    expect(store.list().map((each) => each.id)).toStrictEqual([project.id])
  })

  it('qmd collections that stay are named: qmd not installed, real --remove output', async () => {
    const shop = makeRepo(join(scratch, 'shop'))
    await connect('shop', 'full', null, [shop])
    // The qmd field the qmd step writes; the sandbox has no qmd, so --remove keeps the collections and says why.
    const file = join(harnessHome, 'projects', 'shop', 'profile.json')
    writeFileSync(file, JSON.stringify({ ...(JSON.parse(readFileSync(file, 'utf8')) as object), qmd: { collections: ['shop-docs', 'shared'] } }))
    const project = await listed(shop)
    expect(await removeProject(deps(), project.id)).toStrictEqual({ status: 'removed', notes: ['The qmd collections shop-docs, shared stay: qmd is not installed.'] })
  })

  it('another listed Project inside the folder shares the Profile: its Orchestrator is held too, and it stays in the list, named in the notes', async () => {
    const code = join(scratch, 'code')
    const m1 = makeRepo(join(code, 'm1'))
    const m2 = makeRepo(join(code, 'm2'))
    const folder = realpathSync.native(code)
    await connect('code', 'silent', folder, [m1, m2])
    const project = await listed(folder)
    const inner = await listed(m1)
    const preview = await removalPreview(deps(), project.id)
    expect(preview.status === 'ready' && preview.alsoListed).toStrictEqual([`m1 (${m1})`])
    expect(await removeProject(deps(), project.id)).toStrictEqual({
      status: 'removed',
      notes: ['m1 stays in the list without a Profile: Remove from list takes it out, or Add project connects its folder again.'],
    })
    expect(log).toStrictEqual(['stop code m1', 'hold watches code m1', 'project-connect --remove code', 'list remove code', 'release', 'watch again'])
    expect(store.list().map((each) => each.id)).toStrictEqual([inner.id])
  })

  it('a folder the Harness does not know is refused before anything is asked', async () => {
    // A Harness with a registry that does not name the folder: bin/profile answers exit 3.
    await connect('other', 'full', null, [makeRepo(join(scratch, 'other'))])
    const loose = makeRepo(join(scratch, 'loose'))
    const project = await listed(loose)
    const result = await removeProject(deps(), project.id)
    expect(result.status === 'refused' && result.reason).toBe(`The Harness of this Machine has no Profile for ${loose}, so none of its paths is taken. "Remove from list" takes it out of worfy's list only.`)
    expect(log).toStrictEqual([])
    expect(store.list().map((each) => each.id)).toStrictEqual([project.id])
  })
})

describe('Remove project in Silent mode', () => {
  it('tickets in the default Workflow folder: refused before anything closes, nothing removed, the folder named for Finder', async () => {
    const shop = makeRepo(join(scratch, 'shop'))
    await connect('shop', 'silent', null, [shop])
    const workflow = join(harnessHome, 'projects', 'shop', 'workflow')
    mkdirSync(join(workflow, 'epic', 'issues'), { recursive: true })
    writeFileSync(join(workflow, 'epic', 'issues', '01-ticket.md'), '# 01\n')
    const project = await listed(shop)

    const preview = await removalPreview(deps(), project.id)
    expect(preview.status === 'ready' && preview.workflowFolder).toStrictEqual({ path: expect.stringMatching(/[\\/]projects[\\/]shop[\\/]workflow$/) as unknown as string, inside: true, holdsFiles: true })

    const result = await removeProject(deps([{ sessionId: 'inside', cwd: shop }]), project.id)
    expect(result.status).toBe('refused')
    expect(result.status === 'refused' && result.reason).toMatch(/holds the project's own files \(its tickets\)\. worfy does not delete them.*Nothing was removed\.$/)
    expect(result.status === 'refused' && result.workflowFolder).toMatch(/[\\/]projects[\\/]shop[\\/]workflow$/)
    expect(log).toStrictEqual([])
    expect(readFileSync(join(workflow, 'epic', 'issues', '01-ticket.md'), 'utf8')).toBe('# 01\n')
    expect(registry().map((entry) => entry.profile)).toStrictEqual(['shop'])
    expect(store.list().map((each) => each.id)).toStrictEqual([project.id])
  })

  it('a default Workflow folder with commits only is refused before anything closes, as the Harness would refuse it', async () => {
    const shop = makeRepo(join(scratch, 'shop'))
    await connect('shop', 'silent', null, [shop])
    const workflow = join(harnessHome, 'projects', 'shop', 'workflow')
    // Files that came and went: no file now, but commits the Harness home's history cannot bring back.
    writeFileSync(join(workflow, '01.md'), '# 01\n')
    git(workflow, 'add', '01.md')
    git(workflow, 'commit', '-q', '-m', 'tickets')
    git(workflow, 'rm', '-q', '01.md')
    git(workflow, 'commit', '-q', '-m', 'moved')
    expect(readdirSync(workflow)).toStrictEqual(['.git'])
    // The Harness itself refuses this folder: the check in main says the same before anything closes.
    const before = registry()
    const harnessSays = await realConnect(['--remove', 'shop', '--no-qmd'], '')
    expect([harnessSays.code, harnessSays.stdout]).toStrictEqual([1, expect.stringContaining("holds the project's own files and commits") as unknown as string])
    expect(registry()).toStrictEqual(before)
    const project = await listed(shop)
    const result = await removeProject(deps([{ sessionId: 'inside', cwd: shop }]), project.id)
    expect(result.status === 'refused' && result.reason).toMatch(/^The Workflow folder .* holds the project's own files \(its tickets\)\. worfy does not delete them: move the folder .* out of .* first\. Nothing was removed\.$/)
    expect(result.status === 'refused' && result.workflowFolder).toMatch(/[\\/]projects[\\/]shop[\\/]workflow$/)
    // Nothing was stopped or closed, and the script never ran.
    expect(log).toStrictEqual([])
    expect(git(workflow, 'rev-list', '--count', 'HEAD')).toBe('2')
    expect(registry().map((entry) => entry.profile)).toStrictEqual(['shop'])
    expect(store.list().map((each) => each.id)).toStrictEqual([project.id])
  })

  it('a refusal of the script about the Workflow folder after the preview (a race) still names the folder', async () => {
    const shop = makeRepo(join(scratch, 'shop'))
    await connect('shop', 'silent', null, [shop])
    const project = await listed(shop)
    const refusing: ConnectScript = () =>
      Promise.resolve({ code: 1, stdout: JSON.stringify({ ok: false, errors: [{ path: '', kind: 'value', message: "the Workflow folder holds the project's own files: move it out first; nothing was removed" }] }), stderr: '' })
    const result = await removeProject(deps([], refusing), project.id)
    expect(result.status === 'refused' && result.workflowFolder).toMatch(/[\\/]projects[\\/]shop[\\/]workflow$/)
    expect(log).toStrictEqual(['stop shop', 'hold watches shop', 'project-connect --remove shop', 'release', 'watch again'])
    expect(store.list().map((each) => each.id)).toStrictEqual([project.id])
  })

  it('a project over several repositories: its Workflow folder (the folder above) and both repositories stay; both connect again', async () => {
    const pair = join(scratch, 'pair')
    const one = makeRepo(join(pair, 'one'))
    const two = makeRepo(join(pair, 'two'))
    const folder = realpathSync.native(pair)
    writeFileSync(join(folder, '01-ticket.md'), '# 01\n')
    await connect('pair', 'silent', folder, [one, two])
    const project = await listed(folder)
    expect(project.path).toBe(folder)
    const before = [repoState(one), repoState(two), readdirSync(folder).sort().join(' ')]

    const preview = await removalPreview(deps(), project.id)
    expect(preview.status === 'ready' && [preview.mode, preview.paths, preview.workflowFolder]).toStrictEqual(['silent', [one, two], { path: folder, inside: false, holdsFiles: true }])
    expect(await removeProject(deps(), project.id)).toStrictEqual({ status: 'removed', notes: [] })
    expect([repoState(one), repoState(two), readdirSync(folder).sort().join(' ')]).toStrictEqual(before)
    expect(readFileSync(join(folder, '01-ticket.md'), 'utf8')).toBe('# 01\n')
    expect(registry()).toStrictEqual([])

    // One of the freed repositories connects as a project of its own.
    const alone = await realConnect(['--no-qmd'], draft('one', 'full', null, [one]))
    expect(alone.code, alone.stdout + alone.stderr).toBe(0)
  })

  it('a repository listed on its own whose Profile also covers another repository is refused: the other would go too', async () => {
    const pair = join(scratch, 'pair')
    const one = makeRepo(join(pair, 'one'))
    const two = makeRepo(join(pair, 'two'))
    await connect('pair', 'silent', realpathSync.native(pair), [one, two])
    const project = await listed(one)
    const result = await removeProject(deps(), project.id)
    expect(result.status === 'refused' && result.reason).toBe(
      `The Profile pair also covers ${two}, outside ${one}: removing it would remove those too. Remove the Project of the folder that holds them all instead.`,
    )
    expect(log).toStrictEqual([])
    expect(registry().map((entry) => entry.match)).toStrictEqual([one, two])
  })
})

describe('ProjectRemover', () => {
  it('a second call for the same Project while one runs gets that one\'s answer; the script runs once', async () => {
    const shop = makeRepo(join(scratch, 'shop'))
    await connect('shop', 'full', null, [shop])
    const project = await listed(shop)
    const remover = new ProjectRemover(() => Promise.resolve(deps()))
    const [first, second] = await Promise.all([remover.remove(project.id), remover.remove(project.id)])
    expect(first).toStrictEqual({ status: 'removed', notes: [] })
    expect(second).toBe(first)
    expect(log.filter((line) => line.startsWith('project-connect'))).toStrictEqual(['project-connect --remove shop'])
  })
})

// Windows refuses to rename a folder while a handle inside it is open (EPERM), and `project-connect
// --remove` renames the Profile folder first. A Silent Project's Workflow folder lies in that folder,
// and worfy watches it twice: the Tickets (link-safe-watch.ts on Windows) and the documents (one
// recursive fs.watch). The Harness here acts as Windows would: while any of worfy's watches holds a
// folder inside the Profile folder, it refuses with the words Windows CI showed, and removes nothing.
describe('Remove project of a Silent Project that worfy watches (the Windows rename rule)', () => {
  const EPIC_JSON = JSON.stringify({ ref: null, epics: [], tickets: [] })

  const insideOf = (folder: string) => (path: string) => path === folder || path.startsWith(`${folder}${sep}`)
  const watchesInside = (folder: string): string[] => [...openWatches.values()].filter(insideOf(folder))

  /** The real script, refused as Windows refuses it while a watch holds a folder inside `profileDir`. */
  const windowsConnect = (profileDir: string): ConnectScript => (args, stdin) => {
    const held = watchesInside(profileDir)
    if (held.length === 0) return realConnect(args, stdin)
    const message = `EPERM: operation not permitted, rename '${profileDir}' -> '${join(harnessHome, '.remove-test', 'profile')}' (held: ${held.join(', ')}); the removal was rolled back`
    return Promise.resolve({ code: 1, stdout: JSON.stringify({ ok: false, errors: [{ path: '', kind: 'write', message }] }), stderr: '' })
  }

  async function until(what: string, ready: () => boolean): Promise<void> {
    for (let tries = 0; !ready(); tries += 1) {
      if (tries > 200) throw new Error(`timed out waiting for ${what}`)
      await new Promise((done) => setTimeout(done, 25))
    }
  }

  /** The app's two hubs over the Silent Project `shop`, opened as a window opens them, and the removal's parts with the app's hold of them. */
  async function watched(connectScript: (profileDir: string) => ConnectScript): Promise<{ project: { id: string; name: string; path: string }; profileDir: string; workflowHub: WorkflowHub; docsHub: DocsHub; removal: ProjectRemovalDeps }> {
    const shop = makeRepo(join(scratch, 'shop'))
    await connect('shop', 'silent', null, [shop])
    const project = await listed(shop)
    const profileDir = join(harnessHome, 'projects', 'shop')
    const workflow = join(profileDir, 'workflow')
    expect(existsSync(workflow)).toBe(true)
    const workflowHub = new WorkflowHub({
      claudeHome: join(home, '.claude'),
      env: () => Promise.resolve({}),
      run: () => Promise.resolve(EPIC_JSON),
      layout: (root) => Promise.resolve({ root, mode: 'silent', workflowFolder: workflow, ticketsRoot: workflow, repos: [], workspace: null, reason: null, failed: false }),
      ticketsWatch: 'links-read-first',
    })
    const docsHub = new DocsHub({ debounceMs: 20 })
    cleanups.push(() => workflowHub.closeAll(), () => docsHub.closeAll())
    await workflowHub.open(project.path, { id: 'window', send: () => undefined })
    await docsHub.open(project.id, workflow, { id: 'window', send: () => undefined })
    await until('the watches of the Workflow folder', () => watchesInside(profileDir).length >= 2)
    const base = deps([], connectScript(profileDir))
    const removal: ProjectRemovalDeps = {
      ...base,
      // As src/main/ipc/projects.ts holds them.
      holdWatches: async (projects) => {
        const holds = await Promise.all(projects.flatMap((each) => [workflowHub.hold(each.path), docsHub.hold(each.id)]))
        return async () => {
          await Promise.all(holds.map((watchAgain) => watchAgain()))
        }
      },
    }
    return { project, profileDir, workflowHub, docsHub, removal }
  }

  const cleanups: (() => Promise<void>)[] = []
  afterEach(async () => {
    await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()))
  })

  it('closes the Tickets and documents watches before the Harness renames the Profile folder: the removal succeeds and the folder connects again', async () => {
    const { project, profileDir, workflowHub, removal } = await watched(windowsConnect)
    const result = await removeProject(removal, project.id)
    expect(result).toStrictEqual({ status: 'removed', notes: [] })
    expect(existsSync(profileDir)).toBe(false)
    expect(registry()).toStrictEqual([])
    expect(store.list()).toStrictEqual([])
    // The window still holds its subscription; the hub follows the folder again.
    expect(workflowHub.roots).toStrictEqual([project.path])
    await connect('shop', 'silent', null, [project.path])
    expect(registry().map((entry) => entry.profile)).toStrictEqual(['shop'])
  })

  it.each(['EPERM', 'EBUSY'])('a rename refused with %s names the folder Windows keeps open and what to close', async (code) => {
    const shop = makeRepo(join(scratch, 'shop'))
    await connect('shop', 'silent', null, [shop])
    const project = await listed(shop)
    const profileDir = join(harnessHome, 'projects', 'shop')
    const message = `${code}: operation not permitted, rename '${profileDir}' -> '${join(harnessHome, '.remove-x', 'profile')}'; the removal was rolled back`
    const refusing: ConnectScript = () => Promise.resolve({ code: 1, stdout: JSON.stringify({ ok: false, errors: [{ path: '', kind: 'write', message }] }), stderr: '' })
    const result = await removeProject(deps([], refusing), project.id)
    expect(result.status === 'refused' && result.reason).toBe(
      `The Harness did not remove the Profile shop, so the Project stays in the list: ${message}. Windows keeps a folder inside ${profileDir} open: close Terminals or programs working in it and try again.`,
    )
    expect(store.list().map((each) => each.id)).toStrictEqual([project.id])
  })

  it('another refusal than a rename gets no sentence about Windows', async () => {
    const shop = makeRepo(join(scratch, 'shop'))
    await connect('shop', 'full', null, [shop])
    const project = await listed(shop)
    const refusing: ConnectScript = () => Promise.resolve({ code: 1, stdout: JSON.stringify({ ok: false, errors: [{ path: '', kind: 'write', message: "EPERM: operation not permitted, open 'config.json'" }] }), stderr: '' })
    const result = await removeProject(deps([], refusing), project.id)
    expect(result.status === 'refused' && result.reason).toBe("The Harness did not remove the Profile shop, so the Project stays in the list: EPERM: operation not permitted, open 'config.json'")
  })

  it('the answer does not wait for the watches made again', async () => {
    const shop = makeRepo(join(scratch, 'shop'))
    await connect('shop', 'full', null, [shop])
    const project = await listed(shop)
    let asked = false
    const removal: ProjectRemovalDeps = {
      ...deps(),
      holdWatches: () =>
        Promise.resolve(() => {
          asked = true
          // The first full read of a large Project: it does not end during this test.
          return new Promise<void>(() => undefined)
        }),
    }
    const result = await Promise.race([removeProject(removal, project.id), new Promise<'waited'>((done) => setTimeout(() => done('waited'), 5000))])
    expect(result).toStrictEqual({ status: 'removed', notes: [] })
    expect(asked).toBe(true)
  })

  it('after a refusal of the Harness the watches of the Workflow folder are made again', async () => {
    const refusing: ConnectScript = () => Promise.resolve({ code: 1, stdout: JSON.stringify({ ok: false, errors: [{ path: '', kind: 'write', message: 'the commit failed; the removal was rolled back' }] }), stderr: '' })
    const { project, profileDir, workflowHub, docsHub, removal } = await watched(() => refusing)
    const result = await removeProject(removal, project.id)
    expect(result.status).toBe('refused')
    await until('the watches made again', () => watchesInside(profileDir).length >= 2)
    expect(workflowHub.roots).toStrictEqual([project.path])
    expect(docsHub.projects).toStrictEqual([project.id])
  })
})
