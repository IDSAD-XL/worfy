// The app's Autopilot (src/main/ipc/autopilot.ts, sharedAutopilot) hands the run what a new SDK
// session per Wave needs (worfy-throughput ticket 52): the Orchestrators' newUnattendedSession, the
// brief of "Run wave" and the kind of the Harness on the machine. The app's Orchestrators, launcher
// and Harness lookup are stand-ins here, so each call is seen as the run's deps make it.
import { afterEach, describe, expect, it, vi } from 'vitest'
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
  },
  launcher: {
    autopilotWave: vi.fn((_projectId: string, _epic: string, _resume: readonly number[], brief: boolean) => Promise.resolve({ text: brief ? 'with brief' : 'without' })),
    autopilotRefusal: vi.fn(() => null),
    autopilotGateQueue: vi.fn(() => Promise.resolve(null)),
    attachAutopilot: vi.fn(),
  },
}))

vi.mock('../../src/main/agent/app-orchestrators', async (original) => ({ ...(await original<object>()), sharedOrchestrators: () => stand.orchestrators }))
vi.mock('../../src/main/ipc/actions', async (original) => ({ ...(await original<object>()), sharedLauncher: () => stand.launcher }))
vi.mock('../../src/main/ipc/checks', async (original) => ({ ...(await original<object>()), sharedPrTracker: () => ({ read: () => Promise.resolve({ pulls: [] }) }) }))
vi.mock('../../src/main/harness/locate', async (original) => ({
  ...(await original<object>()),
  currentHarness: () => ({ kind: stand.harness, binDir: '/nowhere', gateDir: '/nowhere', harnessHome: '/nowhere', checked: ['/nowhere', '/nowhere'] }),
}))

const { sharedAutopilot } = await import('../../src/main/ipc/autopilot')

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
