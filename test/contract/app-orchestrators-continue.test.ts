// The app's wiring of Auto-continue of a manual turn (src/main/agent/app-orchestrators.ts,
// sharedOrchestratorContinue; worfy-retry ticket 08): on a Vendor other than Claude (Codex) the module
// reads the windows anew before a continuation after the Limits, and it can only do that with the two
// deps the app gives it — the windows as last read (appLimits().windowsOf) and the free read
// (refreshAppUsage, account/rateLimits/read on Codex). Without them a continuation would go into a window
// still used up. The module itself is real; the Limits tracker, the read and the registry stand in, and
// the settings store lives in a data folder of the test.
import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OrchestratorContinueDeps } from '../../src/main/agent/orchestrator-continue'
import type { LimitWindow } from '../../src/shared/agent/limits'
import { removeTestTree } from '../remove'

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => '/nowhere', on: () => undefined },
  BrowserWindow: { getAllWindows: () => [], fromWebContents: () => null },
}))

const WINDOWS: LimitWindow[] = [
  { vendor: 'codex', id: 'primary', label: '5h', usedPercent: 100, windowMinutes: 300, resetsAt: 1_793_003_600, state: 'reached', receivedAt: 1_793_000_000_000, source: 'read' },
]

const stand = vi.hoisted(() => ({
  deps: null as OrchestratorContinueDeps | null,
  windowsOf: null as unknown as (vendor: string) => readonly LimitWindow[] | null,
  refresh: null as unknown as (maxAgeMs: number, vendor?: string) => Promise<void>,
}))

vi.mock('../../src/main/agent/app-registry', async (original) => ({
  ...(await original<object>()),
  sharedRegistry: () => ({ observe: () => () => undefined, get: () => { throw new Error('no Session in this test') } }),
}))
vi.mock('../../src/main/agent/limits', async (original) => ({
  ...(await original<object>()),
  appLimits: () => ({ snapshot: () => ({ windows: {} }), windowsOf: (vendor: string) => stand.windowsOf(vendor) }),
}))
vi.mock('../../src/main/agent/limits-usage', async (original) => ({
  ...(await original<object>()),
  refreshAppUsage: (maxAgeMs: number, vendor?: string) => stand.refresh(maxAgeMs, vendor),
}))
// The real module, recording the deps the app made it with.
vi.mock('../../src/main/agent/orchestrator-continue', async (original) => {
  const real = await original<typeof import('../../src/main/agent/orchestrator-continue')>()
  class Recorded extends real.OrchestratorContinue {
    constructor(deps: OrchestratorContinueDeps) {
      super(deps)
      stand.deps = deps
    }
  }
  return { ...real, OrchestratorContinue: Recorded }
})

let data: string

beforeEach(() => {
  data = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-app-orchestrators-continue-')))
  vi.stubEnv('WORFY_DATA_DIR', data)
  stand.deps = null
  stand.windowsOf = vi.fn((vendor: string) => (vendor === 'codex' ? WINDOWS : null))
  stand.refresh = vi.fn(() => Promise.resolve())
})

afterEach(() => {
  vi.unstubAllEnvs()
  removeTestTree(data)
})

describe('sharedOrchestratorContinue: the reads of the windows on Codex (worfy-retry ticket 08)', () => {
  it("gives the module the windows as the app last read them and the app's read of the Limits, for the Vendor it names", async () => {
    const { sharedOrchestratorContinue } = await import('../../src/main/agent/app-orchestrators')
    const made = sharedOrchestratorContinue()
    try {
      const deps = stand.deps
      expect(deps).not.toBeNull()

      expect(deps!.windows?.('codex')).toEqual(WINDOWS)
      expect(stand.windowsOf).toHaveBeenCalledWith('codex')

      expect(deps!.usage).toBeDefined()
      await deps!.usage!.refresh(0, 'codex')
      expect(stand.refresh).toHaveBeenCalledWith(0, 'codex')
    } finally {
      made.stop()
    }
  })
})
