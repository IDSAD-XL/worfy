// The `app.version` handler (src/main/ipc/app.ts) answers the build number the build wrote into main
// (__WORFY_BUILD_NUMBER__, src/main/build-number.ts; worfy-update ticket 14), and nothing for a build
// without one. CI's e2e run from a shallow clone, so the chain build → app.version → toolbar is
// pinned here as well.
import { afterEach, describe, expect, it, vi } from 'vitest'
import handlers from '../../src/main/ipc/app'

vi.mock('electron', () => ({ app: { getVersion: () => '0.3.0', isPackaged: false } }))

afterEach(() => {
  vi.unstubAllGlobals()
})

const answer = () => handlers[0]!.handle(undefined as never, {} as never)

describe('app.version', () => {
  it('answers the build number with the build version', async () => {
    vi.stubGlobal('__WORFY_BUILD_NUMBER__', 1187)
    expect(await answer()).toEqual({ version: '0.3.0', packaged: false, number: 1187 })
  })

  it('answers no number for a build without one', async () => {
    vi.stubGlobal('__WORFY_BUILD_NUMBER__', null)
    expect(await answer()).toEqual({ version: '0.3.0', packaged: false })
    expect(await answer()).not.toHaveProperty('number')
  })
})
