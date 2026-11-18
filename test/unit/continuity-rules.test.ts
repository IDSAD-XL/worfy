// The rules of the continuation after a restart of worfy (worfy-continuity ticket 05, src/main/agent/continuity.ts):
// the hour and the cap, the turn the restart cut off (only its calls count for the unknown side effects of ticket
// 16), the Subagents that became Interrupted with it and their Tickets, whether the previous process of a Session
// was left by the worfy that died (its parent is gone) on macOS and on Windows, whether the restart was an Update's,
// and the queue as it comes back.
import { describe, expect, it } from 'vitest'
import {
  CONTINUE_CAP,
  CONTINUE_WITHIN_MS,
  continuityRule,
  cutOffTurn,
  interruptedSubagents,
  parentState,
  queueEntries,
  restartCause,
  restartSubagents,
} from '../../src/main/agent/continuity'
import type { LiveSession } from '../../src/shared/agent/live-sessions'
import { unknownSideEffects } from '../../src/shared/agent/unknown-side-effects'
import { parseTranscriptLines } from '../../src/shared/transcript/parse'

const MINUTE = 60_000
const START = Date.parse('2026-11-18T14:05:00.000Z')

const RECORD: LiveSession = {
  nodeId: 'node-1',
  kind: 'session-node',
  vendor: 'claude',
  vendorSessionId: 's-1',
  state: 'busy',
  queue: { items: [], held: false },
  runId: null,
  lastEventAt: START - 5 * MINUTE,
  continuedAt: [],
}

/** Lines of a Session's own transcript, as Claude Code writes them. */
const at = (minute: number): string => new Date(START - (60 - minute) * MINUTE).toISOString()
const userLine = (text: string, minute: number): string => JSON.stringify({ type: 'user', isSidechain: false, timestamp: at(minute), message: { role: 'user', content: text } })
const useLine = (id: string, command: string, minute: number, sidechain = false): string =>
  JSON.stringify({ type: 'assistant', isSidechain: sidechain, timestamp: at(minute), message: { id: `m-${id}`, role: 'assistant', content: [{ type: 'tool_use', id, name: 'Bash', input: { command } }] } })
const resultLine = (id: string, minute: number, sidechain = false): string =>
  JSON.stringify({ type: 'user', isSidechain: sidechain, timestamp: at(minute), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] } })
const endLine = (minute: number, sidechain = true): string =>
  JSON.stringify({ type: 'assistant', isSidechain: sidechain, timestamp: at(minute), message: { id: `m-end-${minute}`, role: 'assistant', content: [{ type: 'text', text: 'Done.' }], stop_reason: 'end_turn' } })

describe('continuityRule: the hour and the cap', () => {
  it('continues a Session cut off 59 minutes before the start, not one cut off 61 minutes before', () => {
    expect(CONTINUE_WITHIN_MS).toBe(60 * MINUTE)
    expect(continuityRule({ ...RECORD, lastEventAt: START - 59 * MINUTE }, START)).toBe('continue')
    expect(continuityRule({ ...RECORD, lastEventAt: START - 61 * MINUTE }, START)).toBe('too-old')
    expect(continuityRule({ ...RECORD, lastEventAt: START - 60 * MINUTE }, START)).toBe('too-old')
  })

  it('does not continue a third time within the hour; continuations older than the hour do not count', () => {
    expect(CONTINUE_CAP).toBe(2)
    expect(continuityRule({ ...RECORD, continuedAt: [START - 30 * MINUTE] }, START)).toBe('continue')
    expect(continuityRule({ ...RECORD, continuedAt: [START - 40 * MINUTE, START - 10 * MINUTE] }, START)).toBe('cap')
    expect(continuityRule({ ...RECORD, continuedAt: [START - 70 * MINUTE, START - 10 * MINUTE] }, START)).toBe('continue')
  })

  it('a record from a clock ahead of the start (lastEventAt later than now) still continues', () => {
    expect(continuityRule({ ...RECORD, lastEventAt: START + MINUTE }, START)).toBe('continue')
  })
})

describe('cutOffTurn: only the turn the restart cut off', () => {
  it('leaves out a call without a result of an earlier turn, which ticket 16 would count otherwise', () => {
    const entries = parseTranscriptLines([
      userLine('push it', 1),
      useLine('t-old', 'git push origin main', 2),
      // The person interrupted that turn: the push never got its result. Then a new turn.
      userLine('now write the docs', 10),
      useLine('t-new', 'ls docs', 11),
      resultLine('t-new', 12),
    ])
    const cut = cutOffTurn(entries)
    expect(cut.since).toBe(Date.parse(at(10)))
    expect(unknownSideEffects({ session: RECORD, events: cut.events, subagents: [], workflow: undefined }).session).toEqual([])
    // The whole transcript would refuse the continuation for the old push.
    const all = parseTranscriptLines([userLine('push it', 1), useLine('t-old', 'git push origin main', 2), userLine('now write the docs', 10)]).map((entry) => entry.event)
    expect(unknownSideEffects({ session: RECORD, events: all, subagents: [], workflow: undefined }).session.map((call) => call.description)).toEqual(['git push origin main'])
  })

  it('keeps a call without a result of the cut-off turn', () => {
    const cut = cutOffTurn(parseTranscriptLines([userLine('ship it', 1), useLine('t-push', 'git push origin main', 2)]))
    expect(unknownSideEffects({ session: RECORD, events: cut.events, subagents: [], workflow: undefined }).session.map((call) => call.description)).toEqual(['git push origin main'])
  })

  it('leaves out the records a Subagent wrote into the Session file, and gives the whole file when no person spoke', () => {
    const cut = cutOffTurn(parseTranscriptLines([useLine('t-side', 'git push', 1, true), useLine('t-own', 'gh pr merge 12', 2)]))
    expect(cut.since).toBeNull()
    expect(cut.events.filter((event) => event.type === 'tool_use').map((event) => (event.type === 'tool_use' ? event.id : ''))).toEqual(['t-own'])
  })
})

describe('interruptedSubagents and their Tickets', () => {
  const since = Date.parse(at(10))

  it('takes the Subagents with no end that wrote during the cut-off turn; one that ended, or went quiet before it, is left out', () => {
    const found = interruptedSubagents(
      [
        { agentId: 'a-cut', lines: [userLine('Implement ticket .scratch/worfy-continuity/issues/05-x.md', 11), useLine('t1', 'gh pr merge 12', 12, true)] },
        { agentId: 'a-done', lines: [useLine('t2', 'ls', 11, true), resultLine('t2', 12, true), endLine(13)] },
        { agentId: 'a-old', lines: [useLine('t3', 'git push', 2, true)] },
      ],
      since,
    )
    expect(found.map((each) => each.agentId)).toEqual(['a-cut'])
    expect(unknownSideEffects({ session: RECORD, events: [], subagents: found, workflow: undefined }).subagents.map((each) => each.calls.map((call) => call.description))).toEqual([
      ['gh pr merge 12'],
    ])
  })

  it('takes every Subagent without an end when the turn has no start, and names each one with the Ticket of its Binding', () => {
    const lines = [JSON.stringify({ type: 'assistant', isSidechain: true, timestamp: at(11), message: { id: 'm-claim', role: 'assistant', content: [{ type: 'tool_use', id: 't-claim', name: 'Bash', input: { command: 'node ~/.claude/worfy-harness/plugin/bin/ticket claim worfy-continuity 05' } }] } })]
    const found = interruptedSubagents([{ agentId: 'a-1', lines }], null)
    expect(restartSubagents(found)).toEqual([{ agentId: 'a-1', ticket: { epic: 'worfy-continuity', num: 5 } }])
  })
})

describe('parentState: the previous process of a Session, left by the worfy that died', () => {
  it('macOS: a process given to launchd (ppid 1) or whose parent is gone is an orphan; one whose parent runs is not', () => {
    const listing = ['    1     0 /sbin/launchd', '  500     1 claude --resume s-1', '  600   700 claude --resume s-2', '  700     1 /bin/zsh', '  800   999 claude'].join('\n')
    expect(parentState('darwin', listing, 500, 4242)).toBe('orphan')
    expect(parentState('darwin', listing, 600, 4242)).toBe('owned')
    expect(parentState('darwin', listing, 800, 4242)).toBe('orphan')
    expect(parentState('darwin', listing, 900, 4242)).toBe('gone')
    expect(parentState('linux', '  1 0 init\n  42 4242 claude', 42, 4242)).toBe('owned')
  })

  it('Windows: a parent that is gone, or a pid given to a process started after the child, makes an orphan', () => {
    const date = (ms: number): string => `/Date(${ms})/`
    const listing = JSON.stringify([
      { ProcessId: 10, ParentProcessId: 4, CreationDate: date(1_000) },
      { ProcessId: 500, ParentProcessId: 77, CreationDate: date(5_000) },
      { ProcessId: 600, ParentProcessId: 10, CreationDate: date(6_000) },
      // The parent's pid now belongs to a process started after the child: the real parent died.
      { ProcessId: 700, ParentProcessId: 800, CreationDate: date(7_000) },
      { ProcessId: 800, ParentProcessId: 4, CreationDate: date(9_000) },
    ])
    expect(parentState('win32', listing, 500, 4242)).toBe('orphan')
    expect(parentState('win32', listing, 600, 4242)).toBe('owned')
    expect(parentState('win32', listing, 700, 4242)).toBe('orphan')
    expect(parentState('win32', listing, 900, 4242)).toBe('gone')
    // PowerShell prints a single process as an object, not a list.
    expect(parentState('win32', JSON.stringify({ ProcessId: 500, ParentProcessId: 0, CreationDate: date(5_000) }), 500, 4242)).toBe('orphan')
  })
})

describe('restartCause', () => {
  it('is an Update when its restart record was written after the Session last did something, and before the start', () => {
    expect(restartCause(START - 3 * MINUTE, START - 5 * MINUTE, START)).toBe('update')
    // The quit's grace lets a turn run on for a minute after the press of Restart now.
    expect(restartCause(START - 4 * MINUTE, START - 3 * MINUTE, START)).toBe('update')
    // An Update days ago, then a crash: not this restart.
    expect(restartCause(START - 3 * 24 * 60 * MINUTE, START - 5 * MINUTE, START)).toBeNull()
    expect(restartCause(null, START - 5 * MINUTE, START)).toBeNull()
    expect(restartCause(START + MINUTE, START - 5 * MINUTE, START)).toBeNull()
  })
})

describe('queueEntries: the queue as it comes back', () => {
  it('keeps the texts, the files as attachments and whether it was held; the images are only counted', () => {
    const queue = queueEntries({ items: [{ text: 'and then the docs', files: ['/repo/notes.md'], images: ['shot.png'] }, { text: 'thanks', files: [], images: [] }], held: true })
    expect(queue.paused).toBe(true)
    expect(queue.lostImages).toBe(1)
    expect(queue.items.map(({ text, attachments }) => ({ text, attachments }))).toEqual([
      { text: 'and then the docs', attachments: [{ kind: 'file', name: 'notes.md', path: '/repo/notes.md', size: 0, copied: false }] },
      { text: 'thanks', attachments: [] },
    ])
    expect(new Set(queue.items.map((item) => item.id)).size).toBe(2)
  })
})
