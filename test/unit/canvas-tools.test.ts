// The form and the description of the canvas tool autopilot_start (worfy-flight-recorder ticket 23,
// ADR-0091): `epic` is required, `tickets` an optional list of Ticket numbers (owner's answer Q4),
// and the description says when an agent calls it.
import { describe, expect, it } from 'vitest'
import { AUTOPILOT_TICKETS_MAX, CANVAS_TOOL_NAMES, autopilotTicketNums, canvasToolDescriptions, parseToolArgs } from '../../src/shared/canvas/tools'

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

  it('refuses a call without an Epic, with the field named', () => {
    const parsed = parseToolArgs('autopilot_start', { tickets: ['05'] })
    expect(parsed.success).toBe(false)
    expect(parsed.error?.issues.map((issue) => issue.path.join('.'))).toContain('epic')
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
  })
})
