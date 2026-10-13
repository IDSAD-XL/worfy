// The status dot next to the "Machines" heading of the sidebar (src/renderer/machines/machines-dot.ts):
// which dot the Linked machines call for, and what it says to a tooltip and a screen reader.
import { describe, expect, it } from 'vitest'
import { machinesDot } from '../../src/renderer/machines/machines-dot'

type Machine = Parameters<typeof machinesDot>[0][number]

const online: Machine = { state: 'online', certificateChanged: false }
const sleeping: Machine = { state: 'sleeping', certificateChanged: false }
const unavailable: Machine = { state: 'unavailable', certificateChanged: false }

describe('machinesDot', () => {
  it('no Linked machine: no dot', () => {
    expect(machinesDot([])).toBeNull()
  })

  it('one online: green, "1 linked machine online"', () => {
    expect(machinesDot([online])).toStrictEqual({ kind: 'online', label: '1 linked machine online' })
  })

  it('two online: green, "2 linked machines online"; the ones not online are not counted', () => {
    expect(machinesDot([online, online])).toStrictEqual({ kind: 'online', label: '2 linked machines online' })
    expect(machinesDot([online, sleeping, online, unavailable])).toStrictEqual({ kind: 'online', label: '2 linked machines online' })
    expect(machinesDot([sleeping, online])).toStrictEqual({ kind: 'online', label: '1 linked machine online' })
  })

  it('sleeping and unavailable only: no dot', () => {
    expect(machinesDot([sleeping])).toBeNull()
    expect(machinesDot([unavailable])).toBeNull()
    expect(machinesDot([sleeping, unavailable])).toBeNull()
  })

  it('online with a changed certificate: amber, and it is not counted as online', () => {
    expect(machinesDot([{ state: 'online', certificateChanged: true }])).toStrictEqual({
      kind: 'certificate-changed',
      label: 'Certificate changed — link the machine again',
    })
  })

  it('one online and another with a changed certificate: amber wins, whatever the order and the state of the other', () => {
    const amber = { kind: 'certificate-changed', label: 'Certificate changed — link the machine again' }
    expect(machinesDot([online, { state: 'online', certificateChanged: true }])).toStrictEqual(amber)
    expect(machinesDot([{ state: 'unavailable', certificateChanged: true }, online])).toStrictEqual(amber)
    expect(machinesDot([{ state: 'sleeping', certificateChanged: true }])).toStrictEqual(amber)
  })
})
