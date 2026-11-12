// Checks shared by the tests of the windows drawn in the kit's Dialog (theme/kit/Dialog.tsx; the
// windows of the Projects, worfy-ui-kit ticket 05): the focus stays in the window on Tab, and the
// window sits on the dialog layer of the scale.
import { act } from '@testing-library/react'
import { expect } from 'vitest'
import { KIT_DIALOG_ATTRIBUTE } from '../../src/renderer/theme/kit/Dialog'
import { LAYERS } from '../../src/renderer/theme/layers'
import { pressTab } from './tab-key'

/** Lets Base UI's effects and frames run. */
export const flush = (): Promise<void> => act(() => new Promise<void>((resolve) => setTimeout(resolve, 20)))

/** The stops of Tab inside `window`, in order: enabled, not hidden, tabindex not negative. */
export function tabStops(window: HTMLElement): HTMLElement[] {
  return [...window.querySelectorAll<HTMLElement>('*')].filter(
    (element) => element.tabIndex >= 0 && !(('disabled' in element && element.disabled === true) || element.closest('[hidden], [inert]') !== null),
  )
}

/** Tab on the last stop of `window` goes to its first, Shift+Tab there back to the last: the focus never leaves. */
export async function expectTabStaysIn(window: HTMLElement): Promise<void> {
  const stops = tabStops(window)
  expect(stops.length).toBeGreaterThan(1)
  stops.at(-1)!.focus()
  await pressTab()
  expect(document.activeElement).toBe(stops[0])
  await pressTab(true)
  expect(document.activeElement).toBe(stops.at(-1))
}

/** The z-index of the layer `element` is drawn in: of its ancestor right under <body>. */
export function layerOf(element: Element): number {
  let layer = element
  while (layer.parentElement !== null && layer.parentElement !== document.body) layer = layer.parentElement
  return Number((layer as HTMLElement).style.zIndex)
}

/** The window is drawn on the dialog layer of the scale, on the kit's backdrop. */
export function expectKitWindow(window: HTMLElement): void {
  expect(window.getAttribute('role')).toBe('dialog')
  expect(window.getAttribute('aria-modal')).toBe('true')
  expect(window.hasAttribute(KIT_DIALOG_ATTRIBUTE)).toBe(true)
  expect(window.parentElement?.classList.contains('w-kit-dialog__backdrop')).toBe(true)
  expect(layerOf(window)).toBe(LAYERS.dialog)
}
