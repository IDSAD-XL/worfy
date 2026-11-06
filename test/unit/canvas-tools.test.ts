// The form and the description of the canvas tool autopilot_start (worfy-flight-recorder ticket 23,
// ADR-0091): `epic` or a queue `epics` (worfy-autopilot-queue ticket 15), `tickets` an optional list of Ticket numbers (owner's answer Q4),
// and the description says when an agent calls it.
import { describe, expect, it } from 'vitest'
import { MAX_QUEUE_EPICS } from '../../src/shared/autopilot/epic-queue'
import { AUTOPILOT_TICKETS_MAX, CANVAS_TOOL_NAMES, autopilotStartTarget, autopilotTicketNums, canvasToolDescriptions, parseToolArgs } from '../../src/shared/canvas/tools'

describe('autopilot_start: the form', () => {
  it('is one of the canvas tools', () => {
    expect(CANVAS_TOOL_NAMES).toContain('autopilot_start')
  })

  it('takes an Epic alone: the whole Epic runs', () => {
    const parsed = parseToolArgs('autopilot_start', { epic: 'worfy-mvp' })
    expect(parsed.success).toBe(true)
    expect(parsed.data).toEqual({ epic: 'worfy-mvp' })
    expect(autopilotTicketNums(parsed.data?.tickets)).toBeUndefined()
  })

  it('takes named Tickets as the user says them, and as numbers', () => {
    const named = parseToolArgs('autopilot_start', { epic: 'worfy-mvp', tickets: ['05', '06'] })
    expect(named.success).toBe(true)
    expect(autopilotTicketNums(named.data?.tickets)).toEqual([5, 6])
    const numbers = parseToolArgs('autopilot_start', { epic: 'worfy-mvp', tickets: [7, ' 24 ', 7] })
    expect(numbers.success).toBe(true)
    // A Ticket named twice is one Ticket.
    expect(autopilotTicketNums(numbers.data?.tickets)).toEqual([7, 24])
  })

  // worfy-autopilot-queue ticket 15: `epic` or the queue `epics`, exactly one of the two (autopilotStartTarget).
  it('takes a queue of Epics; a queue of one is the Epic alone', () => {
    const parsed = parseToolArgs('autopilot_start', { epics: ['worfy-mvp', 'worfy-guide'] })
    expect(parsed.success).toBe(true)
    expect(autopilotStartTarget(parsed.data!)).toEqual({ epic: 'worfy-mvp', epics: ['worfy-mvp', 'worfy-guide'] })
    expect(autopilotStartTarget({ epics: ['worfy-mvp'], tickets: ['05'] })).toEqual({ epic: 'worfy-mvp', tickets: [5] })
    expect(autopilotStartTarget({ epic: 'worfy-mvp' })).toEqual({ epic: 'worfy-mvp' })
  })

  it('refuses neither epic nor epics, both, an Epic named twice and Tickets with a queue, in words', () => {
    expect(() => autopilotStartTarget({ tickets: ['05'] })).toThrow(/epic, or epics/u)
    expect(() => autopilotStartTarget({ epic: 'a', epics: ['a', 'b'] })).toThrow('Give either epic or epics, not both')
    expect(() => autopilotStartTarget({ epics: ['a', 'b', 'a'] })).toThrow('Epic a is named twice in epics')
    expect(() => autopilotStartTarget({ epics: ['a', 'b'], tickets: ['05'] })).toThrow('tickets are named only with one Epic, not with a queue of Epics')
  })

  it(`refuses an empty queue, a malformed Epic in it and more than ${MAX_QUEUE_EPICS} Epics`, () => {
    for (const epics of [[], ['a', 'b/05'], Array.from({ length: MAX_QUEUE_EPICS + 1 }, (_, index) => `e${index}`)]) {
      expect(parseToolArgs('autopilot_start', { epics }).success, JSON.stringify(epics)).toBe(false)
    }
  })

  it('refuses an empty list, Ticket 0, a word for a number, a malformed Epic and a list too long', () => {
    for (const args of [
      { epic: 'worfy-mvp', tickets: [] },
      { epic: 'worfy-mvp', tickets: ['00'] },
      { epic: 'worfy-mvp', tickets: [0] },
      { epic: 'worfy-mvp', tickets: ['five'] },
      { epic: 'worfy-mvp', tickets: [1.5] },
      { epic: 'worfy-mvp/05' },
      { epic: '' },
      { epic: 'worfy-mvp', tickets: Array.from({ length: AUTOPILOT_TICKETS_MAX + 1 }, (_, index) => index + 1) },
    ]) {
      expect(parseToolArgs('autopilot_start', args).success, JSON.stringify(args)).toBe(false)
    }
  })

  it('drops keys it does not declare', () => {
    const parsed = parseToolArgs('autopilot_start', { epic: 'worfy-mvp', confirmed: true, by: 'button' })
    expect(parsed.data).toEqual({ epic: 'worfy-mvp' })
  })
})

describe('autopilot_start: the description', () => {
  const description = canvasToolDescriptions.autopilot_start

  it('says when to call it: the user asks in words to run on autopilot, autonomously or automatically', () => {
    expect(description).toMatch(/only when the user asks/u)
    expect(description).toMatch(/autopilot/u)
    expect(description).toMatch(/autonomously/u)
    expect(description).toMatch(/automatically/u)
  })

  it('says to pass the named Tickets, and that the user confirms first', () => {
    expect(description).toMatch(/tickets: \["05", "06"\]/u)
    expect(description).toMatch(/whole Epic/u)
    expect(description).toMatch(/confirms in a dialog/u)
    expect(description).toMatch(/up to 10 minutes/u)
    expect(description).toMatch(/Refused in an unattended/u)
  })
})
