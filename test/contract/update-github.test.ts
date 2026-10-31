// The GitHub client of the Update check (worfy-update ticket 01) against the local server of
// test/update-stub.ts: no Authorization ever, every request to WORFY_UPDATE_API, and a GitHub that
// does not answer or refuses is a skipped check, not an exception (spec R15). Then the service of
// src/main/ipc/update.ts over it: the state file in the temporary data folder, the running commit
// from the file next to a Stable copy in the temporary folder.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { UpdateSnapshot } from '../../src/shared/ipc/update'
import { UpdateService } from '../../src/main/ipc/update'
import { checkForUpdate } from '../../src/main/update/check'
import { updateGitHub } from '../../src/main/update/github'
import { readStableMetadata, runningOf, stableCopyPath } from '../../src/main/update/stable-copy'
import { readUpdateState, updateStateFile } from '../../src/main/update/state'
import { removeTestTree } from '../remove'
import { assertTemporaryStableCopy, closedPort, startUpdateStub, type UpdateStub } from '../update-stub'

const RUNNING = '1'.repeat(40)
const HEAD = 'abcdef0' + '2'.repeat(33)

let stub: UpdateStub | undefined
const folders: string[] = []

afterEach(async () => {
  vi.unstubAllEnvs()
  await stub?.close()
  stub = undefined
  for (const folder of folders.splice(0)) removeTestTree(folder)
})

/** The client over the stub, given the whole process environment, as main has it. */
function clientWithTokens(url: string, fetchSpy?: typeof fetch) {
  vi.stubEnv('GH_TOKEN', 'gh-token-of-the-user')
  vi.stubEnv('GITHUB_TOKEN', 'github-token-of-the-user')
  vi.stubEnv('WORFY_UPDATE_API', url)
  return updateGitHub({ env: process.env, ...(fetchSpy === undefined ? {} : { fetch: fetchSpy }) })
}

describe('the GitHub client of Update', () => {
  it('sends no Authorization in any request while GH_TOKEN and GITHUB_TOKEN are set, and asks only WORFY_UPDATE_API', async () => {
    stub = await startUpdateStub({ head: HEAD, version: '0.5.1', compare: { status: 'ahead', files: ['docs/a.md', 'src/main/x.ts'] } })
    const asked: string[] = []
    const spy: typeof fetch = (input, init) => {
      asked.push(String(input))
      return fetch(input, init)
    }
    const outcome = await checkForUpdate({ client: clientWithTokens(stub.url, spy), running: RUNNING, rolledBackFrom: null, manual: false })

    expect(outcome.available).toEqual({ sha: HEAD, version: '0.5.1+abcdef0', quiet: false })
    // The four reads, every one of them to the stub.
    expect(stub.requests.map((request) => request.path)).toEqual([
      '/repos/IDSAD-XL/worfy/branches/main',
      `/repos/IDSAD-XL/worfy/commits/${HEAD}/check-runs?check_name=ci-ok`,
      `/repos/IDSAD-XL/worfy/compare/${RUNNING}...${HEAD}`,
      `/repos/IDSAD-XL/worfy/contents/package.json?ref=${HEAD}`,
    ])
    expect(asked).toHaveLength(stub.requests.length)
    expect(asked.every((url) => url.startsWith(`${stub?.url}/`))).toBe(true)
    for (const request of stub.requests) {
      expect(request.headers.authorization).toBeUndefined()
      expect(JSON.stringify(request.headers)).not.toContain('token-of-the-user')
    }
  })

  it('skips the check without an exception when nothing listens on the address', async () => {
    const client = clientWithTokens(`http://127.0.0.1:${await closedPort()}`)
    const outcome = await checkForUpdate({ client, running: RUNNING, rolledBackFrom: null, manual: false })
    expect(outcome.lastCheck.result).toBe('skipped')
    expect(outcome.lastCheck.reason).toContain('/branches/main')
    expect(outcome.available).toBeUndefined()
  })

  it.each([403, 429, 500, 503])('skips the check without an exception on HTTP %i', async (status) => {
    stub = await startUpdateStub({ head: HEAD, failWith: status })
    const outcome = await checkForUpdate({ client: clientWithTokens(stub.url), running: RUNNING, rolledBackFrom: null, manual: false })
    expect(outcome.lastCheck).toMatchObject({ result: 'skipped', reason: expect.stringContaining(`HTTP ${status}`) as string })
    expect(stub.requests).toHaveLength(1)
  })

  it('skips the check when GitHub gives no answer in time', async () => {
    // A fetch that never answers on its own, only to the abort of the time limit.
    const hanging: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason as Error))
      })
    const client = updateGitHub({ env: { WORFY_UPDATE_API: 'http://127.0.0.1:9' }, fetch: hanging, timeoutMs: 20 })
    expect(await client.headOfMain()).toEqual({ ok: false, reason: 'GET /repos/IDSAD-XL/worfy/branches/main: no answer in 0.02 s' })
  })

  it('reads a comparison GitHub does not know (404) as none, and finds no Update', async () => {
    stub = await startUpdateStub({ head: HEAD, compare: 404 })
    const client = clientWithTokens(stub.url)
    expect(await client.compare(RUNNING, HEAD)).toEqual({ ok: true, value: null })
    const outcome = await checkForUpdate({ client, running: RUNNING, rolledBackFrom: null, manual: false })
    expect(outcome).toMatchObject({ lastCheck: { result: 'ok' }, available: null })
  })

  it('reads ci-ok pending, red and missing as such', async () => {
    stub = await startUpdateStub({ head: HEAD, ciOk: { status: 'in_progress', conclusion: null } })
    const client = clientWithTokens(stub.url)
    expect(await client.ciOk(HEAD)).toEqual({ ok: true, value: 'pending' })
    stub.answers = { head: HEAD, ciOk: { status: 'completed', conclusion: 'failure' } }
    expect(await client.ciOk(HEAD)).toEqual({ ok: true, value: 'failure' })
    stub.answers = { head: HEAD, ciOk: null }
    expect(await client.ciOk(HEAD)).toEqual({ ok: true, value: 'missing' })
  })

  it('refuses an address that is not http(s) without a request', async () => {
    const client = updateGitHub({ env: { WORFY_UPDATE_API: 'file:///etc' } })
    expect(await client.headOfMain()).toEqual({ ok: false, reason: 'WORFY_UPDATE_API is not an http(s) address: file:///etc' })
  })
})

describe('the Update service over the stub', () => {
  it('writes the Available update and the running commit of the Stable copy into the state file', async () => {
    const temp = mkdtempSync(join(tmpdir(), 'worfy-update-'))
    folders.push(temp)
    const copy = join(temp, 'worfy-stable.app')
    stub = await startUpdateStub({ head: HEAD, version: '0.6.0' }, { stable: copy })
    mkdirSync(copy)
    writeFileSync(join(temp, 'worfy-stable.json'), JSON.stringify({ commit: RUNNING, dirty: false }))
    expect(stableCopyPath('darwin', { WORFY_UPDATE_STABLE: copy }, '/Users/u')).toBe(copy)
    const running = runningOf(readStableMetadata('darwin', copy), '0.3.0+1111111')

    const sent: UpdateSnapshot[] = []
    const service = new UpdateService({
      enabled: true,
      running: () => running,
      client: updateGitHub({ env: { WORFY_UPDATE_API: stub.url } }),
      stateFile: () => updateStateFile(),
      broadcast: (snapshot) => sent.push(snapshot),
    })
    const snapshot = await service.check()

    expect(snapshot).toMatchObject({ enabled: true, checking: false, running: { commit: RUNNING, version: '0.3.0+1111111' }, available: { sha: HEAD, version: '0.6.0+abcdef0', quiet: false } })
    expect(readUpdateState()).toMatchObject({ lastCheck: { result: 'ok' }, available: { sha: HEAD } })
    // The windows hear the check begin and end.
    expect(sent.map((each) => each.checking)).toEqual([true, false])

    // A skipped check keeps the Update known before.
    stub.answers = { head: HEAD, failWith: 429 }
    expect(await service.check()).toMatchObject({ lastCheck: { result: 'skipped' }, available: { sha: HEAD } })
  })

  it('refuses a Stable copy outside the temporary folder', () => {
    expect(() => assertTemporaryStableCopy(stableCopyPath('darwin', {}, '/Users/u'))).toThrow(/temporary folder/u)
    expect(() => assertTemporaryStableCopy('C:\\Users\\u\\AppData\\Local\\worfy-stable')).toThrow(/temporary folder/u)
  })

  it('checks nothing and reads no file when Update is off', async () => {
    stub = await startUpdateStub({ head: HEAD })
    const service = new UpdateService({
      enabled: false,
      running: () => ({ commit: RUNNING, version: '0.3.0+1111111' }),
      client: updateGitHub({ env: { WORFY_UPDATE_API: stub.url } }),
      stateFile: () => {
        throw new Error('the state file is not asked for when Update is off')
      },
      broadcast: () => undefined,
    })
    expect(await service.check()).toMatchObject({ enabled: false, checking: false, available: null })
    const stop = service.start()
    stop()
    expect(stub.requests).toHaveLength(0)
  })
})
