// Removing the Demo project of Getting started (worfy-onboarding ticket 10): `gettingStarted.removeDemo`
// over a demo created for real (ticket 05) — git, harness/bin/project-connect and harness/bin/profile
// of this repository in a temporary Harness home, the real Project list, the Orchestrators and
// Sessions on the fake agent, the Terminals of a real registry over a stand-in pty whose shell is a
// node process waiting in its folder. The
// confirmation is a parameter. The guards of the folder are also driven with stand-ins that call
// every folder "ours", so a missing guard shows as a deletion asked for, never as one made.
// Nothing here starts a real agent or writes to ~/.claude.
import { execFile, spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { IpcMainInvokeEvent } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeQueryFactory } from '../../src/main/agent/fake-query'
import { Orchestrators } from '../../src/main/agent/orchestrator'
import { SessionRegistry } from '../../src/main/agent/session'
import { SessionSettingsStore } from '../../src/main/agent/session-settings'
import { DEMO_PROFILE, DemoCreator, demoGit, gateRegistryRepos } from '../../src/main/getting-started/demo'
import { DemoRemover, FOLDER_TRIES, removeConfirmation, removeDemo, type RemoveDeps } from '../../src/main/getting-started/remove'
import { GettingStartedState } from '../../src/main/getting-started/state'
import { LayoutStore } from '../../src/main/layout/store'
import { connectScriptRunner, type ConnectScript } from '../../src/main/projects/connect'
import { ProjectStore, runGit } from '../../src/main/projects/store'
import { removeTree } from '../../src/main/storage/remove'
import { TerminalRegistry, type PtyProcess, type TerminalSink } from '../../src/main/terminal/pty'
import { IPC_CHANNEL_PREFIX, type IpcResult } from '../../src/shared/ipc/channels'
import type { RemoveDemoResult } from '../../src/shared/ipc/getting-started'
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
let cleanups: (() => Promise<void> | void)[] = []

beforeEach(() => {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-gs-remove-')))
  home = join(scratch, 'home')
  temp = join(scratch, 'tmp')
  harnessHome = join(scratch, 'harness')
  data = join(scratch, 'data')
  gitConfig = join(scratch, 'gitconfig')
  for (const dir of [home, temp, data]) mkdirSync(dir, { recursive: true })
  writeFileSync(gitConfig, '[user]\n\tname = Demo Tester\n\temail = demo@example.com\n')
})

afterEach(async () => {
  const pending = cleanups
  cleanups = []
  for (const cleanup of pending) await cleanup()
  removeTestTree(scratch)
})

/** git and the Harness scripts of the test: its own home, Harness home and git config, no variable of the run. */
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

function realConnect(): ConnectScript {
  return connectScriptRunner({
    harness: () => ({
      kind: 'plugin',
      binDir: BIN,
      gateDir: join(harnessHome, 'gate'),
      harnessHome,
      checked: [join(home, '.claude', 'bin', 'epic-status'), join(BIN, 'epic-status')],
    }),
    env: () => Promise.resolve(scriptEnvironment()),
  })
}

function run(file: string, args: readonly string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((done) => {
    execFile(file, args, { env: scriptEnvironment() as NodeJS.ProcessEnv, encoding: 'utf8' }, (error, stdout, stderr) => {
      done({
        code: error ? (typeof error.code === 'number' ? error.code : 1) : 0,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      })
    })
  })
}

/** `bin/profile -C <folder> --name` of the temporary Harness home. */
const profileName = (folder: string) => run(scriptNode(), [join(BIN, 'profile'), '-C', folder, '--name'])

/** The `match` of every entry of the temporary gate registry. */
const gateMatches = (): string[] => {
  const file = join(harnessHome, 'gate', 'config.json')
  if (!existsSync(file)) return []
  return (
    JSON.parse(readFileSync(file, 'utf8')) as {
      repos: { profile: string; match: string }[]
    }
  ).repos
    .filter((each) => each.profile === DEMO_PROFILE)
    .map((each) => each.match)
}

/**
 * A pty over a real process that waits in `cwd`, as a shell would: the registry ends it by its pid,
 * and its exit is written to `log` with its folder.
 */
function waitingPty(cwd: string, log: string[]): PtyProcess {
  const child = spawn(scriptNode(), ['-e', 'setInterval(() => undefined, 1000)'], { cwd, stdio: 'ignore', windowsHide: true })
  if (child.pid === undefined) throw new Error('the stand-in shell did not start')
  const exits: ((event: { exitCode: number }) => void)[] = []
  child.once('exit', (code) => {
    log.push(`terminal closed: ${cwd}`)
    for (const exit of exits) exit({ exitCode: code ?? 0 })
  })
  cleanups.push(() => void child.kill('SIGKILL'))
  return {
    pid: child.pid,
    onData: () => undefined,
    onExit: (listener) => void exits.push(listener),
    write: () => undefined,
    resize: () => undefined,
    kill: () => void child.kill(),
  }
}

interface Options {
  /** The answer of the dialog. */
  confirm?: boolean
  /** Wraps the real bin/project-connect. */
  connect?: (real: ConnectScript) => ConnectScript
  /** Wraps the deletion of a folder; the real one by default. */
  removeTree?: (real: (path: string) => void) => (path: string) => void
  /** The roots of Projects outside the list, by id, for the Terminals keyed to them. */
  roots?: Record<string, string>
}

/** One start of the app over the test's folders: the stores, the Orchestrators, the Terminals, the creator, the remover and their channels. */
async function app(options: Options = {}) {
  const log: string[] = []
  const projects = new ProjectStore(data, runGit, () => Promise.resolve(null))
  const layout = new LayoutStore((projectId) => projects.dataDir(projects.get(projectId).id), { delayMs: 0 })
  const settings = new SessionSettingsStore((projectId) => projects.dataDir(projects.get(projectId).id))
  const registry = new SessionRegistry(fakeQueryFactory({ scriptsDir: AGENT_SCRIPTS, script: 'orchestrator' }))
  const orchestrators = new Orchestrators({
    layout,
    projectPath: (projectId) => projects.get(projectId).path,
    registry,
    settings,
    transcript: () => Promise.resolve(null),
    broadcast: () => undefined,
    publish: () => undefined,
  })
  projects.onChange(() => orchestrators.retain(new Set(projects.list().map((project) => project.id))))
  const terminals = new TerminalRegistry({
    env: () => Promise.resolve({ SHELL: '/bin/sh' }),
    spawn: (_file, _args, spawnOptions) => waitingPty(spawnOptions.cwd, log),
    killGraceMs: 10,
    platform: 'darwin',
  })
  cleanups.push(
    () => registry.closeAll(),
    () => terminals.closeAll(),
  )
  const state = new GettingStartedState(data)
  const connect = options.connect ? options.connect(realConnect()) : realConnect()
  const creator = new DemoCreator(() => ({
    home,
    tmpdir: temp,
    git: demoGit(scriptEnvironment()),
    connect: realConnect(),
    projects,
    openOrchestrator: (projectId, firstSettings) => orchestrators.open(projectId, { firstSettings }),
    state,
    registeredRepos: gateRegistryRepos(() => join(harnessHome, 'gate')),
  }))
  const confirms: string[] = []
  const realRemove = (path: string): void => {
    log.push(`deleted: ${path}`)
    removeTree(path)
  }
  const { gettingStartedHandlers, sessionPlaces, terminalPlaces } = await import('../../src/main/ipc/getting-started')
  const remover = new DemoRemover((confirm) => ({
    home,
    dataRoot: data,
    confirm,
    profileName,
    registeredRepos: gateRegistryRepos(() => join(harnessHome, 'gate')),
    connect,
    projects: {
      find: (id) => projects.find(id),
      remove: (id) => {
        layout.flush(id)
        projects.remove(id)
        layout.forget(id)
      },
      dataDir: (id) => projects.dataDir(id),
    },
    stopOrchestrator: (projectId) =>
      orchestrators.retain(
        new Set(
          projects
            .list()
            .map((project) => project.id)
            .filter((id) => id !== projectId),
        ),
      ),
    sessions: sessionPlaces(registry),
    terminals: terminalPlaces(terminals, (projectId) => projects.find(projectId)?.path ?? options.roots?.[projectId] ?? null),
    state,
    removeTree: options.removeTree ? options.removeTree(realRemove) : realRemove,
    wait: () => Promise.resolve(),
  }))
  const confirm = (folder: string): Promise<boolean> => {
    confirms.push(folder)
    log.push('confirmed')
    return Promise.resolve(options.confirm ?? true)
  }

  const { registerIpc } = await import('../../src/main/ipc/index')
  const handlers = new Map<string, (event: IpcMainInvokeEvent, input: unknown) => unknown>()
  await registerIpc(
    { handle: (name, listener) => handlers.set(name, listener) },
    {
      modules: {
        './getting-started.ts': () =>
          Promise.resolve(
            gettingStartedHandlers(
              () => creator.create(),
              undefined,
              undefined,
              () => remover.remove(confirm),
            ),
          ),
      },
      isTrustedSender: (url) => url === APP_URL,
    },
  )
  const call = async <T>(channel: string): Promise<T> => {
    const listener = handlers.get(`${IPC_CHANNEL_PREFIX}${channel}`)
    if (!listener) throw new Error(`${channel} is not registered`)
    const result = (await listener({ senderFrame: { url: APP_URL } } as unknown as IpcMainInvokeEvent, undefined)) as IpcResult<T>
    if (!result.ok) throw new Error(result.error)
    return result.value
  }
  const sink: TerminalSink = {
    output: () => undefined,
    exit: () => undefined,
    started: () => undefined,
  }
  /** Opens a Terminal keyed to `projectId` in `cwd`, as terminal.open does. */
  const openTerminal = async (projectId: string, nodeId: string, cwd: string): Promise<string> => {
    const key = JSON.stringify([projectId, nodeId])
    await terminals.open(key, { cwd, cols: 80, rows: 24 }, {}, sink)
    return key
  }
  const createDemo = async () => {
    const created = await call<{
      ok: boolean
      projectId?: string
      path?: string
      reason?: string
    }>('gettingStarted.createDemo')
    if (!created.ok || created.projectId === undefined || created.path === undefined) throw new Error(`the demo was not created: ${created.reason ?? ''}`)
    // The Orchestrator's Session has started.
    await vi.waitFor(() => expect(registry.list().some((session) => session.cwd === created.path)).toBe(true))
    return { projectId: created.projectId, path: created.path }
  }
  const projectsFile = () =>
    JSON.parse(readFileSync(join(data, 'projects.json'), 'utf8')) as {
      projects: { id: string; path: string }[]
    }
  return {
    log,
    confirms,
    state,
    registry,
    terminals,
    openTerminal,
    createDemo,
    projectsFile,
    removeDemo: () => call<RemoveDemoResult>('gettingStarted.removeDemo'),
  }
}

const STEPS = ['1', '2', '3', '4', '5', '6'] as const

/** Marks all six steps, as a demo merged would have. */
function markAll(state: GettingStartedState): void {
  for (const step of STEPS) state.markStep(step)
}

describe('gettingStarted.removeDemo', () => {
  it('after Confirm closes the Sessions and Terminals inside the folder first, then removes the Profile, the list row, the data folder, the record and the folder', async () => {
    const elsewhere = join(scratch, 'elsewhere')
    mkdirSync(elsewhere)
    // Terminals start in the root of their Project: one of a Project inside the demo's folder, one of a Project outside it.
    const h = await app({ roots: { visitor: join(home, 'worfy-demo', 'src'), outsider: elsewhere } })
    const demo = await h.createDemo()
    markAll(h.state)
    const sibling = join(home, 'notes.txt')
    writeFileSync(sibling, 'mine\n')
    const inDemo = await h.openTerminal(demo.projectId, 'term-1', demo.path)
    const visiting = await h.openTerminal('visitor', 'term-2', join(demo.path, 'src'))
    const outside = await h.openTerminal('outsider', 'term-3', elsewhere)
    // A Session outside the demo's folder.
    const other = h.registry.start(elsewhere, undefined, () => undefined)

    const result = await h.removeDemo()

    expect(result).toEqual({ removed: true })
    expect(h.confirms).toEqual([demo.path])
    // Closed before anything was deleted; the Terminal outside stays.
    const firstDeletion = h.log.findIndex((line) => line.startsWith('deleted: '))
    expect(h.log.indexOf(`terminal closed: ${demo.path}`)).toBeGreaterThan(h.log.indexOf('confirmed'))
    expect(h.log.indexOf(`terminal closed: ${demo.path}`)).toBeLessThan(firstDeletion)
    expect(h.log.indexOf(`terminal closed: ${join(demo.path, 'src')}`)).toBeLessThan(firstDeletion)
    expect(h.log).not.toContain(`terminal closed: ${elsewhere}`)
    expect(h.terminals.has(inDemo)).toBe(false)
    expect(h.terminals.has(visiting)).toBe(false)
    expect(h.terminals.has(outside)).toBe(true)
    expect(h.registry.list().map((session) => session.cwd)).toEqual([elsewhere])
    expect(other.state).not.toBe('closed')

    // The folder is gone; the home folder and what else it holds stay.
    expect(existsSync(demo.path)).toBe(false)
    expect(readFileSync(sibling, 'utf8')).toBe('mine\n')
    // The Harness does not know it: no Profile, no gate registry entry.
    expect((await profileName(demo.path)).code).not.toBe(0)
    expect(existsSync(join(harnessHome, 'projects', DEMO_PROFILE))).toBe(false)
    expect(gateMatches()).toEqual([])
    // Out of the list, its worfy data folder gone, the record and steps 2–6 gone, step 1 kept.
    expect(h.projectsFile().projects).toEqual([])
    expect(existsSync(join(data, demo.projectId))).toBe(false)
    expect(existsSync(data)).toBe(true)
    const snapshot = h.state.read()
    expect(snapshot.demo).toBeNull()
    expect(Object.keys(snapshot.steps)).toEqual(['1'])
    expect(snapshot.section).toBe('shown')
  })

  it('touches nothing on Cancel', async () => {
    const h = await app({ confirm: false })
    const demo = await h.createDemo()
    markAll(h.state)
    const terminal = await h.openTerminal(demo.projectId, 'term-1', demo.path)

    const result = await h.removeDemo()

    expect(result).toEqual({ removed: false, reason: null })
    expect(h.confirms).toEqual([demo.path])
    expect(h.log.filter((line) => line !== 'confirmed')).toEqual([])
    expect(h.terminals.has(terminal)).toBe(true)
    expect(h.registry.list().some((session) => session.cwd === demo.path)).toBe(true)
    expect(existsSync(join(demo.path, '.git'))).toBe(true)
    expect(await profileName(demo.path)).toMatchObject({
      code: 0,
      stdout: DEMO_PROFILE,
    })
    expect(gateMatches()).toHaveLength(1)
    expect(h.projectsFile().projects.map((project) => project.id)).toEqual([demo.projectId])
    expect(existsSync(join(data, demo.projectId))).toBe(true)
    expect(h.state.demo()?.path).toBe(demo.path)
    expect(Object.keys(h.state.read().steps).sort()).toEqual([...STEPS])
  })

  it('refuses a record whose folder the Harness does not know as worfy-demo, before asking, and leaves the folder whole', async () => {
    const h = await app()
    const demo = await h.createDemo()
    const theirs = join(home, 'my-app')
    mkdirSync(theirs)
    writeFileSync(join(theirs, 'keep.txt'), 'keep\n')
    h.state.setDemo({
      projectId: demo.projectId,
      path: theirs,
      profile: DEMO_PROFILE,
      cost: 'cheaper',
    })

    const result = await h.removeDemo()

    expect(result).toMatchObject({
      removed: false,
      reason: expect.stringMatching(/^Nothing was removed: the Harness does not know .*my-app as the demo/u) as string,
    })
    expect(h.confirms).toEqual([])
    expect(h.log).toEqual([])
    expect(readFileSync(join(theirs, 'keep.txt'), 'utf8')).toBe('keep\n')
    expect(existsSync(join(demo.path, '.git'))).toBe(true)
    expect(await profileName(demo.path)).toMatchObject({
      code: 0,
      stdout: DEMO_PROFILE,
    })
    expect(h.state.demo()?.path).toBe(theirs)
  })

  it('refuses a folder inside the demo: bin/profile answers worfy-demo there, but the Profile is tied to the demo root', async () => {
    const h = await app()
    const demo = await h.createDemo()
    const inner = join(demo.path, 'src')
    expect(await profileName(inner)).toMatchObject({
      code: 0,
      stdout: DEMO_PROFILE,
    })
    h.state.setDemo({
      projectId: demo.projectId,
      path: inner,
      profile: DEMO_PROFILE,
      cost: 'cheaper',
    })

    const result = await h.removeDemo()

    expect(result).toMatchObject({
      removed: false,
      reason: expect.stringMatching(/is not tied to .*src alone/u) as string,
    })
    expect(h.confirms).toEqual([])
    expect(existsSync(inner)).toBe(true)
    expect(gateMatches()).toHaveLength(1)
  })

  it('removes nothing when project-connect cannot remove the Profile, and says so', async () => {
    const h = await app({
      connect: (real) => (args, stdin) =>
        args[0] === '--remove'
          ? Promise.resolve({
              code: 1,
              stdout: '',
              stderr: 'registry locked\n',
            })
          : real(args, stdin),
    })
    const demo = await h.createDemo()

    const result = await h.removeDemo()

    expect(result).toMatchObject({
      removed: false,
      reason: expect.stringMatching(/could not be removed, so nothing was deleted: registry locked/u) as string,
    })
    expect(h.log.filter((line) => line.startsWith('deleted: '))).toEqual([])
    expect(existsSync(join(demo.path, '.git'))).toBe(true)
    expect(h.projectsFile().projects).toHaveLength(1)
    expect(h.state.demo()?.path).toBe(demo.path)
  })

  it(`tries a busy folder again after a pause, ${String(FOLDER_TRIES)} times at most, and names what stays and why`, async () => {
    let busyFor = 2
    const tries: string[] = []
    const h = await app({
      removeTree: (real) => (path) => {
        tries.push(path)
        if (dirname(path) === home && busyFor > 0) {
          busyFor -= 1
          throw Object.assign(new Error(`EBUSY: resource busy or locked, rmdir '${path}'`), { code: 'EBUSY', path })
        }
        real(path)
      },
    })
    const demo = await h.createDemo()
    expect(await h.removeDemo()).toEqual({ removed: true })
    expect(tries.filter((path) => path === demo.path)).toHaveLength(3)
    expect(existsSync(demo.path)).toBe(false)

    // A folder that stays busy: everything else goes, and the answer names the folder and the reason.
    const stuck = await app({
      removeTree: (real) => (path) => {
        if (dirname(path) === home)
          throw Object.assign(new Error('EPERM'), {
            code: 'EPERM',
            path: join(path, 'todo.mjs'),
          })
        real(path)
      },
    })
    const again = await stuck.createDemo()
    const result = await stuck.removeDemo()
    expect(result.removed).toBe(false)
    const reason = result.removed ? '' : (result.reason ?? '')
    expect(reason).toContain(`the folder ${again.path} stays (EPERM on ${join(again.path, 'todo.mjs')}`)
    expect(reason).toMatch(/entries left in it/u)
    expect(existsSync(again.path)).toBe(true)
    expect(gateMatches()).toEqual([])
    expect(stuck.state.demo()).toBeNull()
    expect(existsSync(join(data, again.projectId))).toBe(false)
  })

  it('answers that there is no demo when there is no record', async () => {
    const h = await app()
    expect(await h.removeDemo()).toEqual({
      removed: false,
      reason: 'There is no demo project to remove.',
    })
    expect(h.confirms).toEqual([])
  })

  it('asks with the text of the spec and the folder', () => {
    expect(removeConfirmation('/Users/me/worfy-demo')).toEqual({
      message: 'Remove the demo project?',
      detail: "worfy closes the demo's Sessions, then deletes the folder /Users/me/worfy-demo, and its worfy settings. This cannot be undone.",
    })
  })
})

describe('the guards of the folder', () => {
  /** Stand-ins that call any folder the demo worfy made; the deletion is recorded, never made. */
  function guarded(folder: string, places: { home: string; dataRoot: string }) {
    const asked: string[] = []
    const deleted: string[] = []
    let forgot = false
    const deps: RemoveDeps = {
      ...places,
      confirm: (path) => {
        asked.push(path)
        return Promise.resolve(true)
      },
      profileName: () => Promise.resolve({ code: 0, stdout: `${DEMO_PROFILE}\n` }),
      registeredRepos: () => Promise.resolve([folder]),
      connect: () => Promise.resolve({ code: 0, stdout: '{"ok":true}', stderr: '' }),
      projects: {
        find: () => undefined,
        remove: () => undefined,
        dataDir: (id) => join(places.dataRoot, id),
      },
      stopOrchestrator: () => undefined,
      sessions: { list: () => [], close: () => Promise.resolve() },
      terminals: { list: () => [], close: () => Promise.resolve() },
      state: {
        demo: () => ({
          projectId: 'demo-id',
          path: folder,
          profile: DEMO_PROFILE,
          cost: 'cheaper',
        }),
        forgetDemo: () => {
          forgot = true
        },
      },
      removeTree: (path) => void deleted.push(path),
      wait: () => Promise.resolve(),
    }
    return { deps, asked, deleted, forgot: () => forgot }
  }

  const cases: [string, () => { folder: string; places: { home: string; dataRoot: string } }, RegExp][] = [
    ['the root of a disk', () => ({ folder: resolve('/'), places: { home, dataRoot: data } }), /is the root of a disk/u],
    ['the home folder', () => ({ folder: home, places: { home, dataRoot: data } }), /is your home folder/u],
    ['the folder that holds the home folder', () => ({ folder: dirname(home), places: { home, dataRoot: data } }), /holds your home folder/u],
    ["worfy's data folder", () => ({ folder: data, places: { home, dataRoot: data } }), /is worfy's data folder or overlaps it/u],
    [
      "a folder inside worfy's data folder",
      () => ({
        folder: join(data, 'some-project'),
        places: { home, dataRoot: data },
      }),
      /is worfy's data folder or overlaps it/u,
    ],
    [
      "a folder above worfy's data folder",
      () => ({
        folder: join(scratch, 'apps'),
        places: { home, dataRoot: join(scratch, 'apps', 'worfy') },
      }),
      /is worfy's data folder or overlaps it/u,
    ],
  ]
  for (const [name, make, reason] of cases) {
    it(`never deletes ${name}, and does not ask`, async () => {
      const { folder, places } = make()
      mkdirSync(folder, { recursive: true })
      const g = guarded(folder, places)
      const result = await removeDemo(g.deps)
      expect(result).toMatchObject({
        removed: false,
        reason: expect.stringMatching(reason) as string,
      })
      expect(g.asked).toEqual([])
      expect(g.deleted).toEqual([])
      expect(g.forgot()).toBe(false)
    })
  }

  it('refuses when bin/profile does not answer worfy-demo, even with the registry tied to the folder', async () => {
    const folder = join(home, 'worfy-demo')
    mkdirSync(folder)
    const g = guarded(folder, { home, dataRoot: data })
    g.deps.profileName = () => Promise.resolve({ code: 0, stdout: 'my-app\n' })
    const result = await removeDemo(g.deps)
    expect(result).toMatchObject({
      removed: false,
      reason: expect.stringMatching(/bin\/profile answers "my-app", not worfy-demo/u) as string,
    })
    expect(g.asked).toEqual([])
    expect(g.deleted).toEqual([])
  })

  it('deletes the demo folder itself and the data folder of its Project, nothing above them', async () => {
    const folder = join(home, 'worfy-demo')
    mkdirSync(folder)
    const g = guarded(folder, { home, dataRoot: data })
    const result = await removeDemo(g.deps)
    expect(result).toEqual({
      removed: false,
      reason: expect.stringMatching(/stays \(it is still there/u) as string,
    })
    expect(new Set(g.deleted)).toEqual(new Set([folder, join(data, 'demo-id')]))
    expect(g.asked).toEqual([folder])
    expect(g.forgot()).toBe(true)
  })
})
