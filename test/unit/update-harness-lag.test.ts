// "Harness out of date" (worfy-update ticket 05, spec R10): whether the installed Harness is behind
// the one of this copy, with GitHub's answers from the local stub (test/update-stub.ts), never the
// real GitHub. And the schedule of the check, on fake timers.
import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HarnessState, HarnessStatus } from '../../src/shared/ipc/harness'
import { CHECK_EVERY_MS } from '../../src/main/update/check'
import { updateGitHub, type UpdateGitHub } from '../../src/main/update/github'
import { harnessLag, HarnessLagChecks } from '../../src/main/update/harness-lag'
import { changeUpdateState, readUpdateState, updateStateFile } from '../../src/main/update/state'
import { removeTestTree } from '../remove'
import { closedPort, startUpdateStub, type UpdateStub } from '../update-stub'

const INSTALLED = '0.3.0+aaaaaaa'
const COPY = '0.3.0+bbbbbbb'
const SAME: HarnessState = { kind: 'outdated', from: INSTALLED, to: COPY, sameVersion: true }

let stub: UpdateStub | undefined
let root: string

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-harness-lag-')))
})

afterEach(async () => {
  vi.useRealTimers()
  await stub?.close()
  stub = undefined
  removeTestTree(root)
})

const clientOf = (url: string): UpdateGitHub => updateGitHub({ env: { WORFY_UPDATE_API: url } })

async function withStub(compare: 'ahead' | 'behind' | 'diverged' | 'identical' | 404 | { failWith: number }): Promise<UpdateGitHub> {
  stub =
    typeof compare === 'object'
      ? await startUpdateStub({ head: 'f'.repeat(40), failWith: compare.failWith })
      : await startUpdateStub({ head: 'f'.repeat(40), compare: compare === 404 ? 404 : { status: compare, files: ['harness/x.md'] } })
  return clientOf(stub.url)
}

/** Lets the promises and the file reads of a check run: setImmediate is not faked. */
const settled = async (): Promise<void> => {
  for (let turn = 0; turn < 10; turn += 1) await new Promise<void>((resolve) => setImmediate(resolve))
}

const compares = (): string[] => (stub?.requests ?? []).map((request) => request.path).filter((path) => path.includes('/compare/'))

describe('whether the installed Harness is behind', () => {
  it('one semver from two commits, the copy ahead on GitHub: behind, asked as compare/<installed>...<copy>', async () => {
    const client = await withStub('ahead')
    expect(await harnessLag(SAME, client)).toEqual({ from: INSTALLED, to: COPY })
    expect(compares()).toEqual(['/repos/IDSAD-XL/worfy/compare/aaaaaaa...bbbbbbb'])
  })

  it('the copy behind, diverged, identical or unknown to GitHub: not behind', async () => {
    for (const answer of ['behind', 'diverged', 'identical', 404] as const) {
      const client = await withStub(answer)
      expect(await harnessLag(SAME, client)).toBeNull()
      expect(compares()).toHaveLength(1)
      await stub?.close()
      stub = undefined
    }
  })

  it('GitHub does not answer (no server, or a refusal): null', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    expect(await harnessLag(SAME, clientOf(`http://127.0.0.1:${await closedPort()}`))).toBeNull()
    expect(await harnessLag(SAME, await withStub({ failWith: 500 }))).toBeNull()
    expect(compares()).toHaveLength(1)
  })

  it('a higher semver of the copy (`newer`) is behind without a request', async () => {
    const client = await withStub('behind')
    expect(await harnessLag({ kind: 'outdated', from: '0.2.0+aaaaaaa', to: COPY, sameVersion: false }, client)).toEqual({ from: '0.2.0+aaaaaaa', to: COPY })
    expect(stub?.requests).toEqual([])
  })

  it('asks nothing when the installed Harness is the newer semver, the same commit, installed, missing or broken', async () => {
    const client = await withStub('ahead')
    const states: HarnessState[] = [
      { kind: 'outdated', from: '0.4.0+aaaaaaa', to: COPY, sameVersion: false },
      { kind: 'outdated', from: `${COPY}.dirty`, to: COPY, sameVersion: true },
      { kind: 'outdated', from: null, to: COPY, sameVersion: false },
      { kind: 'installed', version: COPY, enabled: true },
      { kind: 'not-installed' },
      { kind: 'error', step: 'install', reason: 'stub' },
    ]
    for (const state of states) expect(await harnessLag(state, client)).toBeNull()
    expect(stub?.requests).toEqual([])
  })
})

describe('the check of the lag', () => {
  const status = (state: HarnessState): (() => Promise<HarnessStatus>) => () =>
    Promise.resolve({ state, bundledVersion: COPY, canInstall: true, pluginDir: join(root, 'plugin'), dependencies: [] })

  /** A client that counts its comparisons and answers `ahead`. */
  function countingClient(): Pick<UpdateGitHub, 'compare'> & { count: () => number } {
    let count = 0
    return {
      count: () => count,
      compare: () => {
        count += 1
        return Promise.resolve({ ok: true as const, value: { status: 'ahead' as const, files: [], commits: [] } })
      },
    }
  }

  it('writes harnessBehind into the Update state and tells; clears it once the Harness is not behind', async () => {
    const file = updateStateFile(root)
    const onChange = vi.fn()
    let state: HarnessState = SAME
    const checks = new HarnessLagChecks({ status: () => status(state)(), client: countingClient(), stateFile: () => file, onChange })
    await checks.run()
    expect(readUpdateState(file).harnessBehind).toEqual({ from: INSTALLED, to: COPY })
    expect(onChange).toHaveBeenCalledTimes(1)

    // The same answer again changes nothing and tells nobody.
    await checks.run()
    expect(onChange).toHaveBeenCalledTimes(1)

    state = { kind: 'installed', version: COPY, enabled: true }
    await checks.run()
    expect(readUpdateState(file).harnessBehind).toBeNull()
    expect(onChange).toHaveBeenCalledTimes(2)
  })

  it('a failed GitHub read clears a lag known before: null, not the old answer', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const file = updateStateFile(root)
    changeUpdateState((state) => ({ ...state, harnessBehind: { from: INSTALLED, to: COPY } }), file)
    const checks = new HarnessLagChecks({ status: status(SAME), client: clientOf(`http://127.0.0.1:${await closedPort()}`), stateFile: () => file })
    await checks.run()
    expect(readUpdateState(file).harnessBehind).toBeNull()
  })

  it('runs once the Harness install of the start has ended, then once an hour, never more often', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const client = countingClient()
    const checks = new HarnessLagChecks({ status: status(SAME), client, stateFile: () => updateStateFile(root) })
    let installed: () => void = () => undefined
    const stop = checks.start(new Promise<void>((resolve) => (installed = resolve)))

    await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS)
    expect(client.count()).toBe(0)

    installed()
    await settled()
    expect(client.count()).toBe(1)
    await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS - 1)
    expect(client.count()).toBe(1)
    await vi.advanceTimersByTimeAsync(1)
    await settled()
    expect(client.count()).toBe(2)

    stop()
    await vi.advanceTimersByTimeAsync(3 * CHECK_EVERY_MS)
    expect(client.count()).toBe(2)
  })

  it('an install of the start that failed still lets the check begin', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const client = countingClient()
    const stop = new HarnessLagChecks({ status: status(SAME), client, stateFile: () => updateStateFile(root) }).start(Promise.reject(new Error('stub')))
    await settled()
    expect(client.count()).toBe(1)
    stop()
  })

  it('a stop before the install of the start has ended starts nothing', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const client = countingClient()
    let installed: () => void = () => undefined
    const stop = new HarnessLagChecks({ status: status(SAME), client, stateFile: () => updateStateFile(root) }).start(new Promise<void>((resolve) => (installed = resolve)))
    stop()
    installed()
    await vi.advanceTimersByTimeAsync(2 * CHECK_EVERY_MS)
    expect(client.count()).toBe(0)
  })

  it('a check asked while one runs runs once more after it, and every ask meanwhile shares that one', async () => {
    const client = countingClient()
    const checks = new HarnessLagChecks({ status: status(SAME), client, stateFile: () => updateStateFile(root) })
    await Promise.all([checks.run(), checks.run(), checks.run()])
    expect(client.count()).toBe(2)
    await checks.run()
    expect(client.count()).toBe(3)
  })

  it('an install that ends during a check clears the lag at once: the check after it reads the Harness again', async () => {
    const file = updateStateFile(root)
    const client = countingClient()
    let state: HarnessState = SAME
    let reads = 0
    let release: () => void = () => undefined
    const firstRead = new Promise<void>((resolve) => (release = resolve))
    const checks = new HarnessLagChecks({
      status: async () => {
        reads += 1
        const seen = state
        // The first read is slow: the install ends while it runs.
        if (reads === 1) await firstRead
        return status(seen)()
      },
      client,
      stateFile: () => file,
    })
    const first = checks.run()
    state = { kind: 'installed', version: COPY, enabled: true }
    // The install answered `done`: src/main/index.ts asks for a check.
    const afterInstall = checks.run()
    release()
    await Promise.all([first, afterInstall])
    expect(reads).toBe(2)
    expect(readUpdateState(file).harnessBehind).toBeNull()
  })
})
