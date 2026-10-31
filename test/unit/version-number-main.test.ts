// worfy-update ticket 14, main's side: the build number the build writes into main
// (src/main/build-number.ts), and the Update service that numbers this run and the Available update
// (src/main/ipc/update.ts) over a fake GitHub client: no network.
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { appBuildNumber } from '../../src/main/build-number'
import { UpdateService } from '../../src/main/ipc/update'
import type { UpdateGitHub } from '../../src/main/update/github'
import { removeTestTree } from '../remove'

const dirs: string[] = []
afterEach(() => {
  vi.unstubAllGlobals()
  for (const dir of dirs.splice(0)) removeTestTree(dir)
})

describe('appBuildNumber', () => {
  it('is the number the build wrote', () => {
    vi.stubGlobal('__WORFY_BUILD_NUMBER__', 1187)
    expect(appBuildNumber()).toBe(1187)
  })

  it('is undefined for a build without one (null), and where main runs unbuilt', () => {
    expect(appBuildNumber()).toBeUndefined()
    vi.stubGlobal('__WORFY_BUILD_NUMBER__', null)
    expect(appBuildNumber()).toBeUndefined()
  })
})

const RUNNING = 'a'.repeat(40)
const HEAD = 'b'.repeat(40)

const client: UpdateGitHub = {
  headOfMain: () => Promise.resolve({ ok: true, value: HEAD }),
  ciOk: () => Promise.resolve({ ok: true, value: 'success' }),
  compare: () => Promise.resolve({ ok: true, value: { status: 'ahead', files: ['src/main/x.ts'], commits: [], aheadBy: 4 } }),
  packageVersion: () => Promise.resolve({ ok: true, value: '0.3.0' }),
}

function service(number: number | undefined): UpdateService {
  const dir = mkdtempSync(join(tmpdir(), 'worfy-update-number-'))
  dirs.push(dir)
  return new UpdateService({
    enabled: true,
    running: () => ({ commit: RUNNING, version: '0.3.0+aaaaaaa', ...(number === undefined ? {} : { number }) }),
    client,
    stateFile: () => join(dir, 'state.json'),
    broadcast: () => undefined,
  })
}

describe('the Update service', () => {
  it('numbers this run and the Available update: the running number plus ahead_by', async () => {
    const subject = service(1187)
    expect(subject.snapshot().current).toEqual({ version: '0.3.0+aaaaaaa', number: 1187 })
    const snapshot = await subject.check()
    expect(snapshot.running).toEqual({ commit: RUNNING, version: '0.3.0+aaaaaaa', number: 1187 })
    expect(snapshot.available).toEqual({ sha: HEAD, version: '0.3.0+bbbbbbb', quiet: false, number: 1191 })
  })

  it('numbers nothing for a build without a number', async () => {
    const subject = service(undefined)
    expect(subject.snapshot()).not.toHaveProperty('current')
    const snapshot = await subject.check()
    expect(snapshot.available).toEqual({ sha: HEAD, version: '0.3.0+bbbbbbb', quiet: false })
  })
})
