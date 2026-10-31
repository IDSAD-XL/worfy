// An Update that did not take effect (worfy-update ticket 13, spec R8): restart.json says an install
// of B, the helper's result.json says ok, but the copy that starts is still A (the new copy fell over
// at its start and the owner rolled back by hand with scripts/install-stable.mjs --rollback, which
// leaves both files as they are). The start must tell a failure, not "worfy updated to B", and B goes
// quiet, so "Update automatically" does not build and install it again in a loop.
//
// Over a temporary data folder; the Stable copy is a path in the temporary folder
// (assertTemporaryStableCopy), GitHub an object in this file. Nothing is started. The toast of such a
// lastRestart is test/unit/update-toasts.test.tsx's ("an install that did not take effect").
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { UpdateState } from '../../src/shared/ipc/update'
import { autoBuildFor } from '../../src/main/update/auto'
import { checkForUpdate, type UpdateGitHub } from '../../src/main/update/check'
import type { IdleSignal } from '../../src/main/update/idle'
import { helperScript, restartFile, Restarts, resultFile } from '../../src/main/update/restart'
import { changeUpdateState, readUpdateState } from '../../src/main/update/state'
import { removeTestTree } from '../remove'
import { assertTemporaryStableCopy } from '../update-stub'

const A = 'a'.repeat(40)
const B = 'b'.repeat(40)
const A_VERSION = '0.5.0+aaaaaaa'
const B_VERSION = '0.6.0+bbbbbbb'

const quiet: IdleSignal = { idle: true, recheck: () => true, subscribe: () => () => undefined }

let root: string
let dir: string
let target: string
let stateFile: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'worfy update not taken '))
  dir = join(root, 'data', 'update')
  target = join(root, 'Applications', process.platform === 'win32' ? 'worfy-stable' : 'worfy-stable.app')
  assertTemporaryStableCopy(target)
  stateFile = join(dir, 'state.json')
  mkdirSync(dirname(helperScript(dir)), { recursive: true })
})

afterEach(() => {
  removeTestTree(root)
})

/** The start after "Restart now" into B: restart.json and the helper's ok, B built and Available. */
function restartedInto(): void {
  const appPath = join(dir, 'repo', 'dist', 'worfy.app')
  mkdirSync(appPath, { recursive: true })
  changeUpdateState(
    (state) => ({ ...state, available: { sha: B, version: B_VERSION, quiet: false }, build: { phase: 'ready', sha: B, version: B_VERSION, appPath, log: 'build.log' } }),
    stateFile,
  )
  writeFileSync(restartFile(dir), JSON.stringify({ action: 'install', version: B_VERSION, sha: B, from: { sha: A, version: A_VERSION }, harness: true, at: '2026-10-31T10:00:00.000Z' }))
  writeFileSync(resultFile(dir), JSON.stringify({ ok: true, action: 'install', commit: B, previous: null, notes: [] }))
}

/** worfy starts as the copy `running` names: Restarts.settle of the service's start. */
function startAs(running: { commit: string; version: string }): UpdateState {
  new Restarts({ dir, stateFile: () => stateFile, target: () => target, pid: 4242, env: () => Promise.resolve({}), running: () => running, idle: quiet, quit: () => undefined }).settle()
  return readUpdateState(stateFile)
}

/** GitHub with B as the green head of main, ahead of A and changing the app. */
const github: UpdateGitHub = {
  headOfMain: () => Promise.resolve({ ok: true, value: B }),
  ciOk: () => Promise.resolve({ ok: true, value: 'success' }),
  compare: () => Promise.resolve({ ok: true, value: { status: 'ahead', files: ['src/main/x.ts'], commits: [{ sha: B, message: 'feat: x (#1)' }] } }),
  packageVersion: () => Promise.resolve({ ok: true, value: '0.6.0' }),
}

describe('the start after an install of B, the helper said ok', () => {
  it('A runs: a failure that names A, not the success of B; B is rolled back from and quiet, its build idle', () => {
    restartedInto()

    const state = startAs({ commit: A, version: A_VERSION })

    expect(state.lastRestart).toEqual({
      ok: false,
      action: 'install',
      version: B_VERSION,
      reason: `${A_VERSION} runs instead: the new copy did not start, or was rolled back by hand`,
      at: '2026-10-31T10:00:00.000Z',
    })
    expect(state.rolledBackFrom).toBe(B)
    expect(state.available).toEqual({ sha: B, version: B_VERSION, quiet: true })
    expect(state.build).toEqual({ phase: 'idle' })
  })

  it('A runs, named by its short SHA: the same failure', () => {
    restartedInto()
    const state = startAs({ commit: A.slice(0, 7), version: A_VERSION })
    expect(state.lastRestart).toMatchObject({ ok: false, action: 'install', version: B_VERSION })
    expect(state.rolledBackFrom).toBe(B)
  })

  it('B runs: the success it was, and nothing is rolled back from', () => {
    restartedInto()

    const state = startAs({ commit: B, version: B_VERSION })

    expect(state.lastRestart).toEqual({ ok: true, action: 'install', version: B_VERSION, at: '2026-10-31T10:00:00.000Z' })
    expect(state.rolledBackFrom).toBeNull()
    expect(state.available).toBeNull()
    expect(state.build).toEqual({ phase: 'idle' })
  })

  it('B runs, named by its short SHA: still the success', () => {
    restartedInto()
    const state = startAs({ commit: B.slice(0, 7), version: B_VERSION })
    expect(state.lastRestart).toMatchObject({ ok: true, action: 'install' })
    expect(state.rolledBackFrom).toBeNull()
  })

  it('the running commit is not known (a build without one): the success it was', () => {
    restartedInto()
    const state = startAs({ commit: '', version: '0.5.0' })
    expect(state.lastRestart).toEqual({ ok: true, action: 'install', version: B_VERSION, at: '2026-10-31T10:00:00.000Z' })
    expect(state.rolledBackFrom).toBeNull()
  })

  it('with "Update automatically", the start with A does not build B again: not from the state, not after the next check', async () => {
    restartedInto()
    const state = startAs({ commit: A, version: A_VERSION })
    expect(autoBuildFor(state, true)).toBeNull()

    // The scheduled check of the service (manual: false) with the state's rolledBackFrom.
    const outcome = await checkForUpdate({ client: github, running: A, rolledBackFrom: state.rolledBackFrom, manual: false })
    expect(outcome.available).toEqual({ sha: B, version: B_VERSION, quiet: true })
    expect(autoBuildFor({ ...state, available: outcome.available ?? null }, true)).toBeNull()
  })

  it('with B running, a later commit still builds by itself: the success leaves nothing quiet', async () => {
    restartedInto()
    const state = startAs({ commit: B, version: B_VERSION })
    const C = 'c'.repeat(40)
    const later: UpdateGitHub = { ...github, headOfMain: () => Promise.resolve({ ok: true, value: C }) }
    const outcome = await checkForUpdate({ client: later, running: B, rolledBackFrom: state.rolledBackFrom, manual: false })
    expect(autoBuildFor({ ...state, available: outcome.available ?? null }, true)).toEqual({ sha: C, version: `0.6.0+${C.slice(0, 7)}`, quiet: false })
  })
})
