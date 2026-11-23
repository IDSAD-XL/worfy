// The Acceptance queue rule (worfy-acceptance ticket 01): which manual items of which Tickets wait for the owner,
// and in which group the owner sees each, over the workflow models of every Project of the Machine. A manual
// item waits while it has no `[x]` and is not verified; a Ticket waits by itself when it is `blocked` with
// `Waits: owner` (the same rule as Autopilot's Epic queue, `ownersOwn`). The groups come in the spec's order,
// and inside a group the rows go by Project, Epic, Ticket number and item number.
import { describe, expect, it } from 'vitest'
import { acceptanceQueue, itemWaitsForOwner, OLDER_AFTER_DAYS, type QueueProject } from '../../src/shared/acceptance/queue'
import { ACCEPTANCE_GROUPS, type AcceptanceGroup, type AcceptanceRow } from '../../src/shared/ipc/acceptance'
import type { EvidenceItem, EvidenceLine, Ticket } from '../../src/shared/workflow/types'

const NOW = Date.parse('2026-11-23T12:00:00Z')
const DAY = 24 * 60 * 60 * 1000

const line = (kind: string, verdict: 'pass' | 'fail', n = 1): EvidenceLine => ({
  kind,
  verdict,
  ref: '2026-11-22: ok',
  platform: 'mac',
  copy: 'stable',
  sha: 'abc1234',
  scrub: null,
  line: 10 + n,
})

const item = (index: number, extra: Partial<EvidenceItem> = {}): EvidenceItem => ({
  index,
  text: `item ${index}`,
  checked: false,
  manual: true,
  needs: null,
  evidence: [],
  errors: [],
  line: index,
  state: 'not-verified',
  reason: 'no evidence',
  ...extra,
})

const ticket = (epic: string, num: number, state: Ticket['state'], evidence: EvidenceItem[], extra: Partial<Ticket> = {}): Ticket => ({
  epic,
  num,
  slug: `t${num}`,
  title: `${epic} ticket ${num}`,
  statusRaw: state,
  state,
  statusAt: '2026-11-22T10:00Z',
  waits: null,
  blockedReason: null,
  pr: null,
  blockedRaw: null,
  blockedNums: [],
  blockedParsed: true,
  files: [],
  filesListed: true,
  fromBranch: null,
  evidence,
  ...extra,
})

const project = (projectId: string, tickets: Ticket[]): QueueProject => ({ projectId, name: projectId, model: { tickets } })

/** Each group with its rows as `<project> <epic> NN[.item]`. */
function shape(groups: AcceptanceGroup[]): Record<string, string[]> {
  const name = (row: AcceptanceRow) => `${row.ticket.projectId} ${row.ticket.epic} ${String(row.ticket.num).padStart(2, '0')}${row.kind === 'item' ? `.${row.item.index}` : ''}`
  return Object.fromEntries(groups.map((group) => [group.group, group.rows.map(name)]))
}

const queue = (projects: QueueProject[], options: Partial<Parameters<typeof acceptanceQueue>[1]> = {}) => acceptanceQueue(projects, { now: NOW, ...options })

describe('itemWaitsForOwner', () => {
  it('a manual item without [x] and not verified waits; [x], verified or not manual does not', () => {
    expect(itemWaitsForOwner(item(1))).toBe(true)
    expect(itemWaitsForOwner(item(1, { state: 'failed', reason: null, evidence: [line('owner-check', 'fail')] }))).toBe(true)
    expect(itemWaitsForOwner(item(1, { checked: true }))).toBe(false)
    expect(itemWaitsForOwner(item(1, { state: 'verified', reason: null, evidence: [line('owner-check', 'pass')] }))).toBe(false)
    expect(itemWaitsForOwner(item(1, { manual: false }))).toBe(false)
  })
})

describe('acceptanceQueue', () => {
  it('gives every group, in the order of the spec, even an empty one', () => {
    expect(ACCEPTANCE_GROUPS).toEqual(['ready', 'update', 'waits', 'failed', 'work', 'older'])
    expect(queue([]).map((group) => group.group)).toEqual(ACCEPTANCE_GROUPS)
    expect(queue([]).every((group) => group.rows.length === 0)).toBe(true)
  })

  it('takes only the manual items that wait: not a [x] one, a verified one or one that is not manual', () => {
    const groups = queue([
      project('p', [
        ticket('e', 1, 'done', [
          item(1),
          item(2, { checked: true }),
          item(3, { state: 'verified', reason: null, evidence: [line('owner-check', 'pass')] }),
          item(4, { manual: false }),
          item(5, { text: 'second manual' }),
        ]),
      ]),
    ])
    expect(shape(groups).ready).toEqual(['p e 01.1', 'p e 01.5'])
    expect(groups.flatMap((group) => group.rows)).toHaveLength(2)
  })

  it('a done Ticket is Ready to check; done only in its branch, open, in work or blocked for another is In work', () => {
    const groups = queue([
      project('p', [
        ticket('e', 1, 'done', [item(1)]),
        ticket('e', 2, 'done', [item(1)], { fromBranch: 'e/02' }),
        ticket('e', 3, 'open', [item(1)]),
        ticket('e', 4, 'work', [item(1)]),
        ticket('e', 5, 'blocked', [item(1)], { waits: 'team' }),
      ]),
    ])
    expect(shape(groups).ready).toEqual(['p e 01.1'])
    expect(shape(groups).work).toEqual(['p e 02.1', 'p e 03.1', 'p e 04.1', 'p e 05.1'])
  })

  it('a Ticket blocked with Waits: owner shows its waiting items as Ready to check, and without them is one row of Waits for you', () => {
    const groups = queue([
      project('p', [
        ticket('e', 1, 'blocked', [item(1), item(2, { manual: false })], { waits: 'owner' }),
        ticket('e', 2, 'blocked', [item(1, { checked: true })], { waits: 'Owner ', blockedReason: 'choose a name' }),
        ticket('e', 3, 'blocked', [], { waits: 'owner' }),
        ticket('e', 4, 'blocked', [], { waits: 'agent' }),
      ]),
    ])
    expect(shape(groups).ready).toEqual(['p e 01.1'])
    expect(shape(groups).waits).toEqual(['p e 02', 'p e 03'])
    const row = groups.find((group) => group.group === 'waits')!.rows[0]!
    expect(row).toMatchObject({ kind: 'ticket', ticket: { blockedReason: 'choose a name' } })
  })

  it('an item whose last Evidence line is fail is Failed, whatever its Ticket', () => {
    const failed = { state: 'failed' as const, reason: null, evidence: [line('owner-check', 'pass', 1), line('owner-check', 'fail', 2)] }
    const groups = queue([
      project('p', [
        ticket('e', 1, 'done', [item(1, failed)], { statusAt: '2026-09-01T10:00Z' }),
        ticket('e', 2, 'work', [item(1, failed)]),
        ticket('e', 3, 'done', [item(1, { evidence: [line('owner-check', 'fail', 1), line('owner-check', 'pass', 2)], state: 'verified', reason: null })]),
      ]),
    ])
    expect(shape(groups).failed).toEqual(['p e 01.1', 'p e 02.1'])
    expect(groups.flatMap((group) => group.rows)).toHaveLength(2)
  })

  it(`a Ticket closed more than ${OLDER_AFTER_DAYS} days ago is Older; at the threshold or with no time it is not`, () => {
    const at = (days: number) => new Date(NOW - days * DAY).toISOString().slice(0, 16) + 'Z'
    const groups = queue([
      project('p', [
        ticket('e', 1, 'done', [item(1)], { statusAt: at(OLDER_AFTER_DAYS + 1) }),
        ticket('e', 2, 'done', [item(1)], { statusAt: '2026-10-07' }),
        ticket('e', 3, 'done', [item(1)], { statusAt: at(OLDER_AFTER_DAYS) }),
        ticket('e', 4, 'done', [item(1)], { statusAt: null }),
        // Blocked for the owner long ago: not closed, so not Older.
        ticket('e', 5, 'blocked', [item(1)], { waits: 'owner', statusAt: at(60) }),
      ]),
    ])
    expect(shape(groups).older).toEqual(['p e 01.1', 'p e 02.1'])
    expect(shape(groups).ready).toEqual(['p e 03.1', 'p e 04.1', 'p e 05.1'])
  })

  it('Update first takes the items whose change is not in the Stable copy yet; an unknown answer leaves them Ready to check', () => {
    const asked: string[] = []
    const groups = queue(
      [project('p', [ticket('e', 1, 'done', [item(1)]), ticket('e', 2, 'done', [item(1)]), ticket('e', 3, 'done', [item(1)]), ticket('e', 4, 'work', [item(1)])])],
      {
        inStable: (projectId, t) => {
          asked.push(`${projectId} ${t.num}`)
          return t.num === 1 ? false : t.num === 2 ? true : null
        },
      },
    )
    expect(shape(groups).update).toEqual(['p e 01.1'])
    expect(shape(groups).ready).toEqual(['p e 02.1', 'p e 03.1'])
    // A Ticket in work is not asked: its change is not merged.
    expect(asked).not.toContain('p 4')
  })

  it('orders a group by Project (in the order of the list), Epic, Ticket number and item number', () => {
    const groups = queue([
      project('zeta', [ticket('b', 2, 'done', [item(3), item(1)]), ticket('a', 10, 'done', [item(1)]), ticket('a', 9, 'done', [item(2)])]),
      project('alpha', [ticket('a', 1, 'done', [item(1)])]),
    ])
    expect(shape(groups).ready).toEqual(['zeta a 09.2', 'zeta a 10.1', 'zeta b 02.1', 'zeta b 02.3', 'alpha a 01.1'])
  })

  it('a row carries its item with its Evidence lines, the Ticket\'s items that are not manual, and the Sent mark it is given', () => {
    const proof = item(2, { manual: false, state: 'verified', reason: null, evidence: [line('test-run', 'pass')] })
    const shot = item(1, { evidence: [line('screenshot', 'pass')], state: 'verified', reason: null, manual: true })
    const waiting = item(3, { evidence: [line('review', 'pass')], reason: 'review only' })
    const groups = queue([project('p', [ticket('e', 7, 'done', [shot, proof, waiting], { pr: 42 })])], {
      sent: (projectId, t, i) => (projectId === 'p' && t.num === 7 && i.index === 3 ? { verdict: 'pass', at: '2026-11-23T11:00:00.000Z', state: 'sent' } : null),
    })
    const row = groups[0]!.rows[0]!
    expect(row.kind).toBe('item')
    if (row.kind !== 'item') return
    expect(row.item).toEqual(waiting)
    expect(row.prepared).toEqual([proof])
    expect(row.sent).toEqual({ verdict: 'pass', at: '2026-11-23T11:00:00.000Z', state: 'sent' })
    expect(row.stable).toBeNull()
    expect(row.ticket).toMatchObject({ projectId: 'p', projectName: 'p', epic: 'e', num: 7, title: 'e ticket 7', state: 'done', pr: 42 })
  })

  it('reads a Ticket from an older worfy, without Evidence items, as having none', () => {
    const old = ticket('e', 1, 'done', [])
    delete old.evidence
    expect(queue([project('p', [old])]).flatMap((group) => group.rows)).toEqual([])
  })
})
