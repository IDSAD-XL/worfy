// What the Stable copy line reads in the app (src/main/ipc/acceptance.ts, stableSources; worfy-acceptance ticket 02): the
// commit of the Stable copy is the one Update gives this run when this run is the Stable copy, else the one the file
// next to the copy names; whether this copy checks for updates and its Available update come from the Update snapshot.
import { describe, expect, it, vi } from 'vitest'
import type { UpdateSnapshot } from '../../src/shared/ipc/update'

vi.mock('electron', () => ({ app: { on: () => undefined, getPath: () => '/tmp', isPackaged: false }, BrowserWindow: { getAllWindows: () => [] } }))

const RUNNING = 'a'.repeat(40)
const FILE = 'b'.repeat(40)

type Snapshot = Pick<UpdateSnapshot, 'enabled' | 'available' | 'running'>

async function sources(thisRunIsStable: boolean, snapshot: Snapshot | null) {
  const { stableSources } = await import('../../src/main/ipc/acceptance')
  return stableSources({ gh: () => Promise.resolve(''), thisRunIsStable: () => thisRunIsStable, snapshot: () => snapshot, fileCommit: () => FILE })
}

const on: Snapshot = { enabled: true, available: { sha: 'c'.repeat(40), version: '0.4.0+ccccccc', quiet: false }, running: { commit: RUNNING, version: '0.4.0+aaaaaaa' } }

describe('stableSources', () => {
  it('takes the commit Update gives this run when this run is the Stable copy, before the file next to the copy', async () => {
    expect((await sources(true, on)).stableCommit!()).toBe(RUNNING)
  })

  it('takes the file next to the copy in any other run, and when Update has no commit yet', async () => {
    expect((await sources(false, on)).stableCommit!()).toBe(FILE)
    expect((await sources(true, { ...on, running: null })).stableCommit!()).toBe(FILE)
    expect((await sources(true, null)).stableCommit!()).toBe(FILE)
  })

  it('says whether this copy checks for updates, with its Available update', async () => {
    expect((await sources(true, on)).update!()).toEqual({ checks: true, available: on.available })
    expect((await sources(false, { enabled: false, available: null, running: null })).update!()).toEqual({ checks: false, available: null })
    expect((await sources(false, null)).update!()).toEqual({ checks: false, available: null })
  })
})
