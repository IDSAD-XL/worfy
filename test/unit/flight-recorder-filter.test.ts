// The filter of the Run history screen (src/renderer/flight-recorder/filter.ts; worfy-flight-recorder ticket
// 19): the text filter by Ticket, agent, PR and cause, «Problems only» — the failures, retries, blocks, cut-off
// spans and Waits with the rows above them — and what a selection highlights: the span that caused a retry,
// the Tickets of a Wait or an Orchestrator turn.
//
// The night Run is test/fixtures/flight-recorder/night-run-view.json (what the service answers for the
// night-Run fixture); the small Run with a block is built here from facts with the span model.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildTimeline, type RunFacts, type Span } from '../../src/shared/flight-recorder/spans'
import { runViewSchema } from '../../src/shared/ipc/runs'
import { DEFAULT_PIPELINE } from '../../src/shared/workflow/pipeline'
import { filterSpans, highlightsOf, isFiltering, isProblem, NO_FILTER, rowsAbove, type SpanFilter } from '../../src/renderer/flight-recorder/filter'

const NIGHT = runViewSchema.parse(JSON.parse(readFileSync(join(import.meta.dirname, '../fixtures/flight-recorder/night-run-view.json'), 'utf8'))).timeline
const byId = new Map(NIGHT.spans.map((span) => [span.id, span]))
const SESSION = 'f6ab7045-416c-471a-a78d-433567aefa5a'
const IMPL_07 = 'agent:a60e687cd0ab6803e#2'

const ids = (spans: readonly Span[] | null): string[] => (spans ?? []).map((span) => span.id)
const kept = (filter: Partial<SpanFilter>, timeline = NIGHT): readonly Span[] => {
  const spans = filterSpans(timeline, { ...NO_FILTER, ...filter })
  if (spans === null) throw new Error('the filter kept everything')
  return spans
}

/** The spans of `spans` that are above another kept span in the tree: kept as the way to it, not for themselves. */
function ancestorsIn(spans: readonly Span[]): Set<string> {
  const above = new Set<string>()
  const all = new Map(NIGHT.spans.map((span) => [span.id, span]))
  for (const span of spans) {
    let parent = span.parent === null ? undefined : all.get(span.parent)
    while (parent !== undefined) {
      above.add(parent.id)
      parent = parent.parent === null ? undefined : all.get(parent.parent)
    }
    // A Ticket is drawn under the Wave it started in.
    if (span.kind === 'ticket') for (const wave of span.links.waves ?? []) above.add(`wave:${wave}`)
  }
  return above
}

describe('«Problems only»', () => {
  it('on the night Run keeps only the failures, retries, blocks, cut-off spans and Waits, with the rows above them', () => {
    const spans = kept({ problemsOnly: true })
    const keptIds = ids(spans)
    // A successful span with no retry goes: the first implementer of 03, a Stage that ended well, a gate run, CI on main, an Orchestrator turn.
    for (const gone of ['agent:a4f4ef600ce73b83a#1', 'ticket:worfy-pipeline/03/stage:1', 'gate:0a6c108b/2026-10-17T23-37-10Z-41210', 'script:0a6c108b/2026-10-17T23-37-10Z-41210/1', 'ci:gh-run:39084438682', `turn:${SESSION}:1`]) {
      expect(byId.get(gone)?.outcome).toBe('ok')
      expect(keptIds).not.toContain(gone)
    }
    // What stays: a rejected verifier, the retry #2 it caused, a Ticket the Wave left unfinished, every Wait, a cut-off turn.
    expect(keptIds).toEqual(expect.arrayContaining(['agent:adb147aa44e4451c4#1', 'agent:a60e687cd0ab6803e#2', 'ticket:worfy-pipeline/05', 'wait:background-tasks:1', 'wait:background-tasks:13', `turn:${SESSION}:16`]))
    expect(spans.filter((span) => span.kind === 'wait')).toHaveLength(NIGHT.spans.filter((span) => span.kind === 'wait').length)
    // …and the rows above them: the Stage of the retry, its Wave and the Run.
    expect(keptIds).toEqual(expect.arrayContaining(['ticket:worfy-pipeline/07/stage:2', 'wave:1', 'wave:2', 'run']))
    // Every span kept is a problem or on the way to one.
    const above = ancestorsIn(spans)
    for (const span of spans) expect(isProblem(span, NIGHT) || above.has(span.id), span.id).toBe(true)
    // Every problem of the Run is kept.
    for (const span of NIGHT.spans) if (isProblem(span, NIGHT)) expect(keptIds, span.id).toContain(span.id)
  })

  it('keeps a Ticket that was blocked and then done, by its block mark; the Ticket never blocked goes', () => {
    const at = (hhmm: string) => `2026-10-20T${hhmm}:00.000Z`
    const facts: RunFacts = {
      run: { id: '2026-10-20T10-00-00-000Z-aaaaaa', startedAt: at('10:00'), stoppedAt: at('12:00'), live: false, outcome: 'ok', reason: 'tickets-done' },
      now: at('12:00'),
      pipeline: DEFAULT_PIPELINE,
      waves: [{ number: 1, startedAt: at('10:00'), finishedAt: at('12:00'), tickets: ['e/01', 'e/02'] }],
      ticketEvents: [
        { ticket: 'e/01', at: at('10:01'), source: 'journal', event: 'status', state: 'claimed' },
        { ticket: 'e/01', at: at('10:30'), source: 'journal', event: 'status', state: 'blocked', reason: 'Needs the owner', waits: 'the owner' },
        { ticket: 'e/01', at: at('10:40'), source: 'journal', event: 'status', state: 'claimed' },
        { ticket: 'e/01', at: at('11:00'), source: 'journal', event: 'status', state: 'done' },
        { ticket: 'e/02', at: at('10:01'), source: 'journal', event: 'status', state: 'claimed' },
        { ticket: 'e/02', at: at('11:00'), source: 'journal', event: 'status', state: 'done' },
      ],
      work: [],
      retryCauses: [],
      waits: [],
      turns: [],
      lost: [],
      orchestratorMarks: [],
    }
    const timeline = buildTimeline(facts)
    const first = timeline.spans.find((span) => span.kind === 'ticket' && span.links.ticket === 'e/01')!
    expect(first.outcome).toBe('ok')
    expect(timeline.blocks.map((block) => block.ticket)).toEqual(['e/01'])
    const spans = filterSpans(timeline, { ...NO_FILTER, problemsOnly: true })!
    expect(ids(spans.filter((span) => span.kind === 'ticket'))).toEqual([first.id])
  })
})

describe('the text filter', () => {
  it('by Ticket: its number keeps that Ticket, its rows and what names it, nothing of another Ticket', () => {
    const spans = kept({ text: '07' })
    expect(ids(spans.filter((span) => span.kind === 'ticket'))).toEqual(['ticket:worfy-pipeline/07'])
    for (const span of spans) {
      if (span.kind === 'run' || span.kind === 'wave') continue
      const tickets = span.links.tickets ?? (span.links.ticket === undefined ? [] : [span.links.ticket])
      expect(tickets, span.id).toContain('worfy-pipeline/07')
    }
    // The Stages and agents of 07 all stay; the Waits and turns that stood for it too.
    expect(spans.filter((span) => span.links.ticket === 'worfy-pipeline/07')).toHaveLength(NIGHT.spans.filter((span) => span.links.ticket === 'worfy-pipeline/07').length)
    expect(ids(spans)).toContain('wait:background-tasks:1')
    expect(ids(spans)).toContain(`turn:${SESSION}:5`)
    // The full name and «ticket NN» say the same; no digits of a sha or an agent id count.
    expect(ids(kept({ text: 'worfy-pipeline/07' }))).toEqual(ids(spans))
    expect(ids(kept({ text: 'Ticket 7' }))).toEqual(ids(spans))
    expect(ids(kept({ text: '04' }).filter((span) => span.kind === 'ticket'))).toEqual(['ticket:worfy-pipeline/04'])
  })

  it('by agent: its name keeps its spans, the retry whose reason names it, and the rows above them only', () => {
    const spans = kept({ text: 'verify-05' })
    const above = ancestorsIn(spans)
    const own = spans.filter((span) => !above.has(span.id))
    // verify-05 and verify-05-r2, and impl-05 #2 «after verify-05 rejected».
    expect(ids(own).sort()).toEqual(['agent:a710999976a65bea0#1', 'agent:a782351206c4b1fd3#1', 'agent:aecf4b62de8340a93#2'])
    expect(ids(spans)).toEqual(expect.arrayContaining(['ticket:worfy-pipeline/05/stage:2', 'ticket:worfy-pipeline/05', 'wave:2', 'run']))
    // An agent id from its start.
    expect(ids(kept({ text: 'a4f4ef6' })).filter((id) => id.startsWith('agent:'))).toEqual(['agent:a4f4ef600ce73b83a#1'])
  })

  it('by PR: «#460» and «PR 460» keep the spans of that PR', () => {
    const spans = kept({ text: '#460' })
    const above = ancestorsIn(spans)
    const own = spans.filter((span) => !above.has(span.id))
    expect(own.length).toBeGreaterThan(2)
    for (const span of own) expect(span.links.pr, span.id).toBe(460)
    expect(ids(own)).toEqual(expect.arrayContaining(['agent:a60e687cd0ab6803e#1', 'agent:a60e687cd0ab6803e#2', 'ci:gh-run:39084438682']))
    expect(ids(kept({ text: 'PR 460' }))).toEqual(ids(spans))
    expect(ids(kept({ text: '460' }))).toEqual(ids(spans))
    // A PR of no span keeps nothing, not even the Run.
    expect(kept({ text: '#999' })).toEqual([])
  })

  it('by cause: a word of the reason keeps the spans with it', () => {
    const spans = kept({ text: 'rejected' })
    const above = ancestorsIn(spans)
    const own = spans.filter((span) => !above.has(span.id))
    expect(ids(own).sort()).toEqual(['agent:a60e687cd0ab6803e#2', 'agent:a710999976a65bea0#1', 'agent:a782351206c4b1fd3#1', 'agent:adb147aa44e4451c4#1', 'agent:aecf4b62de8340a93#2'])
    for (const span of own) expect(span.reason ?? '', span.id).toMatch(/rejected/i)
    // The cause of a Wait.
    expect(kept({ text: 'background' }).filter((span) => span.kind === 'wait')).toHaveLength(13)
  })

  it('with «Problems only» both hold; cleared, the filter keeps everything', () => {
    const spans = kept({ text: '#467', problemsOnly: true })
    const above = ancestorsIn(spans)
    expect(ids(spans.filter((span) => !above.has(span.id))).sort()).toEqual(['agent:a466b2d852949d8e6#2', 'ticket:worfy-pipeline/04/stage:3'])
    expect(isFiltering(NO_FILTER)).toBe(false)
    expect(isFiltering({ text: '  ', problemsOnly: false })).toBe(false)
    expect(filterSpans(NIGHT, NO_FILTER)).toBeNull()
    expect(filterSpans(NIGHT, { text: ' ', problemsOnly: false })).toBeNull()
  })
})

describe('what a selection highlights', () => {
  it('a retry: the span that caused it', () => {
    expect(highlightsOf(byId.get('agent:a60e687cd0ab6803e#2'), NIGHT.spans).cause).toBe('agent:adb147aa44e4451c4#1')
    expect(highlightsOf(byId.get('agent:a60e687cd0ab6803e#1'), NIGHT.spans).cause).toBeNull()
    expect(highlightsOf(undefined, NIGHT.spans)).toEqual({ cause: null, tickets: new Set() })
  })

  it('a Wait or an Orchestrator turn: the rows of its Tickets; any other span none', () => {
    expect(highlightsOf(byId.get('wait:background-tasks:10'), NIGHT.spans).tickets).toEqual(new Set(['ticket:worfy-pipeline/04', 'ticket:worfy-pipeline/05']))
    expect(highlightsOf(byId.get(`turn:${SESSION}:3`), NIGHT.spans).tickets).toEqual(new Set(['ticket:worfy-pipeline/03', 'ticket:worfy-pipeline/07']))
    expect(highlightsOf(byId.get('agent:a60e687cd0ab6803e#2'), NIGHT.spans).tickets).toEqual(new Set())
  })
})

describe('the rows above a span', () => {
  it('are its parents, the Wave its Ticket is drawn under, and the lane of a Wait or a turn', () => {
    expect(rowsAbove(IMPL_07, NIGHT.spans)).toEqual(['ticket:worfy-pipeline/07/stage:2', 'ticket:worfy-pipeline/07', 'wave:1', 'run'])
    expect(rowsAbove('ticket:worfy-pipeline/05', NIGHT.spans)).toEqual(['wave:2', 'run'])
    expect(rowsAbove('wait:background-tasks:3', NIGHT.spans)).toEqual(['lane:wait'])
    expect(rowsAbove(`turn:${SESSION}:3`, NIGHT.spans)).toEqual(['lane:orchestrator'])
    expect(rowsAbove('run', NIGHT.spans)).toEqual([])
    expect(rowsAbove('no such span', NIGHT.spans)).toEqual([])
  })
})
