// The state of Getting started (worfy-onboarding ticket 06, src/main/getting-started/state.ts) over
// a real file in a temporary data folder: a new or an existing user decided once (decision 7), a
// broken file set aside, the steps kept across a restart, every source's write kept when they come
// together, the channels `gettingStarted.state`, `.setSection` and `.noticeSeen`, and the start in
// the app: the first read at once, `gettingStarted.changed` to every window after a change; step 3
// over real Orchestrators on the fake agent, and step 1 from the `firstRun.checks` handler.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IpcMainInvokeEvent } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeQueryFactory } from '../../src/main/agent/fake-query'
import { Orchestrators } from '../../src/main/agent/orchestrator'
import { SessionRegistry } from '../../src/main/agent/session'
import { SessionSettingsStore } from '../../src/main/agent/session-settings'
import { GettingStartedProgress } from '../../src/main/getting-started/progress'
import { GETTING_STARTED_FILE, GettingStartedState, type DemoRecord } from '../../src/main/getting-started/state'
import { LayoutStore } from '../../src/main/layout/store'
import { ProjectStore, runGit } from '../../src/main/projects/store'
import { IPC_CHANNEL_PREFIX, type IpcResult } from '../../src/shared/ipc/channels'
import type { CheckId, FirstRunReport } from '../../src/shared/ipc/first-run'
import type { GettingStartedSnapshot } from '../../src/shared/ipc/getting-started'
import { APP_URL } from '../app-url'
import { removeTestTree } from '../remove'

/** What the one fake window of the app was sent. */
const electron = vi.hoisted(() => {
  const sent: { channel: string; payload: unknown }[] = []
  const window = { isDestroyed: () => false, webContents: { send: (channel: string, payload: unknown) => sent.push({ channel, payload }) } }
  return { sent, windows: [] as (typeof window)[], window }
})

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => '/nowhere', on: () => undefined },
  BrowserWindow: { getAllWindows: () => electron.windows },
}))

const AGENT_SCRIPTS = join(import.meta.dirname, '..', 'fixtures', 'agent-scripts')
const DEMO: DemoRecord = { projectId: 'demo-id', path: '/home/me/worfy-demo', profile: 'worfy-demo', cost: 'cheaper' }
const NOW = new Date('2026-10-30T10:00:00.000Z')

let data: string

beforeEach(() => {
  data = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-gs-state-')))
})

afterEach(() => {
  removeTestTree(data)
})

const file = () => join(data, GETTING_STARTED_FILE)
const onDisk = () => JSON.parse(readFileSync(file(), 'utf8')) as Record<string, unknown>

/** A state over the folder with a Project list the test changes. */
function stateWith(projects: { id: string }[], options: { auto?: boolean } = {}) {
  const list = [...projects]
  const state = new GettingStartedState(data, { projects: () => list, auto: () => options.auto ?? true, now: () => NOW })
  return { state, list }
}

describe('the first read (decision 7)', () => {
  it('no file and one Project in the list: an existing user, the section hidden', () => {
    const { state } = stateWith([{ id: 'mine' }])
    expect(state.read()).toEqual({ user: 'existing', section: 'hidden', steps: {}, reworkSeen: false, noticeShown: false, demo: null })
    expect(onDisk()).toMatchObject({ user: 'existing', section: 'hidden' })
  })

  it('no file and an empty list: a new user, the section shown', () => {
    const { state } = stateWith([])
    expect(state.read()).toMatchObject({ user: 'new', section: 'shown' })
  })

  it('is not decided again: Projects added later, and a new instance over the same folder, keep the first answer', () => {
    const { state, list } = stateWith([])
    state.read()
    list.push({ id: 'mine' })
    expect(state.read()).toMatchObject({ user: 'new', section: 'shown' })
    expect(stateWith([{ id: 'mine' }]).state.read()).toMatchObject({ user: 'new', section: 'shown' })
  })

  it('the demo itself does not make an existing user', () => {
    const { state } = stateWith([{ id: DEMO.projectId }])
    state.setDemo(DEMO)
    expect(state.read()).toMatchObject({ user: 'new', section: 'shown', demo: DEMO })
  })

  it('with WORFY_GETTING_STARTED_AUTO=0 (auto false) a new user starts with the section hidden', () => {
    const { state } = stateWith([], { auto: false })
    expect(state.read()).toMatchObject({ user: 'new', section: 'hidden' })
  })

  it('a broken file: an empty state, the file set aside next to it', () => {
    writeFileSync(file(), '{"steps": {"1": ')
    const { state } = stateWith([])
    expect(state.read()).toEqual({ user: 'new', section: 'shown', steps: {}, reworkSeen: false, noticeShown: false, demo: null })
    const aside = readdirSync(data).filter((name) => name.startsWith(`${GETTING_STARTED_FILE}.unreadable-`))
    expect(aside).toHaveLength(1)
    expect(readFileSync(join(data, aside[0] ?? ''), 'utf8')).toBe('{"steps": {"1": ')
  })

  it('fields that do not read become their empty values; the others and unknown keys stay', () => {
    writeFileSync(file(), JSON.stringify({ user: 'existing', section: 'sideways', steps: { '2': NOW.toISOString(), '7': NOW.toISOString(), '3': 'yesterday' }, reworkSeen: 'yes', later: { kept: true } }))
    const { state } = stateWith([])
    expect(state.read()).toEqual({ user: 'existing', section: 'hidden', steps: { '2': NOW.toISOString() }, reworkSeen: false, noticeShown: false, demo: null })
    state.markStep('4')
    expect(onDisk().later).toEqual({ kept: true })
  })
})

describe('the steps', () => {
  it('a marked step stays after a restart: written, then read by a new instance', () => {
    const { state } = stateWith([])
    expect(state.markStep('3')).toBe(true)
    expect(state.markReworkSeen()).toBe(true)
    const restarted = new GettingStartedState(data)
    expect(restarted.read()).toMatchObject({ steps: { '3': NOW.toISOString() }, reworkSeen: true })
  })

  it('a step marked again keeps its first time, and the file is not written', () => {
    const { state } = stateWith([])
    state.markStep('1')
    const changes = vi.fn()
    state.onChange(changes)
    const later = new GettingStartedState(data, { now: () => new Date('2026-11-01T00:00:00.000Z') })
    expect(later.markStep('1')).toBe(false)
    expect(state.markStep('1')).toBe(false)
    expect(state.read().steps['1']).toBe(NOW.toISOString())
    expect(changes).not.toHaveBeenCalled()
  })

  it('writes from several sources together keep every mark: two instances, the demo record, the section and the notice', async () => {
    const { state } = stateWith([])
    const other = new GettingStartedState(data, { now: () => NOW })
    const writes: (() => unknown)[] = [
      () => state.markStep('1'),
      () => other.markStep('2'),
      () => state.setDemo(DEMO),
      () => other.markStep('3'),
      () => state.markReworkSeen(),
      () => other.setSection('hidden'),
      () => state.markStep('4'),
      () => other.noticeSeen(),
      () => state.markStep('5'),
      () => other.markStep('6'),
    ]
    // Each source writes from its own callback, as the First run handlers, the Session events and
    // the Stage snapshots do.
    await Promise.all(writes.map((write, index) => new Promise<void>((done) => setTimeout(() => (write(), done()), index % 3))))
    expect(new GettingStartedState(data).read()).toEqual({
      user: 'new',
      section: 'hidden',
      steps: { '1': NOW.toISOString(), '2': NOW.toISOString(), '3': NOW.toISOString(), '4': NOW.toISOString(), '5': NOW.toISOString(), '6': NOW.toISOString() },
      reworkSeen: true,
      noticeShown: true,
      demo: DEMO,
    })
  })

  it('dropping the demo record keeps the steps; dropping a record that is not there writes no file', () => {
    const { state } = stateWith([])
    state.setDemo(null)
    expect(existsSync(file())).toBe(false)
    state.setDemo(DEMO)
    state.markStep('2')
    state.setDemo(null)
    expect(state.read()).toMatchObject({ steps: { '2': NOW.toISOString() }, demo: null })
  })

  it('onChange hears each write that changed the file, once', () => {
    const { state } = stateWith([])
    const changes = vi.fn()
    state.onChange(changes)
    state.read()
    state.read()
    state.markStep('1')
    state.setSection('hidden')
    state.setSection('hidden')
    expect(changes).toHaveBeenCalledTimes(3)
  })
})

describe('the channels gettingStarted.state, .setSection and .noticeSeen', () => {
  async function channels(state: GettingStartedState) {
    const { gettingStartedHandlers } = await import('../../src/main/ipc/getting-started')
    const { registerIpc } = await import('../../src/main/ipc/index')
    const handlers = new Map<string, (event: IpcMainInvokeEvent, input: unknown) => unknown>()
    await registerIpc(
      { handle: (name, listener) => handlers.set(name, listener) },
      { modules: { './getting-started.ts': () => Promise.resolve(gettingStartedHandlers(() => Promise.reject(new Error('not here')), () => state)) }, isTrustedSender: (url) => url === APP_URL },
    )
    return async (name: string, input?: unknown): Promise<GettingStartedSnapshot> => {
      const listener = handlers.get(`${IPC_CHANNEL_PREFIX}${name}`)
      if (!listener) throw new Error(`${name} is not registered`)
      const result = (await listener({ senderFrame: { url: APP_URL } } as unknown as IpcMainInvokeEvent, input)) as IpcResult<GettingStartedSnapshot>
      if (!result.ok) throw new Error(result.error)
      return result.value
    }
  }

  it('reads the state, hides and shows the section, and records the notice; a new instance reads the same', async () => {
    const { state } = stateWith([{ id: 'mine' }])
    const call = await channels(state)
    expect(await call('gettingStarted.state')).toMatchObject({ user: 'existing', section: 'hidden', noticeShown: false })
    expect(await call('gettingStarted.setSection', { section: 'shown' })).toMatchObject({ section: 'shown' })
    expect(await call('gettingStarted.noticeSeen')).toMatchObject({ noticeShown: true })
    expect(await call('gettingStarted.setSection', { section: 'hidden' })).toMatchObject({ section: 'hidden', noticeShown: true })
    expect(new GettingStartedState(data).read()).toMatchObject({ user: 'existing', section: 'hidden', noticeShown: true })
  })

  it('refuses a section outside shown and hidden, and writes nothing', async () => {
    const { state } = stateWith([])
    const call = await channels(state)
    await expect(call('gettingStarted.setSection', { section: 'open' })).rejects.toThrow()
    expect(existsSync(file())).toBe(false)
  })
})

describe('startGettingStarted, in the app', () => {
  const NAMES = ['WORFY_DATA_DIR', 'WORFY_CLAUDE_HOME', 'WORFY_AGENT', 'WORFY_GETTING_STARTED_AUTO'] as const
  let saved: Partial<Record<(typeof NAMES)[number], string>> = {}

  beforeEach(() => {
    saved = Object.fromEntries(NAMES.map((name) => [name, process.env[name]]))
    process.env.WORFY_DATA_DIR = data
    // Read, never written; an empty folder of the test, not the user's ~/.claude.
    process.env.WORFY_CLAUDE_HOME = join(data, 'claude-home')
    process.env.WORFY_AGENT = 'fake'
    delete process.env.WORFY_GETTING_STARTED_AUTO
    electron.windows.push(electron.window)
    // Fresh singletons of the app (the state, the Project list) over this test's folder.
    vi.resetModules()
  })

  afterEach(() => {
    for (const name of NAMES) {
      if (saved[name] === undefined) delete process.env[name]
      else process.env[name] = saved[name]
    }
    electron.windows.length = 0
    electron.sent.length = 0
  })

  it('reads the state at once, deciding the user before any window asks; each change goes to every window as gettingStarted.changed', async () => {
    const { startGettingStarted } = await import('../../src/main/ipc/getting-started')
    const { gettingStartedState } = await import('../../src/main/getting-started/state')
    const stop = startGettingStarted()
    try {
      expect(onDisk()).toMatchObject({ user: 'new', section: 'shown' })
      expect(electron.sent).toEqual([])
      gettingStartedState().markStep('1')
      gettingStartedState().markStep('1')
      expect(electron.sent).toEqual([{ channel: `${IPC_CHANNEL_PREFIX}gettingStarted.changed`, payload: expect.objectContaining({ user: 'new', steps: { '1': expect.any(String) as string } }) as unknown }])
    } finally {
      stop()
    }
    gettingStartedState().markStep('2')
    expect(electron.sent).toHaveLength(1)
  })

  it('WORFY_GETTING_STARTED_AUTO=0: a new user starts with the section hidden', async () => {
    process.env.WORFY_GETTING_STARTED_AUTO = '0'
    const { startGettingStarted } = await import('../../src/main/ipc/getting-started')
    startGettingStarted()()
    expect(onDisk()).toMatchObject({ user: 'new', section: 'hidden' })
  })

  const projectsJson = (projects: { id: string; name: string; path: string }[]) => writeFileSync(join(data, 'projects.json'), `${JSON.stringify({ projects, activeId: null })}\n`)

  it('an existing user, with a Project in the app\'s list at the start, is not made to go through Getting started: existing, the section hidden', async () => {
    projectsJson([{ id: 'mine-id', name: 'mine', path: join(data, 'mine') }])
    const { startGettingStarted } = await import('../../src/main/ipc/getting-started')
    startGettingStarted()()
    expect(onDisk()).toMatchObject({ user: 'existing', section: 'hidden' })
  })

  it('a file of ticket 05 (the demo record alone) and another Project in the list: existing', async () => {
    projectsJson([
      { id: DEMO.projectId, name: 'worfy-demo', path: DEMO.path },
      { id: 'mine-id', name: 'mine', path: join(data, 'mine') },
    ])
    writeFileSync(file(), `${JSON.stringify({ demo: DEMO })}\n`)
    const { startGettingStarted } = await import('../../src/main/ipc/getting-started')
    startGettingStarted()()
    expect(onDisk()).toMatchObject({ user: 'existing', section: 'hidden', demo: DEMO })
  })

  it('the demo alone in the list, from a file of ticket 05: still a new user', async () => {
    projectsJson([{ id: DEMO.projectId, name: 'worfy-demo', path: DEMO.path }])
    writeFileSync(file(), `${JSON.stringify({ demo: DEMO })}\n`)
    const { startGettingStarted } = await import('../../src/main/ipc/getting-started')
    startGettingStarted()()
    expect(onDisk()).toMatchObject({ user: 'new', section: 'shown' })
  })

  it('a Project list that does not read is set aside, and its user counts as existing', async () => {
    writeFileSync(join(data, 'projects.json'), '{"projects": [')
    const { startGettingStarted } = await import('../../src/main/ipc/getting-started')
    startGettingStarted()()
    expect(readdirSync(data).filter((name) => name.startsWith('projects.json.unreadable-'))).toHaveLength(1)
    expect(onDisk()).toMatchObject({ user: 'existing', section: 'hidden' })
  })
})

describe('the demo Orchestrator: step 3 over real Orchestrators on the fake agent', () => {
  const registries: SessionRegistry[] = []

  afterEach(() => {
    for (const registry of registries.splice(0)) registry.closeAll()
  })

  it('only a turn of the demo Project\'s Orchestrator marks step 3: not another Project\'s Orchestrator, not another Session of the demo', async () => {
    const demoPath = join(data, 'worfy-demo')
    const minePath = join(data, 'mine')
    for (const dir of [demoPath, minePath]) mkdirSync(dir)
    writeFileSync(
      join(data, 'projects.json'),
      `${JSON.stringify({
        projects: [
          { id: DEMO.projectId, name: 'worfy-demo', path: demoPath },
          { id: 'mine-id', name: 'mine', path: minePath },
          // In the list, its Orchestrator never opened.
          { id: 'idle-id', name: 'idle', path: minePath },
        ],
        activeId: null,
      })}\n`,
    )
    const projects = new ProjectStore(data, runGit, () => Promise.resolve(null))
    const layout = new LayoutStore((projectId) => projects.dataDir(projects.get(projectId).id), { delayMs: 0 })
    const registry = new SessionRegistry(fakeQueryFactory({ scriptsDir: AGENT_SCRIPTS, script: 'turn' }))
    registries.push(registry)
    const orchestrators = new Orchestrators({
      layout,
      projectPath: (projectId) => projects.get(projectId).path,
      registry,
      settings: new SessionSettingsStore((projectId) => projects.dataDir(projects.get(projectId).id)),
      transcript: () => Promise.resolve(null),
      broadcast: () => undefined,
      publish: () => undefined,
    })
    const { orchestratorMatcher } = await import('../../src/main/ipc/getting-started')
    const isOrchestratorOf = orchestratorMatcher(() => ({ layout, orchestrators, registry }))
    const state = new GettingStartedState(data, { projects: () => projects.list() })
    state.setDemo({ ...DEMO, path: demoPath })
    const stop = new GettingStartedProgress({
      state,
      projects: { list: () => projects.list(), onChange: (listener) => projects.onChange(() => listener()) },
      stages: { open: (root) => Promise.resolve({ root, pipeline: [], tickets: [], error: null }), close: () => Promise.resolve(true) },
      workflow: { model: () => Promise.resolve(null) },
      sessions: registry,
      isOrchestratorOf,
    }).start()

    const [demo, mine] = await Promise.all([orchestrators.open(DEMO.projectId), orchestrators.open('mine-id')])
    if (demo.sessionId === null || mine.sessionId === null) throw new Error('an Orchestrator has no Session')
    expect(isOrchestratorOf(DEMO.projectId, demo.sessionId)).toBe(true)
    expect(isOrchestratorOf('mine-id', mine.sessionId)).toBe(true)
    expect(isOrchestratorOf(DEMO.projectId, mine.sessionId)).toBe(false)
    expect(isOrchestratorOf('mine-id', demo.sessionId)).toBe(false)
    expect(isOrchestratorOf('nowhere-id', demo.sessionId)).toBe(false)
    expect(isOrchestratorOf('idle-id', demo.sessionId)).toBe(false)

    // Registered after the progress, so a turn counted here has been heard by it.
    const ended: string[] = []
    registry.observe((sessionId, event) => {
      if (event.type === 'result') ended.push(sessionId)
    })
    const turn = async (sessionId: string) => {
      const before = ended.length
      registry.get(sessionId).send('hello')
      await vi.waitFor(() => expect(ended).toHaveLength(before + 1))
    }
    try {
      await turn(mine.sessionId)
      expect(state.read().steps['3']).toBeUndefined()
      const plain = registry.start(demoPath, undefined, () => undefined)
      await turn(plain.id)
      expect(isOrchestratorOf(DEMO.projectId, plain.id)).toBe(false)
      expect(state.read().steps['3']).toBeUndefined()
      await turn(demo.sessionId)
      expect(state.read().steps['3']).toBeDefined()
    } finally {
      stop()
    }
  })
})

describe('step 1 from the First run report (src/main/ipc/first-run.ts)', () => {
  const MOCKED = ['electron', '../../src/main/agent/env', '../../src/main/ipc/workflow', '../../src/main/first-run/checks']

  beforeEach(() => {
    vi.resetModules()
    vi.stubEnv('WORFY_DATA_DIR', data)
    vi.stubEnv('WORFY_CLAUDE_HOME', join(data, 'claude-home'))
    vi.stubEnv('WORFY_HARNESS_HOME', join(data, 'harness-home'))
  })

  afterEach(() => {
    for (const path of MOCKED) vi.doUnmock(path)
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  /** `firstRun.checks` of the module, with the checks answering a report where `failing` fail. */
  async function checkAgain(failing: readonly CheckId[]): Promise<() => Promise<unknown>> {
    vi.doMock('electron', () => ({
      app: { isPackaged: false, getAppPath: () => '/nowhere', on: () => undefined, quit: () => undefined },
      BrowserWindow: { getAllWindows: () => [], fromWebContents: () => null },
      dialog: { showMessageBox: () => Promise.reject(new Error('no dialog in this test')) },
      powerSaveBlocker: { start: () => 0, stop: () => undefined, isStarted: () => false },
    }))
    vi.doMock('../../src/main/agent/env', async (original) => ({
      ...(await original<object>()),
      agentEnv: () => Promise.resolve({ env: { PATH: '/usr/bin' }, from: 'login-shell', error: null }),
      recaptureAgentEnv: () => Promise.resolve({ env: { PATH: '/usr/bin' }, from: 'login-shell', error: null }),
    }))
    vi.doMock('../../src/main/ipc/workflow', () => ({ workflowHub: { retryFailedLayouts: () => Promise.resolve(0) } }))
    vi.doMock('../../src/main/first-run/checks', async (original) => ({
      ...(await original<object>()),
      runChecks: (): Promise<FirstRunReport> =>
        Promise.resolve({
          checks: (['git', 'gh', 'node'] as const).map((id) => ({ id, group: 'Command-line tools' as const, title: id, status: failing.includes(id) ? ('fail' as const) : ('ok' as const), detail: '', hint: '', command: null, actions: [] })),
          checkedAt: new Date(0).toISOString(),
        }),
    }))
    const handlers = (await import('../../src/main/ipc/first-run')).default as unknown as { channel: unknown; handle: (input: unknown, context: unknown) => Promise<unknown> }[]
    const { firstRunChecks } = await import('../../src/shared/ipc/first-run')
    const checks = handlers.find((handler) => handler.channel === firstRunChecks)
    if (checks === undefined) throw new Error('no handler of firstRun.checks')
    return () => checks.handle(undefined, {})
  }

  it('"Check again" with only gh failing marks step 1; with git failing it does not', async () => {
    await (await checkAgain(['git']))()
    expect(existsSync(file()) ? new GettingStartedState(data).read().steps['1'] : undefined).toBeUndefined()
    vi.resetModules()
    await (await checkAgain(['gh']))()
    expect(new GettingStartedState(data).read().steps['1']).toEqual(expect.any(String))
  })

  it('a state that cannot be written does not fail the checks: the report comes back all the same', async () => {
    // A folder where the file should be: the read of the state throws EISDIR.
    mkdirSync(file())
    const report = (await (await checkAgain([]))()) as FirstRunReport
    expect(report.checks.map((check) => check.id)).toEqual(['git', 'gh', 'node'])
  })
})
