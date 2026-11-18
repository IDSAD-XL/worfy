// The checkpoint of an Autopilot Run read from its journal (worfy-continuity ticket 02,
// src/shared/autopilot/checkpoint.ts): the fixtures of test/fixtures/autopilot-faults/ — a Run suspended in the
// middle of a Wave, in the Limits wait, in the Start window wait, killed without an end, killed with a torn last
// line, discarded, force-stopped — each with the state it holds and whether it is cut off; a Run over a queue
// with every kind the checkpoint reads; what a Project's journals leave resumable, in order.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readCheckpoint, resumableAfter, runCheckpoint, type RunCheckpoint } from '../../src/shared/autopilot/checkpoint'
import { formatJournalLine, parseJournal, type JournalEvent, type JournalEventFields } from '../../src/shared/autopilot/journal'

const FIXTURES = join(import.meta.dirname, '..', 'fixtures', 'autopilot-faults')
const RUN = '2026-11-03T10-00-00-000Z-a1b2c3'

const fixture = (name: string, file = 'run-1.jsonl'): string => readFileSync(join(FIXTURES, name, file), 'utf8')
const read = (name: string, file?: string): RunCheckpoint => {
  const checkpoint = readCheckpoint(fixture(name, file))
  if (checkpoint === null) throw new Error(`no line of ${name} reads`)
  return checkpoint
}

/** The checkpoint of every fixture of Wave 1 (01, 02): the same start, the same Wave. */
const WAVE_1 = {
  run: RUN,
  project: 'demo-000000a4',
  first: 'demo',
  epic: 'demo',
  epics: ['demo'],
  finished: [],
  tickets: null,
  vendor: 'claude',
  autoApproval: 'off',
  wave: 1,
  retry: null,
  ladder: [],
} as const

describe('runCheckpoint over the fixtures', () => {
  it('a Run suspended in the middle of a Wave: both Tickets in work, no wait, cut off after the quit', () => {
    expect(read('suspended-mid-wave')).toEqual({
      ...WAVE_1,
      mode: null,
      inWork: ['01', '02'],
      waiting: null,
      stopped: null,
      cutOff: { after: 'quit', at: '2026-11-03T10:00:20.000Z' },
      unknownSideEffects: [],
      included: [],
      resumable: [],
      skipped: 0,
    })
  })

  it('a Run suspended in the Limits wait: the wait and its until stay, cut off after the update', () => {
    expect(read('suspended-limits-wait')).toMatchObject({
      ...WAVE_1,
      inWork: ['01', '02'],
      waiting: { kind: 'limits', until: '2026-11-03T12:00:00.000Z' },
      stopped: null,
      cutOff: { after: 'update', at: '2026-11-03T10:00:30.000Z' },
      resumable: [],
    })
  })

  it('a Run suspended in the Start window wait between Waves: no Ticket in work, cut off after the shutdown', () => {
    expect(read('suspended-start-window')).toMatchObject({
      ...WAVE_1,
      mode: 'start-window',
      inWork: [],
      waiting: { kind: 'start-window', until: '2026-11-03T22:00:00.000Z' },
      stopped: null,
      cutOff: { after: 'shutdown', at: '2026-11-03T10:00:40.000Z' },
      resumable: [],
    })
  })

  it('a Run killed without an end: cut off by a crash at its last line', () => {
    expect(read('killed-no-end')).toMatchObject({
      ...WAVE_1,
      inWork: ['01', '02'],
      waiting: null,
      stopped: null,
      cutOff: { after: 'crash', at: '2026-11-03T10:00:06.000Z' },
      resumable: [],
      skipped: 0,
    })
  })

  it('a Run killed with a torn last line: the lines before it read, the torn one is counted', () => {
    expect(read('killed-torn-last')).toMatchObject({ ...WAVE_1, inWork: ['01', '02'], stopped: null, cutOff: { after: 'crash', at: '2026-11-03T10:00:06.000Z' }, resumable: [], skipped: 1 })
  })

  it('a Run discarded after it was cut off: not cut off any more, its Wave in work resumable as after a Force stop', () => {
    expect(read('discarded')).toMatchObject({
      ...WAVE_1,
      stopped: { reason: 'discarded', tickets: ['01', '02'], at: '2026-11-03T10:00:50.000Z' },
      cutOff: null,
      resumable: ['01', '02'],
    })
  })

  it('a Force stop: the Tickets of the interrupted Wave resumable', () => {
    expect(read('force-stopped')).toMatchObject({ ...WAVE_1, stopped: { reason: 'user-force-stop', tickets: ['01', '02'] }, cutOff: null, resumable: ['01', '02'] })
  })

  it('stops that leave nothing: turn-error, a graceful Stop', () => {
    expect(read('api-500')).toMatchObject({ stopped: { reason: 'turn-error', tickets: [] }, cutOff: null, resumable: [] })
    expect(read('api-500', 'run-2.jsonl')).toMatchObject({ wave: 0, stopped: { reason: 'user-stop' }, cutOff: null, resumable: [] })
  })

  it('reads nothing from a file without a readable line', () => {
    expect(readCheckpoint('')).toBeNull()
    expect(readCheckpoint('{"torn":')).toBeNull()
  })
})

// ── Lines made here ──────────────────────────────────────────────────────────

const QUEUE_RUN = '2026-11-04T08-00-00-000Z-0c0ffe'
let second = 0
/** A line of the queue run, a second after the one before, written and read back as the journal does. */
const line = (epic: string, fields: JournalEventFields): string =>
  formatJournalLine({ at: new Date(Date.UTC(2026, 10, 4, 8, 0, second++)).toISOString(), run: QUEUE_RUN, project: 'worfy-1a2b3c4d', epic, ...fields } as JournalEvent)
const events = (text: string): JournalEvent[] => parseJournal(text).events

describe('runCheckpoint, line by line', () => {
  it('reads the queue, the start, the Wave, the retry, the ladder and a continuation after a suspension', () => {
    second = 0
    const text = [
      line('alpha', { kind: 'run-started', epics: ['alpha', 'beta', 'gamma'], mode: 'budget-aware', vendor: 'codex', autoApproval: 'shadow', by: 'tool' }),
      line('alpha', { kind: 'wave-started', wave: 1, tickets: ['01'] }),
      line('alpha', { kind: 'wave-finished', wave: 1, tickets: ['01'] }),
      line('alpha', { kind: 'queue-changed', added: ['delta'], removed: ['gamma'] }),
      line('gamma', { kind: 'epic-finished', outcome: 'removed' }),
      line('alpha', { kind: 'epic-finished', outcome: 'done' }),
      line('beta', { kind: 'epic-started', index: 2, of: 3 }),
      line('beta', { kind: 'wave-started', wave: 1, tickets: ['03', '04', '05'] }),
      line('beta', { kind: 'ticket-status', ticket: '03', state: 'claimed' }),
      line('beta', { kind: 'ticket-status', ticket: '04', state: 'done' }),
      line('beta', { kind: 'ticket-status', ticket: '05', state: 'blocked' }),
      line('beta', { kind: 'ticket-status', ticket: '05', state: 'claimed' }),
      line('beta', { kind: 'wave-finished', wave: 1, tickets: ['03', '04', '05'] }),
      line('beta', { kind: 'ticket-continued', ticket: '03', attempt: 1, of: 2, cause: 'wave-unfinished' }),
      line('beta', { kind: 'wave-started', wave: 2, tickets: ['03', '06'], continuation: { attempt: 1, of: 2, cause: 'wave-unfinished' } }),
      line('beta', { kind: 'turn-retry', attempt: 1, of: 5, error: 'api-500', message: 'API Error: 500', until: '2026-11-04T08:05:00.000Z' }),
      line('beta', { kind: 'resumed' }),
      line('beta', { kind: 'turn-retry', attempt: 2, of: 5, error: 'api-500', message: 'API Error: 500', until: '2026-11-04T08:07:00.000Z' }),
      line('beta', { kind: 'run-suspended', cause: 'update', wave: 2, tickets: ['03', '06'], wait: { kind: 'retry', until: '2026-11-04T08:07:00.000Z' } }),
      line('beta', { kind: 'run-continued', after: 'update' }),
      line('beta', { kind: 'ticket-set-aside', ticket: '06', cause: 'no-progress', attempts: 2 }),
    ].join('')
    const checkpoint = runCheckpoint(events(text))
    expect(checkpoint).toEqual({
      run: QUEUE_RUN,
      project: 'worfy-1a2b3c4d',
      first: 'alpha',
      epic: 'beta',
      epics: ['alpha', 'beta', 'delta'],
      finished: [
        { epic: 'gamma', outcome: 'removed' },
        { epic: 'alpha', outcome: 'done' },
      ],
      tickets: null,
      mode: 'budget-aware',
      vendor: 'codex',
      autoApproval: 'shadow',
      wave: 2,
      inWork: ['03', '06'],
      // The suspension does not end the wait for the retry: it goes on to its until after the restart.
      waiting: { kind: 'retry', until: '2026-11-04T08:07:00.000Z' },
      retry: { attempt: 2, of: 5 },
      ladder: [
        { epic: 'beta', ticket: '03', continued: 1, setAside: false },
        { epic: 'beta', ticket: '06', continued: 0, setAside: true },
      ],
      stopped: null,
      // Continued after the update, and killed since: no end, and no run-suspended after the run-continued.
      cutOff: { after: 'crash', at: '2026-11-04T08:00:20.000Z' },
      unknownSideEffects: [],
      included: [],
      resumable: [],
      skipped: 0,
    })
  })

  it('opens and closes the waits: limits-hit, budget-stop, a bare waiting-until, resumed; a quota hit opens none', () => {
    second = 0
    const start = line('alpha', { kind: 'run-started' })
    const wait = (lines: string[]) => runCheckpoint(events(start + lines.join('')))?.waiting
    expect(wait([line('alpha', { kind: 'limits-hit', window: null, resetsAt: null })])).toEqual({ kind: 'limits', until: null })
    expect(wait([line('alpha', { kind: 'limits-hit', window: null, resetsAt: null }), line('alpha', { kind: 'waiting-until', until: '2026-11-04T09:00:00.000Z' })])).toEqual({ kind: 'limits', until: '2026-11-04T09:00:00.000Z' })
    expect(wait([line('alpha', { kind: 'waiting-until', until: '2026-11-04T09:00:00.000Z' })])).toEqual({ kind: 'limits', until: '2026-11-04T09:00:00.000Z' })
    expect(wait([line('alpha', { kind: 'budget-stop', cause: 'five-hour', share: 0.1, used: 0.05, need: 0.02, until: '2026-11-04T10:00:00.000Z', text: 'The 5-hour window is full' })])).toEqual({ kind: 'budget', until: '2026-11-04T10:00:00.000Z' })
    expect(wait([line('alpha', { kind: 'waiting-until', until: '2026-11-04T09:00:00.000Z' }), line('alpha', { kind: 'resumed' })])).toBeNull()
    expect(wait([line('alpha', { kind: 'limits-hit', window: null, resetsAt: null, reason: 'quota', message: 'usageLimitExceeded' })])).toBeNull()
    expect(wait([line('alpha', { kind: 'turn-retry', attempt: 1, of: 5, error: 'api-500', message: 'x', until: '2026-11-04T09:00:00.000Z' }), line('alpha', { kind: 'retry-refused', reason: 'cap' })])).toBeNull()
  })

  it('a run-suspended that is not the last line still cuts the Run off; a run-stopped after it ends the Run', () => {
    second = 0
    const start = line('alpha', { kind: 'run-started' })
    const suspended = line('alpha', { kind: 'run-suspended', cause: 'quit', wave: 0, tickets: [], wait: null })
    const tasks = line('alpha', { kind: 'background-tasks', tasks: [] })
    expect(runCheckpoint(events(start + suspended + tasks))?.cutOff).toEqual({ after: 'quit', at: '2026-11-04T08:00:01.000Z' })
    expect(runCheckpoint(events(start + suspended + line('alpha', { kind: 'run-stopped', reason: 'discarded' })))?.cutOff).toBeNull()
    // A wait of a shape this build does not know reads as none; the line stays.
    const odd = JSON.stringify({ ...JSON.parse(suspended) as object, wait: { kind: 'restart', until: null } })
    expect(parseJournal(`${start}${odd}\n`).events.at(-1)).toMatchObject({ kind: 'run-suspended', wait: null })
  })
})

describe('parseJournal and a later build', () => {
  it('skips a line of a kind it does not know and counts it, the lines around it read (risk 7)', () => {
    second = 0
    const start = line('alpha', { kind: 'run-started' })
    const later = JSON.stringify({ at: '2026-11-04T08:00:05.000Z', run: QUEUE_RUN, project: 'worfy-1a2b3c4d', epic: 'alpha', kind: 'run-teleported', where: 'mars' })
    const stopped = line('alpha', { kind: 'run-stopped', reason: 'user-stop' })
    const parsed = parseJournal(`${start}${later}\n${stopped}`)
    expect(parsed.skipped).toBe(1)
    expect(parsed.events.map((event) => event.kind)).toEqual(['run-started', 'run-stopped'])
    expect(readCheckpoint(`${start}${later}\n${stopped}`)).toMatchObject({ stopped: { reason: 'user-stop' }, cutOff: null, skipped: 1 })
  })
})

describe('resumableAfter: what a Project’s journals leave, oldest first', () => {
  const forceStop = fixture('force-stopped')
  /** A Run of `epic` that stops with `reason`, after a Wave of `wave` when given; `named` makes it a Run over named Tickets. */
  const runOf = (epic: string, reason: string, options: { wave?: string[]; named?: string[]; tickets?: string[] } = {}): JournalEvent[] => {
    second = 0
    return events(
      [
        line(epic, { kind: 'run-started', ...(options.named === undefined ? {} : { tickets: options.named }) }),
        ...(options.wave === undefined ? [] : [line(epic, { kind: 'wave-started', wave: 1, tickets: options.wave })]),
        line(epic, { kind: 'run-stopped', reason, ...(options.tickets === undefined ? {} : { tickets: options.tickets }) }),
      ].join(''),
    )
  }

  it('none without a Run; a Force stop leaves its Wave', () => {
    expect(resumableAfter([])).toBeNull()
    expect(resumableAfter([events(forceStop)])).toEqual({ epic: 'demo', resumable: ['01', '02'] })
  })

  it('a Run that sent no Wave keeps what it was given; one that sent a Wave and stopped otherwise leaves none', () => {
    expect(resumableAfter([events(forceStop), runOf('demo', 'start-cancelled')])).toEqual({ epic: 'demo', resumable: ['01', '02'] })
    expect(resumableAfter([events(forceStop), runOf('demo', 'no-ready-wave', { wave: ['01', '02'] })])).toEqual({ epic: 'demo', resumable: [] })
  })

  it('a Run of another Epic was given none of them', () => {
    expect(resumableAfter([events(forceStop), runOf('other', 'start-cancelled')])).toEqual({ epic: 'other', resumable: [] })
  })

  it('a Run over named Tickets carries the ones it does not name, and adds its own Force stop', () => {
    expect(resumableAfter([events(forceStop), runOf('demo', 'tickets-done', { wave: ['01'], named: ['01'] })])).toEqual({ epic: 'demo', resumable: ['02'] })
    expect(resumableAfter([events(forceStop), runOf('demo', 'user-force-stop', { wave: ['01'], named: ['01'], tickets: ['01'] })])).toEqual({ epic: 'demo', resumable: ['01', '02'] })
  })

  it('a cut-off Run leaves none until it is discarded; Discard leaves its Wave in work', () => {
    expect(resumableAfter([events(forceStop), events(fixture('suspended-mid-wave'))])).toEqual({ epic: 'demo', resumable: [] })
    expect(resumableAfter([events(fixture('discarded'))])).toEqual({ epic: 'demo', resumable: ['01', '02'] })
  })

  it('a session-error during a Wave leaves its Wave, numbers in number order', () => {
    expect(resumableAfter([runOf('demo', 'session-error', { wave: ['10', '02'], tickets: ['10', '02'] })])).toEqual({ epic: 'demo', resumable: ['02', '10'] })
  })
})

describe('runCheckpoint and Unknown side effects (worfy-continuity ticket 07)', () => {
  const MERGE = ['gh pr merge 41']
  const mark = (ticket: string) => line('demo', { kind: 'unknown-side-effects', ticket, actions: MERGE })
  const checked = (ticket: string) => line('demo', { kind: 'side-effects-checked', ticket })
  /** A Run of Wave 1 (01, 02) cut off, continued with 01 left to a person, and its Wave 2 (02). */
  const continued = (): string[] => {
    second = 0
    return [
      line('demo', { kind: 'run-started' }),
      line('demo', { kind: 'wave-started', wave: 1, tickets: ['01', '02'] }),
      line('demo', { kind: 'run-suspended', cause: 'quit', wave: 1, tickets: ['01', '02'], wait: null }),
      line('demo', { kind: 'run-continued', after: 'quit' }),
      mark('01'),
      line('demo', { kind: 'wave-started', wave: 2, tickets: ['02'] }),
    ]
  }

  it('a marked Ticket is not resumable, even when a run-stopped names it, until Checked, include', () => {
    const forced = [...continued(), line('demo', { kind: 'run-stopped', reason: 'user-force-stop', tickets: ['01', '02'] })]
    expect(runCheckpoint(events(forced.join('')))).toMatchObject({
      unknownSideEffects: [{ epic: 'demo', ticket: '01', actions: MERGE }],
      included: [],
      resumable: ['02'],
    })
    const included = runCheckpoint(events([...forced, checked('01')].join('')))
    expect(included).toMatchObject({ unknownSideEffects: [], included: [{ epic: 'demo', ticket: '01' }], resumable: ['01', '02'], cutOff: null })
  })

  it('Checked, include while the Run goes on: the next Wave that carries the Ticket takes it, and nothing is left after', () => {
    const lines = [...continued(), checked('01')]
    expect(runCheckpoint(events(lines.join('')))).toMatchObject({ unknownSideEffects: [], included: [{ epic: 'demo', ticket: '01' }], resumable: [] })
    const taken = [...lines, line('demo', { kind: 'wave-finished', wave: 2, tickets: ['02'] }), line('demo', { kind: 'wave-started', wave: 3, tickets: ['01'] }), line('demo', { kind: 'run-stopped', reason: 'no-ready-wave' })]
    expect(runCheckpoint(events(taken.join('')))).toMatchObject({ unknownSideEffects: [], included: [], resumable: [] })
  })

  it('a Run cut off again keeps its marks and its included Tickets for the continuation, and leaves nothing resumable', () => {
    const lines = [...continued(), checked('02'), mark('02'), line('demo', { kind: 'run-suspended', cause: 'update', wave: 2, tickets: ['02'], wait: null })]
    expect(runCheckpoint(events(lines.join('')))).toMatchObject({
      unknownSideEffects: [
        { epic: 'demo', ticket: '01', actions: MERGE },
        { epic: 'demo', ticket: '02', actions: MERGE },
      ],
      included: [],
      cutOff: { after: 'update' },
      resumable: [],
    })
    const pending = [...continued(), checked('01'), line('demo', { kind: 'run-suspended', cause: 'update', wave: 2, tickets: ['02'], wait: null })]
    expect(runCheckpoint(events(pending.join('')))).toMatchObject({ unknownSideEffects: [], included: [{ epic: 'demo', ticket: '01' }], resumable: [] })
  })

  it('an open mark goes to the next Run of the Epic, which may include it', () => {
    const first = events([...continued(), line('demo', { kind: 'run-stopped', reason: 'no-ready-wave' })].join(''))
    expect(resumableAfter([first])).toEqual({ epic: 'demo', resumable: [], marks: [{ ticket: '01', actions: MERGE }] })
    second = 100
    const next = events([line('demo', { kind: 'run-started' }), checked('01'), line('demo', { kind: 'run-stopped', reason: 'start-cancelled' })].join(''))
    expect(runCheckpoint(next, { before: resumableAfter([first]) })).toMatchObject({ unknownSideEffects: [], included: [{ epic: 'demo', ticket: '01' }], resumable: ['01'] })
    expect(resumableAfter([first, next])).toEqual({ epic: 'demo', resumable: ['01'] })
    // A Run of another Epic was given no mark.
    second = 200
    const other = events([line('other', { kind: 'run-started' }), line('other', { kind: 'run-stopped', reason: 'start-cancelled' })].join(''))
    expect(runCheckpoint(other, { before: resumableAfter([first]) })).toMatchObject({ unknownSideEffects: [] })
  })
})
