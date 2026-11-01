// The plan of an Epic's Waves from its spec.md (worfy-flight-recorder ticket 22): both shapes of the
// table, ranges, Tickets already done, and the refusal that asks for the Tickets by number when the
// plan cannot say. The texts are excerpts of real spec.md files of this repository (Russian
// headings, as those files have them).
import { describe, expect, it } from 'vitest'
import { nameTheTicketsHint, parseWavePlan, ticketsOfCell, waveTickets } from '../../src/shared/workflow/wave-plan'
import type { Ticket } from '../../src/shared/workflow/types'

/** The shape `Ticket | Files | Wave`, one row per Ticket: .scratch/worfy-flight-recorder/spec.md. */
const FLIGHT_RECORDER = [
  '# worfy-flight-recorder: история Run на одной шкале',
  '',
  '## Ticket-ы',
  '',
  '| Тикет | Что |',
  '| --- | --- |',
  '| 10 | разбор |',
  '',
  '## Волны',
  '',
  'Wave — Ticket-ы, которые можно брать параллельно.',
  '',
  '| Тикет | Файлы из «Где в коде» | Волна |',
  '| --- | --- | --- |',
  '| 10 | `test/fixtures/flight-recorder/night-run/`, `scripts/critical-path.mjs` | 1 |',
  '| 12 | `src/shared/flight-recorder/spans.ts`, `src/shared/flight-recorder/summary.ts` | 1 |',
  '| 21 | `src/shared/autopilot/cycle.ts`, `src/main/autopilot/run.ts` | 1 |',
  '| 11 | `src/shared/autopilot/journal.ts`, `src/main/autopilot/run.ts` | 2 |',
  '| 14 | `src/shared/flight-recorder/from-transcript.ts` | 2 |',
  '| 15 | `src/shared/flight-recorder/from-github.ts` | 2 |',
  '| 16 | `src/shared/flight-recorder/from-gate.ts` | 2 |',
  '| 22 | `src/shared/autopilot/chat-command.ts`, `src/shared/workflow/wave-plan.ts` | 2 |',
  '| 23 | `src/shared/canvas/tools.ts` | 2 |',
  '| 13 | `src/shared/flight-recorder/from-journal.ts` | 3 |',
  '| 25 | `.scratch/worfy-flight-recorder/spec.md` | 8 |',
  '',
  'Правило плана. Ticket стоит в первой Wave, где закрыты все его блокеры.',
  '',
  '## Риски',
  '',
  '| Волна | Ticket-ы |',
  '| --- | --- |',
  '| 2 | 99 |',
].join('\n')

/** The shape `Wave | Tickets`, one row per Wave, with a range: .scratch/worfy-guide/spec.md. */
const GUIDE = [
  '## Волны',
  '',
  '| Волна | Ticket-ы | Кто и когда |',
  '|---|---|---|',
  '| 1 | 01 | после `worfy-onboarding` 13 и 14 |',
  '| 2 | 02 | owner |',
  '| 5 | 05, 09 | Map и ссылки |',
  '| 6 | 06, 07, 08 | Topic-и пилота |',
  '| 8 | 11–19 | по три Topic-а за раз |',
  '| 9 | 20 | закрытие |',
].join('\n')

const ticket = (epic: string, num: number, state: Ticket['state'], fromBranch: string | null = null) => ({ epic, num, state, fromBranch })

describe('parseWavePlan', () => {
  it('reads the table with one row per Ticket, only in the Waves section', () => {
    const plan = parseWavePlan(FLIGHT_RECORDER)
    expect(plan?.get(1)).toEqual([10, 12, 21])
    expect(plan?.get(2)).toEqual([11, 14, 15, 16, 22, 23])
    expect(plan?.get(3)).toEqual([13])
    expect(plan?.get(8)).toEqual([25])
    expect(plan?.has(4)).toBe(false)
  })

  it('reads the table with one row per Wave, ranges and lists', () => {
    const plan = parseWavePlan(GUIDE)
    expect(plan?.get(8)).toEqual([11, 12, 13, 14, 15, 16, 17, 18, 19])
    expect(plan?.get(6)).toEqual([6, 7, 8])
    expect(plan?.get(5)).toEqual([5, 9])
    expect(plan?.get(1)).toEqual([1])
  })

  it('reads English headings, emphasis and a hyphen range', () => {
    const plan = parseWavePlan(['# Epic', '', '### Waves', '', '| **Wave** | Tickets |', '| :-- | --: |', '| **1** | `03-05`, 08 |'].join('\n'))
    expect(plan?.get(1)).toEqual([3, 4, 5, 8])
  })

  it('has no plan without the section, without a table in it, or without both columns', () => {
    expect(parseWavePlan('# Epic\n\n## Ticket-ы\n\n| Волна | Ticket-ы |\n| --- | --- |\n| 1 | 01 |\n')).toBeNull()
    expect(parseWavePlan('## Волны\n\n- Wave 1 — 01, 02.\n')).toBeNull()
    expect(parseWavePlan('## Волны\n\n| Волна | Что |\n| --- | --- |\n| 1 | 01 |\n')).toBeNull()
  })

  it('the section ends at the next heading of its level; a deeper heading stays in it', () => {
    expect(parseWavePlan('## Волны\n\nПлан ниже.\n\n## Риски\n\n| Волна | Ticket-ы |\n| --- | --- |\n| 1 | 01 |\n')).toBeNull()
    expect(parseWavePlan('## Волны\n\n### План\n\n| Волна | Ticket-ы |\n| --- | --- |\n| 1 | 01 |\n')?.get(1)).toEqual([1])
  })

  it('a table without rows is no plan', () => {
    expect(parseWavePlan('## Волны\n\n| Волна | Ticket-ы |\n| --- | --- |\n\nПозже.\n')).toBeNull()
  })

  it('does not guess: a Wave cell that is not a number spoils the table, a Tickets cell its Wave', () => {
    expect(parseWavePlan('## Волны\n\n| Тикет | Волна |\n| --- | --- |\n| 01 | 1 |\n| 02 | позже |\n')).toBeNull()
    const plan = parseWavePlan('## Волны\n\n| Тикет | Волна |\n| --- | --- |\n| 01 | 1 |\n| 02 (после 01) | 2 |\n| 03 | 2 |\n| 04 | 3 |\n')
    expect(plan?.get(1)).toEqual([1])
    expect(plan?.get(2)).toBeNull()
    expect(plan?.get(3)).toEqual([4])
  })
})

describe('ticketsOfCell', () => {
  it.each<[string, number[] | null]>([
    ['05', [5]],
    ['05, 09', [5, 9]],
    ['11–19', [11, 12, 13, 14, 15, 16, 17, 18, 19]],
    ['01, 03—04', [1, 3, 4]],
    ['02, 02', [2]],
    ['', null],
    ['—', null],
    ['19–11', null],
    ['1–500', Array.from({ length: 500 }, (_, at) => at + 1)],
    ['1–600', null],
    ['01 и 02', null],
  ])('%j', (cell, tickets) => {
    expect(ticketsOfCell(cell)).toEqual(tickets)
  })
})

describe('waveTickets', () => {
  const EPIC = 'worfy-flight-recorder'

  it('gives the Tickets of the Wave that are not done; one done only in its branch stays', () => {
    const tickets = [ticket(EPIC, 11, 'done'), ticket(EPIC, 14, 'work'), ticket(EPIC, 15, 'done', 'worfy-flight-recorder/15'), ticket('other', 16, 'done')]
    expect(waveTickets(FLIGHT_RECORDER, EPIC, 2, tickets)).toEqual({ ok: true, tickets: [14, 15, 16, 22, 23] })
  })

  it('a range of the guide: the done ones drop out', () => {
    const tickets = [11, 12, 13].map((num) => ticket('worfy-guide', num, 'done'))
    expect(waveTickets(GUIDE, 'worfy-guide', 8, tickets)).toEqual({ ok: true, tickets: [14, 15, 16, 17, 18, 19] })
  })

  it('refuses with the hint to name the Tickets when the plan cannot say', () => {
    const hint = nameTheTicketsHint('demo')
    expect(hint).toBe('name the Tickets: tickets NN, NN of epic demo')
    expect(waveTickets(null, 'demo', 1, [])).toEqual({ ok: false, message: `Epic demo has no spec.md to read Wave 1 from: ${hint}` })
    expect(waveTickets('# Demo\n', 'demo', 1, [])).toEqual({ ok: false, message: `The Waves table of Epic demo cannot be read: ${hint}` })
    expect(waveTickets(GUIDE, 'demo', 4, [])).toEqual({ ok: false, message: `The plan of Epic demo has no Wave 4: ${hint}` })
    expect(waveTickets('## Волны\n\n| Тикет | Волна |\n| --- | --- |\n| 02 (после 01) | 2 |\n', 'demo', 2, [])).toEqual({ ok: false, message: `Wave 2 of Epic demo cannot be read: ${hint}` })
  })

  it('refuses a Wave whose Tickets are all done', () => {
    expect(waveTickets(GUIDE, 'worfy-guide', 5, [ticket('worfy-guide', 5, 'done'), ticket('worfy-guide', 9, 'done')])).toEqual({
      ok: false,
      message: 'Every Ticket of Wave 5 of Epic worfy-guide is done',
    })
  })
})
