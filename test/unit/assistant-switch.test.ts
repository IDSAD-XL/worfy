// The switch of the Assistant (worfy-assistant ticket 15; owner's decisions 7 and 10): the setting «Assistant on this
// machine» starts and stops it, and the section of the window hears of each turn (AssistantWindow.changed). On the way
// in: the setting and its changes; on the way out: the start, the stop and the change of the section.
import { describe, expect, it } from 'vitest'
import { followAssistantSwitch } from '../../src/main/assistant/session/switch'

function harness(initial: boolean, { startFails = false, introduce = false } = {}) {
  let on = initial
  const listeners = new Set<() => void>()
  const calls: string[] = []
  const stopSwitch = followAssistantSwitch({
    on: () => on,
    onChange: (listener) => {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    start: () => {
      calls.push('start')
      return startFails ? null : () => void calls.push('stop')
    },
    changed: () => void calls.push('changed'),
    ...(introduce
      ? { started: (atStartup: boolean) => void calls.push(`started ${atStartup ? 'with worfy' : 'later'}`), turnedOn: () => void calls.push('turned on') }
      : {}),
    log: (message) => void calls.push(`log: ${message}`),
  })
  const turn = (next: boolean): void => {
    on = next
    for (const listener of [...listeners]) listener()
  }
  return { calls, turn, stopSwitch, listeners }
}

describe('the switch of the Assistant', () => {
  it('off at the start of worfy: nothing starts, and a change of other settings starts nothing', () => {
    const { calls, turn } = harness(false)
    turn(false)
    expect(calls).toEqual([])
  })

  it('on at the start of worfy: the Assistant starts once and the section hears of it', () => {
    const { calls, turn } = harness(true)
    turn(true)
    expect(calls).toEqual(['start', 'changed'])
  })

  it('turned on and off in Settings: started, then stopped, the section told each time', () => {
    const { calls, turn } = harness(false)
    turn(true)
    turn(false)
    turn(false)
    expect(calls).toEqual(['start', 'changed', 'stop', 'changed'])
  })

  it('a start that does not take (the attention core is not running) is logged, and the next change tries again', () => {
    const { calls, turn } = harness(true, { startFails: true })
    expect(calls).toEqual(['start', 'log: the Assistant did not start: the attention core is not running'])
    turn(true)
    expect(calls.filter((call) => call === 'start')).toHaveLength(2)
  })

  it('its stop stops the running Assistant and no longer follows the setting', () => {
    const { calls, turn, stopSwitch, listeners } = harness(true)
    stopSwitch()
    expect(calls).toEqual(['start', 'changed', 'stop'])
    expect(listeners.size).toBe(0)
    turn(false)
    expect(calls).toHaveLength(3)
  })

  it('after each start the introduction hears of it, and whether the start came with worfy\'s own (worfy-assistant ticket 16)', () => {
    const atStart = harness(true, { introduce: true })
    expect(atStart.calls).toEqual(['start', 'changed', 'started with worfy'])
    const later = harness(false, { introduce: true })
    later.turn(true)
    later.turn(false)
    later.turn(true)
    expect(later.calls).toEqual(['turned on', 'start', 'changed', 'started later', 'stop', 'changed', 'turned on', 'start', 'changed', 'started later'])
  })

  it('a start that does not take tells the introduction nothing', () => {
    const { calls } = harness(true, { startFails: true, introduce: true })
    expect(calls.some((call) => call.startsWith('started'))).toBe(false)
  })

  it('turned on by the person while the start does not take: the introduction is owed before the start, so a later start keeps it', () => {
    const { calls, turn } = harness(false, { startFails: true, introduce: true })
    turn(true)
    expect(calls.slice(0, 2)).toEqual(['turned on', 'start'])
    expect(calls.some((call) => call.startsWith('started'))).toBe(false)
  })

  it('on since worfy started: nothing is owed by a turn of the switch', () => {
    const { calls } = harness(true, { introduce: true })
    expect(calls).not.toContain('turned on')
  })
})
