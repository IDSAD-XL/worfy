// appMemory() (src/main/diagnostics/memory.ts): the sampler of the running app is tied to the
// `memoryIndicator` setting of the app's settings store and stops on `will-quit`. Electron's `app` is
// a stub; the store is a real AppSettingsStore over a temporary app-settings.json.
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { APP_SETTINGS_FILE, AppSettingsStore } from '../../src/main/settings/store'
import { removeTestTree } from '../remove'

const stub = vi.hoisted(() => ({
  metrics: [{ type: 'Browser', memory: { workingSetSize: 300_000 } }],
  reads: 0,
  quit: [] as (() => void)[],
  store: undefined as unknown,
}))

vi.mock('electron', () => ({
  app: {
    getAppMetrics: () => {
      stub.reads += 1
      return stub.metrics
    },
    on: (event: string, listener: () => void) => {
      if (event === 'will-quit') stub.quit.push(listener)
    },
  },
}))

vi.mock('../../src/main/settings/store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/main/settings/store')>()
  return { ...actual, appSettingsStore: () => stub.store }
})

const folder = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-memory-app-')))
afterAll(() => removeTestTree(folder))

describe('appMemory', () => {
  it('starts with the setting as stored, follows its changes, is one sampler, and stops on will-quit', async () => {
    vi.useFakeTimers()
    try {
      const file = join(folder, APP_SETTINGS_FILE)
      writeFileSync(file, JSON.stringify({ memoryIndicator: false }))
      const store = new AppSettingsStore(file)
      stub.store = store
      const { appMemory } = await import('../../src/main/diagnostics/memory')

      const sampler = appMemory()
      expect(appMemory()).toBe(sampler)
      const samples: number[] = []
      sampler.subscribe((usage) => samples.push(usage.totalKb))
      // Off at the start: nothing runs, nothing is read.
      expect(sampler.running).toBe(false)
      vi.advanceTimersByTime(20_000)
      expect(stub.reads).toBe(0)

      // Turned on in Settings: the figure gets its first sample at once.
      store.set({ memoryIndicator: true })
      expect(sampler.running).toBe(true)
      expect(samples).toEqual([300_000])
      expect(stub.reads).toBe(1)

      store.set({ memoryIndicator: false })
      expect(sampler.running).toBe(false)
      store.set({ memoryIndicator: true })
      expect(sampler.running).toBe(true)

      expect(stub.quit).toHaveLength(1)
      stub.quit[0]!()
      expect(sampler.running).toBe(false)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
})
