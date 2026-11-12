// The one helper that knows which layers are open over the page (theme/open-layers.ts, worfy-ui-kit
// ticket 02): a dialog, a menu and the list of a Select. Six places used to look for the roles
// themselves; they take the helper now.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Popover } from '@base-ui/react/popover'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { escapeBelongsToPopup, isOpenLayer, KIT_POPUP_ATTRIBUTE, layerOf, openLayers } from '../../src/renderer/theme/open-layers'

const added: Element[] = []

afterEach(() => {
  cleanup()
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

  it.each(['data-ending-style', 'data-closed'])('a Base UI popup still in the page but closing (%s) is not an open layer (ticket 03)', (mark) => {
    const open = put('menu')
    const closing = put('dialog')
    closing.setAttribute(mark, '')
    expect(openLayers()).toEqual([open])
    expect(isOpenLayer(closing)).toBe(false)
  })

  it('a real Base UI Popover kept in the page after it closed is not an open layer', async () => {
    function Kept() {
      const [shown, setShown] = useState(true)
      return (
        <Popover.Root open={shown} onOpenChange={setShown} modal={false}>
          <Popover.Trigger>Open</Popover.Trigger>
          <Popover.Portal keepMounted>
            <Popover.Positioner>
              <Popover.Popup aria-label="Kept" data-testid="kept">
                <button type="button" onClick={() => setShown(false)}>
                  Done
                </button>
              </Popover.Popup>
            </Popover.Positioner>
          </Popover.Portal>
        </Popover.Root>
      )
    }
    render(<Kept />)
    const popup = await screen.findByTestId('kept')
    expect(isOpenLayer(popup)).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 20)))
    expect(popup.isConnected).toBe(true)
    expect(isOpenLayer(popup)).toBe(false)
    expect(openLayers()).toEqual([])
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

describe('whether Esc in a field belongs to an open kit popup (ticket 03)', () => {
  const field = (): HTMLElement => {
    const element = document.body.appendChild(document.createElement('textarea'))
    added.push(element)
    return element
  }
  const kitPopup = (role = 'dialog', parent: Element = document.body): HTMLElement => {
    const popup = put(role, parent)
    popup.setAttribute(KIT_POPUP_ATTRIBUTE, '')
    return popup
  }

  it('an open kit popup elsewhere takes the press; a popup of any role, or none, counts', () => {
    const input = field()
    const tooltip = document.body.appendChild(document.createElement('div'))
    tooltip.setAttribute(KIT_POPUP_ATTRIBUTE, '')
    added.push(tooltip)
    expect(escapeBelongsToPopup(input)).toBe(true)
  })

  it('a closing, hidden or removed kit popup does not', () => {
    const input = field()
    const closing = kitPopup('menu')
    closing.setAttribute('data-ending-style', '')
    const hidden = kitPopup()
    hidden.hidden = true
    kitPopup().remove()
    expect(escapeBelongsToPopup(input)).toBe(false)
  })

  it("the kit popup the field is in does not: the press is that popup's own", () => {
    const popup = kitPopup()
    const input = popup.appendChild(document.createElement('input'))
    expect(escapeBelongsToPopup(input)).toBe(false)
  })

  it('a layer that is not a kit popup does not: its own Esc sits on the layer, not on the document', () => {
    const input = field()
    put('dialog')
    put('listbox')
    expect(escapeBelongsToPopup(input)).toBe(false)
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
