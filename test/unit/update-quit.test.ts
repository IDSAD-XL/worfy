// The quit of Restart now of an Update (src/main/ipc/update.ts, worfy-continuity ticket 04) over a mocked `electron`:
// it goes through the quit's coordinator (src/main/quit-grace.ts) with the cause `update`, so the Runs are suspended
// as an Update after the grace for the external calls; Electron's own quit is not asked. Without a coordinator
// (before src/main/index.ts made one) it is app.quit().
import { describe, expect, it, vi } from 'vitest'
import type { QuitGrace } from '../../src/main/quit-grace'
import type { SuspendCause } from '../../src/shared/autopilot/journal'

const seen = vi.hoisted(() => ({ quits: 0 }))

vi.mock('electron', () => ({
  app: {
    on: vi.fn(),
    quit: () => void (seen.quits += 1),
  },
  shell: { openPath: () => Promise.resolve('') },
  BrowserWindow: { getAllWindows: () => [], fromWebContents: () => null },
  dialog: { showMessageBox: () => Promise.reject(new Error('no dialog in this test')) },
}))

const { quitForUpdate } = await import('../../src/main/ipc/update')
const { setAppQuitGrace } = await import('../../src/main/quit-grace')

describe('the quit of Restart now', () => {
  // In this order: the coordinator, once set, stays for the module's life, as in the app.
  it('without the quit coordinator it is app.quit()', () => {
    quitForUpdate()
    expect(seen.quits).toBe(1)
  })

  it('goes through the quit coordinator with the cause update, not app.quit()', () => {
    const causes: SuspendCause[] = []
    setAppQuitGrace({
      leave: (cause: SuspendCause) => {
        causes.push(cause)
        return Promise.resolve()
      },
    } as unknown as QuitGrace)
    seen.quits = 0
    quitForUpdate()
    expect(causes).toEqual(['update'])
    expect(seen.quits).toBe(0)
  })
})
