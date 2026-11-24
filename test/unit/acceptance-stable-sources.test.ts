// What the Stable copy line reads in the app (src/main/ipc/acceptance.ts, stableSources; worfy-acceptance ticket 02): the
// commit of the Stable copy is this run's own commit (read once) when this run is the Stable copy — never the `running`
// an earlier update check saved, which is the copy before a restart into an Update — else the one the file next to the
// copy names; whether this copy checks for updates and its Available update come from the Update snapshot.
import { describe, expect, it, vi } from 'vitest'
import type { UpdateSnapshot } from '../../src/shared/ipc/update'

vi.mock('electron', () => ({ app: { on: () => undefined, getPath: () => '/tmp', isPackaged: false }, BrowserWindow: { getAllWindows: () => [] } }))

const OWN = 'a'.repeat(40)
const SAVED = 'd'.repeat(40)
const FILE = 'b'.repeat(40)

type Snapshot = Pick<UpdateSnapshot, 'enabled' | 'available' | 'running'>

const on: Snapshot = { enabled: true, available: { sha: 'c'.repeat(40), version: '0.4.0+ccccccc', quiet: false }, running: { commit: SAVED, version: '0.4.0+ddddddd' } }

async function sources(thisRunIsStable: boolean, snapshot: Snapshot | null, ownCommit: () => string | null | undefined = () => OWN) {
  const { stableSources } = await import('../../src/main/ipc/acceptance')
  return stableSources({ gh: () => Promise.resolve(''), thisRunIsStable: () => thisRunIsStable, snapshot: () => snapshot, ownCommit, fileCommit: () => FILE })
}

describe('stableSources', () => {
  it('takes this run\'s own commit when this run is the Stable copy, not the `running` an earlier check saved', async () => {
    expect((await sources(true, on)).stableCommit!()).toBe(OWN)
  })

  it('reads this run\'s commit once, and takes the file next to the copy until it is known', async () => {
    const own = vi.fn<() => string | null | undefined>().mockReturnValueOnce(undefined).mockReturnValue(OWN)
    const read = await sources(true, on, own)
    expect(read.stableCommit!()).toBe(FILE)
    expect(read.stableCommit!()).toBe(OWN)
    expect(read.stableCommit!()).toBe(OWN)
    expect(own).toHaveBeenCalledTimes(2)
  })

  it('takes the file next to the copy in any other run', async () => {
    expect((await sources(false, on)).stableCommit!()).toBe(FILE)
    expect((await sources(true, on, () => null)).stableCommit!()).toBe(FILE)
  })

  it('says whether this copy checks for updates, with its Available update', async () => {
    expect((await sources(true, on)).update!()).toEqual({ checks: true, available: on.available })
    expect((await sources(false, { enabled: false, available: null, running: null })).update!()).toEqual({ checks: false, available: null })
    expect((await sources(false, null)).update!()).toEqual({ checks: false, available: null })
  })
})
