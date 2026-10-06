// keep-awake of an Autopilot run (worfy-daily ticket 04, ADR-0024, src/main/autopilot/power.ts):
// Electron's powerSaveBlocker and the app's will-quit are replaced, so nothing here keeps the real
// Mac awake. Every test ends with no blocker started.
import { afterEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => {
  const started = new Set<number>()
  const quit = new Set<() => void>()
  let next = 1
  return {
    started,
    quit,
    calls: [] as unknown[][],
    powerSaveBlocker: {
      start: (type: string) => {
        const id = next++
        started.add(id)
        electron.calls.push(['start', type, id])
        return id
      },
      stop: (id: number) => {
        started.delete(id)
        electron.calls.push(['stop', id])
      },
      isStarted: (id: number) => started.has(id),
    },
    app: {
      on: (event: string, listener: () => void) => {
        if (event === 'will-quit') quit.add(listener)
      },
      removeListener: (event: string, listener: () => void) => {
        if (event === 'will-quit') quit.delete(listener)
      },
    },
  }
})

vi.mock('electron', () => ({ app: electron.app, powerSaveBlocker: electron.powerSaveBlocker }))

const { KEEP_AWAKE_TYPE, KeepAwake } = await import('../../src/main/autopilot/power')

const quit = () => {
  for (const listener of [...electron.quit]) listener()
}

afterEach(() => {
  quit()
  for (const id of [...electron.started]) electron.powerSaveBlocker.stop(id)
  electron.calls.length = 0
})

describe('KeepAwake', () => {
  it('starts one prevent-app-suspension blocker and stops it', () => {
    const awake = new KeepAwake()
    expect(awake.held).toBe(false)
    awake.start()
    expect(KEEP_AWAKE_TYPE).toBe('prevent-app-suspension')
    expect(electron.calls).toEqual([['start', 'prevent-app-suspension', expect.any(Number)]])
    expect(awake.held).toBe(true)
    expect(electron.started.size).toBe(1)
    awake.stop()
    expect(electron.started.size).toBe(0)
    expect(awake.held).toBe(false)
  })

  it('a second start while held does not start another blocker; a second stop does nothing', () => {
    const awake = new KeepAwake()
    awake.start()
    awake.start()
    expect(electron.started.size).toBe(1)
    awake.stop()
    awake.stop()
    expect(electron.calls.filter((call) => call[0] === 'stop')).toHaveLength(1)
  })

  it('stops the blocker on will-quit, and unsubscribes from will-quit on stop', () => {
    const awake = new KeepAwake()
    awake.start()
    expect(electron.quit.size).toBe(1)
    quit()
    expect(electron.started.size).toBe(0)
    expect(awake.held).toBe(false)
    expect(electron.quit.size).toBe(0)

    const again = new KeepAwake()
    again.start()
    again.stop()
    // The listener does not outlive the run: nothing is left for will-quit to call.
    expect(electron.quit.size).toBe(0)
  })

  it('two runs hold two blockers; each releases only its own', () => {
    const first = new KeepAwake()
    const second = new KeepAwake()
    first.start()
    second.start()
    expect(electron.started.size).toBe(2)
    first.stop()
    expect(electron.started.size).toBe(1)
    expect(second.held).toBe(true)
    second.stop()
    expect(electron.started.size).toBe(0)
  })

  it('can start again after a stop', () => {
    const awake = new KeepAwake()
    awake.start()
    awake.stop()
    awake.start()
    expect(electron.started.size).toBe(1)
    awake.stop()
    expect(electron.started.size).toBe(0)
  })
})
