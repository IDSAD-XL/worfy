// The order of the sidebar's Epics section and its «Older» group (worfy-polish ticket 98,
// src/renderer/shell/sidebar/epics-order.ts). Every time is built from one `now`, never a fixed date.
import { describe, expect, it } from 'vitest'
import { arrangeEpics, EPICS_OLDER_AFTER_MS, lastWorkOf, olderFoldKey, timeOf } from '../../src/renderer/shell/sidebar/epics-order'
import { EPICS_OLDER_AFTER, EPICS_OLDER_AFTER_DEFAULT, epicsOlderAfterOf } from '../../src/shared/settings/app-settings'
import type { Epic, Ticket } from '../../src/shared/workflow/types'

const HOUR = 60 * 60_000
const DAY = 24 * HOUR
const NOW = Date.now()
/** A `Status:` time as the Harness writes it: minutes, `Z`. */
const stamp = (ago: number): string => new Date(NOW - ago).toISOString().slice(0, 16) + 'Z'

const epic = (name: string, specAgo: number | null = null): Epic => ({
  epic: name,
  hasSpec: true,
  hasMap: false,
  title: null,
  ...(specAgo === null ? {} : { specAt: new Date(NOW - specAgo).toISOString() }),
})
const ticket = (name: string, num: number, state: Ticket['state'], ago: number | null): Ticket =>
  ({ epic: name, num, slug: `t${num}`, title: `T${num}`, statusRaw: state, state, statusAt: ago === null ? null : stamp(ago) }) as unknown as Ticket

const names = (rows: { epic: Epic }[]): string[] => rows.map((row) => row.epic.epic)

describe('lastWorkOf', () => {
  it('is the newest status change of the Tickets, the spec time ignored', () => {
    expect(lastWorkOf(epic('e', HOUR), [ticket('e', 1, 'done', 5 * DAY), ticket('e', 2, 'blocked', 2 * DAY), ticket('e', 3, 'open', null)])).toBe(timeOf(stamp(2 * DAY)))
  })

  it('is the spec time while no Ticket has changed status, and null without either', () => {
    expect(lastWorkOf(epic('e', 3 * HOUR), [ticket('e', 1, 'open', null)])).toBe(NOW - 3 * HOUR)
    expect(lastWorkOf(epic('e'), [ticket('e', 1, 'open', null)])).toBeNull()
    expect(lastWorkOf({ specAt: null }, [])).toBeNull()
  })

  it('reads a date alone as its midnight UTC and skips a time that does not read', () => {
    expect(timeOf('2026-10-17')).toBe(Date.UTC(2026, 9, 17))
    expect(timeOf('2026-10-17T09:41Z')).toBe(Date.UTC(2026, 9, 17, 9, 41))
    expect(timeOf('soon')).toBeNull()
    expect(lastWorkOf(epic('e', HOUR), [{ statusAt: 'soon' }])).toBe(NOW - HOUR)
  })
})

describe('arrangeEpics', () => {
  // The fixture of the e2e spec: an Epic in work with an old claim, a fresh one, a closed and an open one 8 days old.
  const epics = [epic('closed-old', 40 * DAY), epic('fresh', 30 * DAY), epic('in-work', 40 * DAY), epic('open-old', 40 * DAY), epic('spec-only', HOUR), epic('no-time')]
  const tickets = [
    ticket('closed-old', 1, 'done', 8 * DAY),
    ticket('closed-old', 2, 'done', 9 * DAY),
    ticket('fresh', 1, 'done', 2 * HOUR),
    ticket('fresh', 2, 'open', null),
    ticket('in-work', 1, 'work', 20 * DAY),
    ticket('in-work', 2, 'done', 25 * DAY),
    ticket('open-old', 1, 'done', 8 * DAY),
    ticket('open-old', 2, 'open', null),
    ticket('spec-only', 1, 'open', null),
    ticket('no-time', 1, 'open', null),
  ]

  it('puts Epics in work first, then the rest by last work, newest first; no known time last', () => {
    const { recent, older } = arrangeEpics(epics, tickets, NOW, 'never')
    expect(names(recent)).toEqual(['in-work', 'spec-only', 'fresh', 'closed-old', 'open-old', 'no-time'])
    expect(older).toEqual([])
  })

  it('moves an Epic without work for the threshold into «Older», closed or open alike; one in work stays', () => {
    const { recent, older } = arrangeEpics(epics, tickets, NOW, '7d')
    expect(names(recent)).toEqual(['in-work', 'spec-only', 'fresh', 'no-time'])
    expect(names(older)).toEqual(['closed-old', 'open-old'])
    expect(recent[0]).toMatchObject({ working: true, lastWork: timeOf(stamp(20 * DAY)) })
  })

  it('follows the threshold: 3 days takes the same two, 30 days none of them', () => {
    expect(names(arrangeEpics(epics, tickets, NOW, '3d').older)).toEqual(['closed-old', 'open-old'])
    expect(names(arrangeEpics(epics, tickets, NOW, '30d').older)).toEqual([])
  })

  it('takes an Epic into «Older» only past the threshold, not at it', () => {
    const at = [epic('edge')]
    const done = [{ ...ticket('edge', 1, 'done', null), statusAt: new Date(NOW).toISOString() }]
    expect(arrangeEpics(at, done, NOW + 7 * DAY, '7d').older).toEqual([])
    expect(names(arrangeEpics(at, done, NOW + 7 * DAY + 1, '7d').older)).toEqual(['edge'])
  })

  it('keeps the name order for equal times, so two reads give one order', () => {
    const same = [epic('b', HOUR), epic('a', HOUR), epic('c', HOUR)]
    expect(names(arrangeEpics(same, [], NOW, '7d').recent)).toEqual(['a', 'b', 'c'])
  })
})

describe('the setting', () => {
  it('offers Never, 3, 7 and 30 days, 7 days by default, each with its span', () => {
    expect(EPICS_OLDER_AFTER).toEqual(['never', '3d', '7d', '30d'])
    expect(EPICS_OLDER_AFTER_DEFAULT).toBe('7d')
    expect(epicsOlderAfterOf({})).toBe('7d')
    expect(epicsOlderAfterOf({ epicsOlderAfter: 'never' })).toBe('never')
    expect(EPICS_OLDER_AFTER_MS).toEqual({ never: null, '3d': 3 * DAY, '7d': 7 * DAY, '30d': 30 * DAY })
  })
})

describe('olderFoldKey', () => {
  it('is one section id per Project, from the path hash of its id', () => {
    expect(olderFoldKey('my project.é-0a1b2c3d')).toBe('EpicsOlder-0a1b2c3d')
    expect(olderFoldKey('other-ffffffff')).not.toBe(olderFoldKey('my project.é-0a1b2c3d'))
    expect(olderFoldKey('shop-1')).toBe('EpicsOlder-shop-1')
    expect(olderFoldKey('a b/c')).toMatch(/^[A-Za-z0-9][\w-]{0,99}$/u)
  })
})
