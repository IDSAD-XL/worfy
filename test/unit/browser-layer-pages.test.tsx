// The pages of the Browser layer (src/renderer/canvas/overlays/browser-pages.ts, worfy-browser
// ticket 14): what the layer reads from React Flow's store, which profile it opens each page under
// and what it writes into the Nodes. The layer must pick as the frame does (browserProfileChoice over
// the Node's own data): an old Browser — no `profile` key — keeps its page on `default`, and a new
// one (`profile: null`) never does. And, for focus mode (worfy-browser ticket 17), where a page goes
// to lie on its frame's body in a tile and what the window tells main it shows.
import type { ReactFlowState } from '@xyflow/react'
import { describe, expect, it } from 'vitest'
import { browserProfileChoice } from '../../src/renderer/canvas/nodes/browser-frame'
import { pagesKey, placeBrowserPages, profileWrites, screenShown, tilePlacement, type BrowserLayerPage } from '../../src/renderer/canvas/overlays/browser-pages'
import type { LayoutNode } from '../../src/shared/layout/types'

const PROJECT = 'alpha-0a1b2c3d'
const page = 'http://127.0.0.1:3000/page.html'
const p = (...ids: string[]) => ids.map((id) => ({ id }))

/** React Flow's store with these Nodes, as pagesKey reads it. */
function store(...nodes: { id: string; kind?: string; data: Record<string, unknown>; hidden?: boolean }[]): Pick<ReactFlowState, 'nodeLookup'> {
  const lookup = new Map<string, unknown>()
  for (const { id, kind = 'browser', data, hidden = false } of nodes) {
    const node: LayoutNode = { id, kind, x: 10, y: 20, w: 300, h: 200, hidden, locked: false, pinned: false, tags: [], data }
    lookup.set(id, { id, type: kind, hidden, internals: { positionAbsolute: { x: 10, y: 20 } }, width: 300, height: 200, measured: {}, data: { node } })
  }
  return { nodeLookup: lookup } as unknown as Pick<ReactFlowState, 'nodeLookup'>
}

/** The pages as the layer has them: through the string of its selector and back. */
const pagesOf = (state: Pick<ReactFlowState, 'nodeLookup'>) => JSON.parse(pagesKey(state)) as BrowserLayerPage[]

describe('the profile the Browser layer opens a page under, as the frame picks it', () => {
  const old = store({ id: 'b0', data: { url: page } })

  it('keeps an old Browser (a page address, no `profile` key) on `default` while it exists, and writes `default` into it', () => {
    const placed = placeBrowserPages(pagesOf(old), p('default', 'admin-aaaaaa'), PROJECT)
    expect(placed.map(({ choice }) => choice)).toEqual([{ kind: 'use', id: 'default', write: true }])
    expect(placed[0]?.partition).toBe('persist:worfy-browser-0a1b2c3d-default')
    expect(profileWrites(placed)).toEqual([{ id: 'b0', profile: 'default' }])
  })

  it('asks for an old Browser whose `default` was deleted, also with one other profile left: no page, nothing written', () => {
    for (const profiles of [p('work-bbbbbb'), p('work-bbbbbb', 'admin-aaaaaa')]) {
      const placed = placeBrowserPages(pagesOf(old), profiles, PROJECT)
      expect(placed.map(({ choice, partition }) => [choice, partition]), JSON.stringify(profiles)).toEqual([[{ kind: 'choose', reason: 'deleted' }, null]])
      expect(profileWrites(placed)).toEqual([])
    }
  })

  it('asks for a new Browser (`profile: null`) with several profiles even when it has an address: no page, nothing written', () => {
    const placed = placeBrowserPages(pagesOf(store({ id: 'b1', data: { profile: null, url: page } })), p('default', 'admin-aaaaaa'), PROJECT)
    expect(placed.map(({ choice, partition }) => [choice, partition])).toEqual([[{ kind: 'choose', reason: 'several' }, null]])
    expect(profileWrites(placed)).toEqual([])
  })

  it('picks for every Browser exactly what the frame picks from the Node\'s own data', () => {
    const datas: Record<string, unknown>[] = [{ url: page }, {}, { profile: null }, { profile: null, url: page }, { profile: 'admin-aaaaaa' }, { profile: 'gone-000000', url: page }, { profile: 7, url: page }]
    const state = store(...datas.map((data, index) => ({ id: `b${index}`, data })))
    for (const profiles of [p('default', 'admin-aaaaaa'), p('admin-aaaaaa'), p('default'), p(), undefined]) {
      const placed = placeBrowserPages(pagesOf(state), profiles, PROJECT)
      expect(
        placed.map(({ choice }) => choice),
        JSON.stringify(profiles),
      ).toEqual(datas.map((data) => browserProfileChoice(data, profiles)))
    }
  })

  it('has no page for a hidden Browser or a Node of another kind, and keeps the pages in id order', () => {
    const pages = pagesOf(store({ id: 'b2', data: {} }, { id: 'b1', data: { url: page } }, { id: 'b3', data: {}, hidden: true }, { id: 'n1', kind: 'note', data: { url: page } }))
    expect(pages.map(({ id, url }) => [id, url])).toEqual([
      ['b1', page],
      ['b2', null],
    ])
  })

  it('opens no page while the profiles are not read, or without a Project', () => {
    expect(placeBrowserPages(pagesOf(old), undefined, PROJECT).map(({ partition }) => partition)).toEqual([null])
    expect(placeBrowserPages(pagesOf(old), p('default'), undefined).map(({ partition }) => partition)).toEqual([null])
  })
})

describe('a page in a focus tile (worfy-browser ticket 17)', () => {
  it('lies on the tile body: placed in Canvas units from the layer origin, scaled back by the Canvas zoom', () => {
    // The layer's origin at (100, 60) on the window, the Canvas at zoom 0.5; the body at (245, 108), 1150 × 787.
    const placed = tilePlacement({ x: 245, y: 108, width: 1150, height: 787 }, { x: 100, y: 60 }, 0.5)
    expect(placed).toEqual({ x: 290, y: 96, w: 1150, h: 787, zoom: 0.5 })
    // Through the viewport's scale and the page's scale(1 / zoom): the body's place and size on the window.
    expect([100 + placed.x * placed.zoom, 60 + placed.y * placed.zoom, placed.w * placed.zoom * (1 / placed.zoom)]).toEqual([245, 108, 1150])
    expect(tilePlacement({ x: 10, y: 20, width: 30, height: 40 }, { x: 0, y: 0 }, 2)).toEqual({ x: 5, y: 10, w: 30, h: 40, zoom: 2 })
  })

  const pages: BrowserLayerPage[] = [
    { id: 'near', url: null, x: 0, y: 0, w: 100, h: 100 },
    { id: 'far', url: null, x: 5000, y: 5000, w: 100, h: 100 },
  ]
  const view = (zoom: number) => ({ transform: [0, 0, zoom] as [number, number, number], width: 800, height: 600 })

  it('counts the Browsers in tiles alone as shown, wherever their frames are on the Canvas, at zoom 1', () => {
    expect(screenShown(view(1), pages, [])).toEqual({ visible: ['near'], zoom: 1 })
    expect(screenShown(view(1), pages, ['far'])).toEqual({ visible: ['far'], zoom: 1 })
    expect(screenShown(view(0.25), pages, ['far'])).toEqual({ visible: ['far'], zoom: 1 })
    expect(screenShown(view(2), pages, ['far'])).toEqual({ visible: ['far'], zoom: 1 })
    expect(screenShown(view(0.25), pages, ['far', 'near'])).toEqual({ visible: ['near', 'far'], zoom: 1 })
  })

  it('leaves the zoom as the Canvas has it when no tile shows a Browser of this Canvas', () => {
    expect(screenShown(view(0.25), pages, [])).toEqual({ visible: ['near'], zoom: 0.25 })
    expect(screenShown(view(0.25), pages, ['gone'])).toEqual({ visible: ['near'], zoom: 0.25 })
  })
})
