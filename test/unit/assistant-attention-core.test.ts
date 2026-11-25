// The attention core of the Assistant (worfy-assistant ticket 03; spec, test decisions, seam A): events, a clock
// that is not the machine's, and the settings in; items out. The items are kept in the Project's data folder, so a
// restart is a new core over the same folder.
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import type { AttentionEvent } from '../../src/shared/assistant/attention'
import { AttentionCore } from '../../src/main/assistant/core/attention-core'
import { attentionFileStore, attentionPaths, ATTENTION_FILE } from '../../src/main/assistant/core/store'
import { removeTree } from '../../src/main/storage/remove'

const temp = mkdtempSync(join(tmpdir(), 'worfy-attention-'))
afterAll(() => removeTree(temp))

const PROJECT = 'p-alpha'
const MIN = 60_000
const HOUR = 60 * MIN

/** A clock the test moves by hand. */
function clock(start: string): { now: () => number; set: (iso: string) => void; add: (ms: number) => void } {
  let at = Date.parse(start)
  return { now: () => at, set: (iso) => (at = Date.parse(iso)), add: (ms) => (at += ms) }
}

let folders = 0
/** A data root of its own: a Project's data folder under it, as the app's store keeps them. */
function dataRoot(): { root: string; projectDir: (id: string) => string } {
  const root = join(temp, `root-${folders++}`)
  return { root, projectDir: (id) => join(root, 'projects', id) }
}

/** A core over `root`, in Berlin time (DST ends on 2026-10-25 at 03:00 local). */
function coreOver(root: ReturnType<typeof dataRoot>, now: () => number, timeZone = 'Europe/Berlin'): AttentionCore {
  return new AttentionCore({ now, store: attentionFileStore(attentionPaths(root.projectDir, root.root)), settings: () => ({ timeZone }), projects: () => [PROJECT] })
}

/** A blocked Ticket with `Waits: owner` (rule (f) of the events measurement). */
const waits = (num: number, revision: string, at?: number): AttentionEvent => ({
  source: 'ticket-waits',
  id: `worfy-x/${num}`,
  revision,
  projectId: PROJECT,
  subject: { kind: 'ticket', id: `worfy-x/${num}`, label: `worfy-x ${num}` },
  kind: 'waits',
  text: 'acceptance by the owner',
  ...(at === undefined ? {} : { at }),
})

/** A Session's turn that ended with an API error (rule (e)). */
const apiError = (session: string, n: number): AttentionEvent => ({
  source: 'session',
  id: `${session}:error`,
  revision: String(n),
  projectId: PROJECT,
  subject: { kind: 'session', id: session, label: session },
  kind: 'error',
  text: 'rate_limit',
})

describe('dedup and gluing', () => {
  it('two events with one source, id and revision give one item; a new revision of the subject the same day is glued into it', () => {
    const time = clock('2026-11-13T09:00:00Z')
    const core = coreOver(dataRoot(), time.now)
    expect(core.ingest(waits(1, 'r1'))).not.toBeNull()
    expect(core.ingest(waits(1, 'r1'))).toBeNull()
    time.add(HOUR)
    core.ingest({ ...waits(1, 'r2'), kind: 'blocked', source: 'workflow' })
    expect(core.items(PROJECT)).toEqual([
      expect.objectContaining({ source: 'workflow', projectId: PROJECT, subject: expect.objectContaining({ kind: 'ticket', id: 'worfy-x/1' }), kind: 'blocked', revision: 'r2', state: 'new', duty: null, events: 2, startedAt: Date.parse('2026-11-13T09:00:00Z'), updatedAt: Date.parse('2026-11-13T10:00:00Z') }),
    ])
  })

  it('the 1 188 rate_limit refusals of one Session on 2026-11-13 are one item; another Session is another', () => {
    const time = clock('2026-11-13T01:04:00Z')
    const core = coreOver(dataRoot(), time.now)
    for (let n = 0; n < 1188; n++) {
      core.ingest(apiError('s-orchestrator', n))
      time.add(3_000)
    }
    core.ingest(apiError('s-other', 0))
    expect(core.items(PROJECT).map((item) => [item.subject.id, item.events])).toEqual([
      ['s-orchestrator', 1188],
      ['s-other', 1],
    ])
  })

  it('a seen item asks again when its subject has news; a dismissed one stays dismissed', () => {
    const time = clock('2026-11-13T09:00:00Z')
    const core = coreOver(dataRoot(), time.now)
    const seen = core.ingest(waits(1, 'r1'))!
    const dismissed = core.ingest(waits(2, 'r1'))!
    core.mark(PROJECT, seen.id, 'seen')
    core.mark(PROJECT, dismissed.id, 'dismissed')
    core.ingest(waits(1, 'r2'))
    core.ingest(waits(2, 'r2'))
    expect(core.items(PROJECT).map((item) => item.state)).toEqual(['new', 'dismissed'])
  })

  it('resolve closes the open items of the subject; a later event opens it again', () => {
    const time = clock('2026-11-13T09:00:00Z')
    const core = coreOver(dataRoot(), time.now)
    core.ingest(waits(1, 'r1'))
    core.resolve(PROJECT, waits(1, '').subject)
    expect(core.items(PROJECT)[0]!.state).toBe('closed')
    core.ingest(waits(1, 'r2'))
    expect(core.items(PROJECT)[0]!.state).toBe('new')
  })
})

describe('the day of the gluing on a clock that is not the machine’s', () => {
  it('midnight: 23:50 and 00:10 local time are two days, two items', () => {
    const time = clock('2026-11-13T22:50:00Z') // 23:50 in Berlin (UTC+1)
    const core = coreOver(dataRoot(), time.now)
    core.ingest(waits(1, 'r1'))
    time.add(20 * MIN)
    core.ingest(waits(1, 'r2'))
    expect(core.items(PROJECT).map((item) => [item.revision, item.events])).toEqual([
      ['r1', 1],
      ['r2', 1],
    ])
  })

  it('the change of daylight saving time: the 25 hours of 2026-10-25 in Berlin are one day', () => {
    const time = clock('2026-10-24T22:30:00Z') // 00:30 on 10-25, still UTC+2
    const core = coreOver(dataRoot(), time.now)
    core.ingest(waits(1, 'r1'))
    time.set('2026-10-25T22:30:00Z') // 23:30 on 10-25, UTC+1 since 03:00: 24 h later, the same day
    core.ingest(waits(1, 'r2'))
    time.set('2026-10-25T23:30:00Z') // 00:30 on 10-26
    core.ingest(waits(1, 'r3'))
    expect(core.items(PROJECT).map((item) => [item.revision, item.events])).toEqual([
      ['r2', 2],
      ['r3', 1],
    ])
  })

  it('the day is the event’s own: an event that came while worfy was closed glues into the day it happened', () => {
    const time = clock('2026-11-14T08:00:00Z')
    const core = coreOver(dataRoot(), time.now)
    core.ingest(waits(1, 'r1', Date.parse('2026-11-13T20:00:00Z')))
    core.ingest(waits(1, 'r2'))
    expect(core.items(PROJECT).map((item) => item.startedAt)).toEqual([Date.parse('2026-11-13T20:00:00Z'), Date.parse('2026-11-14T08:00:00Z')])
  })
})

describe('«nothing happened»', () => {
  const waiting = (revision: string, from?: number) => ({
    source: 'session' as const,
    id: 's-1:waiting',
    revision,
    projectId: PROJECT,
    subject: { kind: 'session' as const, id: 's-1', label: 's-1' },
    kind: 'waiting',
    text: 'Waits for you since the end of its turn',
    quietMs: 15 * MIN,
    ...(from === undefined ? {} : { from }),
  })

  it('one condition gives one item while it does not change; a changed one gives a new item and the old one is stale', () => {
    const time = clock('2026-11-13T09:00:00Z')
    const core = coreOver(dataRoot(), time.now)
    core.expect(waiting('turn-1'))
    time.add(14 * MIN)
    core.tick()
    expect(core.items(PROJECT)).toEqual([])
    time.add(MIN)
    core.tick()
    core.tick()
    core.expect(waiting('turn-1'))
    time.add(HOUR)
    core.tick()
    expect(core.items(PROJECT)).toEqual([expect.objectContaining({ kind: 'waiting', condition: 's-1:waiting', state: 'new', startedAt: Date.parse('2026-11-13T09:15:00Z') })])

    core.expect(waiting('turn-2'))
    time.add(15 * MIN)
    core.tick()
    expect(core.items(PROJECT).map((item) => [item.revision, item.state])).toEqual([
      ['turn-1', 'stale'],
      ['turn-2', 'new'],
    ])
  })

  it('something that happens on the subject before it is due ends the condition', () => {
    const time = clock('2026-11-13T09:00:00Z')
    const core = coreOver(dataRoot(), time.now)
    core.expect(waiting('turn-1'))
    time.add(5 * MIN)
    core.ingest(apiError('s-1', 1))
    time.add(HOUR)
    core.tick()
    expect(core.items(PROJECT).map((item) => item.kind)).toEqual(['error'])
  })

  it('a sleep of the Mac: the first tick after the wake gives the one item, dated when the condition came due', () => {
    const time = clock('2026-11-13T22:00:00Z')
    const core = coreOver(dataRoot(), time.now)
    core.expect(waiting('turn-1'))
    time.add(8 * HOUR) // the Mac slept through the night: no tick ran
    core.tick()
    core.tick()
    expect(core.items(PROJECT).map((item) => [item.kind, item.startedAt])).toEqual([['waiting', Date.parse('2026-11-13T22:15:00Z')]])
  })
})

describe('keeping the items', () => {
  it('the items lie in the Project’s data folder and live through a restart; a repeat after it gives nothing', () => {
    const root = dataRoot()
    const time = clock('2026-11-13T09:00:00Z')
    const first = coreOver(root, time.now)
    first.ingest(waits(1, 'r1'))
    expect(existsSync(join(root.projectDir(PROJECT), ATTENTION_FILE))).toBe(true)

    const second = coreOver(root, time.now)
    expect(second.items(PROJECT)).toEqual(first.items(PROJECT))
    expect(second.ingest(waits(1, 'r1'))).toBeNull()
  })

  it('a restart: a condition named before it gives its one item after it, and only once', () => {
    const root = dataRoot()
    const time = clock('2026-11-13T09:00:00Z')
    coreOver(root, time.now).expect({
      source: 'session',
      id: 's-1:waiting',
      revision: 'turn-1',
      projectId: PROJECT,
      subject: { kind: 'session', id: 's-1', label: 's-1' },
      kind: 'waiting',
      text: 'waits',
      quietMs: 15 * MIN,
    })
    time.add(2 * HOUR) // worfy was closed
    const after = coreOver(root, time.now)
    after.tick()
    expect(after.items(PROJECT).map((item) => item.kind)).toEqual(['waiting'])
    const again = coreOver(root, time.now)
    again.tick()
    expect(again.items(PROJECT)).toHaveLength(1)
  })

  it('the Machine’s items lie under worfy’s data root, apart from any Project', () => {
    const root = dataRoot()
    const time = clock('2026-11-13T09:00:00Z')
    const core = coreOver(root, time.now)
    core.ingest({ source: 'limits', id: 'five_hour', revision: 'limit-reached\0', projectId: null, subject: { kind: 'limit', id: 'five_hour', label: 'five_hour' }, kind: 'limit-reached', text: 'reached' })
    expect(existsSync(join(root.root, 'assistant', 'items.json'))).toBe(true)
    expect(core.items(null)).toHaveLength(1)
    expect(core.items(PROJECT)).toEqual([])
  })

  it('the store is bounded: an item, open or not, that took no event for 14 days is dropped, with the keys of that time', () => {
    const time = clock('2026-11-01T09:00:00Z')
    const core = coreOver(dataRoot(), time.now)
    core.ingest(waits(1, 'r1'))
    core.ingest(waits(2, 'r1'))
    core.ingest(waits(3, 'r1'))
    core.resolve(PROJECT, waits(1, '').subject)
    time.add(10 * 24 * HOUR)
    core.ingest(waits(3, 'r2'))
    time.add(5 * 24 * HOUR)
    core.ingest(waits(4, 'r1'))
    expect(core.items(PROJECT).map((item) => [item.subject.id, item.revision])).toEqual([
      ['worfy-x/3', 'r2'],
      ['worfy-x/4', 'r1'],
    ])
  })

  it('updatedAt is the core’s clock when it took the event, not the event’s own time; startedAt is the event’s', () => {
    const time = clock('2026-11-13T18:00:00Z')
    const core = coreOver(dataRoot(), time.now)
    // An event that happened at 09:00 and was read back at 18:00 (a catch-up), then one more of the subject at 10:00.
    core.ingest(waits(1, 'r1', Date.parse('2026-11-13T09:00:00Z')))
    expect(core.items(PROJECT).map((item) => [item.startedAt, item.updatedAt])).toEqual([[Date.parse('2026-11-13T09:00:00Z'), Date.parse('2026-11-13T18:00:00Z')]])
    time.add(HOUR)
    core.ingest(waits(1, 'r2', Date.parse('2026-11-13T10:00:00Z')))
    expect(core.items(PROJECT).map((item) => [item.startedAt, item.updatedAt, item.events])).toEqual([[Date.parse('2026-11-13T09:00:00Z'), Date.parse('2026-11-13T19:00:00Z'), 2]])
  })

  it('a Project whose file cannot be read or written does not stop the tick of the others', () => {
    const time = clock('2026-11-13T09:00:00Z')
    const root = dataRoot()
    const files = attentionFileStore(attentionPaths(root.projectDir, root.root))
    const logs: string[] = []
    const store = {
      read: (scope: string | null) => {
        if (scope === 'p-broken') throw new Error('EACCES: permission denied')
        return files.read(scope)
      },
      write: files.write,
    }
    const core = new AttentionCore({ now: time.now, store, settings: () => ({ timeZone: 'Europe/Berlin' }), projects: () => ['p-broken', PROJECT], log: (message) => logs.push(message) })
    core.expect({ source: 'session', id: 's-1:waiting', revision: 'turn-1', projectId: PROJECT, subject: { kind: 'session', id: 's-1', label: 's-1' }, kind: 'waiting', text: 'waits', quietMs: 15 * MIN })
    time.add(HOUR)
    expect(() => core.tick()).not.toThrow()
    expect(core.items(PROJECT).map((item) => item.kind)).toEqual(['waiting'])
    expect(logs).toEqual([expect.stringContaining('p-broken')])
  })
})
