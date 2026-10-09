// Connecting a Project (src/main/projects/connect.ts): what kind of folder the user picked, a folder
// the Harness already knows, the Harness check, the draft Session and the write through the
// Harness script. Real git repositories and the real harness/bin/profile and
// harness/bin/project-connect in a temporary Harness home (HOME, HARNESS_HOME and CLAUDE_CONFIG_DIR
// all in the temporary folder); the Harness check and Claude Code are replaced — the draft Session
// plays test/fixtures/agent-scripts/profile-draft.jsonl through the fake agent.
import { execFileSync, spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { HarnessStatus } from '../../src/shared/ipc/harness'
import type { ProfileDraft } from '../../src/shared/ipc/projects'
import { fakeQueryFactory, type FakeCall } from '../../src/main/agent/fake-query'
import { draftSessionOptions, sessionOptions } from '../../src/main/agent/options'
import {
  activityOf,
  draftCanUseTool,
  inspectFolder,
  MULTI_REPO_FULL,
  ProjectConnector,
  readOnlyCommand,
  type AddOutcome,
  type ConnectDeps,
  type DraftRequest,
} from '../../src/main/projects/connect'
import { ProjectStore, runGit } from '../../src/main/projects/store'
import type { ProfileRunner } from '../../src/main/workflow/profile'

const REPO = join(__dirname, '..', '..')
const BIN = join(REPO, 'harness', 'bin')
const SCRIPTS = join(REPO, 'test', 'fixtures', 'agent-scripts')
const SCHEMA = JSON.parse(readFileSync(join(REPO, 'harness', 'profiles', 'draft.schema.json'), 'utf8')) as Record<string, unknown>

let scratch: string
let home: string
let harnessHome: string

/** git for the fixtures, without GIT_* variables of a surrounding hook. */
function git(cwd: string, ...args: string[]): string {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd, env, encoding: 'utf8' }).trim()
}

function makeRepo(path: string): string {
  mkdirSync(path, { recursive: true })
  git(path, 'init', '-q', '-b', 'main')
  writeFileSync(join(path, 'package.json'), '{"scripts":{"lint":"eslint .","test":"vitest run"}}\n')
  git(path, 'add', 'package.json')
  git(path, 'commit', '-q', '-m', 'init')
  return realpathSync(path)
}

/**
 * Variables that would point the Harness scripts elsewhere: the gate exports CLAUDE_GATE_CONFIG
 * (its own registry) to the tests it runs.
 */
const OUTSIDE = /^(GIT_|CLAUDE_GATE_|CLAUDE_PROFILES_DIR$|PROJECT_CONNECT_|ELECTRON_RUN_AS_NODE$)/

/** The environment of the Harness scripts: everything in the temporary folder. */
function sandboxEnv(): NodeJS.ProcessEnv {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !OUTSIDE.test(key)))
  return {
    ...env,
    HOME: home,
    HARNESS_HOME: harnessHome,
    CLAUDE_CONFIG_DIR: join(home, '.claude'),
    PROJECT_CONNECT_QMD: join(scratch, 'no-qmd'),
    GIT_AUTHOR_NAME: 't',
    GIT_AUTHOR_EMAIL: 't@t',
    GIT_COMMITTER_NAME: 't',
    GIT_COMMITTER_EMAIL: 't@t',
  }
}

function runScript(script: string, args: readonly string[], stdin: string, cwd = scratch): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [join(BIN, script), ...args], { cwd, env: sandboxEnv() })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf8')))
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')))
    child.on('error', reject)
    child.on('close', (code) => resolve({ code, stdout, stderr }))
    child.stdin.end(stdin)
  })
}

/** The real harness/bin/profile in the sandbox. */
const realProfile: ProfileRunner = (cwd, args) => runScript('profile', args, '', cwd)

const installed: HarnessStatus = { state: { kind: 'installed', version: '0.4.0', enabled: true }, bundledVersion: '0.4.0', canInstall: true, pluginDir: '/x/plugin' }

interface Harnessed {
  connector: ProjectConnector
  requests: DraftRequest[]
  calls: FakeCall[]
  added: string[]
  activity: string[]
}

/** A connector over the sandbox; `overrides` replace any of its parts. */
function connectorWith(overrides: Partial<ConnectDeps> & { script?: string; scriptsDir?: string } = {}): Harnessed {
  const requests: DraftRequest[] = []
  const calls: FakeCall[] = []
  const added: string[] = []
  const fake = fakeQueryFactory({ scriptsDir: overrides.scriptsDir ?? SCRIPTS, script: overrides.script ?? 'profile-draft', record: (call) => calls.push(call), releases: undefined })
  const store = new ProjectStore(join(scratch, 'data'))
  const deps: ConnectDeps = {
    git: runGit,
    profile: realProfile,
    connect: (args, stdin) => runScript('project-connect', args, stdin),
    harness: () => Promise.resolve(installed),
    query: (request) => {
      requests.push(request)
      return fake(request)
    },
    draftSchema: () => SCHEMA,
    reportsLanguage: () => 'ru',
    add: async (root): Promise<AddOutcome> => {
      added.push(root)
      const result = await store.add(root)
      return result.status === 'added' ? { status: 'added', projectId: result.project.id, notice: result.notice } : result
    },
    log: () => undefined,
    ...overrides,
  }
  return { connector: new ProjectConnector(deps), requests, calls, added, activity: [] }
}

/** Every file of the Harness home with its contents: equal before and after means nothing was written. */
function harnessFiles(): Record<string, string> {
  const files: Record<string, string> = {}
  const walk = (dir: string, prefix: string): void => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const rel = prefix + entry.name
      if (entry.isDirectory()) walk(join(dir, entry.name), `${rel}/`)
      else files[rel] = readFileSync(join(dir, entry.name), 'utf8')
    }
  }
  walk(harnessHome, '')
  return files
}

const clean = (repo: string): string => git(repo, 'status', '--porcelain', '--ignored', '--untracked-files=all')

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-connect-')))
  home = join(scratch, 'home')
  harnessHome = join(home, '.claude', 'worfy-harness')
  mkdirSync(join(harnessHome, 'gate'), { recursive: true })
  writeFileSync(join(harnessHome, 'gate', 'config.json'), '{"repos":[]}\n')
})

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true })
})

describe('the kind of the folder (step 1)', () => {
  it('a folder above two repositories that is not in git itself is multi-repo, with both repositories', async () => {
    const workspace = join(scratch, 'atakama')
    const server = makeRepo(join(workspace, 'server'))
    const extension = makeRepo(join(workspace, 'extension'))
    mkdirSync(join(workspace, 'notes'))

    const result = await inspectFolder(workspace, runGit)

    expect(result).toEqual({
      ok: true,
      folder: {
        kind: 'multi-repo',
        root: realpathSync(workspace),
        repos: [
          { name: 'extension', path: extension },
          { name: 'server', path: server },
        ],
        notice: null,
      },
    })
  })

  it('a git repository is git; a subfolder and a linked worktree resolve to its root and say so', async () => {
    const repo = makeRepo(join(scratch, 'shop'))
    mkdirSync(join(repo, 'src'))
    expect(await inspectFolder(repo, runGit)).toEqual({ ok: true, folder: { kind: 'git', root: repo, repos: [{ name: 'shop', path: repo }], notice: null } })

    const sub = await inspectFolder(join(repo, 'src'), runGit)
    expect(sub.ok && sub.folder.root).toBe(repo)
    expect(sub.ok && sub.folder.notice).toMatch(/is inside the repository .*the repository root is connected instead/)

    const worktree = join(scratch, 'shop-wt')
    git(repo, 'worktree', 'add', '-q', '-b', 'feature', worktree)
    const linked = await inspectFolder(worktree, runGit)
    expect(linked.ok && linked.folder).toMatchObject({ kind: 'git', root: repo })
    expect(linked.ok && linked.folder.notice).toMatch(/is a worktree of .*the repository root is connected instead/)
  })

  it('a folder without repositories, or with only one, is refused with the reason', async () => {
    const plain = join(scratch, 'plain')
    mkdirSync(join(plain, 'docs'), { recursive: true })
    expect(await inspectFolder(plain, runGit)).toEqual({
      ok: false,
      reason: `${plain} is not a git repository and holds no repositories. Choose the folder of a git repository, or the folder above the repositories of one project.`,
    })
    const one = makeRepo(join(plain, 'only'))
    const single = await inspectFolder(plain, runGit)
    expect(single).toEqual({ ok: false, reason: `${plain} is not a git repository and holds only one: choose the repository ${one} itself.` })
    expect(await inspectFolder(join(scratch, 'missing'), runGit)).toEqual({ ok: false, reason: `${join(scratch, 'missing')} does not exist.` })
  })
})

describe('a folder the Harness already knows', () => {
  it('bin/profile -C exits 0: the folder is known, and no draft Session starts', async () => {
    const repo = makeRepo(join(scratch, 'shop'))
    // A bin/profile that knows every folder.
    const knowsAll: ProfileRunner = () => Promise.resolve({ code: 0, stdout: '{"name":"shop","_resolved":{"workspace":null}}', stderr: '' })
    const { connector, requests } = connectorWith({ profile: knowsAll })
    expect(await connector.inspect(repo)).toEqual({ status: 'known', folder: { kind: 'git', root: repo, repos: [{ name: 'shop', path: repo }], notice: null } })
    expect(requests).toHaveLength(0)

    // Unknown (exit 3): a new folder for the dialog.
    const unknown = connectorWith({ profile: () => Promise.resolve({ code: 3, stdout: '', stderr: 'not registered' }) })
    expect((await unknown.connector.inspect(repo)).status).toBe('new')
  })

  it('a multi-repo folder is known only with _resolved.workspace', async () => {
    const workspace = join(scratch, 'ws')
    makeRepo(join(workspace, 'api'))
    makeRepo(join(workspace, 'web'))
    const answer = (workspace: string | null): ProfileRunner => () => Promise.resolve({ code: 0, stdout: JSON.stringify({ _resolved: { workspace } }), stderr: '' })
    expect((await connectorWith({ profile: answer(null) }).connector.inspect(workspace)).status).toBe('new')
    expect((await connectorWith({ profile: answer(workspace) }).connector.inspect(workspace)).status).toBe('known')
  })
})

describe('the Harness check (step 3)', () => {
  it.each([
    [{ kind: 'not-installed' as const }, 'The Harness plugin is not installed. Install it on the first-run screen.'],
    [{ kind: 'outdated' as const, from: '0.3.0', to: '0.4.0' }, 'The Harness plugin is 0.3.0, and worfy carries 0.4.0. Update it on the first-run screen.'],
    [{ kind: 'installed' as const, version: '0.4.0', enabled: false }, 'The Harness plugin 0.4.0 is installed but disabled. Enable it on the first-run screen.'],
  ])('%o: no draft Session, the answer names the reason', async (state, reason) => {
    const repo = makeRepo(join(scratch, 'shop'))
    const { connector, requests } = connectorWith({ harness: () => Promise.resolve({ ...installed, state }) })
    expect(await connector.draft({ draftId: 'd1', root: repo, mode: 'silent', workflowFolder: null }, () => undefined)).toEqual({ status: 'harness', reason })
    expect(requests).toHaveLength(0)
  })
})

describe('the draft Session (step 4)', () => {
  it('runs in the folder with the draft schema, without Write/Edit/NotebookEdit, and its first message is the skill', async () => {
    const repo = makeRepo(join(scratch, 'shop'))
    const run = connectorWith()
    const activity: string[] = []
    const before = harnessFiles()

    const outcome = await run.connector.draft({ draftId: 'd1', root: repo, mode: 'silent', workflowFolder: null }, (text) => activity.push(text))

    expect(run.requests).toHaveLength(1)
    const request = run.requests[0]
    expect(request?.cwd).toBe(repo)
    expect(request?.outputFormat).toEqual({ type: 'json_schema', schema: SCHEMA })
    expect(request?.disallowedTools).toEqual(expect.arrayContaining(['Write', 'Edit', 'NotebookEdit']))
    expect(request?.settings.permissionMode).toBe('default')
    expect(run.calls.filter((call) => call.kind === 'message').map((call) => (call as { text: string }).text)).toEqual([`/worfy:connect-project ${repo} silent --draft-only`])
    expect(activity).toEqual(['Claude Code started', `Read ${repo}/package.json`, 'Bash git remote -v', 'The draft is ready'])

    // The form gets the draft, with what worfy owns set over it.
    expect(outcome.status).toBe('draft')
    if (outcome.status !== 'draft') return
    const profile = outcome.draft.profile as Record<string, Record<string, unknown>>
    expect(profile.mode).toBe('silent')
    expect(profile.workflow?.folder).toBeNull()
    expect(profile.worktree?.root).toBe(`${repo}/.claude/worktrees/`)
    expect(profile.language).toEqual({ reports: 'ru', team: 'en', docs: 'en' })
    expect(profile.github).toEqual({ account: null })
    expect(outcome.draft.gate).toEqual([expect.objectContaining({ key: 'fake-project', match: repo, profile: 'fake-project' })])
    expect(outcome.issues).toEqual([])
    // Nothing was written: not in the Harness home, not in the repository.
    expect(harnessFiles()).toEqual(before)
    expect(clean(repo)).toBe('')
  })

  it('a draft off the schema is an error with its reasons, and nothing is written', async () => {
    const repo = makeRepo(join(scratch, 'shop'))
    const scripts = join(scratch, 'scripts')
    mkdirSync(scripts)
    const lines = readFileSync(join(SCRIPTS, 'profile-draft.jsonl'), 'utf8').trim().split('\n')
    const result = JSON.parse(lines.at(-1) ?? '{}') as { structured_output: { profile: Record<string, unknown>; extra?: number } }
    delete result.structured_output.profile.commands
    result.structured_output.extra = 1
    writeFileSync(join(scripts, 'broken.jsonl'), [...lines.slice(0, -1), JSON.stringify(result)].join('\n'))
    const before = harnessFiles()

    const outcome = await connectorWith({ scriptsDir: scripts, script: 'broken' }).connector.draft({ draftId: 'd1', root: repo, mode: 'silent', workflowFolder: null }, () => undefined)

    expect(outcome.status).toBe('failed')
    if (outcome.status !== 'failed') return
    expect(outcome.reason).toMatch(/^The draft does not match the schema: /)
    expect(outcome.issues.map((issue) => issue.path)).toEqual(expect.arrayContaining(['profile.commands', 'extra']))
    expect(harnessFiles()).toEqual(before)
  })

  it('Stop ends the draft Session', async () => {
    const repo = makeRepo(join(scratch, 'shop'))
    const scripts = join(scratch, 'scripts')
    mkdirSync(scripts)
    const lines = readFileSync(join(SCRIPTS, 'profile-draft.jsonl'), 'utf8').trim().split('\n')
    writeFileSync(join(scripts, 'slow.jsonl'), [...lines.slice(0, 2), '{"fake":"wait_release","name":"never"}', ...lines.slice(2)].join('\n'))
    const { connector } = connectorWith({ scriptsDir: scripts, script: 'slow' })
    let started: () => void = () => undefined
    const startedNow = new Promise<void>((resolve) => (started = resolve))
    const outcome = connector.draft({ draftId: 'd1', root: repo, mode: 'silent', workflowFolder: null }, () => started())
    await startedNow
    expect(connector.stop('d1')).toBe(true)
    expect(await outcome).toEqual({ status: 'stopped' })
    expect(connector.stop('d1')).toBe(false)
  })

  it('refuses the tools that write, and Bash that does not only read', async () => {
    const signal = new AbortController().signal
    for (const tool of ['Write', 'Edit', 'NotebookEdit', 'MultiEdit']) {
      expect((await draftCanUseTool(tool, { file_path: '/x' }, { signal })).behavior).toBe('deny')
    }
    expect((await draftCanUseTool('Read', { file_path: '/x' }, { signal })).behavior).toBe('allow')
    expect((await draftCanUseTool('Bash', { command: 'git remote -v' }, { signal })).behavior).toBe('allow')
    expect((await draftCanUseTool('Bash', { command: 'npm install' }, { signal })).behavior).toBe('deny')
    for (const command of ['git -C /x remote -v', 'cat package.json | jq .scripts', 'ls -la && git branch --show-current', 'git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null', 'find . -name "*.yml"', 'git config --get remote.origin.url']) {
      expect(readOnlyCommand(command), command).toBe(true)
    }
    for (const command of ['echo x > a', 'git commit -m x', 'git branch new', 'git tag v1', 'git config user.name x', 'find . -delete', 'sort -o out in', 'cat $(which x)', 'rm -rf x', 'ls; touch y', 'git diff --output=x', 'git remote add o u']) {
      expect(readOnlyCommand(command), command).toBe(false)
    }
    // A single `&` ends a command; readers that write or run a program; git told to run one.
    for (const command of [
      'ls & touch x',
      'ls &touch x',
      'uniq in out',
      'file -C -m magic',
      'rg --pre=rm x .',
      'rg --pre rm x .',
      'rg --pre-glob "*" --pre=sh x',
      'sort --compress-program=sh in',
      'git -c diff.external=rm diff',
      'git -C /x -c core.pager=sh log',
      'git --config-env=core.pager=X log',
      'git --exec-path=/tmp/x status',
      'toString',
      'constructor x',
    ]) {
      expect(readOnlyCommand(command), command).toBe(false)
    }
    expect(readOnlyCommand('rg -n lint package.json'), 'rg without --pre').toBe(true)
    expect(readOnlyCommand('ls 2>&1 | head'), '2>&1 is no background &').toBe(true)
  })

  it('reads only the user\'s settings and asks the policy tier to ignore every allow rule outside it', () => {
    const options = draftSessionOptions({
      cwd: '/repos/shop',
      env: {},
      runtime: { packaged: false, resourcesPath: '/r', platform: 'darwin', arch: 'arm64' },
      settings: { model: null, effort: null, permissionMode: 'default' },
      canUseTool: draftCanUseTool,
      outputFormat: { type: 'json_schema', schema: SCHEMA },
      disallowedTools: ['Write', 'Edit', 'NotebookEdit'],
      harnessPlugin: null,
    })
    // Not 'project' or 'local': allow rules in the repository's .claude/settings*.json would let a tool past canUseTool.
    expect(options.settingSources).toEqual(['user'])
    expect(options.managedSettings).toEqual({ allowManagedPermissionRulesOnly: true })
    expect(options.disallowedTools).toEqual(['Write', 'Edit', 'NotebookEdit'])
    expect(options.outputFormat).toEqual({ type: 'json_schema', schema: SCHEMA })
    expect(options.permissionMode).toBe('default')
    expect(options.canUseTool).toBe(draftCanUseTool)
    expect(options.mcpServers).toBeUndefined()
    // An ordinary Session keeps all three sources and no such policy.
    const ordinary = sessionOptions({ cwd: '/repos/shop', env: {}, runtime: { packaged: false, resourcesPath: '/r', platform: 'darwin', arch: 'arm64' } })
    expect(ordinary.settingSources).toEqual(['user', 'project', 'local'])
    expect(ordinary.managedSettings).toBeUndefined()
  })

  it('the activity names the last tool and its target', () => {
    expect(activityOf({ type: 'assistant', message: { content: [{ type: 'text', text: 'x' }, { type: 'tool_use', name: 'Grep', input: { pattern: 'lint' } }] } })).toBe('Grep lint')
    expect(activityOf({ type: 'assistant', message: { content: [{ type: 'text', text: 'x' }] } })).toBeNull()
    expect(activityOf({ type: 'user' })).toBeNull()
  })
})

describe('the form and the write (steps 5 and 6)', () => {
  /** The draft of the fake agent for `repo`, as the form gets it. */
  async function draftFor(run: Harnessed, repo: string, mode: 'full' | 'silent' = 'silent', workflowFolder: string | null = null): Promise<ProfileDraft> {
    const outcome = await run.connector.draft({ draftId: `d-${repo}`, root: repo, mode, workflowFolder }, () => undefined)
    if (outcome.status !== 'draft') throw new Error(`no draft: ${JSON.stringify(outcome)}`)
    return outcome.draft
  }

  it('the check names a taken name under its field; Connect writes, bin/profile finds it, the Project is in the list', async () => {
    const repo = makeRepo(join(scratch, 'shop'))
    mkdirSync(join(harnessHome, 'projects', 'fake-project'), { recursive: true })
    const run = connectorWith()
    const draft = await draftFor(run, repo)
    expect(await run.connector.check(draft)).toEqual([{ path: 'profile.name', kind: 'conflict', message: `the name is taken: ${join(harnessHome, 'projects', 'fake-project')} exists` }])
    expect(await run.connector.write(repo, draft)).toEqual({ status: 'refused', issues: [expect.objectContaining({ path: 'profile.name', kind: 'conflict' })] })
    expect(run.added).toEqual([])

    // The person renames it in the form.
    const renamed: ProfileDraft = { ...draft, profile: { ...draft.profile, name: 'shop' }, gate: draft.gate.map((entry) => ({ ...entry, key: 'shop', profile: 'shop' })) }
    expect(await run.connector.check(renamed)).toEqual([])
    const written = await run.connector.write(repo, renamed)
    expect(written).toMatchObject({ status: 'added', notice: 'qmd collections were not set up: qmd is not installed.' })
    expect(run.added).toEqual([repo])
    expect((await realProfile(repo, ['-C', repo, '--field', 'mode'])).stdout.trim()).toBe('silent')
    expect((await realProfile(repo, ['-C', repo, '--field', 'workflow.folder'])).stdout.trim()).toBe(join(harnessHome, 'projects', 'shop', 'workflow'))
    const store = new ProjectStore(join(scratch, 'data'))
    expect(store.active()).toMatchObject({ path: repo, name: 'shop' })
    // A second connection of the same repository: its match is in the registry now.
    expect(await run.connector.check({ ...renamed, profile: { ...renamed.profile, name: 'shop2' }, gate: renamed.gate.map((entry) => ({ ...entry, key: 'shop2', profile: 'shop2' })) })).toEqual([
      expect.objectContaining({ path: 'gate[0].match', kind: 'conflict' }),
    ])
    expect(clean(repo)).toBe('')
  })

  it('a folder above two repositories: Silent only, the folder itself is the Workflow folder, Full is refused', async () => {
    const workspace = realpathSync(mkdirSync(join(scratch, 'ws'), { recursive: true }) ?? join(scratch, 'ws'))
    const api = makeRepo(join(workspace, 'api'))
    const web = makeRepo(join(workspace, 'web'))
    // The list takes the folder as ticket 23 makes ProjectStore take it: a stand-in records it.
    const listed: string[] = []
    const run = connectorWith({ add: (root) => (listed.push(root), Promise.resolve({ status: 'added', projectId: 'ws-1', notice: null })) })

    expect(await run.connector.draft({ draftId: 'full', root: workspace, mode: 'full', workflowFolder: null }, () => undefined)).toEqual({ status: 'refused', reason: MULTI_REPO_FULL })
    expect(run.requests).toHaveLength(0)

    const draft = await draftFor(run, workspace)
    const profile = draft.profile as Record<string, Record<string, unknown>>
    expect(profile.mode).toBe('silent')
    expect(profile.workflow?.folder).toBe(workspace)
    expect(profile.worktree?.root).toBeNull()
    // The skill proposes one entry per repository; the fake agent proposed one for the folder.
    const both: ProfileDraft = { ...draft, profile: { ...draft.profile, name: 'ws' }, gate: [api, web].map((match) => ({ ...draft.gate[0], key: match.split('/').at(-1), match, profile: 'ws' })) }
    expect(await run.connector.write(workspace, { ...both, profile: { ...both.profile, mode: 'full' } })).toEqual({ status: 'refused', issues: [{ path: 'profile.mode', kind: 'value', message: MULTI_REPO_FULL }] })
    expect(listed).toEqual([])

    expect(await run.connector.write(workspace, both)).toEqual({ status: 'added', projectId: 'ws-1', notice: 'qmd collections were not set up: qmd is not installed.' })
    expect(listed).toEqual([workspace])
    expect((await realProfile(workspace, ['-C', workspace, '--field', '_resolved.workspace'])).stdout.trim()).toBe(workspace)
    expect((await realProfile(api, ['-C', api, '--field', 'mode'])).stdout.trim()).toBe('silent')
    expect(clean(api)).toBe('')
    expect(clean(web)).toBe('')
  })
})
