// The app's Autopilot (src/main/ipc/autopilot.ts, sharedAutopilot) hands the run what a new SDK
// session per Wave needs (worfy-throughput ticket 52): the Orchestrators' newUnattendedSession, the
// brief of "Run wave" and the kind of the Harness on the machine. The app's Orchestrators, launcher
// and Harness lookup are stand-ins here, so each call is seen as the run's deps make it. The app's
// starts from a chat (sharedChatStarts) run over the same Orchestrators and a stand-in Session
// registry, Project list and workflow read (worfy-polish ticket 50). A run that waits for the busy
// Orchestrator asks the app's Orchestrators what keeps it busy, and Start now takes it through them
// (worfy-autopilot-queue ticket 07).
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WAIT_MESSAGE } from '../../src/main/autopilot/chat-start'
import type { AutopilotDeps } from '../../src/main/autopilot/run'
import type { HarnessKind } from '../../src/shared/projects/action-templates'

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => '/nowhere', on: () => undefined },
  BrowserWindow: { getAllWindows: () => [], fromWebContents: () => null },
  dialog: { showMessageBox: () => Promise.reject(new Error('no dialog in this test')) },
  powerSaveBlocker: { start: () => 0, stop: () => undefined, isStarted: () => false },
}))

const stand = vi.hoisted(() => ({
  harness: 'plugin' as HarnessKind,
  orchestrators: {
    newUnattendedSession: vi.fn((projectId: string) => Promise.resolve({ projectId, sessionId: 'new-session' })),
    setUnattended: vi.fn(() => Promise.resolve(null)),
    giveBackNow: vi.fn(() => Promise.resolve(null)),
    open: vi.fn((projectId: string) => Promise.resolve({ projectId, sessionId: 'orchestrator-session' })),
    /** Session ids whose stopped run waits to be given back (Orchestrators.awaitsGiveBack). */
    waiting: new Set<string>(),
    awaitsGiveBack: vi.fn((sessionId: string): boolean => stand.orchestrators.waiting.has(sessionId)),
    busy: vi.fn((projectId: string) => (projectId === '' ? null : { turn: true, queued: 0, tasks: [] })),
    takeNow: vi.fn((projectId: string) => Promise.resolve({ view: { projectId, sessionId: 'orchestrator-session' }, killed: [] })),
    runsOn: vi.fn(() => 'claude'),
  },
  /** The Orchestrator's Session in the app's registry: in a turn, with one live background task, nothing queued. */
  session: {
    state: 'busy',
    backgroundTasks: () => [{ taskId: 'task_impl_0001' }],
    queued: () => ({ items: [] }),
  },
  launcher: {
    autopilotWave: vi.fn((_projectId: string, _epic: string, _resume: readonly number[], brief: boolean) => Promise.resolve({ text: brief ? 'with brief' : 'without' })),
    autopilotRefusal: vi.fn(() => null),
    autopilotGateQueue: vi.fn(() => Promise.resolve(null)),
    attachAutopilot: vi.fn(),
  },
}))

vi.mock('../../src/main/agent/app-orchestrators', async (original) => ({ ...(await original<object>()), sharedOrchestrators: () => stand.orchestrators }))
vi.mock('../../src/main/agent/app-registry', async (original) => ({
  ...(await original<object>()),
  sharedRegistry: () => ({
    get: (sessionId: string) => {
      if (sessionId !== 'orchestrator-session') throw new Error(`no Session ${sessionId}`)
      return stand.session
    },
    observe: () => () => undefined,
  }),
}))
vi.mock('../../src/main/projects/store', async (original) => ({
  ...(await original<object>()),
  projectStore: () => ({ get: (id: string) => ({ id, name: 'Demo', path: '/nowhere/demo' }), list: () => [] }),
}))
vi.mock('../../src/main/workflow/reader', async (original) => ({
  ...(await original<object>()),
  readWorkflow: () => Promise.resolve({ model: { root: '/nowhere/demo', epics: [{ epic: 'demo', hasSpec: true, hasMap: false }], tickets: [], error: null, branchErrors: [] } }),
}))
vi.mock('../../src/main/ipc/actions', async (original) => ({ ...(await original<object>()), sharedLauncher: () => stand.launcher }))
vi.mock('../../src/main/ipc/checks', async (original) => ({ ...(await original<object>()), sharedPrTracker: () => ({ read: () => Promise.resolve({ pulls: [] }) }) }))
vi.mock('../../src/main/harness/locate', async (original) => ({
  ...(await original<object>()),
  currentHarness: () => ({ kind: stand.harness, binDir: '/nowhere', gateDir: '/nowhere', harnessHome: '/nowhere', checked: ['/nowhere', '/nowhere'] }),
}))

const { sharedAutopilot, sharedChatStarts } = await import('../../src/main/ipc/autopilot')

/** What the app's Autopilot was built with. */
const deps = (): AutopilotDeps => (sharedAutopilot() as unknown as { deps: AutopilotDeps }).deps

afterEach(() => {
  vi.clearAllMocks()
  stand.harness = 'plugin'
})

describe('the deps of the app\'s Autopilot (worfy-throughput ticket 52)', () => {
  it('newUnattendedSession goes to the app\'s Orchestrators, and its answer back', async () => {
    await expect(deps().orchestrators.newUnattendedSession('demo-00000052')).resolves.toEqual({ projectId: 'demo-00000052', sessionId: 'new-session' })
    expect(stand.orchestrators.newUnattendedSession).toHaveBeenCalledWith('demo-00000052')
  })

  it('"Run wave" goes to the app\'s launcher with the brief, both ways, and with the named Tickets of the run (worfy-flight-recorder ticket 21)', async () => {
    await expect(deps().waves.autopilotWave('demo-00000052', 'demo', [1], true)).resolves.toMatchObject({ text: 'with brief' })
    await expect(deps().waves.autopilotWave('demo-00000052', 'demo', [], false)).resolves.toMatchObject({ text: 'without' })
    await deps().waves.autopilotWave('demo-00000052', 'demo', [], false, [5, 6])
    expect(stand.launcher.autopilotWave.mock.calls).toEqual([
      ['demo-00000052', 'demo', [1], true, undefined],
      ['demo-00000052', 'demo', [], false, undefined],
      ['demo-00000052', 'demo', [], false, [5, 6]],
    ])
  })

  it('the Harness is the one found on the machine, read on each call', () => {
    expect(deps().harness()).toBe('plugin')
    stand.harness = 'legacy'
    expect(deps().harness()).toBe('legacy')
  })
})

describe("a run that waits for the busy Orchestrator, over the app's Orchestrators (worfy-autopilot-queue ticket 07)", () => {
  it("busy, Start now and the machine of the Orchestrator go to the app's Orchestrators, and their answers back", async () => {
    expect(deps().orchestrators.busy?.('demo-00000007')).toEqual({ turn: true, queued: 0, tasks: [] })
    expect(stand.orchestrators.busy).toHaveBeenCalledWith('demo-00000007')
    await expect(deps().orchestrators.takeNow?.('demo-00000007', undefined, 100)).resolves.toEqual({ view: { projectId: 'demo-00000007', sessionId: 'orchestrator-session' }, killed: [] })
    expect(stand.orchestrators.takeNow).toHaveBeenCalledWith('demo-00000007', undefined, 100)
    expect(deps().orchestrators.runsOn?.('demo-00000007')).toBe('claude')
  })
})

describe("the app's starts from a chat (worfy-polish ticket 50)", () => {
  /** autopilot_start confirmed in a turn of the Project's Orchestrator. */
  const fromTurn = () => sharedChatStarts().startFromChat({ projectId: 'demo-00000050', epic: 'demo', by: 'tool', session: 'orchestrator-session', mode: 'fastest' })

  // The run itself is Autopilot's (autopilot-wait.test.ts); here the app's Autopilot answers with a
  // run that waits for the Orchestrator, and the chat is told so instead of a refusal.
  it('a busy Orchestrator, also the one whose turn asked, does not refuse: the run waits and the chat is told so', async () => {
    vi.spyOn(sharedAutopilot(), 'runningEpic').mockReturnValue(null)
    const start = vi.spyOn(sharedAutopilot(), 'start').mockResolvedValue({ projectId: 'demo-00000050', epic: 'demo', status: 'waiting', waitingFor: 'orchestrator' } as never)
    await expect(fromTurn()).resolves.toEqual({ kind: 'after-turn', message: WAIT_MESSAGE })
    expect(start).toHaveBeenCalledWith('demo-00000050', 'demo', expect.objectContaining({ by: 'tool', mode: 'fastest', override: false }))
  })
})
