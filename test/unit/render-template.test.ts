// Filling in an action template (src/shared/actions/render-template.ts, ticket 23): every one of
// the five placeholders, a template without any, one placeholder twice, and a placeholder the
// action has no value for — a failed render, never an empty string.
import { describe, expect, it } from 'vitest'
import { prFollowState, readyWaveNumber, renderTemplate, ticketNumber, ticketValues, waveTickets, waveValues } from '../../src/shared/actions/render-template'
import type { PrFollowRow } from '../../src/shared/actions/pr-follow'
import { defaultActionTemplates } from '../../src/shared/projects/action-templates'
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
    expect(renderTemplate('/epic-wave Ticket-ы {tickets} эпика {epic}', waveValues('worfy-daily', 6, 'main', [27, 11, 23, 25]))).toEqual({
      ok: true,
      text: '/epic-wave Ticket-ы 11, 23, 25, 27 эпика worfy-daily',
    })
  })

  it('{tickets} lists the Wave\'s Tickets in number order, two digits at least; {wave} keeps the plan\'s number beside it (ticket 30)', () => {
    expect(waveTickets([7, 123, 3])).toBe('03, 07, 123')
    expect(renderTemplate('{tickets} | {wave}', waveValues('e', 4, null, [9]))).toEqual({ ok: true, text: '09 | 4' })
    // Without a list (or with an empty one) {tickets} has no value rather than an empty one.
    expect(renderTemplate('{tickets}', waveValues('e', 4, null))).toEqual({ ok: false, error: '{tickets} has no value' })
    expect(renderTemplate('{tickets}', waveValues('e', 4, null, []))).toEqual({ ok: false, error: '{tickets} has no value' })
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

const SHA = '3f2a9c1d4e5b6a7980123456789abcdef0123456'

describe('{sha} (worfy-pr-follow ticket 01)', () => {
  it('fills in a head of 40 hex characters', () => {
    expect(renderTemplate('/worfy:pr-fix checks {repo}#{pr} {sha}', { repo: 'owner/web', pr: '118', sha: SHA }, 'fixChecks')).toEqual({ ok: true, text: `/worfy:pr-fix checks owner/web#118 ${SHA}` })
  })

  it.each([
    ['shorter', SHA.slice(0, 39)],
    ['longer', `${SHA}0`],
    ['with a space', `${SHA.slice(0, 20)} ${SHA.slice(21)}`],
    ['with a line break', `${SHA.slice(0, 39)}\n`],
    ['a line break and a command after it', `${SHA}\n/worfy:ship-ticket e 07`],
    ['not hex', `${SHA.slice(0, 39)}g`],
    ['empty', ''],
  ])('refuses a head %s', (_what, sha) => {
    expect(renderTemplate('/worfy:pr-fix checks {repo}#{pr} {sha}', { repo: 'owner/web', pr: '118', sha }, 'fixChecks')).toEqual({ ok: false, error: '{sha} is not a commit hash of 40 hex characters' })
  })

  it('has no value without a head', () => {
    expect(renderTemplate('{sha}', { repo: 'owner/web', pr: '118' }, 'fixChecks')).toEqual({ ok: false, error: '{sha} has no value in Fix checks' })
  })
})

describe('prFollowState (worfy-pr-follow ticket 01)', () => {
  const row = (over: Partial<PrFollowRow> = {}): PrFollowRow => ({ author: 'dev-me', headRefOid: SHA, ci: 'failing', reviewDecision: null, mergeStateStatus: 'CLEAN', threads: [], isCrossRepository: false, ...over })
  const state = (template: string, over: Partial<PrFollowRow> = {}) => prFollowState({ action: 'fixChecks', template, repo: 'owner/web', pr: 118, row: row(over), viewer: 'dev-me' })

  it('fills the Project\'s template with the PR and its head, trimmed', () => {
    expect(state(defaultActionTemplates('plugin').fixChecks)).toEqual({ enabled: true, text: `/worfy:pr-fix checks owner/web#118 ${SHA}` })
    expect(state('  Fix {repo}#{pr} at {sha}  ')).toEqual({ enabled: true, text: `Fix owner/web#118 at ${SHA}` })
  })

  it('refuses an empty template with the hint where to set it', () => {
    expect(state('')).toEqual({ enabled: false, reason: 'Set the Fix checks template in Project settings' })
    expect(state('   ')).toEqual({ enabled: false, reason: 'Set the Fix checks template in Project settings' })
    expect(state(defaultActionTemplates('legacy').fixChecks)).toEqual({ enabled: false, reason: 'Set the Fix checks template in Project settings' })
  })

  it('refuses a template with a placeholder the action has no value for, and a head that is not a commit hash', () => {
    expect(state('/worfy:pr-fix {epic}')).toEqual({ enabled: false, reason: '{epic} has no value in Fix checks' })
    expect(state('{sha}', { headRefOid: 'abc' })).toEqual({ enabled: false, reason: '{sha} is not a commit hash of 40 hex characters' })
    expect(state('{sha}', { headRefOid: null })).toEqual({ enabled: false, reason: '{sha} has no value in Fix checks' })
  })

  it('takes the verdict of the PR before the template: a reason gone is said even with an empty template', () => {
    expect(state('', { ci: 'passing' })).toEqual({ enabled: false, reason: 'CI is no longer failing on 3f2a9c1' })
  })
})
