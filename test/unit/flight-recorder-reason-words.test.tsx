// The reason of a Wait on the Run history screen (src/renderer/flight-recorder/span-words.ts, reasonText;
// worfy-resource-planner ticket 11, round 1): the Journal keeps `until` as an ISO moment, and the screen,
// whose times are local, writes it in local time with the formatter of Start and End (formatLocal). The
// time zone is fixed before the formatter is made: Kyiv, whose clocks go back on 2026-10-25 at 01:00 UTC.
import { vi } from 'vitest'

vi.hoisted(() => {
  process.env.TZ = 'Europe/Kyiv'
})

import { describe, expect, it } from 'vitest'
import type { Span } from '../../src/shared/flight-recorder/spans'
import { markText, reasonText, stopReasonText } from '../../src/renderer/flight-recorder/span-words'
import { formatLocal } from '../../src/renderer/flight-recorder/store'

const wait = (reason: string | null, kind: Span['kind'] = 'wait'): Span =>
  ({ id: 'wait:start-window:1', kind, reason, waitCause: kind === 'wait' ? 'start-window' : null }) as Span

describe('the until of a Wait reason in local time', () => {
  it('writes the until of a Start window Wait as Start and End are written, in the local time zone', () => {
    const text = reasonText(wait('start-window: outside, until 2026-10-21T09:30:00.000Z'))
    expect(text).toBe(`start-window: outside, until ${formatLocal(Date.parse('2026-10-21T09:30:00.000Z'))}`)
    // Kyiv is three hours ahead of UTC before the clocks go back.
    expect(text).toMatch(/until \D*21\D*12:30$/)
    expect(text).not.toContain('2026-10-21T09:30')
  })

  it('takes the day the clocks go back: two hours ahead after it', () => {
    expect(reasonText(wait('start-window: wave-too-long, until 2026-10-25T00:30:00.000Z'))).toMatch(/until \D*25\D*03:30$/)
    expect(reasonText(wait('start-window: wave-too-long, until 2026-10-25T02:30:00.000Z'))).toMatch(/until \D*25\D*04:30$/)
  })

  it('does the same for the until of a Limits Wait, and keeps the rest of the reason', () => {
    expect(reasonText(wait('limits-budget: daily-share, until 2026-10-21T21:00:00.000Z'))).toMatch(/^limits-budget: daily-share, until \D*22\D*00:00$/)
  })

  it('leaves a reason without an ISO until, and the reason of another span, as they are', () => {
    expect(reasonText(wait('limits: seven_day'))).toBe('limits: seven_day')
    expect(reasonText(wait('start-window: outside, until someday'))).toBe('start-window: outside, until someday')
    expect(reasonText(wait(null))).toBeNull()
    expect(reasonText(wait('rejected until 2026-10-21T09:30:00.000Z', 'agent'))).toBe('rejected until 2026-10-21T09:30:00.000Z')
  })
})

// The words of the continuation ladder (worfy-stuck-agents ticket 05): the stop `main-red`, the reason of the
// attempt a `ticket-continued` caused, and the mark of a `ticket-set-aside`, as from-journal.ts leaves them.
describe('the words of the continuation ladder', () => {
  it('names the main-red stop of a Run', () => {
    expect(stopReasonText('main-red')).toBe('main-red: main was red, so the stuck Ticket was not continued')
    expect(reasonText(wait('main-red', 'run'))).toBe('main-red: main was red, so the stuck Ticket was not continued')
  })

  it('writes the reason of the attempt a continuation caused in words, for both causes', () => {
    expect(reasonText(wait('ticket-continued: wave-unfinished, 1 of 2', 'agent'))).toBe('continuation 1 of 2: still in work after the turn')
    expect(reasonText(wait('ticket-continued: no-progress, 2 of 2', 'agent'))).toBe('continuation 2 of 2: the same Wave came back')
    // Another reason of an attempt stays as it is.
    expect(reasonText(wait('narrow round: fix the lint', 'agent'))).toBe('narrow round: fix the lint')
  })

  it('writes the mark of a Ticket set aside, naming its Epic only in a Run over a queue', () => {
    const mark = { kind: 'ticket-set-aside' as const, text: 'ticket-set-aside: epic-a/05, wave-unfinished, 2' }
    expect(markText(mark)).toBe('Ticket 05 set aside after 2 continuations: still in work after the turn')
    expect(markText(mark, ['epic-a', 'epic-b'])).toBe('Ticket epic-a/05 set aside after 2 continuations: still in work after the turn')
    expect(markText({ kind: 'ticket-set-aside', text: 'ticket-set-aside: epic-a/07, no-progress, 2' })).toBe('Ticket 07 set aside after 2 continuations: the same Wave came back')
    // The other marks keep the reader's words.
    expect(markText({ kind: 'epic-started', text: 'Epic 2/3: epic-b' })).toBe('Epic 2/3: epic-b')
  })
})
