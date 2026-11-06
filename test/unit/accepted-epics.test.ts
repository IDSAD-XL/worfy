import { describe, expect, it } from 'vitest'
import { acceptedEpics } from '../../src/shared/workflow/accepted-epics'
import type { Epic, Ticket, WorkflowModel } from '../../src/shared/workflow/types'

/** A Ticket of `epic` with the given number and state, no blockers, its own file. */
function ticket(epic: string, num: number, state: Ticket['state'] = 'open', over: Partial<Ticket> = {}): Ticket {
  return {
    epic,
    num,
    slug: `t${num}`,
    title: `${num}`,
    statusRaw: state,
    state,
    blockedRaw: null,
    blockedNums: [],
    blockedParsed: true,
    files: [`src/${epic}/t${num}.ts`],
    filesListed: true,
    fromBranch: null,
    ...over,
  }
}

const epic = (name: string, acceptedAt: string | null | undefined): Epic => ({
  epic: name,
  hasSpec: true,
  hasMap: false,
  title: null,
  ...(acceptedAt === undefined ? {} : { specStatus: acceptedAt === null ? 'draft' : `accepted ${acceptedAt}`, acceptedAt }),
})

const model = (epics: Epic[], tickets: Ticket[]): WorkflowModel => ({ root: '/repo', epics, tickets, error: null, branchErrors: [] })

const names = (m: WorkflowModel): string[] => acceptedEpics(m).map((e) => e.epic)

describe('acceptedEpics', () => {
  it('lists the accepted Epics with a ready Ticket, oldest acceptance first', () => {
    const m = model(
      [epic('late', '2026-11-06'), epic('early', '2026-10-07'), epic('middle', '2026-11-04')],
      [ticket('late', 1), ticket('early', 1), ticket('middle', 1)],
    )
    expect(names(m)).toEqual(['early', 'middle', 'late'])
    expect(acceptedEpics(m)[0]).toMatchObject({ epic: 'early', acceptedAt: '2026-10-07' })
  })

  it('orders Epics accepted on one day by name', () => {
    const m = model([epic('beta', '2026-11-04'), epic('alpha', '2026-11-04')], [ticket('beta', 1), ticket('alpha', 1)])
    expect(names(m)).toEqual(['alpha', 'beta'])
  })

  it('leaves out a closed Epic: every Ticket done', () => {
    const m = model([epic('closed', '2026-10-01'), epic('open', '2026-10-02')], [ticket('closed', 1, 'done'), ticket('closed', 2, 'done'), ticket('open', 1)])
    expect(names(m)).toEqual(['open'])
  })

  it('leaves out an Epic without a ready Ticket: in work, blocked, or waiting for an open blocker', () => {
    const m = model(
      [epic('busy', '2026-10-01'), epic('stuck', '2026-10-02'), epic('waits', '2026-10-03'), epic('none', '2026-10-04')],
      [
        ticket('busy', 1, 'work'),
        ticket('stuck', 1, 'blocked'),
        ticket('waits', 1, 'work'),
        ticket('waits', 2, 'open', { blockedRaw: '01', blockedNums: [1] }),
      ],
    )
    expect(names(m)).toEqual([])
  })

  it('leaves out an Epic the owner has not accepted, or whose Harness sends no date', () => {
    const m = model([epic('draft', null), epic('old-harness', undefined), epic('yes', '2026-10-05')], [ticket('draft', 1), ticket('old-harness', 1), ticket('yes', 1)])
    expect(names(m)).toEqual(['yes'])
  })

  it('counts a ready Ticket of the Epic itself, not of another Epic', () => {
    const m = model([epic('a', '2026-10-01'), epic('b', '2026-10-02')], [ticket('a', 1, 'done'), ticket('b', 1)])
    expect(names(m)).toEqual(['b'])
  })
})
