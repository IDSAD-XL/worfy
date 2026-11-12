// The one helper that knows which layers are open over the page (theme/open-layers.ts, worfy-ui-kit
// ticket 02): a dialog, a menu and the list of a Select. Six places used to look for the roles
// themselves; they take the helper now.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { isOpenLayer, layerOf, openLayers } from '../../src/renderer/theme/open-layers'

const added: Element[] = []

afterEach(() => {
  for (const element of added.splice(0)) element.remove()
})

/** An element of `role` put into `parent` (the page's body by default). */
function put(role: string, parent: Element = document.body): HTMLElement {
  const element = document.createElement('div')
  element.setAttribute('role', role)
  parent.append(element)
  if (parent === document.body) added.push(element)
  return element
}

describe('open layers', () => {
  it.each(['dialog', 'menu', 'listbox'])('an open %s is an open layer', (role) => {
    const layer = put(role)
    expect(openLayers()).toEqual([layer])
    expect(isOpenLayer(layer)).toBe(true)
  })

  it('finds every open layer of the page in document order, and of a part of it when given one', () => {
    const dialog = put('dialog')
    const menu = put('menu')
    const list = put('listbox', dialog)
    expect(openLayers()).toEqual([dialog, list, menu])
    expect(openLayers(dialog)).toEqual([list])
  })

  it('a layer inside a hidden view, or hidden itself, is not open', () => {
    const view = document.createElement('section')
    view.hidden = true
    document.body.append(view)
    added.push(view)
    const inHiddenView = put('dialog', view)
    const hidden = put('menu')
    hidden.hidden = true
    expect(openLayers()).toEqual([])
    expect(isOpenLayer(inHiddenView)).toBe(false)
    expect(isOpenLayer(hidden)).toBe(false)
  })

  it('a layer taken out of the page is not open', () => {
    const list = put('listbox')
    list.remove()
    expect(isOpenLayer(list)).toBe(false)
  })

  it('other roles are not layers', () => {
    const region = put('region')
    put('tooltip')
    put('alert')
    expect(openLayers()).toEqual([])
    expect(isOpenLayer(region)).toBe(false)
  })

  it('names the layer a key press is in: the element itself or the nearest layer around it', () => {
    const dialog = put('dialog')
    const list = put('listbox', dialog)
    const option = list.appendChild(document.createElement('div'))
    const outside = document.body.appendChild(document.createElement('button'))
    added.push(outside)
    expect(layerOf(option)).toBe(list)
    expect(layerOf(dialog)).toBe(dialog)
    expect(layerOf(outside)).toBeNull()
    expect(layerOf(window)).toBeNull()
    expect(layerOf(null)).toBeNull()
  })
})

describe('the places that ask whether a layer is open', () => {
  const PLACES = [
    'focus/FocusMode.tsx',
    'canvas/sources/epics.ts',
    'work-track/SpanPanel.tsx',
    'flight-recorder/RunHistoryView.tsx',
    'toast/ToastRegion.tsx',
    'pr-inbox/PrInboxView.tsx',
  ]

  it.each(PLACES)('%s takes the helper and looks for no layer role itself', (place) => {
    const source = readFileSync(join(import.meta.dirname, '../../src/renderer', place), 'utf8')
    expect(source).toMatch(/from '(\.\.\/)+theme\/open-layers'/)
    expect(source).not.toMatch(/\[role="(dialog|menu|listbox)"\]/)
  })
})
