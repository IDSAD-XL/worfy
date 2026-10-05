// Filling in an action template (src/shared/actions/render-template.ts, ticket 23): every one of
// the five placeholders, a template without any, one placeholder twice, and a placeholder the
// action has no value for — a failed render, never an empty string.
import { describe, expect, it } from 'vitest'
import { readyWaveNumber, renderTemplate, ticketNumber, ticketValues, waveValues } from '../../src/shared/actions/render-template'
import type { Ticket } from '../../src/shared/workflow/types'

const ticket = { epic: 'worfy-mvp', num: 7, slug: 'движок-сессий' }

describe('renderTemplate', () => {
  it('fills in all five placeholders', () => {
    const values = { ...ticketValues(ticket, 'main'), wave: '3' }
    expect(renderTemplate('{epic} {NN} {wave} {slug} {branch}', values)).toEqual({ ok: true, text: 'worfy-mvp 07 3 движок-сессий main' })
  })

  it('renders the default templates', () => {
    expect(renderTemplate('/ship-ticket {epic} {NN}', ticketValues(ticket, 'main'))).toEqual({ ok: true, text: '/ship-ticket worfy-mvp 07' })
    expect(renderTemplate('/epic-wave волна {wave} эпика {epic}', waveValues('worfy-mvp', 3, 'main'))).toEqual({ ok: true, text: '/epic-wave волна 3 эпика worfy-mvp' })
  })

  it('leaves a template without placeholders as it is', () => {
    expect(renderTemplate('/ship-ticket now, please', ticketValues(ticket, null))).toEqual({ ok: true, text: '/ship-ticket now, please' })
  })

  it('fills in a placeholder each time it appears', () => {
    expect(renderTemplate('{NN}: {epic}/{NN} {NN}', ticketValues(ticket, null))).toEqual({ ok: true, text: '07: worfy-mvp/07 07' })
  })

  it('fails on a placeholder the action has no value for, naming it once', () => {
    expect(renderTemplate('/epic-wave {wave} {NN} {NN}', waveValues('worfy-mvp', 3, 'main'), 'runWave')).toEqual({ ok: false, error: '{NN} has no value in Run wave' })
    expect(renderTemplate('/ship-ticket {epic} {wave}', ticketValues(ticket, 'main'), 'shipTicket')).toEqual({ ok: false, error: '{wave} has no value in Ship ticket' })
    // git could not say the branch: {branch} has no value rather than an empty one.
    expect(renderTemplate('{branch}', ticketValues(ticket, null))).toEqual({ ok: false, error: '{branch} has no value' })
    expect(renderTemplate('{wave}', waveValues('e', null, null))).toEqual({ ok: false, error: '{wave} has no value' })
  })

  it('fails on an unknown placeholder', () => {
    expect(renderTemplate('/ship {ticket}', ticketValues(ticket, 'main'))).toEqual({ ok: false, error: 'Unknown placeholder {ticket}' })
  })

  it('a value that looks like a placeholder is not filled in again', () => {
    expect(renderTemplate('{branch} {epic}', { epic: 'e', branch: '{epic}' })).toEqual({ ok: true, text: '{epic} e' })
  })
})

describe('values', () => {
  it('NN has a leading zero; three digits stay', () => {
    expect([ticketNumber(7), ticketNumber(23), ticketNumber(123)]).toEqual(['07', '23', '123'])
  })
})

const t = (num: number, state: Ticket['state'], blockedNums: number[] = [], files: string[] = [`src/f${num}.ts`]): Ticket => ({
  epic: 'e',
  num,
  slug: `s${num}`,
  title: `T${num}`,
  statusRaw: state,
  state,
  blockedRaw: null,
  blockedNums,
  blockedParsed: true,
  files,
  filesListed: true,
  fromBranch: null,
})

describe('readyWaveNumber', () => {
  it('counts the Wave in the Epic\'s plan, where every Ticket is open, as the spec table does', () => {
    // Plan: wave 1 = 01, 02; wave 2 = 03 (after 01); wave 3 = 04 (after 03).
    const plan = [t(1, 'open'), t(2, 'open'), t(3, 'open', [1]), t(4, 'open', [3])]
    expect(readyWaveNumber(plan, 'e')).toBe(1)
    expect(readyWaveNumber([t(1, 'done'), t(2, 'done'), t(3, 'done', [1]), t(4, 'open', [3])], 'e')).toBe(3)
    // 02 still open from wave 1 while 03 is ready too: the earliest Wave of the ready Tickets.
    expect(readyWaveNumber([t(1, 'done'), t(2, 'open'), t(3, 'open', [1]), t(4, 'open', [3])], 'e')).toBe(1)
  })

  it('is null when nothing is ready', () => {
    expect(readyWaveNumber([t(1, 'work'), t(2, 'open', [1])], 'e')).toBeNull()
    expect(readyWaveNumber([t(1, 'done')], 'e')).toBeNull()
  })
})
