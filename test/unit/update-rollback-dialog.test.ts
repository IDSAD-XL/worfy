// The native dialog of the roll back (src/main/ipc/update.ts, worfy-update ticket 04) over a mocked
// `electron`: its texts, and that only "Roll back" says yes. Its line on the Harness keeps the case
// where the Harness is not installed: an installed one newer than the copy's own stays
// (src/main/update/harness-after-update.ts answers `current`), owner's decision of 2026-10-31.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { updateRollback, type RestartAnswer } from '../../src/shared/ipc/update'

const seen = vi.hoisted(() => ({ options: [] as Record<string, unknown>[], response: 0 }))

vi.mock('electron', () => ({
  app: { on: vi.fn() },
  shell: { openPath: () => Promise.resolve('') },
  BrowserWindow: { getAllWindows: () => [], fromWebContents: () => null },
  dialog: {
    showMessageBox: (options: Record<string, unknown>) => {
      seen.options.push(options)
      return Promise.resolve({ response: seen.response, checkboxChecked: false })
    },
  },
}))

const { updateHandlers } = await import('../../src/main/ipc/update')
type UpdateService = Parameters<typeof updateHandlers>[0] extends (() => infer S) | undefined ? S : never

/** Presses the roll back with a service whose previous copy is `version`; answers the dialog's yes or no. */
async function pressRollback(version: string): Promise<boolean> {
  let confirmed: boolean | undefined
  const service = {
    rollback: async (confirm: (version: string) => Promise<boolean>): Promise<RestartAnswer> => {
      confirmed = await confirm(version)
      return { outcome: confirmed ? 'quitting' : 'cancelled' }
    },
  } as unknown as UpdateService
  const handler = updateHandlers(() => service).find((one) => one.channel === updateRollback)
  if (handler === undefined) throw new Error('no handler of update.rollback')
  await handler.handle(undefined as never, { event: { sender: {} } as never })
  if (confirmed === undefined) throw new Error('the dialog was not asked')
  return confirmed
}

describe('the dialog of the roll back', () => {
  beforeEach(() => {
    seen.options.length = 0
    seen.response = 0
  })

  it('names the copy and says the Harness is installed unless the installed one is newer', async () => {
    await pressRollback('0.9.0')
    expect(seen.options).toHaveLength(1)
    expect(seen.options[0]).toMatchObject({
      buttons: ['Roll back', 'Cancel'],
      message: 'Roll back to worfy 0.9.0?',
      detail: 'worfy quits, puts the previous copy back and starts it. Its Harness is installed too, unless the one installed is newer.',
    })
  })

  it('"Roll back" says yes, "Cancel" says no', async () => {
    expect(await pressRollback('0.9.0')).toBe(true)
    seen.response = 1
    expect(await pressRollback('0.9.0')).toBe(false)
  })
})
