// What focus mode's cover leaves of what is under its layer while a tile is see-through
// (src/renderer/focus/cover.ts, worfy-browser ticket 17): everything inert but the elements marked
// `shown` and the chain up to them, kept so as the DOM changes and taken back whole; and a keyboard
// focus that lands under the cover — a Card's script focusing its own field — goes back to the layer.
import { afterEach, describe, expect, it } from 'vitest'
import { COVERED_ATTRIBUTE, keepFocusOutOfCover, keepShownOnly, underFocusCover, UNDER_FOCUS_ATTRIBUTE } from '../../src/renderer/focus/cover'

/** Waits for the MutationObserver's callback. */
const settle = () => new Promise((done) => setTimeout(done, 0))

/** The ids of the inert elements under `root`, root included. */
function inertIds(root: Element): string[] {
  return [root, ...root.querySelectorAll('*')].filter((element) => element.hasAttribute('inert')).map((element) => element.id)
}

afterEach(() => {
  document.body.replaceChildren()
})

describe('keepShownOnly', () => {
  /** The Canvas as the cover finds it: nodes beside a layer of pages, one page shown. */
  function canvas(): HTMLElement {
    document.body.innerHTML = `
      <main id="root">
        <div id="toolbarish"><button id="button">b</button></div>
        <div id="flow">
          <div id="nodes"><div id="node1"><iframe id="card"></iframe></div></div>
          <div id="layer">
            <div id="p1" ${UNDER_FOCUS_ATTRIBUTE}="shown"><input id="in-page"></div>
            <div id="p2" ${UNDER_FOCUS_ATTRIBUTE}="kept"></div>
          </div>
        </div>
      </main>`
    return document.getElementById('root')!
  }

  it('makes inert every element off the chain to the shown ones, and nothing on it or in them', () => {
    const root = canvas()
    keepShownOnly(root)
    expect(inertIds(root).sort()).toEqual(['nodes', 'p2', 'toolbarish'])
  })

  it('makes the root inert while nothing in it is shown', () => {
    const root = canvas()
    document.getElementById('p1')!.setAttribute(UNDER_FOCUS_ATTRIBUTE, 'kept')
    keepShownOnly(root)
    expect(inertIds(root)).toEqual(['root'])
  })

  it('follows a page that turns shown inside a part already inert, and one that stops being shown', async () => {
    const root = canvas()
    document.getElementById('p1')!.setAttribute(UNDER_FOCUS_ATTRIBUTE, 'kept')
    keepShownOnly(root)
    document.getElementById('p1')!.setAttribute(UNDER_FOCUS_ATTRIBUTE, 'shown')
    await settle()
    expect(inertIds(root).sort()).toEqual(['nodes', 'p2', 'toolbarish'])
    document.getElementById('p1')!.setAttribute(UNDER_FOCUS_ATTRIBUTE, 'kept')
    await settle()
    expect(inertIds(root)).toEqual(['root'])
  })

  it('makes a new element beside the chain inert, and follows a shown page added inside an inert part', async () => {
    const root = canvas()
    keepShownOnly(root)
    const added = document.createElement('div')
    added.id = 'added'
    document.getElementById('flow')!.append(added)
    await settle()
    expect(inertIds(root)).toContain('added')
    const page = document.createElement('div')
    page.id = 'p3'
    page.setAttribute(UNDER_FOCUS_ATTRIBUTE, 'shown')
    document.getElementById('node1')!.append(page)
    await settle()
    expect(inertIds(root)).not.toContain('nodes')
    expect(inertIds(root)).not.toContain('node1')
    expect(inertIds(root)).toContain('card')
    expect(inertIds(root)).not.toContain('p3')
  })

  it('takes back only what it made inert', () => {
    const root = canvas()
    document.getElementById('toolbarish')!.setAttribute('inert', '')
    document.getElementById('in-page')!.setAttribute('inert', '')
    const undo = keepShownOnly(root)
    undo()
    expect(inertIds(root).sort()).toEqual(['in-page', 'toolbarish'])
  })

  it('stops following the DOM once taken back', async () => {
    const root = canvas()
    keepShownOnly(root)()
    document.getElementById('p1')!.setAttribute(UNDER_FOCUS_ATTRIBUTE, 'kept')
    await settle()
    expect(inertIds(root)).toEqual([])
  })
})

describe('keepFocusOutOfCover', () => {
  function shell(): { layer: HTMLElement; covered: HTMLInputElement; shown: HTMLInputElement; free: HTMLInputElement } {
    document.body.innerHTML = `
      <aside><input id="free"></aside>
      <main ${COVERED_ATTRIBUTE}><input id="covered"><div ${UNDER_FOCUS_ATTRIBUTE}="shown"><input id="shown"></div></main>
      <div id="layer" tabindex="-1"></div>`
    const get = (id: string) => document.getElementById(id) as HTMLInputElement
    return { layer: get('layer'), covered: get('covered'), shown: get('shown'), free: get('free') }
  }

  it('sends a focus under the cover back to the layer, and leaves one in a shown element or outside the cover', () => {
    const { layer, covered, shown, free } = shell()
    const stop = keepFocusOutOfCover(layer)
    covered.focus()
    expect(document.activeElement).toBe(layer)
    shown.focus()
    expect(document.activeElement).toBe(shown)
    free.focus()
    expect(document.activeElement).toBe(free)
    stop()
    covered.focus()
    expect(document.activeElement).toBe(covered)
  })

  it('looks again after the window loses the focus to a frame', async () => {
    const { layer, covered } = shell()
    const stop = keepFocusOutOfCover(layer)
    stop()
    covered.focus()
    const again = keepFocusOutOfCover(layer)
    window.dispatchEvent(new Event('blur'))
    expect(document.activeElement).toBe(covered)
    await settle()
    expect(document.activeElement).toBe(layer)
    again()
  })

  it('counts both covers: inert and the mark of a see-through tile', () => {
    const { covered, free } = shell()
    expect(underFocusCover(covered)).toBe(true)
    expect(underFocusCover(free)).toBe(false)
    free.parentElement!.setAttribute('inert', '')
    expect(underFocusCover(free)).toBe(true)
  })
})
