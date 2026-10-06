// The Autopilot run journal format (src/shared/autopilot/journal.ts): parsing a JSONL file that
// worfy and an outside observer both append to, and serialising one event into one line.
import { describe, expect, it } from 'vitest'
import {
  JOURNAL_EVENT_KINDS,
  LAST_TEXT_MAX,
  clipLastText,
  formatJournalLine,
  isRunId,
  parseJournal,
  type JournalEvent,
} from '../../src/shared/autopilot/journal'

const base = { run: '2026-10-06T01-02-03-004Z-a1b2c3', project: 'Auction-1a2b3c4d', epic: 'worfy-daily' }
const at = (minute: number): string => new Date(Date.UTC(2026, 9, 6, 1, minute)).toISOString()

const started: JournalEvent = { ...base, at: at(0), kind: 'run-started' }
const waveStarted: JournalEvent = { ...base, at: at(1), kind: 'wave-started', wave: 1, tickets: ['01', '02'] }
const stopped: JournalEvent = { ...base, at: at(9), kind: 'run-stopped', reason: 'epic-done' }

const line = (value: unknown): string => `${JSON.stringify(value)}\n`

/** One valid event of every kind, in the order of JOURNAL_EVENT_KINDS. */
const everyKind: JournalEvent[] = [
  started,
  waveStarted,
  { ...base, at: at(2), kind: 'wave-finished', wave: 1, tickets: ['01', '02'] },
  { ...base, at: at(3), kind: 'limits-hit', window: 'five_hour', resetsAt: at(30) },
  { ...base, at: at(3), kind: 'waiting-until', until: at(31) },
  { ...base, at: at(31), kind: 'resumed' },
  { ...base, at: at(32), kind: 'session-error', session: 'abc-123', message: 'spawn ENOENT' },
  { ...base, at: at(33), kind: 'refused-dialog', session: 'abc-123', what: 'AskUserQuestion' },
  { ...base, at: at(34), kind: 'human-input', source: 'worfy', what: 'message to the Orchestrator' },
  { ...base, at: at(35), kind: 'background-tasks', tasks: [{ id: 'task-1', type: 'local_agent', description: 'Implement 01' }] },
  stopped,
  { ...base, at: at(40), kind: 'orchestrator-returned' },
  { ...base, at: at(41), kind: 'tasks-killed', reason: 'app-quit', tasks: [{ id: 'task-2', type: null, description: null }] },
]

describe('parseJournal', () => {
  it('reads a file whose last line was cut off by a crash: the events before it stay, one line is skipped', () => {
    const text = line(started) + line(waveStarted) + JSON.stringify(stopped).slice(0, 25)
    expect(parseJournal(text)).toEqual({ events: [started, waveStarted], skipped: 1 })
  })

  it('reads every kind of event back exactly as it was written, in file order', () => {
    expect(everyKind.map((event) => event.kind)).toEqual([...JOURNAL_EVENT_KINDS])
    const text = everyKind.map((event) => formatJournalLine(event)).join('')
    expect(parseJournal(text)).toEqual({ events: everyKind, skipped: 0 })
  })

  it('skips a line of an unknown kind and counts it, keeping the lines around it', () => {
    const text = line(started) + line({ ...base, at: at(1), kind: 'coffee-break' }) + line(stopped)
    expect(parseJournal(text)).toEqual({ events: [started, stopped], skipped: 1 })
  })

  it('skips a known kind whose fields have the wrong type, and a line that is not an object', () => {
    const text =
      line(started) +
      line({ ...base, at: at(1), kind: 'wave-started', wave: 'one', tickets: [] }) +
      line({ ...base, at: 'yesterday', kind: 'resumed' }) +
      line({ ...base, at: at(1), kind: 'human-input', source: 'cat', what: 'walked on the keyboard' }) +
      line([1, 2]) +
      line('run-stopped') +
      line(stopped)
    expect(parseJournal(text)).toEqual({ events: [started, stopped], skipped: 5 })
  })

  it('reads a human-input line an observer appended by hand between two lines of worfy, in place', () => {
    // Written the way the comment at the top of the shared module tells an observer to: no worfy
    // code, its own key order, an ISO time with an offset instead of Z.
    const observer = `{"kind":"human-input","source":"observer","what":"clicked Allow on a macOS Keychain dialog","at":"2026-10-06T04:05:00+03:00","run":"${base.run}","project":"${base.project}","epic":"${base.epic}"}\n`
    const parsed = parseJournal(line(started) + observer + line(stopped))
    expect(parsed.skipped).toBe(0)
    expect(parsed.events.map((event) => event.kind)).toEqual(['run-started', 'human-input', 'run-stopped'])
    expect(parsed.events[1]).toEqual({
      ...base,
      at: '2026-10-06T04:05:00+03:00',
      kind: 'human-input',
      source: 'observer',
      what: 'clicked Allow on a macOS Keychain dialog',
    })
  })

  it('drops keys the format does not declare, so a reader never gets the raw line', () => {
    const parsed = parseJournal(line({ ...stopped, secret: 'x', extra: { nested: true } }))
    expect(parsed).toEqual({ events: [stopped], skipped: 0 })
    expect(Object.keys(parsed.events[0]!)).not.toContain('secret')
  })

  it('reads the background tasks of a line only in their declared shape (ADR-0029)', () => {
    const tasks = [{ id: 'task-1', type: 'local_agent', description: 'Implement 01' }]
    const good = { ...base, at: at(5), kind: 'background-tasks', tasks }
    const parsed = parseJournal(
      line({ ...good, tasks: [{ ...tasks[0], prompt: 'the whole prompt' }] }) +
        line({ ...good, tasks: [{ id: 7, type: null, description: null }] }) +
        line({ ...base, at: at(6), kind: 'tasks-killed', reason: 'app-quit' }) +
        line({ ...stopped, tasks: 'all of them' }),
    )
    expect(parsed).toEqual({ events: [good], skipped: 3 })
    expect(JSON.stringify(parsed.events)).not.toContain('the whole prompt')
  })

  it('reads the text, skipped Tickets, stop Tickets and last answer of ticket 30 only in their declared shape, and old lines without them', () => {
    const wave = { ...waveStarted, text: '/epic-wave Ticket-ы 01, 02 эпика worfy-daily', skipped: [{ num: '15', state: 'blocked' as const }] }
    const stop = { ...stopped, reason: 'blocked-tickets', tickets: ['15'], lastText: 'Волна уже закрыта.' }
    const parsed = parseJournal(
      line({ ...wave, skipped: [{ num: '15', state: 'blocked', why: 'x' }] }) +
        line(stop) +
        line(waveStarted) +
        line({ ...wave, skipped: [{ num: '15', state: 'work' }] }) +
        line({ ...wave, skipped: [{ num: 15, state: 'blocked' }] }) +
        line({ ...wave, text: 7 }) +
        line({ ...stop, tickets: [15] }) +
        line({ ...stop, lastText: 'x'.repeat(LAST_TEXT_MAX + 1) }),
    )
    expect(parsed).toEqual({ events: [wave, stop, waveStarted], skipped: 5 })
    expect(JSON.stringify(parsed.events)).not.toContain('why')
  })

  it('clips the last answer to LAST_TEXT_MAX units without cutting a surrogate pair', () => {
    expect(clipLastText('short')).toBe('short')
    expect(clipLastText('a'.repeat(LAST_TEXT_MAX + 5))).toBe('a'.repeat(LAST_TEXT_MAX))
    const pair = `${'a'.repeat(LAST_TEXT_MAX - 1)}😀tail`
    expect(clipLastText(pair)).toBe('a'.repeat(LAST_TEXT_MAX - 1))
    expect(() => formatJournalLine({ ...stopped, lastText: clipLastText('я'.repeat(5000)) })).not.toThrow()
  })

  it('ignores blank lines without counting them, including CRLF endings', () => {
    const text = `\n${JSON.stringify(started)}\r\n\n   \n${JSON.stringify(stopped)}\r\n`
    expect(parseJournal(text)).toEqual({ events: [started, stopped], skipped: 0 })
  })

  it('returns no events for an empty file', () => {
    expect(parseJournal('')).toEqual({ events: [], skipped: 0 })
  })
})

describe('formatJournalLine', () => {
  it('writes one JSON object and one newline, with no newline inside', () => {
    const event: JournalEvent = { ...base, at: at(4), kind: 'session-error', session: null, message: 'line one\nline two' }
    const text = formatJournalLine(event)
    expect(text.endsWith('\n')).toBe(true)
    expect(text.slice(0, -1)).not.toContain('\n')
    expect(JSON.parse(text)).toEqual(event)
  })

  it('refuses an event outside the format instead of writing a line no reader would accept', () => {
    expect(() => formatJournalLine({ ...base, at: at(1), kind: 'coffee-break' } as unknown as JournalEvent)).toThrow(/journal/)
    expect(() => formatJournalLine({ ...waveStarted, wave: 'one' } as unknown as JournalEvent)).toThrow(/journal/)
    expect(() => formatJournalLine({ ...started, at: 'yesterday' })).toThrow(/journal/)
  })

  it('writes the parsed event, not the value it was given: undeclared keys are dropped', () => {
    const text = formatJournalLine({ ...stopped, secret: 'x' } as JournalEvent)
    expect(JSON.parse(text)).toEqual(stopped)
  })
})

describe('isRunId', () => {
  it('accepts the start time plus a short suffix and nothing that could leave the folder', () => {
    expect(isRunId(base.run)).toBe(true)
    for (const bad of ['', '../x', `../${base.run}`, `${base.run}/../../x`, `${base.run}.jsonl`, '2026-10-06T01:02:03.004Z-a1b2c3', 'run']) {
      expect(isRunId(bad)).toBe(false)
    }
  })
})
