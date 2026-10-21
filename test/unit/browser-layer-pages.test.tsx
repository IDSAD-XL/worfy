// The pages of the Browser layer (src/renderer/canvas/overlays/browser-pages.ts, worfy-browser
// ticket 14): what the layer reads from React Flow's store, which profile it opens each page under
// and what it writes into the Nodes. The layer must pick as the frame does (browserProfileChoice over
// the Node's own data): an old Browser — no `profile` key — keeps its page on `default`, and a new
// one (`profile: null`) never does.
import type { ReactFlowState } from '@xyflow/react'
import { describe, expect, it } from 'vitest'
import { browserProfileChoice } from '../../src/renderer/canvas/nodes/browser-frame'
import { pagesKey, placeBrowserPages, profileWrites, type BrowserLayerPage } from '../../src/renderer/canvas/overlays/browser-pages'
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
