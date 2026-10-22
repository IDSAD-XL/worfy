// The window that draws the Live page of a Browser (src/main/browser/owner.ts; ADR-0078 item 16,
// worfy-browser ticket 07): the window where the user worked with it last; a closed window hands
// the page to another one; a single window owns it by itself.
import { describe, expect, it } from 'vitest'
import { NO_OWNER, nextOwners, ownerOf, ownersAmong, type OwnerEvent } from '../../src/main/browser/owner'

const show = (window: number): OwnerEvent => ({ kind: 'show', window })
const work = (window: number): OwnerEvent => ({ kind: 'work', window })
const leave = (window: number): OwnerEvent => ({ kind: 'leave', window })

describe('the owner of a Browser’s Live page', () => {
  it('is the one window that shows the Project, without any work in it', () => {
    expect(ownerOf([show(1)])).toBe(1)
    expect(ownerOf([show(1), show(1)])).toBe(1)
    // A window that is the only one again owns the page once the other left.
    expect(ownerOf([show(1), show(2), work(2), leave(2)])).toBe(1)
  })

  it('is the window where the user worked with the Browser last', () => {
    expect(ownerOf([show(1), show(2)])).toBe(1)
    expect(ownerOf([show(1), show(2), work(2)])).toBe(2)
    expect(ownerOf([show(1), show(2), work(2), work(1)])).toBe(1)
    expect(ownerOf([show(1), show(2), show(3), work(3), work(2)])).toBe(2)
    // A window that shows the Project later does not take the page.
    expect(ownerOf([show(1), work(1), show(2)])).toBe(1)
  })

  it('goes to another window when the owner closes: the one worked in most recently, else the one that came first', () => {
    expect(ownerOf([show(1), show(2), leave(1)])).toBe(2)
    expect(ownerOf([show(1), show(2), show(3), work(3), work(2), leave(2)])).toBe(3)
    expect(ownerOf([show(1), show(2), show(3), work(3), leave(3)])).toBe(1)
    // Another window closing leaves the owner as it is.
    expect(ownerOf([show(1), show(2), work(2), leave(1)])).toBe(2)
    expect(ownerOf([show(1), leave(1)])).toBeNull()
    expect(ownerOf([leave(4)])).toBeNull()
  })

  it('follows the windows that show the Project now', () => {
    const state = [show(1), show(2), work(2)].reduce(nextOwners, NO_OWNER)
    expect(ownersAmong(state, [1, 2])).toEqual(state)
    expect(ownersAmong(state, [1]).owner).toBe(1)
    expect(ownersAmong(state, [1, 2, 3]).owner).toBe(2)
    expect(ownersAmong(state, [3])).toEqual({ owner: 3, windows: [3] })
    expect(ownersAmong(NO_OWNER, [])).toEqual(NO_OWNER)
  })
})
