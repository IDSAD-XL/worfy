// The Autopilot line and the chips of a run over a queue of Epics (worfy-autopilot-queue ticket 17): the line of the
// Epic the run is on says where in the queue it is ("Epic 2/3: checkout · Wave 1 · running"); the frame of each other
// Epic of the queue gets a chip by its status (`done`, `running`, `next`, `waits-owner`, `elsewhere`); the line's
// tooltip lists the queue; "⋯" offers "Add to queue" or "Remove from queue" by the same state, and an edit made during
// a Wave shows as waiting for its end.
import { describe, expect, it } from 'vitest'
import { autopilotStatusLine, queueAction, queueChip, queueTitle, type AutopilotState, type QueueEpicStatus } from '../../src/shared/ipc/autopilot'

type QueueState = Pick<AutopilotState, 'status' | 'wave' | 'reason' | 'epic' | 'queue' | 'index' | 'stopping'>

const NO_EDITS = { add: [], remove: [] }

/** A run over `epics` with these statuses, on the Epic at `index`. */
function queueRun(statuses: readonly [string, QueueEpicStatus][], index: number, more: Partial<QueueState> = {}): QueueState {
  return {
    status: 'running',
    wave: 1,
    reason: null,
    epic: statuses[index]![0],
    queue: statuses.map(([epic, status]) => ({ epic, status })),
    index,
    stopping: false,
    ...more,
  }
}

const THREE = queueRun(
  [
    ['demo', 'done'],
    ['checkout', 'running'],
    ['search', 'next'],
  ],
  1,
)

describe('autopilotStatusLine of a run over a queue', () => {
  it('says the place of the Epic in the queue and its name before the Wave', () => {
    expect(autopilotStatusLine(THREE)).toBe('Epic 2/3: checkout · Wave 1 · running')
    expect(autopilotStatusLine({ ...queueRun([['demo', 'running'], ['checkout', 'next']], 0), wave: 2 })).toBe('Epic 1/2: demo · Wave 2 · running')
    expect(autopilotStatusLine({ ...THREE, backgroundTasks: 2 })).toBe('Epic 2/3: checkout · Wave 1 · 2 background tasks')
  })

  it('keeps the place while the run waits and after it stopped', () => {
    expect(autopilotStatusLine({ ...THREE, status: 'waiting', resumesAt: null, waitingFor: 'limits' })).toBe('Epic 2/3: checkout · waiting for limits')
    expect(autopilotStatusLine({ ...THREE, status: 'stopped', reason: 'limits-timeout' })).toBe('Epic 2/3: checkout · stopped: limits timeout')
  })

  it('says no place for a run of one Epic, and for a state without a queue', () => {
    expect(autopilotStatusLine(queueRun([['demo', 'running']], 0))).toBe('Wave 1 · running')
    expect(autopilotStatusLine({ status: 'running', wave: 3, reason: null })).toBe('Wave 3 · running')
  })

  it('stays null for a state with nothing to say', () => {
    expect(autopilotStatusLine({ ...THREE, status: 'stopped', reason: null })).toBeNull()
  })
})

describe('queueChip: the chip of an Epic of the queue that the run is not on', () => {
  const FIVE = queueRun(
    [
      ['demo', 'done'],
      ['billing', 'waits-owner'],
      ['payments', 'elsewhere'],
      ['checkout', 'running'],
      ['search', 'next'],
    ],
    3,
  )

  it('`next`: In queue with its place', () => {
    expect(queueChip(FIVE, 'search', NO_EDITS)).toMatchObject({ label: 'In queue 5/5', tone: 'open' })
    expect(queueChip(FIVE, 'search', NO_EDITS)?.title).toBe('Autopilot runs search after checkout: 5 of 5 in its queue')
  })

  it('`waits-owner`: Waits for owner', () => {
    expect(queueChip(FIVE, 'billing', NO_EDITS)).toMatchObject({ label: 'Waits for owner', tone: 'blocked' })
  })

  it('`elsewhere`: Runs elsewhere', () => {
    expect(queueChip(FIVE, 'payments', NO_EDITS)).toMatchObject({ label: 'Runs elsewhere', tone: 'stopped' })
  })

  it('`running` and `done`: no chip (the line is on the running one, a done one is on the done shelf)', () => {
    expect(queueChip(FIVE, 'checkout', NO_EDITS)).toBeNull()
    expect(queueChip(FIVE, 'demo', NO_EDITS)).toBeNull()
  })

  it('an Epic outside the queue, a stopped run, a state without a queue: no chip', () => {
    expect(queueChip(FIVE, 'other', NO_EDITS)).toBeNull()
    expect(queueChip({ ...FIVE, status: 'stopped' }, 'search', NO_EDITS)).toBeNull()
    expect(queueChip({ status: 'running', epic: 'demo' }, 'search', NO_EDITS)).toBeNull()
  })

  it('an edit that waits for the end of the Wave: Joins after this Wave, Leaves after this Wave', () => {
    expect(queueChip(FIVE, 'other', { add: ['other'], remove: [] })).toMatchObject({ label: 'Joins after this Wave', tone: 'open' })
    expect(queueChip(FIVE, 'search', { add: [], remove: ['search'] })).toMatchObject({ label: 'Leaves after this Wave', tone: 'stopped' })
    // A run of one Epic shows a waiting addition too.
    expect(queueChip(queueRun([['demo', 'running']], 0), 'search', { add: ['search'], remove: [] })?.label).toBe('Joins after this Wave')
  })
})

describe('queueTitle: the queue in the tooltip of the line', () => {
  it('lists every Epic with its status, and the edits that wait', () => {
    const run = queueRun(
      [
        ['demo', 'done'],
        ['billing', 'waits-owner'],
        ['payments', 'elsewhere'],
        ['checkout', 'running'],
        ['search', 'next'],
      ],
      3,
    )
    expect(queueTitle(run, { add: ['docs'], remove: ['search'] })).toBe(
      [
        'Queue of this run:',
        '1. demo — done',
        '2. billing — skipped: waits for the owner',
        '3. payments — skipped: runs on another Machine',
        '4. checkout — running',
        '5. search — next, leaves after this Wave',
        '6. docs — joins after this Wave',
      ].join('\n'),
    )
  })

  it('is null for a run of one Epic with no edit waiting, and for a state without a queue', () => {
    expect(queueTitle(queueRun([['demo', 'running']], 0), NO_EDITS)).toBeNull()
    expect(queueTitle({ status: 'running', epic: 'demo' }, NO_EDITS)).toBeNull()
    expect(queueTitle(queueRun([['demo', 'running']], 0), { add: ['search'], remove: [] })).toBe('Queue of this run:\n1. demo — running\n2. search — joins after this Wave')
  })
})

describe('queueAction: what "⋯" of an Epic frame offers for the queue', () => {
  it('Add to queue: an Epic outside the queue of a run that goes on', () => {
    expect(queueAction(THREE, 'other', NO_EDITS)).toBe('add')
    expect(queueAction({ ...THREE, status: 'waiting' }, 'other', NO_EDITS)).toBe('add')
  })

  it('Remove from queue: an Epic not started, or one whose adding waits for the end of the Wave', () => {
    expect(queueAction(THREE, 'search', NO_EDITS)).toBe('remove')
    expect(queueAction(THREE, 'other', { add: ['other'], remove: [] })).toBe('remove')
  })

  it('nothing for the Epic running or finished, for a removal that waits, with no run and while stopping', () => {
    expect(queueAction(THREE, 'checkout', NO_EDITS)).toBeNull()
    expect(queueAction(THREE, 'demo', NO_EDITS)).toBeNull()
    expect(queueAction(THREE, 'search', { add: [], remove: ['search'] })).toBeNull()
    expect(queueAction({ ...THREE, status: 'stopped' }, 'other', NO_EDITS)).toBeNull()
    expect(queueAction({ ...THREE, stopping: true }, 'other', NO_EDITS)).toBeNull()
    expect(queueAction(undefined, 'other', NO_EDITS)).toBeNull()
  })
})
