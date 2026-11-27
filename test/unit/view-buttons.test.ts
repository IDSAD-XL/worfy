// The model of the View button layout (worfy-layout ticket 02; Seam 1 of the spec's test decisions): which
// of the six View buttons sits in which zone, and in what order. The repair rule is the one a file
// written by another build of worfy meets on read.
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_VIEW_BUTTONS,
  isDefault,
  moveToZone,
  moveWithin,
  repairViewButtons,
  VIEW_BUTTON_IDS,
  VIEW_ZONES,
  type ViewButtons,
} from '../../src/shared/layout/view-buttons'
import { accessOf } from '../../src/shared/ipc/channels'
import { routeOf } from '../../src/renderer/ipc'
import { DEFAULT_APP_SETTINGS, viewButtonsOf } from '../../src/shared/settings/app-settings'

const DEFAULT = { header: ['canvas', 'session'], rail: ['pull-requests', 'acceptance'], footer: ['pipeline', 'history'] }

/** Every id once, in zone order: the invariant each layout keeps (Q6 — a View button cannot be hidden). */
function ids(layout: ViewButtons): string[] {
  return VIEW_ZONES.flatMap((zone) => layout[zone]).toSorted()
}

describe('the View button model', () => {
  it('has six ids, three zones and the default of Q1 and Q12', () => {
    expect([...VIEW_BUTTON_IDS].toSorted()).toEqual(['acceptance', 'canvas', 'history', 'pipeline', 'pull-requests', 'session'])
    expect(VIEW_ZONES).toEqual(['header', 'rail', 'footer'])
    expect(DEFAULT_VIEW_BUTTONS).toEqual(DEFAULT)
    expect(isDefault(DEFAULT_VIEW_BUTTONS)).toBe(true)
  })
})

describe('repairViewButtons', () => {
  it('keeps a whole layout as it is, in a copy', () => {
    const raw = { header: ['history', 'canvas'], rail: [], footer: ['session', 'pipeline', 'acceptance', 'pull-requests'] }
    const repaired = repairViewButtons(raw)
    expect(repaired).toEqual(raw)
    expect(repaired.header).not.toBe(raw.header)
  })

  it('drops an unknown id: a view a newer build has, or one this build removed', () => {
    expect(repairViewButtons({ header: ['canvas', 'timeline', 'session'], rail: ['pull-requests', 7, null, 'acceptance'], footer: ['pipeline', 'history', 'canvas-2'] })).toEqual(DEFAULT)
  })

  it('keeps the first of a repeated id, in zone order header, rail, footer', () => {
    expect(repairViewButtons({ header: ['canvas', 'session', 'canvas'], rail: ['history', 'pull-requests', 'acceptance'], footer: ['pipeline', 'history', 'session'] })).toEqual({
      header: ['canvas', 'session'],
      rail: ['history', 'pull-requests', 'acceptance'],
      footer: ['pipeline'],
    })
  })

  it('puts a missing id — a view added later — at the end of its default zone', () => {
    expect(repairViewButtons({ header: ['session'], rail: ['history'], footer: ['acceptance'] })).toEqual({
      header: ['session', 'canvas'],
      rail: ['history', 'pull-requests'],
      footer: ['acceptance', 'pipeline'],
    })
    expect(repairViewButtons({ header: [], rail: [], footer: [] })).toEqual(DEFAULT)
  })

  it.each([
    ['nothing', undefined],
    ['null', null],
    ['a string', 'header'],
    ['an array', [['canvas'], [], []]],
    ['a zone that is no array', { header: 'canvas', rail: [], footer: [] }],
    ['a zone missing', { header: ['canvas'], rail: ['session'] }],
  ])('gives the default layout for the wrong shape: %s', (_case, raw) => {
    expect(repairViewButtons(raw)).toEqual(DEFAULT)
  })

  it('ignores a zone this build does not know', () => {
    expect(repairViewButtons({ ...DEFAULT, header: ['canvas'], dock: ['session'] })).toEqual({ ...DEFAULT, header: ['canvas', 'session'] })
  })
})

describe('moveWithin', () => {
  const layout: ViewButtons = { header: ['canvas', 'session', 'history'], rail: ['pull-requests', 'acceptance'], footer: ['pipeline'] }

  it('moves a button to a new place in its zone and leaves the layout it was given as it was', () => {
    expect(moveWithin(layout, 'header', 0, 2)).toEqual({ ...layout, header: ['session', 'history', 'canvas'] })
    expect(moveWithin(layout, 'header', 2, 0)).toEqual({ ...layout, header: ['history', 'canvas', 'session'] })
    expect(moveWithin(layout, 'rail', 1, 0)).toEqual({ ...layout, rail: ['acceptance', 'pull-requests'] })
    expect(layout.header).toEqual(['canvas', 'session', 'history'])
  })

  it('keeps a target past either end at that end, and changes nothing for a place the zone does not have', () => {
    expect(moveWithin(layout, 'header', 0, 9)).toEqual({ ...layout, header: ['session', 'history', 'canvas'] })
    expect(moveWithin(layout, 'header', 2, -3)).toEqual({ ...layout, header: ['history', 'canvas', 'session'] })
    expect(moveWithin(layout, 'header', 3, 0)).toEqual(layout)
    expect(moveWithin(layout, 'footer', -1, 0)).toEqual(layout)
    expect(moveWithin(layout, 'header', 1, 1)).toEqual(layout)
  })
})

describe('moveToZone', () => {
  it('without an index, puts the button at the end of the zone', () => {
    const moved = moveToZone(DEFAULT_VIEW_BUTTONS, 'canvas', 'footer')
    expect(moved).toEqual({ header: ['session'], rail: ['pull-requests', 'acceptance'], footer: ['pipeline', 'history', 'canvas'] })
    expect(ids(moved)).toEqual([...VIEW_BUTTON_IDS].toSorted())
    expect(DEFAULT_VIEW_BUTTONS.header).toEqual(['canvas', 'session'])
  })

  it('with an index, puts it at that place; an index past either end is that end', () => {
    expect(moveToZone(DEFAULT_VIEW_BUTTONS, 'history', 'header', 0)).toEqual({ ...DEFAULT, header: ['history', 'canvas', 'session'], footer: ['pipeline'] })
    expect(moveToZone(DEFAULT_VIEW_BUTTONS, 'history', 'rail', 1)).toEqual({ ...DEFAULT, rail: ['pull-requests', 'history', 'acceptance'], footer: ['pipeline'] })
    expect(moveToZone(DEFAULT_VIEW_BUTTONS, 'history', 'rail', 99)).toEqual({ ...DEFAULT, rail: ['pull-requests', 'acceptance', 'history'], footer: ['pipeline'] })
    expect(moveToZone(DEFAULT_VIEW_BUTTONS, 'history', 'rail', -1)).toEqual({ ...DEFAULT, rail: ['history', 'pull-requests', 'acceptance'], footer: ['pipeline'] })
  })

  it('into its own zone, the index is a place among the others', () => {
    expect(moveToZone(DEFAULT_VIEW_BUTTONS, 'canvas', 'header')).toEqual({ ...DEFAULT, header: ['session', 'canvas'] })
    expect(moveToZone(DEFAULT_VIEW_BUTTONS, 'session', 'header', 0)).toEqual({ ...DEFAULT, header: ['session', 'canvas'] })
  })

  it('may empty a zone', () => {
    const moved = moveToZone(moveToZone(DEFAULT_VIEW_BUTTONS, 'pipeline', 'header'), 'history', 'header')
    expect(moved).toEqual({ header: ['canvas', 'session', 'pipeline', 'history'], rail: ['pull-requests', 'acceptance'], footer: [] })
  })
})

describe('isDefault', () => {
  it('is true only for the default zones in the default order', () => {
    expect(isDefault({ header: ['canvas', 'session'], rail: ['pull-requests', 'acceptance'], footer: ['pipeline', 'history'] })).toBe(true)
    expect(isDefault(moveWithin(DEFAULT_VIEW_BUTTONS, 'header', 0, 1))).toBe(false)
    expect(isDefault(moveToZone(DEFAULT_VIEW_BUTTONS, 'canvas', 'footer'))).toBe(false)
    expect(isDefault(moveToZone(moveToZone(DEFAULT_VIEW_BUTTONS, 'canvas', 'footer'), 'canvas', 'header', 0))).toBe(true)
  })
})

describe('viewButtonsOf', () => {
  it('is the default layout while the settings hold none, and the stored one once they do', () => {
    expect(DEFAULT_APP_SETTINGS).not.toHaveProperty('viewButtons')
    expect(viewButtonsOf(DEFAULT_APP_SETTINGS)).toEqual(DEFAULT)
    const stored: ViewButtons = { header: ['session'], rail: ['canvas', 'pull-requests', 'acceptance'], footer: ['pipeline', 'history'] }
    expect(viewButtonsOf({ viewButtons: stored })).toEqual(stored)
  })

  // Q13 of the spec: a window on a Linked machine's Project shows the layout of this computer. No
  // channel of its own does it: the app settings channels are `local`, and a `local` channel of such a
  // window goes to this Machine's main, not to the Linked machine.
  it('comes to a window on a Linked machine from this Machine: the app settings channels route here', () => {
    for (const channel of ['appSettings.get', 'appSettings.set', 'appSettings.changed']) {
      // Declared, so the route below comes from the mark, not from the fallback for an unknown name.
      expect(accessOf(channel), channel).toBe('local')
      expect(routeOf(channel), channel).toBe('this-machine')
    }
  })
})
