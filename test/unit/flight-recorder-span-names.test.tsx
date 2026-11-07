// The name of a Ticket row on the Run history screen (src/renderer/flight-recorder/span-words.ts,
// displayName; worfy-polish ticket 62): a Run over a queue of Epics may hold Ticket 01 of two Epics, so
// there a Ticket row names its Epic; a Run of one Epic names the number alone, as before.
import { describe, expect, it } from 'vitest'
import type { Span } from '../../src/shared/flight-recorder/spans'
import { displayName } from '../../src/renderer/flight-recorder/span-words'

const ticket = (name: string): Span => ({ id: `ticket:${name}`, kind: 'ticket', name }) as Span

describe('the name of a Ticket row', () => {
  it('in a Run over a queue of Epics, names the Epic of the Ticket', () => {
    const epics = ['alpha', 'beta']
    expect(displayName(ticket('alpha/01'), epics)).toBe('Ticket alpha/01')
    expect(displayName(ticket('beta/01'), epics)).toBe('Ticket beta/01')
  })

  it('in a Run of one Epic, is the number alone, as before', () => {
    expect(displayName(ticket('alpha/01'))).toBe('Ticket 01')
    expect(displayName(ticket('alpha/01'), ['alpha'])).toBe('Ticket 01')
  })

  it('names the other spans the same in both', () => {
    const wave = { id: 'wave:1', kind: 'wave', name: 'Wave 1 · beta' } as Span
    expect(displayName(wave, ['alpha', 'beta'])).toBe('Wave 1 · beta')
    expect(displayName(wave)).toBe('Wave 1 · beta')
  })
})
