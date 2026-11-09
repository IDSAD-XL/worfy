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
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { gateRegistryRepos } from '../../src/main/getting-started/demo'
import type { ConnectScript, ScriptRun } from '../../src/main/projects/connect'
import { ProjectRemover, removalPreview, removeProject, type ProjectRemovalDeps } from '../../src/main/projects/remove'
import { readProfileDir } from '../../src/main/projects/review-offer'
import { ProjectStore, runGit } from '../../src/main/projects/store'
import { removeTestTree } from '../remove'

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
    expect(log).toStrictEqual(['stop shop', 'close inside', 'project-connect --remove shop', 'list remove shop', 'release'])

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
    expect(log).toStrictEqual(['stop shop', 'project-connect --remove shop', 'release'])
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
    expect(log).toStrictEqual(['stop code m1', 'project-connect --remove code', 'list remove code', 'release'])
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
    expect(log).toStrictEqual(['stop shop', 'project-connect --remove shop', 'release'])
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
