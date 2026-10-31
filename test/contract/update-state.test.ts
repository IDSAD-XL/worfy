// The state file of Update (worfy-update ticket 01): `<dataRoot>/update/state.json` in the
// temporary data folder of the test (test/setup-contract.ts sets WORFY_DATA_DIR), written and read
// back; a file that does not read is set aside and the state starts empty.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { dataRoot } from '../../src/main/storage/paths'
import { changeUpdateState, emptyUpdateState, readUpdateState, updateStateFile } from '../../src/main/update/state'

/** A state file of its own for each test, in the data folder of the test file. */
const fresh = (): string => updateStateFile(mkdtempSync(join(dataRoot(), 'case-')))

describe('the state file of Update', () => {
  it('lies in update/ of the data folder', () => {
    expect(updateStateFile()).toBe(join(dataRoot(), 'update', 'state.json'))
  })

  it('reads empty before the first write, then what was written', () => {
    const file = fresh()
    expect(existsSync(file)).toBe(false)
    expect(readUpdateState(file)).toEqual(emptyUpdateState())
    expect(emptyUpdateState()).toEqual({
      lastCheck: null,
      available: null,
      build: { phase: 'idle' },
      idle: false,
      previous: null,
      rolledBackFrom: null,
      harnessBehind: null,
      running: null,
      lastRestart: null,
      harnessAfterUpdate: null,
    })

    const written = changeUpdateState((state) => ({
      ...state,
      lastCheck: { at: '2026-10-31T10:00:00.000Z', result: 'ok' },
      available: { sha: 'abcdef0123', version: '0.4.0+abcdef0', quiet: false },
      running: { commit: '1111111', version: '0.3.0+1111111' },
    }), file)
    expect(readUpdateState(file)).toEqual(written)
    expect(readUpdateState(file).available?.version).toBe('0.4.0+abcdef0')
  })

  it('sets a file that does not read aside and starts empty', () => {
    const file = fresh()
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, '{ not json')
    expect(readUpdateState(file)).toEqual(emptyUpdateState())
    expect(existsSync(file)).toBe(false)
    expect(readdirSync(dirname(file)).some((name) => name.startsWith('state.json.unreadable-'))).toBe(true)

    writeFileSync(file, JSON.stringify({ available: { sha: 'not a sha', version: 'x', quiet: false } }))
    expect(readUpdateState(file)).toEqual(emptyUpdateState())
  })

  it('reads a file without some fields with their empty values', () => {
    const file = fresh()
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify({ lastCheck: { at: '2026-10-31T10:00:00.000Z', result: 'skipped', reason: 'HTTP 429' } }))
    expect(readUpdateState(file)).toEqual({ ...emptyUpdateState(), lastCheck: { at: '2026-10-31T10:00:00.000Z', result: 'skipped', reason: 'HTTP 429' } })
  })
})
