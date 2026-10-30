// Creating the Demo project of Getting started with one call (worfy-onboarding ticket 05):
// `gettingStarted.createDemo` over the real git, the real harness/bin/project-connect and
// harness/bin/profile in a temporary Harness home, the real Project list, Layout store and
// Session settings, and the Orchestrators on the fake agent. The home folder and the temporary
// folder are handed to the code as parameters, not through the environment: the test itself lives
// in the temporary folder of the system. Nothing here starts a real agent or writes to ~/.claude.
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { IpcMainInvokeEvent } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeQueryFactory } from '../../src/main/agent/fake-query'
import { Orchestrators } from '../../src/main/agent/orchestrator'
import { SessionRegistry, type QueryRequest } from '../../src/main/agent/session'
import { SESSION_SETTINGS_FILE, SessionSettingsStore } from '../../src/main/agent/session-settings'
import { GIT_IDENTITY_COMMANDS } from '../../src/main/first-run/checks'
import { DEMO_PROFILE, DemoCreator, demoGit, gateRegistryRepos, type DemoDeps } from '../../src/main/getting-started/demo'
import { demoTemplate } from '../../src/main/getting-started/demo-template'
import { GETTING_STARTED_FILE, GettingStartedState } from '../../src/main/getting-started/state'
import { LayoutStore } from '../../src/main/layout/store'
import { connectScriptRunner, type ConnectScript } from '../../src/main/projects/connect'
import { ProjectStore, runGit } from '../../src/main/projects/store'
import { IPC_CHANNEL_PREFIX, type IpcResult } from '../../src/shared/ipc/channels'
import type { CreateDemoResult } from '../../src/shared/ipc/getting-started'
import { APP_URL } from '../app-url'
import { removeTestTree } from '../remove'
import { scriptNode } from '../script-node'

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => '/nowhere', on: () => undefined },
  BrowserWindow: { getAllWindows: () => [] },
}))

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const BIN = join(REPO, 'harness', 'bin')
const AGENT_SCRIPTS = join(REPO, 'test', 'fixtures', 'agent-scripts')

let scratch: string
let home: string
let temp: string
let harnessHome: string
let data: string
let gitConfig: string
let registries: SessionRegistry[] = []

beforeEach(() => {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-gs-demo-')))
  home = join(scratch, 'home')
  temp = join(scratch, 'tmp')
  harnessHome = join(scratch, 'harness')
  data = join(scratch, 'data')
  gitConfig = join(scratch, 'gitconfig')
  for (const dir of [home, temp, data]) mkdirSync(dir, { recursive: true })
  writeFileSync(gitConfig, '[user]\n\tname = Demo Tester\n\temail = demo@example.com\n')
})

afterEach(() => {
  for (const registry of registries) registry.closeAll()
  registries = []
  removeTestTree(scratch)
})

/**
 * The environment of git and of the Harness scripts in the test: no GIT_* or gate variable of the
 * run, the test's own home, Harness home and git config, and the node the tests start scripts with
 * first on PATH.
 */
function scriptEnvironment(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('GIT_') || key === 'CLAUDE_GATE_CONFIG' || key === 'HARNESS_HOME' || key === 'ELECTRON_RUN_AS_NODE') continue
    env[key] = value
  }
  return {
    ...env,
    HOME: home,
    USERPROFILE: home,
    HARNESS_HOME: harnessHome,
    GIT_CONFIG_GLOBAL: gitConfig,
    GIT_CONFIG_NOSYSTEM: '1',
    PATH: `${dirname(scriptNode())}${delimiter}${process.env.PATH ?? ''}`,
  }
}

/** The real bin/project-connect of this repository, as the app starts it (connectScriptRunner). */
function realConnect(): ConnectScript {
  return connectScriptRunner({
    harness: () => ({ kind: 'plugin', binDir: BIN, gateDir: join(harnessHome, 'gate'), harnessHome, checked: [join(home, '.claude', 'bin', 'epic-status'), join(BIN, 'epic-status')] }),
    env: () => Promise.resolve(scriptEnvironment()),
  })
}

function run(file: string, args: readonly string[], cwd?: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((done) => {
    execFile(file, args, { cwd, env: scriptEnvironment() as NodeJS.ProcessEnv, encoding: 'utf8' }, (error, stdout, stderr) => {
      done({ code: error ? (typeof error.code === 'number' ? error.code : 1) : 0, stdout: stdout.trim(), stderr: stderr.trim() })
    })
  })
}

/** `bin/profile -C <folder> --name` of the temporary Harness home. */
const profileName = (folder: string) => run(scriptNode(), [join(BIN, 'profile'), '-C', folder, '--name'])

interface Options {
  /** Wraps the real bin/project-connect, e.g. to make one call fail. */
  connect?: (real: ConnectScript) => ConnectScript
  /** The home folder handed to the code; the test's own by default. */
  home?: string
  /** Wraps the opening of the Orchestrator, e.g. to make it fail. */
  open?: (real: DemoDeps['openOrchestrator']) => DemoDeps['openOrchestrator']
}

/** One start of the app over the test's folders: the stores, the Orchestrators, the creator and its channel. */
async function app(options: Options = {}) {
  const projects = new ProjectStore(data, runGit, () => Promise.resolve(null))
  const layout = new LayoutStore((projectId) => projects.dataDir(projects.get(projectId).id), { delayMs: 0 })
  const settings = new SessionSettingsStore((projectId) => projects.dataDir(projects.get(projectId).id))
  const requests: QueryRequest[] = []
  const fake = fakeQueryFactory({ scriptsDir: AGENT_SCRIPTS, script: 'orchestrator' })
  const registry = new SessionRegistry((request) => {
    requests.push(request)
    return fake(request)
  })
  registries.push(registry)
  const orchestrators = new Orchestrators({
    layout,
    projectPath: (projectId) => projects.get(projectId).path,
    registry,
    settings,
    transcript: () => Promise.resolve(null),
    broadcast: () => undefined,
    publish: () => undefined,
  })
  // As the app does (startOrchestrators, src/main/agent/app-orchestrators.ts): the Project that
  // becomes active gets its Orchestrator opened, one that leaves the list loses it.
  projects.onChange(({ activeId, previousActiveId }) => {
    if (activeId !== null && activeId !== previousActiveId) orchestrators.open(activeId).catch(() => undefined)
    orchestrators.retain(new Set(projects.list().map((project) => project.id)))
  })
  const connectCalls: string[][] = []
  const real = realConnect()
  const recorded: ConnectScript = (args, stdin) => {
    connectCalls.push([...args])
    return real(args, stdin)
  }
  const realOpen: DemoDeps['openOrchestrator'] = (projectId, firstSettings) => orchestrators.open(projectId, { firstSettings })
  const progress: string[] = []
  const state = new GettingStartedState(data)
  const creator = new DemoCreator(() => ({
    home: options.home ?? home,
    tmpdir: temp,
    git: demoGit(scriptEnvironment()),
    connect: options.connect ? options.connect(recorded) : recorded,
    projects,
    openOrchestrator: options.open ? options.open(realOpen) : realOpen,
    state,
    registeredRepos: gateRegistryRepos(() => join(harnessHome, 'gate')),
    progress: (step) => progress.push(step),
  }))

  const { gettingStartedHandlers } = await import('../../src/main/ipc/getting-started')
  const { registerIpc } = await import('../../src/main/ipc/index')
  const handlers = new Map<string, (event: IpcMainInvokeEvent, input: unknown) => unknown>()
  await registerIpc(
    { handle: (name, listener) => handlers.set(name, listener) },
    { modules: { './getting-started.ts': () => Promise.resolve(gettingStartedHandlers(() => creator.create())) }, isTrustedSender: (url) => url === APP_URL },
  )
  const createDemo = async (): Promise<CreateDemoResult> => {
    const listener = handlers.get(`${IPC_CHANNEL_PREFIX}gettingStarted.createDemo`)
    if (!listener) throw new Error('gettingStarted.createDemo is not registered')
    const result = (await listener({ senderFrame: { url: APP_URL } } as unknown as IpcMainInvokeEvent, undefined)) as IpcResult<CreateDemoResult>
    if (!result.ok) throw new Error(result.error)
    return result.value
  }
  const projectsFile = () => JSON.parse(readFileSync(join(data, 'projects.json'), 'utf8')) as { projects: { id: string; path: string; localOnly?: boolean }[]; activeId: string | null }
  return { projects, layout, requests, createDemo, connectCalls, progress, state, projectsFile }
}

const CHEAPER = { model: 'sonnet', effort: 'medium', permissionMode: 'bypassPermissions' }
const profileDir = () => join(harnessHome, 'projects', DEMO_PROFILE)

describe('gettingStarted.createDemo', () => {
  it('creates the repository from the template, connects it, lists it local-only and active, and opens a cheaper Orchestrator', async () => {
    const { createDemo, projectsFile, layout, requests, connectCalls, progress, state } = await app()
    const result = await createDemo()

    const folder = join(home, 'worfy-demo')
    expect(result).toEqual({ ok: true, projectId: expect.any(String) as string, path: folder })
    if (!result.ok) return

    // The template's files, one commit by the author git knows, nothing left uncommitted.
    for (const [file, text] of Object.entries(demoTemplate({ root: folder, profileName: DEMO_PROFILE }).files)) {
      expect(readFileSync(join(folder, ...file.split('/')), 'utf8')).toBe(text)
    }
    expect((await run('git', ['-C', folder, 'rev-list', '--count', 'HEAD'])).stdout).toBe('1')
    expect((await run('git', ['-C', folder, 'log', '-1', '--format=%an <%ae>|%s'])).stdout).toBe('Demo Tester <demo@example.com>|Demo project')
    expect((await run('git', ['-C', folder, 'branch', '--show-current'])).stdout).toBe('main')
    expect((await run('git', ['-C', folder, 'status', '--porcelain'])).stdout).toBe('')

    // The Harness knows it, and qmd was not set up.
    expect(await profileName(folder)).toMatchObject({ code: 0, stdout: DEMO_PROFILE })
    expect(connectCalls).toEqual([['--no-qmd']])

    // In the list, only for this Machine, and active.
    const listed = projectsFile()
    expect(listed.projects).toEqual([expect.objectContaining({ id: result.projectId, path: folder, localOnly: true })])
    expect(listed.activeId).toBe(result.projectId)

    // The Orchestrator Node exists and its Session started on Sonnet with effort medium, no message sent.
    const node = layout.get(result.projectId).layout.nodes.find((each) => each.kind === 'orchestrator')
    expect(node).toBeDefined()
    const saved = JSON.parse(readFileSync(join(data, result.projectId, SESSION_SETTINGS_FILE), 'utf8')) as { nodes: Record<string, unknown> }
    expect(saved.nodes[node?.id ?? '']).toEqual(CHEAPER)
    expect(requests).toHaveLength(1)
    expect(requests[0]?.settings).toEqual(CHEAPER)

    // The record, in worfy's own data folder.
    expect(state.demo()).toEqual({ projectId: result.projectId, path: folder, profile: DEMO_PROFILE, cost: 'cheaper' })
    expect(existsSync(join(data, GETTING_STARTED_FILE))).toBe(true)
    expect(progress.length).toBeGreaterThan(0)
  })

  it('takes worfy-demo-2 when worfy-demo is someone else’s folder, and leaves that one alone', async () => {
    const theirs = join(home, 'worfy-demo')
    mkdirSync(theirs)
    writeFileSync(join(theirs, 'notes.txt'), 'mine\n')
    const { createDemo } = await app()

    const result = await createDemo()

    expect(result).toMatchObject({ ok: true, path: join(home, 'worfy-demo-2') })
    expect(readFileSync(join(theirs, 'notes.txt'), 'utf8')).toBe('mine\n')
    expect(existsSync(join(theirs, '.git'))).toBe(false)
    expect(await profileName(join(home, 'worfy-demo-2'))).toMatchObject({ code: 0, stdout: DEMO_PROFILE })
  })

  it('takes worfy-demo-2 when a file is named worfy-demo, and leaves the file alone', async () => {
    writeFileSync(join(home, 'worfy-demo'), 'not a folder\n')
    const { createDemo } = await app()

    const result = await createDemo()

    expect(result).toMatchObject({ ok: true, path: join(home, 'worfy-demo-2') })
    expect(readFileSync(join(home, 'worfy-demo'), 'utf8')).toBe('not a folder\n')
  })

  it('refuses a home folder inside the temporary folder and writes nothing', async () => {
    const tempHome = join(temp, 'Users', 'someone')
    mkdirSync(tempHome, { recursive: true })
    const { createDemo, connectCalls } = await app({ home: tempHome })

    const result = await createDemo()

    expect(result.ok).toBe(false)
    expect(!result.ok && result.reason).toMatch(/temporary folder/)
    expect(existsSync(join(tempHome, 'worfy-demo'))).toBe(false)
    expect(connectCalls).toEqual([])
    expect(existsSync(join(data, 'projects.json'))).toBe(false)
    expect(existsSync(join(data, GETTING_STARTED_FILE))).toBe(false)
  })

  it('rolls back when project-connect fails: no folder, no Profile, nothing in the list; the reason in the answer', async () => {
    const failing = (real: ConnectScript): ConnectScript => (args, stdin) =>
      args[0] === '--remove'
        ? real(args, stdin)
        : Promise.resolve({ code: 1, stdout: JSON.stringify({ ok: false, errors: [{ path: '', kind: 'write', message: 'the disk is full' }] }), stderr: 'the disk is full' })
    writeFileSync(join(home, 'keep.txt'), 'mine\n')
    const { createDemo, projectsFile } = await app({ connect: failing })

    const result = await createDemo()

    expect(result.ok).toBe(false)
    expect(!result.ok && result.reason).toMatch(/the disk is full/)
    expect(existsSync(join(home, 'worfy-demo'))).toBe(false)
    // Only the folder this call made goes: the home folder and what else is in it stay.
    expect(readFileSync(join(home, 'keep.txt'), 'utf8')).toBe('mine\n')
    expect(existsSync(profileDir())).toBe(false)
    expect(existsSync(join(data, 'projects.json')) ? projectsFile().projects : []).toEqual([])
    expect(existsSync(join(data, GETTING_STARTED_FILE))).toBe(false)
  })

  it('rolls back what it did when the Orchestrator does not open: the Profile removed, the Project out of the list, no folder', async () => {
    writeFileSync(join(home, 'keep.txt'), 'mine\n')
    const { createDemo, projectsFile, connectCalls } = await app({ open: () => () => Promise.reject(new Error('no Session today')) })

    const result = await createDemo()

    expect(result.ok).toBe(false)
    expect(!result.ok && result.reason).toMatch(/no Session today/)
    expect(connectCalls).toEqual([['--no-qmd'], ['--remove', DEMO_PROFILE, '--no-qmd']])
    expect(existsSync(profileDir())).toBe(false)
    expect(projectsFile().projects).toEqual([])
    expect(existsSync(join(home, 'worfy-demo'))).toBe(false)
    expect(readFileSync(join(home, 'keep.txt'), 'utf8')).toBe('mine\n')
  })

  it('asks for an update of the Harness when project-connect does not know --no-qmd, and leaves nothing', async () => {
    const old = (): ConnectScript => () => Promise.resolve({ code: 2, stdout: '', stderr: 'usage: project-connect [--check | --schema-only] < draft.json' })
    const { createDemo } = await app({ connect: old })

    const result = await createDemo()

    expect(result.ok).toBe(false)
    expect(!result.ok && result.reason).toMatch(/^Update the Harness first: /)
    expect(existsSync(join(home, 'worfy-demo'))).toBe(false)
  })

  it('refuses when the name worfy-demo belongs to a Profile worfy did not create, and leaves that Profile as it is', async () => {
    const elsewhere = join(scratch, 'other-repo')
    mkdirSync(elsewhere)
    await run('git', ['init', '-q', elsewhere])
    const foreign = demoTemplate({ root: elsewhere, profileName: DEMO_PROFILE }).draft
    expect((await realConnect()(['--no-qmd'], JSON.stringify(foreign))).code).toBe(0)
    const before = readFileSync(join(profileDir(), 'profile.json'), 'utf8')
    const { createDemo, projectsFile } = await app()

    const result = await createDemo()

    expect(result.ok).toBe(false)
    expect(!result.ok && result.reason).toMatch(/worfy-demo/)
    expect(readFileSync(join(profileDir(), 'profile.json'), 'utf8')).toBe(before)
    expect(existsSync(join(home, 'worfy-demo'))).toBe(false)
    expect(existsSync(join(data, 'projects.json')) ? projectsFile().projects : []).toEqual([])
  })

  it('refuses without a git commit author, naming the command that sets it, and creates no folder', async () => {
    writeFileSync(gitConfig, '')
    const { createDemo } = await app()

    const result = await createDemo()

    expect(result.ok).toBe(false)
    expect(!result.ok && result.reason).toContain(GIT_IDENTITY_COMMANDS)
    expect(existsSync(join(home, 'worfy-demo'))).toBe(false)
  })

  it('answers with the demo that is there on a second call, and two calls at once get one demo', async () => {
    const { createDemo, connectCalls } = await app()

    const [first, same] = await Promise.all([createDemo(), createDemo()])
    const again = await createDemo()

    expect(first.ok).toBe(true)
    expect(same).toEqual(first)
    expect(again).toEqual(first)
    expect(existsSync(join(home, 'worfy-demo-2'))).toBe(false)
    expect(connectCalls).toEqual([['--no-qmd']])
  })

  it('creates the demo again after its folder was deleted by hand, replacing its own old Profile', async () => {
    const first = await (await app()).createDemo()
    expect(first.ok).toBe(true)
    if (!first.ok) return
    removeTestTree(first.path)

    const { createDemo, connectCalls, state, projectsFile } = await app()
    const second = await createDemo()

    expect(second).toEqual({ ok: true, projectId: first.projectId, path: first.path })
    expect(connectCalls).toEqual([['--remove', DEMO_PROFILE, '--no-qmd'], ['--no-qmd']])
    expect(await profileName(first.path)).toMatchObject({ code: 0, stdout: DEMO_PROFILE })
    expect(projectsFile().projects).toHaveLength(1)
    expect(state.demo()?.path).toBe(first.path)
  })

  it('leaves a worfy-demo Profile over another repository alone when the demo folder was deleted, and refuses on the name', async () => {
    const first = await (await app()).createDemo()
    expect(first.ok).toBe(true)
    if (!first.ok) return
    // The user deletes the demo, removes its Profile, and connects a repository of their own under the same name.
    removeTestTree(first.path)
    expect((await realConnect()(['--remove', DEMO_PROFILE, '--no-qmd'], '')).code).toBe(0)
    const theirs = join(scratch, 'their-repo')
    mkdirSync(theirs)
    await run('git', ['init', '-q', theirs])
    expect((await realConnect()(['--no-qmd'], JSON.stringify(demoTemplate({ root: theirs, profileName: DEMO_PROFILE }).draft))).code).toBe(0)

    const { createDemo, connectCalls, state } = await app()
    const result = await createDemo()

    expect(result.ok).toBe(false)
    expect(!result.ok && result.reason).toMatch(/already has a Profile named worfy-demo/)
    expect(connectCalls.filter((args) => args[0] === '--remove')).toEqual([])
    expect(await profileName(theirs)).toMatchObject({ code: 0, stdout: DEMO_PROFILE })
    expect(existsSync(join(home, 'worfy-demo'))).toBe(false)
    expect(state.demo()).toBeNull()
  })
})
