// How appUpdate() of src/main/ipc/update.ts wires Restarts, over a mocked `electron` (worfy-continuity ticket 08):
// the `quit` it gives Restarts goes through the quit's coordinator (src/main/quit-grace.ts) with the cause `update`,
// not through Electron's own quit; and the idle watch it gives Restarts reads the app's Autopilot through the
// Projects, taking Autopilot as at work until its module is loaded.
//
// Restarts itself is the real class, only its options are noted; nothing here starts the helper or quits. The
// Session registry, Autopilot and the Project store are fakes the tests set (the real ones are tested on their own).
import { describe, expect, it, vi } from 'vitest'
import type { QuitGrace } from '../../src/main/quit-grace'
import type { IdleAutopilot, IdleRun } from '../../src/main/update/idle'
import type { RestartsOptions } from '../../src/main/update/restart'
import type { SuspendCause } from '../../src/shared/autopilot/journal'

const seen = vi.hoisted(() => ({
  quits: 0,
  restarts: [] as unknown[],
  /** The runs of the fake Autopilot, by Project id; none: Autopilot has stopped. */
  runs: new Map<string, unknown>(),
  projects: ['alpha', 'beta'],
}))

vi.mock('electron', () => ({
  app: {
    on: vi.fn(),
    quit: () => void (seen.quits += 1),
    isPackaged: false,
    getPath: () => '/nowhere',
  },
  shell: { openPath: () => Promise.resolve('') },
  BrowserWindow: { getAllWindows: () => [], fromWebContents: () => null },
  dialog: { showMessageBox: () => Promise.reject(new Error('no dialog in this test')) },
}))

vi.mock('../../src/main/update/restart', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/main/update/restart')>()
  class NotedRestarts extends actual.Restarts {
    constructor(options: RestartsOptions) {
      super(options)
      seen.restarts.push(options)
    }
  }
  return { ...actual, Restarts: NotedRestarts }
})

vi.mock('../../src/main/agent/app-registry', () => ({
  sharedRegistry: () => ({ list: () => [], get: () => ({ backgroundTasks: () => [] }), observe: () => () => undefined }),
}))

vi.mock('../../src/main/ipc/autopilot', () => ({
  sharedAutopilot: (): IdleAutopilot => ({
    anyRunning: () => seen.runs.size > 0,
    running: (projectId) => seen.runs.has(projectId),
    state: (projectId) => seen.runs.get(projectId) as ReturnType<IdleAutopilot['state']>,
  }),
}))

vi.mock('../../src/main/projects/store', () => ({
  projectStore: () => ({ list: () => seen.projects.map((id) => ({ id })) }),
}))

const { appUpdate } = await import('../../src/main/ipc/update')
const { setAppQuitGrace } = await import('../../src/main/quit-grace')

const WAVE: IdleRun = { status: 'running', stopping: false }
const LIMITS: IdleRun = { status: 'waiting', waitingFor: 'limits', stopping: false }

/** The options appUpdate() gave Restarts. */
function restartsOptions(): RestartsOptions {
  appUpdate()
  expect(seen.restarts).toHaveLength(1)
  return seen.restarts[0] as RestartsOptions
}

describe('appUpdate() wires Restarts', () => {
  // In this order: the first look is taken in the same turn as the first appUpdate(), before the modules load.
  it('takes Autopilot as at work until its module is loaded, though nothing runs', async () => {
    const { idle } = restartsOptions()
    expect(idle.recheck()).toBe(false)
    // Once loaded, the same quiet world reads as quiet.
    await vi.waitFor(() => expect(idle.recheck()).toBe(true))
  })

  it('a run in the Wait for the Limits of one Project does not hold the restart; a run with a Wave in work does', () => {
    const { idle } = restartsOptions()
    seen.runs.set('beta', LIMITS)
    expect(idle.recheck()).toBe(true)
    seen.runs.set('alpha', WAVE)
    expect(idle.recheck()).toBe(false)
    seen.runs.clear()
    expect(idle.recheck()).toBe(true)
  })

  it('quits for the restart helper through the quit coordinator with the cause update, not app.quit()', () => {
    const { quit } = restartsOptions()
    const causes: SuspendCause[] = []
    setAppQuitGrace({
      leave: (cause: SuspendCause) => {
        causes.push(cause)
        return Promise.resolve()
      },
    } as unknown as QuitGrace)
    quit()
    expect(causes).toEqual(['update'])
    expect(seen.quits).toBe(0)
  })
})
