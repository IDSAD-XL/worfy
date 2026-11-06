// The Epic queue rule (worfy-autopilot-queue ticket 12): from the reason an Epic's cycle stopped and
// the Epic's Tickets, a Run over a queue of Epics goes on to the next Epic (all done, or only the
// owner's Tickets left) or stops as a whole. A wrong skip ends the Run early; a wrong stop leaves it
// standing all night, so every case of the rule has a row here.
import { describe, expect, it } from 'vitest'
import { AUTOPILOT_STOP_REASONS, type AutopilotStopReason } from '../../src/shared/autopilot/cycle'
import { epicOutcome, MAX_QUEUE_EPICS, nextEpic, type EpicFinish } from '../../src/shared/autopilot/epic-queue'
import type { Ticket } from '../../src/shared/workflow/types'

const EPIC = 'demo'

interface Extra {
  waits?: string | null
  fromBranch?: string | null
  epic?: string
  blockedParsed?: boolean
}

const t = (num: number, state: Ticket['state'], blockedNums: number[] = [], extra: Extra = {}): Ticket => ({
  epic: extra.epic ?? EPIC,
  num,
  slug: `slug-${num}`,
  title: `T${num}`,
  statusRaw: state,
  state,
  waits: extra.waits ?? null,
  blockedRaw: blockedNums.length ? blockedNums.join(', ') : '—',
  blockedNums,
  blockedParsed: extra.blockedParsed ?? true,
  files: [`src/f${num}.ts`],
  filesListed: true,
  fromBranch: extra.fromBranch ?? null,
})

const owner = { waits: 'owner' }
const NEXT_DONE = { kind: 'next', outcome: 'done' }
const STOP = { kind: 'stop' }
const waitsOwner = (tickets: number[]) => ({ kind: 'next', outcome: 'waits-owner', tickets })

describe('epicOutcome', () => {
  const cases: { name: string; reason: AutopilotStopReason; tickets: Ticket[]; expected: unknown }[] = [
    { name: 'every Ticket done in the checkout', reason: 'no-ready-wave', tickets: [t(1, 'done'), t(2, 'done', [1])], expected: NEXT_DONE },
    {
      name: 'the named Tickets of a one-Epic Run are done (tickets-done)',
      reason: 'tickets-done',
      tickets: [t(1, 'done'), t(2, 'open', [1])],
      expected: NEXT_DONE,
    },
    {
      name: 'a Ticket done only in its unmerged branch is not done',
      reason: 'no-ready-wave',
      tickets: [t(1, 'done'), t(2, 'done', [], { fromBranch: 'demo/02' })],
      expected: STOP,
    },
    { name: 'one blocked Ticket waits for the owner', reason: 'blocked-tickets', tickets: [t(1, 'done'), t(2, 'blocked', [1], owner)], expected: waitsOwner([2]) },
    {
      name: 'a blocked Ticket waits for the owner and an open one waits for it',
      reason: 'blocked-tickets',
      tickets: [t(1, 'done'), t(2, 'blocked', [1], owner), t(3, 'open', [2])],
      expected: waitsOwner([2, 3]),
    },
    {
      name: 'a chain behind the owner Ticket waits for the owner too',
      reason: 'no-ready-wave',
      tickets: [t(1, 'blocked', [], owner), t(2, 'open', [1]), t(3, 'open', [1, 2]), t(4, 'done')],
      expected: waitsOwner([1, 2, 3]),
    },
    { name: 'the owner is matched without case and spaces', reason: 'blocked-tickets', tickets: [t(1, 'blocked', [], { waits: ' Owner ' })], expected: waitsOwner([1]) },
    { name: 'a blocked Ticket that waits for an agent stops the Run', reason: 'blocked-tickets', tickets: [t(1, 'done'), t(2, 'blocked', [1], { waits: 'agent' })], expected: STOP },
    { name: 'a blocked Ticket that waits for nobody named stops the Run', reason: 'blocked-tickets', tickets: [t(1, 'blocked')], expected: STOP },
    {
      name: 'one owner Ticket beside one that waits for an agent stops the Run',
      reason: 'blocked-tickets',
      tickets: [t(1, 'blocked', [], owner), t(2, 'blocked', [], { waits: 'agent' })],
      expected: STOP,
    },
    {
      name: 'an open Ticket whose blockers are the owner Ticket and an unmerged one stops the Run',
      reason: 'no-ready-wave',
      tickets: [t(1, 'blocked', [], owner), t(2, 'done', [], { fromBranch: 'demo/02' }), t(3, 'open', [1, 2])],
      expected: STOP,
    },
    { name: 'a status-less Ticket is not in Autopilot (skipped by readyWave)', reason: 'blocked-tickets', tickets: [t(1, 'done'), t(2, 'none', [1])], expected: waitsOwner([2]) },
    {
      name: 'an open Ticket behind an unparsed Blocked by line stops the Run',
      reason: 'no-ready-wave',
      tickets: [t(1, 'blocked', [], owner), t(2, 'open', [], { blockedParsed: false })],
      expected: STOP,
    },
    { name: 'an open Ticket behind a missing blocker stops the Run', reason: 'no-ready-wave', tickets: [t(1, 'blocked', [], owner), t(2, 'open', [9])], expected: STOP },
    { name: 'a Ticket still in work stops the Run', reason: 'no-ready-wave', tickets: [t(1, 'blocked', [], owner), t(2, 'work')], expected: STOP },
    {
      name: 'an open cycle with no owner Ticket in it stops the Run',
      reason: 'no-ready-wave',
      tickets: [t(1, 'open', [2]), t(2, 'open', [1])],
      expected: STOP,
    },
    {
      name: 'Tickets of other Epics do not count',
      reason: 'no-ready-wave',
      tickets: [t(1, 'done'), t(2, 'open', [], { epic: 'other' }), t(3, 'blocked', [], { epic: 'other', waits: 'agent' })],
      expected: NEXT_DONE,
    },
    { name: 'red CI on main: the Wave makes no progress', reason: 'no-progress', tickets: [t(1, 'done'), t(2, 'blocked', [1], owner)], expected: STOP },
    { name: 'red CI on main: the Wave is left unfinished', reason: 'wave-unfinished', tickets: [t(1, 'open')], expected: STOP },
    { name: 'limits-timeout stops the Run', reason: 'limits-timeout', tickets: [t(1, 'done')], expected: STOP },
    { name: 'a Stop ends the whole Run even with every Ticket done', reason: 'user-stop', tickets: [t(1, 'done')], expected: STOP },
    { name: 'window-too-short stops the Run', reason: 'window-too-short', tickets: [t(1, 'blocked', [], owner)], expected: STOP },
  ]

  it.each(cases)('$name', ({ reason, tickets, expected }) => {
    expect(epicOutcome(reason, tickets, EPIC)).toEqual(expected)
  })

  it('stops the Run on every reason except the three ends of an Epic', () => {
    const ends = new Set<AutopilotStopReason>(['no-ready-wave', 'tickets-done', 'blocked-tickets'])
    for (const reason of AUTOPILOT_STOP_REASONS) {
      if (ends.has(reason)) continue
      expect(epicOutcome(reason, [t(1, 'done')], EPIC), reason).toEqual(STOP)
    }
  })
})

describe('nextEpic', () => {
  const queue = ['a', 'b', 'c']

  it('gives the first Epic before the Run has started one', () => {
    expect(nextEpic(queue, -1, new Map())).toEqual({ index: 0, epic: 'a' })
  })

  it('gives the Epic after the current one', () => {
    expect(nextEpic(queue, 0, new Map<string, EpicFinish>([['a', 'done']]))).toEqual({ index: 1, epic: 'b' })
  })

  it('passes over an Epic that already has an outcome', () => {
    const outcomes = new Map<string, EpicFinish>([
      ['a', 'waits-owner'],
      ['b', 'removed'],
    ])
    expect(nextEpic(queue, 0, outcomes)).toEqual({ index: 2, epic: 'c' })
  })

  it('passes over an Epic named twice once it has run', () => {
    expect(nextEpic(['a', 'a', 'b'], 0, new Map<string, EpicFinish>([['a', 'done']]))).toEqual({ index: 2, epic: 'b' })
  })

  it('is null after the last Epic, as for a one-Epic Run', () => {
    expect(nextEpic(queue, 2, new Map<string, EpicFinish>([['c', 'done']]))).toBeNull()
    expect(nextEpic(['a'], 0, new Map<string, EpicFinish>([['a', 'done']]))).toBeNull()
  })

  it('is null when every Epic left has an outcome', () => {
    expect(nextEpic(queue, 0, new Map<string, EpicFinish>([['b', 'elsewhere'], ['c', 'removed']]))).toBeNull()
  })
})

describe('MAX_QUEUE_EPICS', () => {
  it('is 10', () => {
    expect(MAX_QUEUE_EPICS).toBe(10)
  })
})
