import { describe, expect, it } from 'vitest'
import { MOVE_RETRIES, MOVE_RETRY_MS, moveWhenFree } from '../../src/main/storage/move'

/** A rename that answers the given codes in turn and then succeeds; it records every call and wait. */
function model(answers: string[]) {
  const calls: string[] = []
  const waits: number[] = []
  const rename = (from: string, to: string): void => {
    calls.push(`${from} -> ${to}`)
    const code = answers.shift()
    if (code !== undefined) throw Object.assign(new Error(`${code}: rename`), { code })
  }
  return { calls, waits, rename, wait: (ms: number) => void waits.push(ms) }
}

describe('moveWhenFree', () => {
  it.each(['EPERM', 'EBUSY', 'EACCES'])('on Windows waits while the move meets %s, then moves', (code) => {
    const m = model([code, code])
    moveWhenFree('/a', '/b', { platform: 'win32', rename: m.rename, wait: m.wait })
    expect(m.calls).toEqual(['/a -> /b', '/a -> /b', '/a -> /b'])
    expect(m.waits).toEqual([MOVE_RETRY_MS, MOVE_RETRY_MS])
  })

  it('on Windows gives up after its waits and throws what the last try met', () => {
    const m = model(Array.from({ length: 20 }, () => 'EPERM'))
    expect(() => moveWhenFree('/a', '/b', { platform: 'win32', rename: m.rename, wait: m.wait })).toThrow(/EPERM/)
    expect(m.waits).toHaveLength(MOVE_RETRIES)
    expect(m.calls).toHaveLength(MOVE_RETRIES + 1)
  })

  it.each(['ENOENT', 'ENOTEMPTY', 'EXDEV'])('throws %s at once: it does not pass by waiting', (code) => {
    const m = model([code])
    expect(() => moveWhenFree('/a', '/b', { platform: 'win32', rename: m.rename, wait: m.wait })).toThrow(code)
    expect(m.waits).toEqual([])
  })

  it('off Windows makes one try', () => {
    const m = model(['EPERM'])
    expect(() => moveWhenFree('/a', '/b', { platform: 'darwin', rename: m.rename, wait: m.wait })).toThrow(/EPERM/)
    expect(m.calls).toHaveLength(1)
    expect(m.waits).toEqual([])
  })
})
