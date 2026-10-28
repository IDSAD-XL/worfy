// The Autopilot run journal format (src/shared/autopilot/journal.ts): parsing a JSONL file that
// worfy and an outside observer both append to, and serialising one event into one line.
import { describe, expect, it } from 'vitest'
import {
  JOURNAL_EVENT_KINDS,
  LAST_TEXT_MAX,
  REASON_MAX,
  clipLastText,
  formatJournalLine,
  isRunId,
  journalReason,
  parseJournal,
  type JournalEvent,
} from '../../src/shared/autopilot/journal'

const base = { run: '2026-10-06T01-02-03-004Z-a1b2c3', project: 'Auction-1a2b3c4d', epic: 'worfy-daily' }
const at = (minute: number): string => new Date(Date.UTC(2026, 9, 6, 1, minute)).toISOString()

const started: JournalEvent = { ...base, at: at(0), kind: 'run-started' }
const waveStarted: JournalEvent = { ...base, at: at(1), kind: 'wave-started', wave: 1, tickets: ['01', '02'] }
const stopped: JournalEvent = { ...base, at: at(9), kind: 'run-stopped', reason: 'epic-done' }

const line = (value: unknown): string => `${JSON.stringify(value)}\n`

const harnessBehind: JournalEvent = { ...base, at: at(0), kind: 'harness-behind', harness: '0.1.0+abcdef1', main: 'origin/main', commits: 2 }

/** One valid event of every kind, in the order of JOURNAL_EVENT_KINDS. */
const everyKind: JournalEvent[] = [
  started,
  harnessBehind,
  waveStarted,
  { ...base, at: at(2), kind: 'narrow-round', ticket: '02', outcome: 'started', text: 'NARROW: [med] src/a.ts:1 — x' },
  { ...base, at: at(2), kind: 'wave-finished', wave: 1, tickets: ['01', '02'] },
  { ...base, at: at(2), kind: 'budget-stop', cause: 'daily-share', share: 0.09, used: 0.1, need: 0, until: at(29), text: "Today's share of the Limits is used: Autopilot continues at 00:00" },
  { ...base, at: at(3), kind: 'limits-hit', window: 'five_hour', resetsAt: at(30) },
  { ...base, at: at(3), kind: 'waiting-until', until: at(31) },
  { ...base, at: at(31), kind: 'resumed' },
  { ...base, at: at(32), kind: 'session-error', session: 'abc-123', message: 'spawn ENOENT' },
  { ...base, at: at(33), kind: 'refused-dialog', session: 'abc-123', what: 'AskUserQuestion' },
  { ...base, at: at(34), kind: 'human-input', source: 'worfy', what: 'message to the Orchestrator' },
  { ...base, at: at(35), kind: 'background-tasks', tasks: [{ id: 'task-1', type: 'local_agent', description: 'Implement 01' }] },
  { ...base, at: at(36), kind: 'run-stopping', reason: 'user-stop', wave: 1, tickets: ['01', '02'], inWork: ['01'] },
  { ...base, at: at(37), kind: 'gate-queue', text: '/worfy:gate-queue' },
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

  it('reads harness-behind (worfy-harness ticket 21), and a journal without it as before', () => {
    expect(parseJournal(line(started) + line(harnessBehind) + line(waveStarted))).toEqual({ events: [started, harnessBehind, waveStarted], skipped: 0 })
    expect(parseJournal(line(started) + line(waveStarted) + line(stopped))).toEqual({ events: [started, waveStarted, stopped], skipped: 0 })
  })

  it('reads gate-queue (worfy-windows ticket 17), and skips one without its text', () => {
    const gateQueue: JournalEvent = { ...base, at: at(8), kind: 'gate-queue', text: '/worfy:gate-queue' }
    expect(parseJournal(line(started) + line(gateQueue) + line(stopped))).toEqual({ events: [started, gateQueue, stopped], skipped: 0 })
    expect(parseJournal(line(started) + line({ ...gateQueue, text: undefined }) + line({ ...gateQueue, text: '' }) + line(stopped))).toEqual({ events: [started, stopped], skipped: 2 })
  })

  const narrowStarted: JournalEvent = { ...base, at: at(2), kind: 'narrow-round', ticket: '02', outcome: 'started', text: 'NARROW: [med] src/a.ts:1 — x' }
  const narrowRejected: JournalEvent = { ...base, at: at(3), kind: 'narrow-round', ticket: '02', outcome: 'rejected', text: 'NARROW: REJECTED: src/a.ts:1 still open' }

  it('reads narrow-round lines (worfy-harness ticket 20), and a journal without them as before', () => {
    const verified: JournalEvent = { ...narrowStarted, ticket: '07', outcome: 'verified', text: 'NARROW: VERIFIED' }
    expect(parseJournal(line(started) + line(waveStarted) + line(narrowStarted) + line(narrowRejected) + line(verified) + line(stopped))).toEqual({
      events: [started, waveStarted, narrowStarted, narrowRejected, verified, stopped],
      skipped: 0,
    })
    expect(parseJournal(line(started) + line(waveStarted) + line(stopped))).toEqual({ events: [started, waveStarted, stopped], skipped: 0 })
  })

  it('skips narrow-round with an unknown outcome, without a ticket or text, or with a text over 1000 characters, and counts it', () => {
    const bad = [{ outcome: 'passed' }, { outcome: 'VERIFIED' }, { outcome: undefined }, { ticket: '' }, { ticket: 2 }, { text: '' }, { text: 'x'.repeat(LAST_TEXT_MAX + 1) }]
    for (const fields of bad) {
      expect(parseJournal(line(started) + line({ ...narrowStarted, ...fields }) + line(stopped)), JSON.stringify(fields)).toEqual({ events: [started, stopped], skipped: 1 })
    }
  })

  it('skips harness-behind without a build version or ref, or with a count below 1', () => {
    const bad = [{ harness: '' }, { main: undefined }, { commits: 0 }, { commits: 1.5 }, { commits: '2' }]
    for (const fields of bad) {
      expect(parseJournal(line(started) + line({ ...harnessBehind, ...fields })), JSON.stringify(fields)).toEqual({ events: [started], skipped: 1 })
    }
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

  const refusedOld: JournalEvent = { ...base, at: at(33), kind: 'refused-dialog', session: 'abc-123', what: 'permission_request Bash' }
  const refusedNew: JournalEvent = { ...refusedOld, agent: 'agent-impl-07', reason: 'rm -rf with a target that cannot be resolved (~/x)' }

  it('reads refused-dialog with the Subagent and the reason, and an old line without them as before', () => {
    expect(parseJournal(line(started) + line(refusedOld) + line(refusedNew) + line(stopped))).toEqual({ events: [started, refusedOld, refusedNew, stopped], skipped: 0 })
    expect(parseJournal(line(refusedOld)).events[0]).toStrictEqual(refusedOld)
  })

  it('skips refused-dialog with an empty agent or reason, or a reason over REASON_MAX, and counts it', () => {
    for (const fields of [{ agent: '' }, { reason: '' }, { agent: 7 }, { reason: 'x'.repeat(REASON_MAX + 1) }]) {
      expect(parseJournal(line(started) + line({ ...refusedOld, ...fields }) + line(stopped)), JSON.stringify(fields)).toEqual({ events: [started, stopped], skipped: 1 })
    }
    expect(parseJournal(line({ ...refusedOld, reason: 'x'.repeat(REASON_MAX) })).skipped).toBe(0)
  })

  it('journalReason writes the home folder as ~ and clips to REASON_MAX units without cutting a surrogate pair', () => {
    expect(journalReason('cannot resolve /Users/someone/app and /Users/someone', '/Users/someone')).toBe('cannot resolve ~/app and ~')
    expect(journalReason('a path in /Users/someone/', '/Users/someone/')).toBe('a path in ~/')
    // Another user whose name starts with the same letters keeps the path.
    expect(journalReason('/Users/someone2/app, /Users/someone_x and /Users/someoneé', '/Users/someone')).toBe('/Users/someone2/app, /Users/someone_x and /Users/someoneé')
    expect(journalReason('it is in /Users/someone.', '/Users/someone')).toBe('it is in ~.')
    expect(journalReason('in C:\\Users\\someone\\app', 'C:\\Users\\someone')).toBe('in ~\\app')
    expect(journalReason('a (b) /', '')).toBe('a (b) /')
    expect(journalReason('a (b) /', '/')).toBe('a (b) /')
    expect(journalReason('a'.repeat(REASON_MAX + 5), '/h')).toBe('a'.repeat(REASON_MAX))
    expect(journalReason(`/h/${'a'.repeat(REASON_MAX)}`, '/h')).toBe(`~/${'a'.repeat(REASON_MAX - 2)}`)
    expect(journalReason(`${'a'.repeat(REASON_MAX - 1)}😀tail`, '/h')).toBe('a'.repeat(REASON_MAX - 1))
    expect(() => formatJournalLine({ ...refusedOld, reason: journalReason('я'.repeat(500), '/h') })).not.toThrow()
  })

  describe('journalReason: one rule for the home folder on every platform', () => {
    const windows = 'C:\\Users\\Ann'

    it('matches the home in any case: c:\\users\\ann on Windows, /Users/Ann for /Users/ann on a Mac', () => {
      expect(journalReason('rm -rf c:\\users\\ann\\x', windows)).toBe('rm -rf ~\\x')
      expect(journalReason('rm -rf C:\\USERS\\ANN\\x', windows)).toBe('rm -rf ~\\x')
      expect(journalReason('rm -rf /Users/Ann/x', '/Users/ann')).toBe('rm -rf ~/x')
    })

    it('takes \\ and / as the same separator: C:/Users/Ann and a mixed C:\\Users/Ann', () => {
      expect(journalReason('rm -rf C:\\Users\\Ann\\x', windows)).toBe('rm -rf ~\\x')
      expect(journalReason('rm -rf C:/Users/Ann/x', windows)).toBe('rm -rf ~/x')
      expect(journalReason('rm -rf C:\\Users/Ann/x', windows)).toBe('rm -rf ~/x')
    })

    it('takes the MSYS drive form /c/Users/Ann for a home on drive C, and no other drive', () => {
      expect(journalReason('rm -rf /c/Users/Ann/x', windows)).toBe('rm -rf ~/x')
      expect(journalReason('rm -rf /C/users/ann', windows)).toBe('rm -rf ~')
      expect(journalReason('rm -rf /d/Users/Ann/x and D:\\Users\\Ann\\x', windows)).toBe('rm -rf /d/Users/Ann/x and D:\\Users\\Ann\\x')
    })

    it('takes a home given with a trailing separator as the same home', () => {
      expect(journalReason('rm -rf /Users/ann/x', '/Users/ann/')).toBe('rm -rf ~/x')
      expect(journalReason('rm -rf C:/Users/Ann/x', 'C:\\Users\\Ann\\')).toBe('rm -rf ~/x')
    })

    it.each([',', '[', ';', '>', '"', "'", '`', '(', '=', ':', ' ', '\n', '|', '{', '<', '*'])('replaces the home after %j: punctuation is not part of a path', (before) => {
      expect(journalReason(`rm${before}/Users/ann/x`, '/Users/ann')).toBe(`rm${before}~/x`)
      expect(journalReason(`rm${before}c:/users/ann/x`, windows)).toBe(`rm${before}~/x`)
    })

    it('replaces the home at the start of the text', () => {
      expect(journalReason('/Users/ann/x', '/Users/ann')).toBe('~/x')
      expect(journalReason('/c/Users/Ann/x', windows)).toBe('~/x')
    })

    it.each(['x', 'Z', '7', 'я', '.', '_', '-'])('keeps a path that goes on from a path name: after %j', (before) => {
      expect(journalReason(`rm ${before}/Users/ann/x`, '/Users/ann')).toBe(`rm ${before}/Users/ann/x`)
      expect(journalReason(`rm ${before}C:\\Users\\Ann\\x`, windows)).toBe(`rm ${before}C:\\Users\\Ann\\x`)
    })

    it('keeps /mnt/Users/ann: the home in the middle of another path, after a name or a separator', () => {
      expect(journalReason('/mnt/Users/ann/x and x/Users/ann', '/Users/ann')).toBe('/mnt/Users/ann/x and x/Users/ann')
      expect(journalReason('rm /mnt//Users/ann/x and x\\/Users/ann', '/Users/ann')).toBe('rm /mnt//Users/ann/x and x\\/Users/ann')
      // A doubled separator at a path start is the same path: the run of separators is the home's own.
      expect(journalReason('rm //Users/ann/x', '/Users/ann')).toBe('rm ~/x')
    })

    it('replaces a drive home after a separator: the \\\\?\\ and \\\\.\\ prefixes, /C:\\ and file:///C:/', () => {
      expect(journalReason('rm \\\\?\\C:\\Users\\Ann\\x', windows)).toBe('rm \\\\?\\~\\x')
      expect(journalReason('rm \\\\.\\C:\\Users\\Ann\\x', windows)).toBe('rm \\\\.\\~\\x')
      expect(journalReason('rm \\\\?\\c:\\users\\ann\\x', windows)).toBe('rm \\\\?\\~\\x')
      expect(journalReason('rm /C:\\Users\\Ann\\x', windows)).toBe('rm /~\\x')
      expect(journalReason('open file:///C:/Users/Ann/x', windows)).toBe('open file:///~/x')
      expect(journalReason('rm x/C:\\Users\\Ann\\x and y\\c:/users/ann', windows)).toBe('rm x/~\\x and y\\~')
    })

    it('keeps a drive home that goes on from a path name, and an MSYS form after a separator or a name', () => {
      expect(journalReason('rm x/c/Users/Ann and /mnt/c/Users/Ann/x', windows)).toBe('rm x/c/Users/Ann and /mnt/c/Users/Ann/x')
      // A UNC server named c and a doubled separator before /c are not the MSYS form of the home.
      expect(journalReason('rm \\\\c\\Users\\Ann and /mnt//c/Users/Ann', windows)).toBe('rm \\\\c\\Users\\Ann and /mnt//c/Users/Ann')
      expect(journalReason('rm xC:\\Users\\Ann\\x and C:\\Users\\Ann2', windows)).toBe('rm xC:\\Users\\Ann\\x and C:\\Users\\Ann2')
    })

    it('keeps a home without a drive after a name or a separator: x/Users/ann, /System/Volumes/Data/Users/ann', () => {
      expect(journalReason('rm x/Users/ann and /System/Volumes/Data/Users/ann/x', '/Users/ann')).toBe('rm x/Users/ann and /System/Volumes/Data/Users/ann/x')
    })

    it('keeps a folder whose name only goes on from the home\'s', () => {
      expect(journalReason('rm C:\\Users\\Ann2\\x and /c/Users/Ann_b', windows)).toBe('rm C:\\Users\\Ann2\\x and /c/Users/Ann_b')
      expect(journalReason('rm /Users/ann-old/x', '/Users/ann')).toBe('rm /Users/ann-old/x')
    })
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
