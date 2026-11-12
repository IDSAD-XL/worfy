import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ProbeDialog, ProbePopover } from '../../src/renderer/spike/BaseUiSpike'

// Spike worfy-ui-kit 01 (never merged): the app's own Select inside a modal Base UI Dialog, in the
// three ways of the spec, and how Base UI marks a handled Esc. jsdom has no layout and no hit
// testing, so the pointer part is checked again in test/e2e/spike-base-ui.spec.ts; here the dismiss
// logic, the aria-hidden marking and the Esc order. Each answer is printed as a `[spike-unit]` line.

const spike = (): { log: { probe: string; open: boolean; reason: string; defaultPrevented?: boolean }[]; escapes: { defaultPrevented: boolean }[] } =>
  (window as unknown as { __worfySpike: never }).__worfySpike

afterEach(() => {
  cleanup()
  spike().log.length = 0
  spike().escapes.length = 0
})

/** A pointer press as a browser sends it: pointerdown, mousedown, pointerup, mouseup, click. */
function press(element: Element): void {
  fireEvent.pointerDown(element, { button: 0, pointerType: 'mouse' })
  fireEvent.mouseDown(element, { button: 0 })
  fireEvent.pointerUp(element, { button: 0, pointerType: 'mouse' })
  fireEvent.mouseUp(element, { button: 0 })
  fireEvent.click(element, { button: 0 })
}

/** Whether the element or one of its ancestors is hidden from assistive tech. */
function hiddenFromAt(element: Element): string | null {
  for (let node: Element | null = element; node !== null; node = node.parentElement) {
    if (node.getAttribute('aria-hidden') === 'true') return `aria-hidden on ${node.tagName}.${node.className}`
    if (node.hasAttribute('inert')) return `inert on ${node.tagName}.${node.className}`
  }
  return null
}

const flush = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 20)))

describe.each(['body', 'inside', 'trap'] as const)('Select inside a modal Dialog, way %s', (way) => {
  const id = `d-${way}`

  async function openDialogAndList(): Promise<{ dialog: HTMLElement; button: HTMLElement; list: HTMLElement }> {
    render(<ProbeDialog id={id} way={way} />)
    press(screen.getByTestId(`${id}-trigger`))
    await flush()
    const dialog = screen.getByTestId(`${id}-popup`)
    const button = screen.getByTestId(`${id}-select`)
    press(button)
    await flush()
    const list = screen.getByTestId(`${id}-select-list`)
    return { dialog, button, list }
  }

  it('an option chosen with the mouse sets the value and leaves the window open', async () => {
    const { dialog, list } = await openDialogAndList()
    const beta = list.querySelector('[data-value="beta"]')!
    press(beta)
    await flush()
    const value = screen.getByTestId(`${id}-value`).textContent
    const open = dialog.isConnected
    console.log(`[spike-unit] ${way}: mouse pick -> value ${value}, window open ${open}, log ${JSON.stringify(spike().log)}`)
    expect(value).toBe('beta')
    expect(open).toBe(true)
  })

  it('Esc on the open list closes the list only; the next Esc closes the window', async () => {
    const { dialog, button } = await openDialogAndList()
    fireEvent.keyDown(button, { key: 'Escape' })
    await flush()
    const listGone = screen.queryByTestId(`${id}-select-list`) === null
    const open = dialog.isConnected
    fireEvent.keyDown(button, { key: 'Escape' })
    await flush()
    const closedAfterSecond = screen.queryByTestId(`${id}-popup`) === null
    console.log(`[spike-unit] ${way}: Esc on list -> list closed ${listGone}, window open ${open}; second Esc closes window ${closedAfterSecond}`)
    expect(listGone).toBe(true)
    expect(open).toBe(true)
    expect(closedAfterSecond).toBe(true)
  })

  it('the open list is not hidden from assistive tech', async () => {
    const { list } = await openDialogAndList()
    const hidden = hiddenFromAt(list)
    console.log(`[spike-unit] ${way}: list hidden from AT: ${hidden ?? 'no'}; canvas root hidden: ${hiddenFromAt(document.body.firstElementChild!) ?? 'no'}`)
    expect(hidden).toBeNull()
  })
})

describe('Esc on a Base UI Popover', () => {
  it('closes it, marks the press handled (preventDefault) and stops it at document', async () => {
    render(<ProbePopover id="p" />)
    press(screen.getByTestId('p-trigger'))
    await flush()
    const input = screen.getByTestId('p-input')
    fireEvent.keyDown(input, { key: 'Escape' })
    await flush()
    const entry = spike().log.find((each) => !each.open)
    console.log(`[spike-unit] popover Esc: ${JSON.stringify(entry)}; reached window: ${JSON.stringify(spike().escapes)}`)
    expect(entry?.reason).toBe('escape-key')
    expect(entry?.defaultPrevented).toBe(true)
    expect(spike().escapes).toHaveLength(0)
  })
})
